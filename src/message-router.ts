/**
 * Automatic Message Router
 *
 * Routes task output to the appropriate channel based on:
 * - Task category (vps-health → Telegram for urgent, Slack for reports)
 * - Message severity (CRITICAL/URGENT → Telegram, detailed reports → Slack)
 * - Message type (life-system nudges → Telegram, analytics → Slack)
 *
 * Destinations:
 * - Telegram: time-sensitive alerts, reminders, quick status, life-system
 * - Slack:    detailed reports, analytics digests, lead reports
 * - WhatsApp: conversational replies, interactive tasks (default)
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

interface Destination {
  name: string;
  targetJid: string;
  description: string;
}

/** Severity levels for automatic routing. */
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Routing decision: where to send the message and optionally a copy. */
export interface RouteDecision {
  /** Primary destination JID. */
  primaryJid: string;
  /** Optional secondary destination for cross-posting (e.g. Slack copy of urgent alert). */
  secondaryJid?: string;
  /** Why this route was chosen (for logging). */
  reason: string;
}

/** Load named destinations from the main group's IPC directory. */
function loadDestinations(): Destination[] {
  try {
    const destPath = path.join(DATA_DIR, 'ipc', 'main', 'destinations.json');
    const raw = fs.readFileSync(destPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getDestinationJid(name: string): string | null {
  const dests = loadDestinations();
  return dests.find((d) => d.name === name)?.targetJid ?? null;
}

/** Detect severity from message text. */
function detectSeverity(text: string): Severity {
  const lower = text.toLowerCase();
  // Critical: service down, OOM, fatal errors
  if (/\bcritical\b|\bfatal\b|\bemergency\b|\bpanic\b|\boom\b/i.test(text))
    return 'critical';
  if (
    /\bdown\b/i.test(text) &&
    /\b(server|vps|service|database|site|n8n)\b/i.test(text)
  )
    return 'critical';
  if (/🔴/.test(text)) return 'critical';

  // High: errors, failures, security issues
  if (/\berror\b|\bfailed\b|\bfailure\b|\bunreachable\b|\bdenied\b/i.test(text))
    return 'high';
  if (/\bsecurity\b.*\b(alert|issue|breach|vuln)/i.test(text)) return 'high';
  if (/🟡|YELLOW/i.test(text) && /RED|🔴/i.test(text)) return 'high';

  // Medium: warnings, degraded performance
  if (/\bwarning\b|\bdegraded\b|\bhigh usage\b|\brestarting\b/i.test(text))
    return 'medium';
  if (/🟡|YELLOW/i.test(text)) return 'medium';

  // Low: notices, completed tasks
  if (/\bnotice\b|\brecovered\b|\bresolved\b/i.test(text)) return 'low';

  return 'info';
}

/**
 * Route a task's output to the appropriate channel.
 *
 * @param taskCategory - The task's category (e.g. vps-health, analytics, life-system)
 * @param text - The message text to route
 * @param originJid - The task's original chat_jid (fallback destination)
 * @returns Routing decision with primary and optional secondary JID
 */
export function routeTaskOutput(
  taskCategory: string | null,
  text: string,
  originJid: string,
): RouteDecision {
  const telegramJid = getDestinationJid('reminders');
  const slackJid = getDestinationJid('findings');
  const severity = detectSeverity(text);

  // --- VPS Health & Security ---
  if (taskCategory === 'vps-health') {
    if (severity === 'critical' || severity === 'high') {
      // Urgent: Telegram (immediate) + Slack (record)
      if (telegramJid && slackJid) {
        return {
          primaryJid: telegramJid,
          secondaryJid: slackJid,
          reason: `vps-health/${severity} → Telegram + Slack`,
        };
      }
      if (telegramJid) {
        return {
          primaryJid: telegramJid,
          reason: `vps-health/${severity} → Telegram`,
        };
      }
    }
    // Non-urgent VPS reports → Slack
    if (slackJid) {
      return { primaryJid: slackJid, reason: 'vps-health/report → Slack' };
    }
  }

  // --- Analytics & Reports ---
  if (taskCategory === 'analytics') {
    // Detailed reports always go to Slack
    if (slackJid) {
      return { primaryJid: slackJid, reason: 'analytics → Slack' };
    }
  }

  // --- Lead Generation ---
  if (taskCategory === 'lead-gen') {
    // Lead reports → Slack, but high-score urgent leads also ping Telegram
    if (slackJid) {
      const hasHighScore =
        /\b([8-9]|10)\/10\b/.test(text) || /score.*[8-9]|score.*10/i.test(text);
      if (hasHighScore && telegramJid) {
        return {
          primaryJid: slackJid,
          secondaryJid: telegramJid,
          reason: 'lead-gen/high-score → Slack + Telegram ping',
        };
      }
      return { primaryJid: slackJid, reason: 'lead-gen → Slack' };
    }
  }

  // --- Life System ---
  if (taskCategory === 'life-system') {
    // Morning briefings, evening reflections, reminders → Telegram
    if (telegramJid) {
      return { primaryJid: telegramJid, reason: 'life-system → Telegram' };
    }
  }

  // --- Interactive tasks stay on the original channel ---
  if (taskCategory === 'interactive') {
    return { primaryJid: originJid, reason: 'interactive → origin' };
  }

  // --- Severity-based fallback for uncategorized tasks ---
  if (severity === 'critical' || severity === 'high') {
    if (telegramJid) {
      return {
        primaryJid: telegramJid,
        secondaryJid: slackJid || undefined,
        reason: `uncategorized/${severity} → Telegram`,
      };
    }
  }

  // Default: send to origin (WhatsApp)
  return { primaryJid: originJid, reason: 'default → origin' };
}
