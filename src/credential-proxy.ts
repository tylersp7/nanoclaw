/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 *
 * Cost tracking:
 *   Containers set ANTHROPIC_BASE_URL to http://host:port/track/{groupFolder}
 *   The proxy strips the /track/{groupFolder} prefix, forwards upstream,
 *   then parses the response to extract token usage for per-group cost tracking.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import { PassThrough } from 'stream';

import {
  extractGroupFromPath,
  parseNonStreamingUsage,
  parseStreamingUsage,
  recordTokenUsage,
} from './cost-tracker.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // Extract group folder from /track/{groupFolder}/... path prefix
        let groupFolder: string | null = null;
        let upstreamPath = req.url || '/';

        const trackInfo = extractGroupFromPath(upstreamPath);
        if (trackInfo) {
          groupFolder = trackInfo.groupFolder;
          upstreamPath = trackInfo.strippedPath;
        }

        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Determine if this is a messages endpoint (for token tracking)
        const isMessagesEndpoint = upstreamPath.includes('/v1/messages');

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: upstreamPath,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);

            if (isMessagesEndpoint && groupFolder && upRes.statusCode === 200) {
              // Tap into the response stream to extract token usage
              const responseChunks: Buffer[] = [];
              const isStreaming =
                upRes.headers['content-type']?.includes('text/event-stream') ??
                false;

              const passThrough = new PassThrough();
              upRes.pipe(passThrough);
              passThrough.pipe(res);

              passThrough.on('data', (chunk: Buffer) => {
                responseChunks.push(chunk);
              });

              passThrough.on('end', () => {
                try {
                  const responseBody =
                    Buffer.concat(responseChunks).toString('utf-8');
                  const usage = isStreaming
                    ? parseStreamingUsage(responseBody)
                    : parseNonStreamingUsage(responseBody);

                  if (usage && groupFolder) {
                    recordTokenUsage(groupFolder, usage);
                  }
                } catch (err) {
                  logger.debug(
                    { err, groupFolder },
                    'Failed to parse token usage from response',
                  );
                }
              });
            } else {
              // Non-tracked requests: pipe directly
              upRes.pipe(res);
            }
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
