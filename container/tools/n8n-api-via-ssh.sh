#!/bin/bash
# n8n API access via SSH (for when n8n only listens on localhost)
# This uses vps-monitor.sh to execute curl commands on the VPS

VPS="beastmode"
N8N_URL="http://localhost:5678/api/v1"

if [ -z "$N8N_API_KEY" ]; then
  echo "Error: N8N_API_KEY environment variable not set"
  exit 1
fi

case "$1" in
  workflows)
    /workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s '$N8N_URL/workflows' -H 'X-N8N-API-KEY: $N8N_API_KEY'"
    ;;

  executions)
    LIMIT="${2:-20}"
    /workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s '$N8N_URL/executions?limit=$LIMIT' -H 'X-N8N-API-KEY: $N8N_API_KEY'"
    ;;

  failures)
    LIMIT="${2:-10}"
    /workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s '$N8N_URL/executions?status=error&limit=$LIMIT' -H 'X-N8N-API-KEY: $N8N_API_KEY'"
    ;;

  stats)
    HOURS="${2:-24}"
    # Get both success and error executions
    SUCCESS=$(/workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s '$N8N_URL/executions?status=success&limit=100' -H 'X-N8N-API-KEY: $N8N_API_KEY'")
    FAILED=$(/workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s '$N8N_URL/executions?status=error&limit=100' -H 'X-N8N-API-KEY: $N8N_API_KEY'")

    # Simple stats output using Python for JSON parsing
    python3 <<EOF
import json
import sys

try:
    success_data = json.loads('''$SUCCESS''')
    failed_data = json.loads('''$FAILED''')

    success_count = len(success_data.get('data', []))
    failed_count = len(failed_data.get('data', []))
    total = success_count + failed_count

    if total > 0:
        success_rate = f"{(success_count * 100) // total}%"
    else:
        success_rate = "N/A"

    print("*n8n Execution Stats (last ${HOURS}h)*")
    print()
    print(f"Total: {total}")
    print(f"✅ Success: {success_count}")
    print(f"❌ Failed: {failed_count}")
    print(f"📊 Success Rate: {success_rate}")

    if failed_count > 0:
        print()
        print("*Top Errors:*")
        for exec in failed_data.get('data', [])[:5]:
            wf_name = exec.get('workflowName') or exec.get('workflowId', 'Unknown')
            started = exec.get('startedAt', '')
            print(f"• {wf_name}: {started}")
except Exception as e:
    print(f"Error parsing stats: {e}", file=sys.stderr)
EOF
    ;;

  activate)
    WF_ID="$2"
    if [ -z "$WF_ID" ]; then
      echo "Usage: n8n-api-via-ssh.sh activate <workflow_id>"
      exit 1
    fi
    /workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s -X PATCH '$N8N_URL/workflows/$WF_ID' -H 'X-N8N-API-KEY: $N8N_API_KEY' -H 'Content-Type: application/json' -d '{\"active\":true}'"
    echo "✅ Workflow $WF_ID activated"
    ;;

  deactivate)
    WF_ID="$2"
    if [ -z "$WF_ID" ]; then
      echo "Usage: n8n-api-via-ssh.sh deactivate <workflow_id>"
      exit 1
    fi
    /workspace/project/container/tools/vps-monitor.sh exec "$VPS" \
      "curl -s -X PATCH '$N8N_URL/workflows/$WF_ID' -H 'X-N8N-API-KEY: $N8N_API_KEY' -H 'Content-Type: application/json' -d '{\"active\":false}'"
    echo "⚪ Workflow $WF_ID deactivated"
    ;;

  *)
    echo "Usage: n8n-api-via-ssh.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  workflows              - List workflows"
    echo "  executions [limit]     - Recent executions"
    echo "  failures [limit]       - Failed executions"
    echo "  stats [hours]          - Execution statistics"
    echo "  activate <workflow_id> - Activate a workflow"
    echo "  deactivate <workflow_id> - Deactivate a workflow"
    echo ""
    echo "Note: This version uses SSH execution to access n8n on localhost"
    ;;
esac
