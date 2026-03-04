import fs from 'fs';
import path from 'path';
import os from 'os';

interface AlertPattern {
  pattern: RegExp;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  action: string;
  autoRemediate?: {
    server: string;
    command: string;
  };
}

interface ParsedAlert {
  message: string;
  timestamp: string;
  channel: string;
  severity: 'critical' | 'warning' | 'info' | 'unknown';
  category: string;
  suggestedAction: string;
  autoRemediate?: {
    server: string;
    command: string;
  };
}

interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  categories: Record<string, number>;
  alerts: ParsedAlert[];
  recommendations: string[];
}

// Known error patterns and their remediation actions
const ALERT_PATTERNS: AlertPattern[] = [
  // Docker/Container issues
  {
    pattern: /container\s+(\S+)\s+(exited|stopped|died|unhealthy)/i,
    severity: 'critical',
    category: 'container',
    action: 'Restart the container',
    autoRemediate: { server: 'auto', command: 'docker restart $1' },
  },
  {
    pattern: /out of memory|oom|killed process/i,
    severity: 'critical',
    category: 'memory',
    action: 'Check memory usage, restart affected service, consider scaling',
  },
  {
    pattern: /disk\s*(space|usage).*(\d{2,3})%/i,
    severity: 'warning',
    category: 'disk',
    action: 'Clean up old logs/images: docker system prune, log rotation',
    autoRemediate: {
      server: 'auto',
      command: 'docker system prune -f && journalctl --vacuum-time=3d',
    },
  },
  {
    pattern: /no space left on device/i,
    severity: 'critical',
    category: 'disk',
    action: 'Emergency disk cleanup needed',
    autoRemediate: {
      server: 'auto',
      command: 'docker system prune -f && journalctl --vacuum-time=1d',
    },
  },

  // n8n issues
  {
    pattern: /n8n.*crash|n8n.*error|workflow.*failed/i,
    severity: 'critical',
    category: 'n8n',
    action: 'Check n8n logs, restart if needed',
    autoRemediate: {
      server: 'beastmode',
      command: 'docker restart n8n 2>/dev/null || systemctl restart n8n',
    },
  },
  {
    pattern: /execution\s+\S+\s+failed|workflow.*timed?\s*out/i,
    severity: 'warning',
    category: 'n8n',
    action: 'Check n8n execution history for details',
  },
  {
    pattern: /n8n.*connection\s*(refused|reset|timeout)/i,
    severity: 'critical',
    category: 'n8n',
    action: 'n8n service may be down, restart it',
    autoRemediate: {
      server: 'beastmode',
      command: 'docker restart n8n 2>/dev/null || systemctl restart n8n',
    },
  },

  // Network issues
  {
    pattern: /connection\s*(refused|reset|timeout)|ECONNREFUSED|ETIMEDOUT/i,
    severity: 'warning',
    category: 'network',
    action: 'Check service status and network connectivity',
  },
  {
    pattern: /ssl|certificate\s*(expired|invalid|error)/i,
    severity: 'warning',
    category: 'ssl',
    action: 'Renew SSL certificate: certbot renew',
    autoRemediate: { server: 'auto', command: 'certbot renew --quiet' },
  },

  // BeastMode specific
  {
    pattern: /scan\s*(failed|error|timeout)|recon.*fail/i,
    severity: 'warning',
    category: 'beastmode',
    action: 'Check BeastMode scan logs',
  },
  {
    pattern: /rate\s*limit|blocked|banned|403\s*forbidden/i,
    severity: 'warning',
    category: 'beastmode',
    action: 'Rate limited - pause scanning, rotate IP/proxy',
  },
  {
    pattern: /vulnerability\s*found|critical\s*finding/i,
    severity: 'info',
    category: 'beastmode',
    action: 'Review finding and report if valid',
  },

  // Auto Blogger specific
  {
    pattern: /post\s*(generation|publish)\s*(failed|error)/i,
    severity: 'warning',
    category: 'autoblogger',
    action: 'Check Auto Blogger queue and LLM API status',
  },
  {
    pattern: /api\s*(key|token)\s*(invalid|expired|rate)/i,
    severity: 'critical',
    category: 'api',
    action: 'API credentials issue - check and rotate keys',
  },
  {
    pattern: /database\s*(error|connection|timeout)|postgres|redis.*error/i,
    severity: 'critical',
    category: 'database',
    action: 'Check database service and connections',
    autoRemediate: {
      server: 'auto',
      command:
        'systemctl restart postgresql redis 2>/dev/null; docker restart postgres redis 2>/dev/null',
    },
  },

  // Nginx
  {
    pattern: /nginx.*error|502\s*bad\s*gateway|503\s*service/i,
    severity: 'critical',
    category: 'nginx',
    action: 'Check upstream services, restart nginx',
    autoRemediate: { server: 'auto', command: 'systemctl restart nginx' },
  },

  // General
  {
    pattern: /permission denied|access denied/i,
    severity: 'warning',
    category: 'permissions',
    action: 'Check file/service permissions',
  },
  {
    pattern: /cron.*fail|scheduled.*task.*error/i,
    severity: 'warning',
    category: 'cron',
    action: 'Check cron job logs',
  },
];

/**
 * Analyze a single message for alert patterns
 */
