#!/bin/bash
# HackerNews monitoring tool for NanoClaw agents
# Includes OSINT-style change detection — only reports new/changed items across runs

NANOCLAW_DIR="/workspace/project"
WORKSPACE_DIR="/workspace/group"
USER_KEYWORDS="n8n,automation,workflow,API,VPS,security,Python,JavaScript,freelance,contract,remote,QA,testing,test automation,quality assurance,vibe coding,AI coding"

case "$1" in
  who-is-hiring)
    MIN_SCORE="${2:-7}"
    node -e "
    const { searchWhoIsHiring, formatJobListings } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const keywords = '$USER_KEYWORDS'.split(',');

    searchWhoIsHiring(keywords, $MIN_SCORE).then(jobs => {
      const detected = jobs.map(j => cd.hnToDetectedItem(j));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'hn-hiring', detected);
      const actionable = [...delta.newItems, ...delta.changedItems];
      if (actionable.length === 0) {
        console.log(delta.summary);
        return;
      }
      const tiered = cd.tagWithSignificance(actionable);
      const critical = tiered.filter(t => t.tier === 'critical');
      const important = tiered.filter(t => t.tier === 'important');
      const minor = tiered.filter(t => t.tier === 'minor');
      console.log(delta.summary + '\n');
      const showIds = new Set([...critical, ...important].map(t => t.id));
      const filtered = jobs.filter(j => showIds.has('hn:' + j.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatJobListings(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  ask-hn)
    KEYWORDS="${2:-automation,workflow,self-hosted,api,integration}"
    node -e "
    const { findAskHNOpportunities, formatHNPosts } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const keywords = '$KEYWORDS'.split(',');

    findAskHNOpportunities(keywords).then(posts => {
      const detected = posts.map(p => cd.hnStoryToDetectedItem(p));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'hn-ask', detected);
      const actionable = [...delta.newItems, ...delta.changedItems];
      if (actionable.length === 0) {
        console.log(delta.summary);
        return;
      }
      const tiered = cd.tagWithSignificance(actionable);
      const critical = tiered.filter(t => t.tier === 'critical');
      const important = tiered.filter(t => t.tier === 'important');
      const minor = tiered.filter(t => t.tier === 'minor');
      console.log(delta.summary + '\n');
      const showIds = new Set([...critical, ...important].map(t => t.id));
      const filtered = posts.filter(p => showIds.has('hn:' + p.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatHNPosts(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  show-hn)
    KEYWORDS="${2:-automation,workflow,api,integration,tool}"
    node -e "
    const { findShowHN, formatHNPosts } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const keywords = '$KEYWORDS'.split(',');

    findShowHN(keywords).then(posts => {
      const detected = posts.map(p => cd.hnStoryToDetectedItem(p));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'hn-show', detected);
      const actionable = [...delta.newItems, ...delta.changedItems];
      if (actionable.length === 0) {
        console.log(delta.summary);
        return;
      }
      const tiered = cd.tagWithSignificance(actionable);
      const critical = tiered.filter(t => t.tier === 'critical');
      const important = tiered.filter(t => t.tier === 'important');
      const minor = tiered.filter(t => t.tier === 'minor');
      console.log(delta.summary + '\n');
      const showIds = new Set([...critical, ...important].map(t => t.id));
      const filtered = posts.filter(p => showIds.has('hn:' + p.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatHNPosts(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  find-thread)
    node -e "
    const { findWhoIsHiringThread } = require('$NANOCLAW_DIR/dist/hn-helper.js');

    findWhoIsHiringThread().then(thread => {
      if (!thread) {
        console.log('Could not find Who\\'s Hiring thread');
      } else {
        console.log(\`Latest thread: \${thread.title}\`);
        console.log(\`Posted: \${new Date(thread.time * 1000).toLocaleDateString()}\`);
        console.log(\`URL: https://news.ycombinator.com/item?id=\${thread.id}\`);
        console.log(\`Comments: \${thread.descendants || 0}\`);
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  stats)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const stats = cd.getAllStats('$WORKSPACE_DIR');
    const hnStats = stats.filter(s => s.source.startsWith('hn'));
    if (hnStats.length === 0) {
      console.log('No change detection data yet. Run a monitor command first.');
    } else {
      console.log('HackerNews change detection stats:');
      for (const s of hnStats) {
        console.log(\`  \${s.source}: \${s.tracked} items tracked, last run: \${s.lastRun || 'never'}\`);
      }
    }
    "
    ;;

  reset)
    SOURCE="${2:-}"
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    cd.resetState('$WORKSPACE_DIR', '$SOURCE' || undefined);
    console.log('Change detection state reset' + ('$SOURCE' ? ' for $SOURCE' : ' (all sources)'));
    "
    ;;

  *)
    echo "Usage: hn-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  who-is-hiring [min_score]       - Search Who's Hiring thread (default min: 7)"
    echo "  ask-hn [keywords]               - Find Ask HN opportunities"
    echo "  show-hn [keywords]              - Find Show HN posts"
    echo "  find-thread                     - Find latest Who's Hiring thread info"
    echo "  stats                           - Show change detection statistics"
    echo "  reset [source]                  - Reset change detection state"
    echo ""
    echo "All commands use change detection — only new/changed items are reported."
    echo ""
    echo "Examples:"
    echo "  hn-monitor.sh who-is-hiring 8"
    echo "  hn-monitor.sh ask-hn 'automation,api,workflow'"
    echo "  hn-monitor.sh show-hn 'automation,integration'"
    ;;
esac
