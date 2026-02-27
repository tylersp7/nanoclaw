import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  WASocket,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  GROUPS_DIR,
  STORE_DIR,
} from '../config.js';
import { getLastGroupSync, setLastGroupSync, updateChatName } from '../db.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private groupSyncTimerStarted = false;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000; // 5 minutes max

  private opts: WhatsAppChannelOpts;

  constructor(opts: WhatsAppChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectInternal(resolve).catch(reject);
    });
  }

  private async connectInternal(onFirstOpen?: () => void): Promise<void> {
    const authDir = path.join(STORE_DIR, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const needsAuth = !state.creds.registered;
    let pairingCodeRequested = false;

    // Auto-fetch latest WhatsApp Web version, fallback to known-good version
    const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1034183557];
    let waVersion: [number, number, number] = FALLBACK_VERSION;
    try {
      const { version, isLatest, error } = await fetchLatestWaWebVersion();
      if (isLatest && version) {
        waVersion = version as [number, number, number];
        logger.info({ version: waVersion }, 'Fetched latest WA Web version');
      } else {
        logger.warn({ error, fallback: FALLBACK_VERSION }, 'Could not fetch latest WA version, using fallback');
      }
    } catch (err) {
      logger.warn({ err, fallback: FALLBACK_VERSION }, 'Failed to fetch WA version, using fallback');
    }

    this.sock = makeWASocket({
      version: waVersion,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: Browsers.macOS('Safari'),
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Request pairing code when QR is offered (socket is ready for auth)
      if (qr && needsAuth && !pairingCodeRequested) {
        pairingCodeRequested = true;
        const phoneNumber = typeof ASSISTANT_HAS_OWN_NUMBER === 'string' ? ASSISTANT_HAS_OWN_NUMBER : '19706923038';
        logger.info({ phoneNumber }, 'Requesting pairing code instead of QR');
        this.sock.requestPairingCode(phoneNumber).then((code) => {
          const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
          logger.info({ code: formattedCode }, 'PAIRING CODE — enter in WhatsApp > Linked Devices > Link with phone number');
          exec(
            `osascript -e 'display dialog "WhatsApp Pairing Code: ${formattedCode}\\n\\nOpen WhatsApp on phone > Linked Devices > Link a Device > Link with phone number instead" with title "NanoClaw" buttons {"OK"} default button "OK"'`,
          );
          fs.writeFileSync('/tmp/nanoclaw-pairing-code.txt', `${formattedCode}\n`);
        }).catch((err) => {
          logger.error({ err }, 'Failed to request pairing code, falling back to QR');
          // Fall back to QR code
          import('qrcode').then(m => {
            const qrPath = '/tmp/nanoclaw-qr.png';
            m.default.toFile(qrPath, qr, { scale: 8 }, () => {
              exec(`open "${qrPath}"`);
            });
          }).catch(() => {});
        });
      } else if (qr && !needsAuth) {
        // Already registered but session expired — show QR
        const msg = 'WhatsApp re-authentication required.';
        logger.error(msg);
        exec(
          `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
        );
        import('qrcode').then(m => {
          const qrPath = '/tmp/nanoclaw-qr.png';
          m.default.toFile(qrPath, qr, { scale: 8 }, () => {
            exec(`open "${qrPath}"`);
          });
        }).catch(() => {});
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        logger.info(
          {
            reason,
            shouldReconnect,
            queuedMessages: this.outgoingQueue.length,
          },
          'Connection closed',
        );

        if (shouldReconnect) {
          this.reconnectAttempts++;
          // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s, ... capped at 5 min
          const baseDelay = Math.min(
            2000 * Math.pow(2, this.reconnectAttempts - 1),
            WhatsAppChannel.MAX_RECONNECT_DELAY_MS
          );
          // Add jitter (±25%) to prevent thundering herd
          const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
          const delay = Math.round(baseDelay + jitter);
          logger.info({ attempt: this.reconnectAttempts, delayMs: delay }, `Reconnecting in ${Math.round(delay / 1000)}s...`);
          setTimeout(() => {
            this.connectInternal().catch((err) => {
              logger.error({ err }, 'Reconnection failed');
            });
          }, delay);
        } else {
          logger.info('Logged out. Run /setup to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        this.connected = true;
        this.reconnectAttempts = 0; // Reset backoff on successful connection
        logger.info('Connected to WhatsApp');

        // Mark as unavailable so mobile device receives push notifications
        // When marked as 'available', WhatsApp treats this as an active desktop client
        // and suppresses mobile notifications. Setting to 'unavailable' enables notifications.
        this.sock.sendPresenceUpdate('unavailable').catch(() => {});

        // Build LID to phone mapping from auth state for self-chat translation
        if (this.sock.user) {
          const phoneUser = this.sock.user.id.split(':')[0];
          const lidUser = this.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            this.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
            logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
          }
        }

        // Flush any messages queued while disconnected
        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );

        // Sync group metadata on startup (respects 24h cache)
        this.syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Initial group sync failed'),
        );
        // Set up daily sync timer (only once)
        if (!this.groupSyncTimerStarted) {
          this.groupSyncTimerStarted = true;
          setInterval(() => {
            this.syncGroupMetadata().catch((err) =>
              logger.error({ err }, 'Periodic group sync failed'),
            );
            this.cleanupOldMedia();
          }, GROUP_SYNC_INTERVAL_MS);
        }

        // Signal first connection to caller
        if (onFirstOpen) {
          onFirstOpen();
          onFirstOpen = undefined;
        }
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        // Translate LID JID to phone JID if applicable
        const chatJid = await this.translateJid(rawJid);

        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();

        // Always notify about chat metadata for group discovery
        const isGroup = chatJid.endsWith('@g.us');
        this.opts.onChatMetadata(
          chatJid,
          timestamp,
          undefined,
          'whatsapp',
          isGroup,
        );

        // Only deliver full message for registered groups
        const groups = this.opts.registeredGroups();
        if (groups[chatJid]) {
          const content =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

          // Skip protocol messages with no text content (encryption keys, read receipts, etc.)
          if (!content) continue;

          const sender = msg.key.participant || msg.key.remoteJid || '';
          const senderName = msg.pushName || sender.split('@')[0];

          const fromMe = msg.key.fromMe || false;
          // Detect bot messages: with own number, fromMe is reliable
          // since only the bot sends from that number.
          // With shared number, bot messages carry the assistant name prefix
          // (even in DMs/self-chat) so we check for that.
          const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
            ? fromMe
            : content.startsWith(`${ASSISTANT_NAME}:`);

          // Download image if present
          let mediaPath: string | undefined;
          if (msg.message?.imageMessage) {
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                logger,
                reuploadRequest: this.sock.updateMediaMessage,
              });
              if (buffer.length <= 15 * 1024 * 1024) {
                const mime = msg.message.imageMessage.mimetype || 'image/jpeg';
                const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
                const folder = groups[chatJid].folder;
                const mediaDir = path.join(GROUPS_DIR, folder, 'media');
                fs.mkdirSync(mediaDir, { recursive: true });
                const filename = `${msg.key.id}.${ext}`;
                fs.writeFileSync(path.join(mediaDir, filename), buffer);
                mediaPath = `media/${filename}`;
                logger.info({ chatJid, mediaPath, size: buffer.length }, 'Downloaded image');
              } else {
                logger.warn({ chatJid, size: buffer.length }, 'Image too large, skipping download');
              }
            } catch (err) {
              logger.error({ err, chatJid }, 'Failed to download image');
            }
          }

          this.opts.onMessage(chatJid, {
            id: msg.key.id || '',
            chat_jid: chatJid,
            sender,
            sender_name: senderName,
            content,
            timestamp,
            is_from_me: fromMe,
            is_bot_message: isBotMessage,
            media_path: mediaPath,
          });
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? text
      : `${ASSISTANT_NAME}: ${text}`;

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.info(
        { jid, length: prefixed.length, queueSize: this.outgoingQueue.length },
        'WA disconnected, message queued',
      );
      return;
    }
    try {
      await this.sock.sendMessage(jid, { text: prefixed });
      logger.info({ jid, length: prefixed.length }, 'Message sent');
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send, message queued',
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sock?.end(undefined);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      const status = isTyping ? 'composing' : 'paused';
      logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, jid);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update typing status');
    }
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via IPC.
   */
  async syncGroupMetadata(force = false): Promise<void> {
    if (!force) {
      const lastSync = getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from WhatsApp...');
      const groups = await this.sock.groupFetchAllParticipating();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          updateChatName(jid, metadata.subject);
          count++;
        }
      }

      setLastGroupSync();
      logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  private async translateJid(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      logger.debug(
        { lidJid: jid, phoneJid: cached },
        'Translated LID to phone JID (cached)',
      );
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await this.sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.lidToPhoneMap[lidUser] = phoneJid;
        logger.info(
          { lidJid: jid, phoneJid },
          'Translated LID to phone JID (signalRepository)',
        );
        return phoneJid;
      }
    } catch (err) {
      logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  private cleanupOldMedia(): void {
    try {
      const groups = this.opts.registeredGroups();
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - maxAge;
      for (const group of Object.values(groups)) {
        const mediaDir = path.join(GROUPS_DIR, group.folder, 'media');
        if (!fs.existsSync(mediaDir)) continue;
        for (const file of fs.readdirSync(mediaDir)) {
          const filePath = path.join(mediaDir, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            logger.debug({ filePath }, 'Cleaned up old media file');
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Media cleanup failed');
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing outgoing message queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        // Send directly — queued items are already prefixed by sendMessage
        await this.sock.sendMessage(item.jid, { text: item.text });
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}