export function analyzeMessage(
  message: string,
  channel: string,
  timestamp: string,
): ParsedAlert {
  for (const pattern of ALERT_PATTERNS) {
    if (pattern.pattern.test(message)) {
      // Determine which server based on channel
      let server = pattern.autoRemediate?.server;
      if (server === 'auto') {
        if (channel.includes('bugbounty') || channel.includes('beastmode')) {
          server = 'beastmode';
        } else if (
          channel.includes('blogger') ||
          channel.includes('auto_blogger')
        ) {
          server = 'blogger';
        } else {
          server = 'beastmode'; // Default
        }
      }

      return {
        message,
        timestamp,
        channel,
        severity: pattern.severity,
        category: pattern.category,
        suggestedAction: pattern.action,
        autoRemediate:
          pattern.autoRemediate && server
            ? { server, command: pattern.autoRemediate.command }
            : undefined,
      };
    }
  }

  // Check for general error indicators
  if (/error|fail|crash|exception|critical|fatal/i.test(message)) {
    return {
      message,
      timestamp,
      channel,
      severity: 'warning',
      category: 'general',
      suggestedAction: 'Review error details and investigate',
    };
  }

  return {
    message,
    timestamp,
    channel,
    severity: 'unknown',
    category: 'general',
    suggestedAction: 'No action needed',
  };
}

/**
 * Analyze multiple messages and generate summary
 */
export function analyzeAlerts(
  messages: Array<{ text: string; channel: string; timestamp: string }>,
): AlertSummary {
  const alerts = messages
    .map((m) => analyzeMessage(m.text, m.channel, m.timestamp))
    .filter((a) => a.severity !== 'unknown');

  const categories: Record<string, number> = {};
  let critical = 0;
  let warning = 0;
  let info = 0;

  for (const alert of alerts) {
    categories[alert.category] = (categories[alert.category] || 0) + 1;
    if (alert.severity === 'critical') critical++;
    else if (alert.severity === 'warning') warning++;
    else if (alert.severity === 'info') info++;
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (critical > 0) {
    recommendations.push('Immediate attention needed for critical alerts');
  }

  const remediable = alerts.filter((a) => a.autoRemediate);
  if (remediable.length > 0) {
    recommendations.push(
      `${remediable.length} issue(s) can be auto-remediated`,
    );
  }

  if (categories['memory'] > 0) {
    recommendations.push(
      'Memory issues detected - consider scaling or optimizing',
    );
  }

  if (categories['disk'] > 0) {
    recommendations.push('Disk space issues - run cleanup');
  }

  if ((categories['n8n'] || 0) > 3) {
    recommendations.push('Multiple n8n errors - investigate root cause');
  }

  return {
    total: alerts.length,
    critical,
    warning,
    info,
    categories,
    alerts: alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2, unknown: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    recommendations,
  };
}

/**
 * Get auto-remediation commands for alerts
 */
export function getRemediationCommands(
  alerts: ParsedAlert[],
): Array<{ server: string; command: string; reason: string }> {
  const commands: Array<{ server: string; command: string; reason: string }> =
    [];
  const seen = new Set<string>();

  for (const alert of alerts) {
    if (alert.autoRemediate) {
      const key = `${alert.autoRemediate.server}:${alert.autoRemediate.command}`;
      if (!seen.has(key)) {
        seen.add(key);
        commands.push({
          server: alert.autoRemediate.server,
          command: alert.autoRemediate.command,
          reason: alert.category + ': ' + alert.suggestedAction,
        });
      }
    }
  }

  return commands;
}

/**
 * Format alert summary for WhatsApp
 */
export function formatAlertSummaryForWhatsApp(summary: AlertSummary): string {
  if (summary.total === 0) {
    return '✅ *No alerts detected* - All systems look healthy!';
  }

  const severityLine = [
    summary.critical > 0 ? `🔴 ${summary.critical} critical` : '',
    summary.warning > 0 ? `🟡 ${summary.warning} warning` : '',
    summary.info > 0 ? `🔵 ${summary.info} info` : '',
  ]
    .filter((s) => s)
    .join(' • ');

  const categoryLines = Object.entries(summary.categories)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `• ${cat}: ${count}`)
    .join('\n');

  const topAlerts = summary.alerts
    .slice(0, 5)
    .map((a, i) => {
      const emoji = {
        critical: '🔴',
        warning: '🟡',
        info: '🔵',
        unknown: '⚪',
      }[a.severity];
      return `${i + 1}. ${emoji} [${a.category}] ${a.message.substring(0, 100)}${a.message.length > 100 ? '...' : ''}
   _Action: ${a.suggestedAction}_`;
    })
    .join('\n\n');

  const remediable = summary.alerts.filter((a) => a.autoRemediate);
  const remediationNote =
    remediable.length > 0
      ? `\n\n*Auto-fix available for ${remediable.length} issue(s)*\nSay "fix it" to auto-remediate.`
      : '';

  const recommendationLines =
    summary.recommendations.length > 0
      ? '\n\n*Recommendations:*\n' +
        summary.recommendations.map((r) => `• ${r}`).join('\n')
      : '';

  return `*Alert Summary* (${summary.total} alerts)
${severityLine}

*Categories:*
${categoryLines}

*Top Alerts:*
${topAlerts}${remediationNote}${recommendationLines}`;
}
