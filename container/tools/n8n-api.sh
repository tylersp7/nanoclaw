#!/bin/bash
# n8n API monitoring tool
# Automatically uses SSH-based access when n8n is only available via localhost

NANOCLAW_DIR="/workspace/project"
SSH_TOOL="$NANOCLAW_DIR/container/tools/n8n-api-via-ssh.sh"

# Check if we should use SSH-based access
# (when SSH_RELAY is available and n8n is localhost-only)
USE_SSH=false
if [ -n "$SSH_RELAY_URL" ] && [ -n "$SSH_RELAY_SECRET" ]; then
  USE_SSH=true
fi

case "$1" in
  workflows)
    if [ "$USE_SSH" = true ]; then
      exec "$SSH_TOOL" workflows
    else
      ACTIVE_ONLY="${2:-false}"
      node -e "
      const { listWorkflows, formatWorkflowsForWhatsApp } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
      listWorkflows($ACTIVE_ONLY).then(wfs => {
        console.log('*n8n Workflows:*\n');
        console.log(formatWorkflowsForWhatsApp(wfs));
      }).catch(err => console.error('Error:', err.message));
      "
    fi
    ;;

  executions)
    if [ "$USE_SSH" = true ]; then
      exec "$SSH_TOOL" executions "$2"
    else
      LIMIT="${2:-20}"
      node -e "
      const { listExecutions, formatExecutionsForWhatsApp } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
      listExecutions({ limit: $LIMIT }).then(execs => {
        console.log('*Recent Executions:*\n');
        console.log(formatExecutionsForWhatsApp(execs));
      }).catch(err => console.error('Error:', err.message));
      "
    fi
    ;;

  failures)
    if [ "$USE_SSH" = true ]; then
      exec "$SSH_TOOL" failures "$2"
    else
      LIMIT="${2:-10}"
      node -e "
      const { getFailedExecutions, formatExecutionsForWhatsApp } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
      getFailedExecutions($LIMIT).then(execs => {
        if (execs.length === 0) {
          console.log('✅ No failed executions found!');
        } else {
          console.log('*Failed Executions:*\n');
          console.log(formatExecutionsForWhatsApp(execs));
        }
      }).catch(err => console.error('Error:', err.message));
      "
    fi
    ;;

  stats)
    if [ "$USE_SSH" = true ]; then
      exec "$SSH_TOOL" stats "$2"
    else
      HOURS="${2:-24}"
      node -e "
      const { getExecutionStats, formatStatsForWhatsApp } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
      getExecutionStats($HOURS).then(stats => {
        console.log(formatStatsForWhatsApp(stats, $HOURS));
      }).catch(err => console.error('Error:', err.message));
      "
    fi
    ;;

  retry)
    EXEC_ID="$2"
    if [ -z "$EXEC_ID" ]; then
      echo "Usage: n8n-api.sh retry <execution_id>"
      exit 1
    fi
    node -e "
    const { retryExecution } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
    retryExecution('$EXEC_ID').then(result => {
      console.log('✅ Retried execution $EXEC_ID');
      console.log('New execution ID:', result.id);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  activate)
    if [ "$USE_SSH" = true ]; then
      exec "$SSH_TOOL" activate "$2"
    else
      WF_ID="$2"
      if [ -z "$WF_ID" ]; then
        echo "Usage: n8n-api.sh activate <workflow_id>"
        exit 1
      fi
      node -e "
      const { setWorkflowActive } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
      setWorkflowActive('$WF_ID', true).then(() => {
        console.log('✅ Workflow $WF_ID activated');
      }).catch(err => console.error('Error:', err.message));
      "
    fi
    ;;

  deactivate)
    if [ "$USE_SSH" = true ]; then
      exec "$SSH_TOOL" deactivate "$2"
    else
      WF_ID="$2"
      if [ -z "$WF_ID" ]; then
        echo "Usage: n8n-api.sh deactivate <workflow_id>"
        exit 1
      fi
      node -e "
      const { setWorkflowActive } = require('$NANOCLAW_DIR/dist/n8n-api-helper.js');
      setWorkflowActive('$WF_ID', false).then(() => {
        console.log('⚪ Workflow $WF_ID deactivated');
      }).catch(err => console.error('Error:', err.message));
      "
    fi
    ;;

  *)
    echo "Usage: n8n-api.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  workflows [active_only]     - List workflows"
    echo "  executions [limit]          - Recent executions"
    echo "  failures [limit]            - Failed executions with errors"
    echo "  stats [hours]               - Execution statistics"
    echo "  retry <execution_id>        - Retry a failed execution"
    echo "  activate <workflow_id>      - Activate a workflow"
    echo "  deactivate <workflow_id>    - Deactivate a workflow"
    echo ""
    echo "Examples:"
    echo "  n8n-api.sh workflows true"
    echo "  n8n-api.sh failures 5"
    echo "  n8n-api.sh stats 24"
    echo ""
    echo "Note: When SSH_RELAY is available, uses SSH-based access for localhost n8n"
    ;;
esac
