#!/bin/bash
# Smart Alert Handler tool

NANOCLAW_DIR="/workspace/project"

case "$1" in
  analyze)
    CHANNEL="${2:-all}"
    HOURS="${3:-1}"
    node -e "
    const { analyzeAlerts, formatAlertSummaryForWhatsApp } = require('$NANOCLAW_DIR/dist/alert-handler.js');

    // Read recent Slack messages
    let messages = [];
    try {
      const { getChannelMessages, getMessagesSince } = require('$NANOCLAW_DIR/dist/slack-helper.js');
      const channels = '$CHANNEL' === 'all'
        ? ['bugbounty', 'auto_blogger', 'automation']
        : ['$CHANNEL'];

      const since = Math.floor(Date.now() / 1000) - ($HOURS * 3600);

      const results = await Promise.all(channels.map(async ch => {
        try {
          const msgs = await getMessagesSince(ch, since);
          return msgs.map(m => ({ text: m.text || '', channel: ch, timestamp: m.ts || '' }));
        } catch { return []; }
      }));

      messages = results.flat();
    } catch (err) {
      console.error('Could not read Slack messages:', err.message);
      process.exit(1);
    }

    if (messages.length === 0) {
      console.log('No messages found in the last $HOURS hour(s).');
      process.exit(0);
    }

    const summary = analyzeAlerts(messages);
    console.log(formatAlertSummaryForWhatsApp(summary));
    " 2>&1
    ;;

  remediate)
    CHANNEL="${2:-all}"
    HOURS="${3:-1}"
    node -e "
    const { analyzeAlerts, getRemediationCommands } = require('$NANOCLAW_DIR/dist/alert-handler.js');
    const { runCommand } = require('$NANOCLAW_DIR/dist/vps-monitor.js');

    // Read Slack messages
    let messages = [];
    try {
      const { getMessagesSince } = require('$NANOCLAW_DIR/dist/slack-helper.js');
      const channels = '$CHANNEL' === 'all'
        ? ['bugbounty', 'auto_blogger', 'automation']
        : ['$CHANNEL'];

      const since = Math.floor(Date.now() / 1000) - ($HOURS * 3600);

      const results = await Promise.all(channels.map(async ch => {
        try {
          const msgs = await getMessagesSince(ch, since);
          return msgs.map(m => ({ text: m.text || '', channel: ch, timestamp: m.ts || '' }));
        } catch { return []; }
      }));

      messages = results.flat();
    } catch (err) {
      console.error('Could not read Slack messages:', err.message);
      process.exit(1);
    }

    const summary = analyzeAlerts(messages);
    const commands = getRemediationCommands(summary.alerts);

    if (commands.length === 0) {
      console.log('✅ No auto-remediable issues found.');
      process.exit(0);
    }

    console.log('*Running auto-remediation:*\n');
    for (const cmd of commands) {
      console.log('🔧 ' + cmd.server + ': ' + cmd.reason);
      console.log('   Command: ' + cmd.command);
      try {
        const output = await runCommand(cmd.server, cmd.command);
        console.log('   ✅ Success: ' + (output.substring(0, 100) || 'done'));
      } catch (err) {
        console.log('   ❌ Failed: ' + err.message);
      }
      console.log('');
    }
    " 2>&1
    ;;

  check-message)
    MESSAGE="$2"
    if [ -z "$MESSAGE" ]; then
      echo "Usage: alert-handler.sh check-message 'error message text'"
      exit 1
    fi
    node -e "
    const { analyzeMessage } = require('$NANOCLAW_DIR/dist/alert-handler.js');
    const alert = analyzeMessage(process.argv[1], 'manual', new Date().toISOString());
    console.log('*Alert Analysis:*');
    console.log('Severity:', alert.severity);
    console.log('Category:', alert.category);
    console.log('Action:', alert.suggestedAction);
    if (alert.autoRemediate) {
      console.log('Auto-fix:', alert.autoRemediate.server + ' - ' + alert.autoRemediate.command);
    }
    " "$MESSAGE"
    ;;

  *)
    echo "Usage: alert-handler.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  analyze [channel] [hours]     - Analyze Slack alerts"
    echo "  remediate [channel] [hours]   - Auto-fix detected issues"
    echo "  check-message 'text'          - Analyze a specific error message"
    echo ""
    echo "Channels: all, bugbounty, auto_blogger, automation"
    echo ""
    echo "Examples:"
    echo "  alert-handler.sh analyze all 2"
    echo "  alert-handler.sh remediate bugbounty 1"
    echo "  alert-handler.sh check-message 'container n8n exited'"
    ;;
esac
