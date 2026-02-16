#!/bin/bash
# Auto Blogger Monitor tool

NANOCLAW_DIR="/workspace/project"

case "$1" in
  status)
    node -e "
    const { getBloggerStatus, formatBloggerStatusForWhatsApp } = require('$NANOCLAW_DIR/dist/auto-blogger-monitor.js');
    getBloggerStatus().then(status => {
      console.log(formatBloggerStatusForWhatsApp(status));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  stats)
    DAYS="${2:-7}"
    node -e "
    const { getPostStats, formatPostStatsForWhatsApp } = require('$NANOCLAW_DIR/dist/auto-blogger-monitor.js');
    getPostStats($DAYS).then(stats => {
      console.log(formatPostStatsForWhatsApp(stats, $DAYS));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  retry-failed)
    node -e "
    const { retryFailedPosts } = require('$NANOCLAW_DIR/dist/auto-blogger-monitor.js');
    retryFailedPosts().then(result => {
      console.log(result);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  restart)
    node -e "
    const { restartBloggerServices } = require('$NANOCLAW_DIR/dist/auto-blogger-monitor.js');
    restartBloggerServices().then(result => {
      console.log('*Restart Result:*');
      console.log(result);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  logs)
    LINES="${2:-50}"
    node -e "
    const { runCommand } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    runCommand('blogger', 'docker logs --tail $LINES \$(docker ps -q --filter \"name=auto-blogger\" --filter \"name=blog\" | head -1) 2>&1').then(out => {
      console.log('*Auto Blogger Logs:*\n');
      console.log(out);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: auto-blogger-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  status              - Full status report"
    echo "  stats [days]        - Post statistics"
    echo "  retry-failed        - Retry failed posts"
    echo "  restart             - Restart Auto Blogger services"
    echo "  logs [lines]        - View recent logs"
    echo ""
    echo "Examples:"
    echo "  auto-blogger-monitor.sh status"
    echo "  auto-blogger-monitor.sh stats 30"
    echo "  auto-blogger-monitor.sh retry-failed"
    ;;
esac
