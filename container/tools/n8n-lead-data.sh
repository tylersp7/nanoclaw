#!/bin/bash
# Fetch pre-collected lead data from n8n workflows.
# n8n runs the data fetching; this script retrieves the latest results.
#
# Usage: n8n-lead-data.sh <source>
# Sources: reddit, hn, github, n8n-community, job-boards, all
#
# Requires: N8N_API_URL, N8N_API_KEY (or SSH_RELAY_URL/SSH_RELAY_SECRET for proxied access)

set -euo pipefail

# n8n workflow IDs
declare -A WORKFLOW_IDS=(
  [reddit]="ts2Y6888Ez1DEKmT"
  [hn]="OAs7Pv9C9po8lbfO"
  [github]="0aOVEjeVyRwW9ZCv"
  [n8n-community]="wvMHhw0lyRCsbzyx"
  [job-boards]="xNpHJ7rbEad6joUi"
)

SOURCE="${1:-all}"

# Load n8n config
N8N_CONFIG="$HOME/.nanoclaw-n8n/config.json"
if [ -z "${N8N_API_URL:-}" ] && [ -f "$N8N_CONFIG" ]; then
  N8N_API_URL=$(python3 -c "import json; print(json.load(open('$N8N_CONFIG')).get('url',''))" 2>/dev/null || true)
  N8N_API_KEY=$(python3 -c "import json; print(json.load(open('$N8N_CONFIG')).get('apiKey',''))" 2>/dev/null || true)
fi

N8N_API_URL="${N8N_API_URL:-https://n8n.sparksbusinesssolutionsllc.com}"
N8N_API_KEY="${N8N_API_KEY:-}"

fetch_execution() {
  local wf_id="$1"
  local source_name="$2"
  local url="${N8N_API_URL}/api/v1/executions?workflowId=${wf_id}&status=success&limit=1"

  local response
  if [ -n "${SSH_RELAY_URL:-}" ] && [ -n "${SSH_RELAY_SECRET:-}" ]; then
    # Use SSH relay to proxy the request (container can't reach Tailscale)
    response=$(curl -sf -X POST "${SSH_RELAY_URL}/fetch" \
      -H "Authorization: Bearer ${SSH_RELAY_SECRET}" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"${url}\",\"method\":\"GET\",\"headers\":{\"X-N8N-API-KEY\":\"${N8N_API_KEY}\"}}" 2>/dev/null) || true
  else
    response=$(curl -sf -H "X-N8N-API-KEY: ${N8N_API_KEY}" "${url}" 2>/dev/null) || true
  fi

  if [ -z "$response" ]; then
    echo "{\"source\":\"${source_name}\",\"error\":\"Failed to fetch from n8n API\",\"fallback\":true}"
    return 1
  fi

  # Extract the last node's output data from the execution
  python3 -c "
import json, sys
data = json.loads('''${response}''')
executions = data.get('data', [])
if not executions:
    print(json.dumps({'source': '${source_name}', 'error': 'No successful executions found', 'fallback': True}))
    sys.exit(0)

execution = executions[0]
finished_at = execution.get('stoppedAt', execution.get('startedAt', ''))

# Get the last node's output
result_data = execution.get('data', {}).get('resultData', {}).get('runData', {})
last_node_output = None
for node_name, runs in result_data.items():
    for run in runs:
        if run.get('data', {}).get('main'):
            for output in run['data']['main']:
                if output:
                    last_node_output = output[-1].get('json', {}) if output else None

if last_node_output:
    last_node_output['_source'] = '${source_name}'
    last_node_output['_executionFinishedAt'] = finished_at
    print(json.dumps(last_node_output, indent=2))
else:
    print(json.dumps({'source': '${source_name}', 'error': 'No output data in execution', 'fallback': True}))
" 2>/dev/null || echo "{\"source\":\"${source_name}\",\"error\":\"Failed to parse execution data\",\"fallback\":true}"
}

if [ "$SOURCE" = "all" ]; then
  echo "{"
  echo "  \"fetchedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"sources\": {"
  first=true
  for src in "${!WORKFLOW_IDS[@]}"; do
    if [ "$first" = false ]; then echo ","; fi
    first=false
    echo "    \"${src}\": $(fetch_execution "${WORKFLOW_IDS[$src]}" "$src")"
  done
  echo "  }"
  echo "}"
elif [ -n "${WORKFLOW_IDS[$SOURCE]:-}" ]; then
  fetch_execution "${WORKFLOW_IDS[$SOURCE]}" "$SOURCE"
else
  echo "Unknown source: $SOURCE"
  echo "Available: reddit, hn, github, n8n-community, job-boards, all"
  exit 1
fi
