/**
 * Webhook Server
 *
 * HTTP server that accepts inbound webhooks from external services.
 * Webhooks are authenticated per-group with HMAC-SHA256 signatures
 * and converted into messages that the normal message loop processes.
 *
 * Endpoints:
 *   POST /webhook/:groupFolder  - Deliver a webhook message
 *   GET  /webhook/health        - Health check
 */

import http from 'http';
import crypto from 'crypto';

import { logger } from './logger.js';
import { RegisteredGroup, NewMessage } from './types.js';

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '9877', 10);
const WEBHOOK_HOST = process.env.WEBHOOK_HOST || '0.0.0.0';

// Max request body size (64KB — webhooks shouldn't be huge)
const MAX_BODY_SIZE = 65536;

export interface WebhookDeps {
  registeredGroups: () => Record<string, RegisteredGroup>;
  onMessage: (chatJid: string, msg: NewMessage) => void;
  onChatMetadata: (
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ) => void;
  getWebhookSecret: (groupFolder: string) => string | null;
}

/**
 * Verify HMAC-SHA256 signature on request body.
 * Signature expected in `X-Webhook-Signature` header as `sha256=<hex>`.
 */
function verifySignature(
  body: string,
  secret: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Find the JID for a group folder from registered groups.
 */
function findJidByFolder(
  registeredGroups: Record<string, RegisteredGroup>,
  folder: string,
): string | null {
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (group.folder === folder) return jid;
  }
  return null;
}

export function startWebhookServer(deps: WebhookDeps): http.Server | null {
  const server = http.createServer((req, res) => {
    const urlPath = req.url || '/';

    // Health check
    if (req.method === 'GET' && urlPath === '/webhook/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method !== 'POST' || !urlPath.startsWith('/webhook/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Extract group folder from path: /webhook/{groupFolder}
    const parts = urlPath.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] !== 'webhook') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'Invalid path. Use /webhook/{groupFolder}' }),
      );
      return;
    }

    const groupFolder = decodeURIComponent(parts[1]);

    // Read body with size limit
    let body = '';
    let oversize = false;

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        oversize = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (oversize) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }

      try {
        handleWebhook(deps, groupFolder, body, req.headers, res);
      } catch (err: any) {
        logger.error(
          { err: err.message, groupFolder },
          'Webhook handler error',
        );
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal error' }));
        }
      }
    });
  });

  server.on('error', (err: any) => {
    logger.error({ error: err }, 'Webhook server error');
  });

  server.listen(WEBHOOK_PORT, WEBHOOK_HOST, () => {
    logger.info(
      { host: WEBHOOK_HOST, port: WEBHOOK_PORT },
      'Webhook server started',
    );
  });

  return server;
}

function handleWebhook(
  deps: WebhookDeps,
  groupFolder: string,
  body: string,
  headers: http.IncomingHttpHeaders,
  res: http.ServerResponse,
): void {
  // Verify group exists
  const registeredGroups = deps.registeredGroups();
  const chatJid = findJidByFolder(registeredGroups, groupFolder);

  if (!chatJid) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Group not found' }));
    return;
  }

  // Verify signature
  const secret = deps.getWebhookSecret(groupFolder);
  if (!secret) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'Webhooks not configured for this group' }),
    );
    return;
  }

  const signature = headers['x-webhook-signature'] as string | undefined;
  if (!verifySignature(body, secret, signature)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid signature' }));
    return;
  }

  // Parse payload
  let payload: {
    text?: string;
    sender?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!payload.text) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing "text" field' }));
    return;
  }

  const timestamp = new Date().toISOString();
  const senderName = payload.sender || payload.source || 'Webhook';
  const msgId = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Store chat metadata
  deps.onChatMetadata(chatJid, timestamp, undefined, 'webhook', true);

  // Create and deliver message
  const msg: NewMessage = {
    id: msgId,
    chat_jid: chatJid,
    sender: 'webhook',
    sender_name: senderName,
    content: payload.text,
    timestamp,
    is_from_me: false,
  };

  deps.onMessage(chatJid, msg);

  logger.info(
    { groupFolder, chatJid, sender: senderName, length: payload.text.length },
    'Webhook message delivered',
  );

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, messageId: msgId }));
}
