#!/bin/bash
# CRM lead management tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"

case "$1" in
  add)
    TITLE="$2"
    SOURCE="$3"
    if [ -z "$TITLE" ] || [ -z "$SOURCE" ]; then
      echo "Usage: crm.sh add 'title' 'source' [--url URL] [--budget BUDGET] [--score N] [--client NAME]"
      exit 1
    fi
    shift 3
    OPTS="{}"
    while [ $# -gt 0 ]; do
      case "$1" in
        --url) OPTS=$(echo "$OPTS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.url='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --budget) OPTS=$(echo "$OPTS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.budget='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --score) OPTS=$(echo "$OPTS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.score=$2;console.log(JSON.stringify(o))"); shift 2 ;;
        --client) OPTS=$(echo "$OPTS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.clientName='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        *) shift ;;
      esac
    done
    node -e "
    const { addLead } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const opts = JSON.parse(process.argv[1]);
    const lead = addLead(process.argv[2], process.argv[3], opts);
    console.log('✅ Lead added: ' + lead.id);
    console.log('Title: ' + lead.title);
    console.log('Source: ' + lead.source);
    console.log('Score: ' + lead.score + '/10');
    if (lead.url) console.log('URL: ' + lead.url);
    if (lead.budget) console.log('Budget: ' + lead.budget);
    " "$OPTS" "$TITLE" "$SOURCE"
    ;;

  update)
    ID="$2"
    if [ -z "$ID" ]; then
      echo "Usage: crm.sh update <lead_id> [--status STATUS] [--score N] [--follow-up DATE] [--client NAME] [--email EMAIL] [--won-amount N]"
      exit 1
    fi
    shift 2
    UPDATES="{}"
    while [ $# -gt 0 ]; do
      case "$1" in
        --status) UPDATES=$(echo "$UPDATES" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.status='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --score) UPDATES=$(echo "$UPDATES" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.score=$2;console.log(JSON.stringify(o))"); shift 2 ;;
        --follow-up) UPDATES=$(echo "$UPDATES" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.followUpDate='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --client) UPDATES=$(echo "$UPDATES" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.clientName='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --email) UPDATES=$(echo "$UPDATES" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.clientEmail='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --won-amount) UPDATES=$(echo "$UPDATES" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.wonAmount=$2;console.log(JSON.stringify(o))"); shift 2 ;;
        *) shift ;;
      esac
    done
    node -e "
    const { updateLead } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const updates = JSON.parse(process.argv[1]);
    const lead = updateLead(process.argv[2], updates);
    if (!lead) { console.log('❌ Lead not found: ' + process.argv[2]); process.exit(1); }
    console.log('✅ Lead updated: ' + lead.id);
    console.log('Status: ' + lead.status);
    console.log('Score: ' + lead.score + '/10');
    " "$UPDATES" "$ID"
    ;;

  note)
    ID="$2"
    NOTE="$3"
    if [ -z "$ID" ] || [ -z "$NOTE" ]; then
      echo "Usage: crm.sh note <lead_id> 'note text'"
      exit 1
    fi
    node -e "
    const { addNote } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const lead = addNote(process.argv[1], process.argv[2]);
    if (!lead) { console.log('❌ Lead not found'); process.exit(1); }
    console.log('✅ Note added to ' + lead.title);
    console.log('Total notes: ' + lead.notes.length);
    " "$ID" "$NOTE"
    ;;

  list)
    shift
    FILTERS="{}"
    while [ $# -gt 0 ]; do
      case "$1" in
        --status) FILTERS=$(echo "$FILTERS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.status='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --source) FILTERS=$(echo "$FILTERS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.source='$2';console.log(JSON.stringify(o))"); shift 2 ;;
        --min-score) FILTERS=$(echo "$FILTERS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.minScore=$2;console.log(JSON.stringify(o))"); shift 2 ;;
        --limit) FILTERS=$(echo "$FILTERS" | node -e "const o=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));o.limit=$2;console.log(JSON.stringify(o))"); shift 2 ;;
        *) shift ;;
      esac
    done
    node -e "
    const { listLeads, formatLeadsForWhatsApp } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const filters = JSON.parse(process.argv[1]);
    const leads = listLeads(Object.keys(filters).length > 0 ? filters : undefined);
    if (leads.length === 0) { console.log('No leads found.'); }
    else {
      console.log('Found ' + leads.length + ' leads:\n');
      console.log(formatLeadsForWhatsApp(leads));
    }
    " "$FILTERS"
    ;;

  search)
    QUERY="$2"
    if [ -z "$QUERY" ]; then
      echo "Usage: crm.sh search 'query'"
      exit 1
    fi
    node -e "
    const { searchLeads, formatLeadsForWhatsApp } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const leads = searchLeads(process.argv[1]);
    if (leads.length === 0) { console.log('No leads found matching: ' + process.argv[1]); }
    else {
      console.log('Found ' + leads.length + ' leads:\n');
      console.log(formatLeadsForWhatsApp(leads));
    }
    " "$QUERY"
    ;;

  follow-ups)
    node -e "
    const { getFollowUps, formatLeadsForWhatsApp } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const leads = getFollowUps();
    if (leads.length === 0) { console.log('No follow-ups due today.'); }
    else {
      console.log('📋 ' + leads.length + ' follow-ups due:\n');
      console.log(formatLeadsForWhatsApp(leads));
    }
    "
    ;;

  stats)
    node -e "
    const { getPipelineStats, formatStatsForWhatsApp } = require('$NANOCLAW_DIR/dist/crm-helper.js');
    const stats = getPipelineStats();
    console.log(formatStatsForWhatsApp(stats));
    "
    ;;

  *)
    echo "Usage: crm.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  add 'title' 'source' [opts]      - Add a new lead"
    echo "  update <id> [opts]               - Update lead status/details"
    echo "  note <id> 'text'                 - Add a note to a lead"
    echo "  list [filters]                   - List leads"
    echo "  search 'query'                   - Search leads"
    echo "  follow-ups                       - Show due follow-ups"
    echo "  stats                            - Pipeline statistics"
    echo ""
    echo "Add options: --url URL --budget BUDGET --score N --client NAME"
    echo "Update options: --status STATUS --score N --follow-up DATE --client NAME --email EMAIL --won-amount N"
    echo "List filters: --status STATUS --source SOURCE --min-score N --limit N"
    echo ""
    echo "Statuses: new, contacted, responded, interview, proposal_sent, won, lost, skipped"
    echo "Sources: upwork, freelancer, reddit, hn, linkedin, github, n8n, referral"
    ;;
esac
