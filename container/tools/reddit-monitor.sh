#!/bin/bash
# Reddit monitoring tool for NanoClaw agents
# Includes OSINT-style change detection — only reports new/changed items across runs

NANOCLAW_DIR="/workspace/project"
WORKSPACE_DIR="/workspace/group"
USER_SKILLS="n8n,automation,VPS,API,security,Python,JavaScript,bug bounty,workflow,QA,testing,test automation,quality assurance,vibe coding,AI coding"

case "$1" in
  search)
    SUBREDDIT="$2"
    KEYWORDS="$3"
    node -e "
    const { searchSubreddit, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const keywords = '$KEYWORDS'.split(',');
    searchSubreddit('$SUBREDDIT', keywords).then(posts => {
      const detected = posts.map(p => cd.redditToDetectedItem(p));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'reddit-search-$SUBREDDIT', detected);
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
      const filtered = posts.filter(p => showIds.has('reddit:' + p.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatPostsForWhatsApp(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  monitor-jobs)
    TIMESTAMP="${2:-0}"
    node -e "
    const { monitorSubreddits, filterByScore, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const subreddits = ['forhire', 'freelance_forhire', 'jobbit'];
    const keywords = '$USER_SKILLS'.split(',');
    const timestamp = parseInt('$TIMESTAMP') || (Date.now() / 1000 - 3600 * 24);

    monitorSubreddits(subreddits, keywords, timestamp).then(posts => {
      const scored = filterByScore(posts, keywords, 7);
      const detected = scored.map(p => cd.redditToDetectedItem(p));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'reddit-jobs', detected);
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
      const filtered = scored.filter(p => showIds.has('reddit:' + p.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatPostsForWhatsApp(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  monitor-community)
    SUBREDDIT="$2"
    TIMESTAMP="${3:-0}"
    node -e "
    const { getPostsSince, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const timestamp = parseInt('$TIMESTAMP') || (Date.now() / 1000 - 3600 * 4);

    getPostsSince('$SUBREDDIT', timestamp).then(posts => {
      const detected = posts.map(p => cd.redditToDetectedItem(p));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'reddit-community-$SUBREDDIT', detected);
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
      const filtered = posts.filter(p => showIds.has('reddit:' + p.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatPostsForWhatsApp(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  stats)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const stats = cd.getAllStats('$WORKSPACE_DIR');
    const redditStats = stats.filter(s => s.source.startsWith('reddit'));
    if (redditStats.length === 0) {
      console.log('No change detection data yet. Run a monitor command first.');
    } else {
      console.log('Reddit change detection stats:');
      for (const s of redditStats) {
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

  status)
    node -e "
    const { getBackendStatus } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    console.log('Reddit backend:', getBackendStatus());
    "
    ;;

  *)
    echo "Usage: reddit-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  search <subreddit> <keywords>       - Search subreddit for keywords"
    echo "  monitor-jobs [since_timestamp]       - Check job boards for opportunities"
    echo "  monitor-community <subreddit> [since] - Get new posts from subreddit"
    echo "  stats                                - Show change detection statistics"
    echo "  reset [source]                       - Reset change detection state"
    echo "  status                               - Show which backend is active"
    echo ""
    echo "All commands use change detection — only new/changed items are reported."
    echo ""
    echo "Examples:"
    echo "  reddit-monitor.sh search forhire 'n8n,automation'"
    echo "  reddit-monitor.sh monitor-jobs"
    echo "  reddit-monitor.sh monitor-community n8n"
    echo "  reddit-monitor.sh stats"
    echo "  reddit-monitor.sh status"
    ;;
esac
