#!/bin/bash
# Slack reading tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"

case "$1" in
  list-channels)
    node -e "
    const { listChannels } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    listChannels().then(channels => {
      console.log('Available Slack channels:');
      channels.forEach(c => {
        console.log(\`  \${c.isMember ? '✓' : ' '} #\${c.name} (\${c.id})\`);
      });
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  read-channel)
    CHANNEL="$2"
    LIMIT="${3:-50}"
    node -e "
    const { getChannelMessages, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    getChannelMessages('$CHANNEL', $LIMIT).then(msgs => {
      console.log(formatMessagesForWhatsApp(msgs));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  filter-critical)
    CHANNEL="$2"
    LIMIT="${3:-100}"
    node -e "
    const { getChannelMessages, filterBySeverity, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    getChannelMessages('$CHANNEL', $LIMIT).then(msgs => {
      const critical = filterBySeverity(msgs, ['critical', 'high', 'error', 'failed', 'alert']);
      console.log(formatMessagesForWhatsApp(critical));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  since)
    CHANNEL="$2"
    TIMESTAMP="$3"
    node -e "
    const { getMessagesSince, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    getMessagesSince('$CHANNEL', '$TIMESTAMP').then(msgs => {
      console.log(formatMessagesForWhatsApp(msgs));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: slack-reader.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list-channels              - List all channels bot has access to"
    echo "  read-channel <channel> [limit]  - Read messages from channel"
    echo "  filter-critical <channel> [limit] - Get only critical/error messages"
    echo "  since <channel> <timestamp>  - Get messages since timestamp"
    echo ""
    echo "Examples:"
    echo "  slack-reader.sh list-channels"
    echo "  slack-reader.sh read-channel bugbounty 20"
    echo "  slack-reader.sh filter-critical beastmode-alerts"
    ;;
esac
