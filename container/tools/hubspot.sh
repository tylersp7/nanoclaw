#!/bin/bash
# HubSpot CRM sync tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"

# Load HUBSPOT_TOKEN from env-dir if available
if [ -f /workspace/env-dir/env ]; then
  export $(grep HUBSPOT_TOKEN /workspace/env-dir/env 2>/dev/null | xargs)
fi

if [ -z "$HUBSPOT_TOKEN" ]; then
  echo "Error: HUBSPOT_TOKEN not configured. Add it to .env and restart the service."
  exit 1
fi

case "$1" in
  validate)
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" validate
    ;;

  setup-properties)
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" setup-properties
    ;;

  sync)
    shift
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" sync "$@"
    ;;

  status)
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" status
    ;;

  lookup)
    QUERY="$2"
    if [ -z "$QUERY" ]; then
      echo "Usage: hubspot.sh lookup <email|monitor_id>"
      exit 1
    fi
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" lookup "$QUERY"
    ;;

  push-lead)
    LEAD_ID="$2"
    if [ -z "$LEAD_ID" ]; then
      echo "Usage: hubspot.sh push-lead <lead_id>"
      exit 1
    fi
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" push-lead "$LEAD_ID"
    ;;

  create-task)
    LEAD_ID="$2"
    SUBJECT="$3"
    if [ -z "$LEAD_ID" ] || [ -z "$SUBJECT" ]; then
      echo "Usage: hubspot.sh create-task <lead_id> <subject> [--due DAYS] [--priority HIGH|MEDIUM|LOW]"
      exit 1
    fi
    shift 3
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" create-task "$LEAD_ID" "$SUBJECT" "$@"
    ;;

  stages)
    node "$NANOCLAW_DIR/dist/hubspot-sync.js" stages
    ;;

  *)
    echo "Usage: hubspot.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  validate                      Verify HubSpot token works"
    echo "  setup-properties              Create custom HubSpot properties (one-time)"
    echo "  sync [--limit N]              Sync unsynced leads to HubSpot"
    echo "  status                        Show HubSpot sync stats"
    echo "  lookup <email|monitor_id>     Find contact in HubSpot"
    echo "  push-lead <lead_id>           Force-sync a specific lead"
    echo "  create-task <lead_id> <subject> [--due DAYS] [--priority HIGH|MEDIUM|LOW]"
    echo "  stages                        List deal pipeline stages"
    ;;
esac
