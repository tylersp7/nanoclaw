#!/bin/bash
# VPS Health Monitor tool

NANOCLAW_DIR="/workspace/project"

case "$1" in
  health)
    SERVER="${2:-beastmode}"
    node -e "
    const { getHealthReport, formatHealthForWhatsApp } = require('$NANOCLAW_DIR/dist/vps-monitor.js');

    getHealthReport('$SERVER').then(report => {
      console.log(formatHealthForWhatsApp(report));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  health-all)
    node -e "
    const { getHealthReport, formatHealthForWhatsApp, listServers } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    const servers = listServers();

    Promise.all(servers.map(s =>
      getHealthReport(s.id).catch(err => ({ error: err.message, server: s.name }))
    )).then(reports => {
      reports.forEach(report => {
        if (report.error) {
          console.log('❌ ' + report.server + ': ' + report.error);
        } else {
          console.log(formatHealthForWhatsApp(report));
        }
        console.log('\n---\n');
      });
    });
    "
    ;;

  docker)
    SERVER="${2:-beastmode}"
    node -e "
    const { runCommand } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    runCommand('$SERVER', 'docker ps -a --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\"').then(out => {
      console.log('*Docker containers on $SERVER:*\n');
      console.log(out);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  logs)
    SERVER="${2:-beastmode}"
    CONTAINER="$3"
    LINES="${4:-50}"
    if [ -z "$CONTAINER" ]; then
      echo "Usage: vps-monitor.sh logs <server> <container> [lines]"
      exit 1
    fi
    node -e "
    const { getContainerLogs } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    getContainerLogs('$SERVER', '$CONTAINER', $LINES).then(logs => {
      console.log('*Logs for $CONTAINER on $SERVER:*\n');
      console.log(logs);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  restart-container)
    SERVER="${2:-beastmode}"
    CONTAINER="$3"
    if [ -z "$CONTAINER" ]; then
      echo "Usage: vps-monitor.sh restart-container <server> <container>"
      exit 1
    fi
    node -e "
    const { restartContainer } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    restartContainer('$SERVER', '$CONTAINER').then(out => {
      console.log('✅ Restarted $CONTAINER on $SERVER');
      console.log(out);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  restart-service)
    SERVER="${2:-beastmode}"
    SERVICE="$3"
    if [ -z "$SERVICE" ]; then
      echo "Usage: vps-monitor.sh restart-service <server> <service>"
      exit 1
    fi
    node -e "
    const { restartService } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    restartService('$SERVER', '$SERVICE').then(out => {
      console.log('✅ Restarted $SERVICE on $SERVER');
      console.log(out);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  exec)
    SERVER="${2:-beastmode}"
    CMD="$3"
    if [ -z "$CMD" ]; then
      echo "Usage: vps-monitor.sh exec <server> 'command'"
      exit 1
    fi
    node -e "
    const { runCommand } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    runCommand(process.argv[1], process.argv[2]).then(out => {
      console.log(out);
    }).catch(err => console.error('Error:', err.message));
    " "$SERVER" "$CMD"
    ;;

  servers)
    node -e "
    const { listServers } = require('$NANOCLAW_DIR/dist/vps-monitor.js');
    const servers = listServers();
    console.log('*Available VPS Servers:*\n');
    servers.forEach(s => console.log('• ' + s.id + ' - ' + s.name + ' (' + s.host + ')'));
    "
    ;;

  *)
    echo "Usage: vps-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  health [server]                    - Full health report"
    echo "  health-all                         - Health report for all servers"
    echo "  docker [server]                    - List Docker containers"
    echo "  logs <server> <container> [lines]  - View container logs"
    echo "  restart-container <server> <name>  - Restart a container"
    echo "  restart-service <server> <name>    - Restart a systemd service"
    echo "  exec <server> 'command'            - Run a command via SSH"
    echo "  servers                            - List configured servers"
    echo ""
    echo "Servers: beastmode, blogger"
    ;;
esac
