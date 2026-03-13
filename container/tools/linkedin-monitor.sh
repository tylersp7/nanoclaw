#!/bin/bash
# LinkedIn monitoring tool
# Includes OSINT-style change detection — only reports new/changed items across runs

NANOCLAW_DIR="/workspace/project"
WORKSPACE_DIR="/workspace/group"
USER_SKILLS="n8n,automation,API,workflow,Python,JavaScript,VPS,security,integration,QA,testing,test automation,quality assurance,vibe coding,AI coding"

case "$1" in
  search-jobs)
    KEYWORDS="${2:-automation n8n}"
    MIN_SCORE="${3:-7}"
    node -e "
    const { searchJobs, scoreJob, formatJobsForWhatsApp, closeBrowser } = require('$NANOCLAW_DIR/dist/linkedin-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const skills = '$USER_SKILLS'.split(',');

    searchJobs('$KEYWORDS', 'Remote', 'past-week').then(jobs => {
      const scored = jobs.map(job => ({
        ...job,
        relevanceScore: scoreJob(job, skills)
      })).filter(j => j.relevanceScore >= $MIN_SCORE).sort((a, b) => b.relevanceScore - a.relevanceScore);

      const detected = scored.map(j => cd.linkedinToDetectedItem(j));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'linkedin-jobs', detected);
      const actionable = [...delta.newItems, ...delta.changedItems];
      if (actionable.length === 0) {
        console.log(delta.summary);
        return closeBrowser();
      }
      const tiered = cd.tagWithSignificance(actionable);
      const critical = tiered.filter(t => t.tier === 'critical');
      const important = tiered.filter(t => t.tier === 'important');
      const minor = tiered.filter(t => t.tier === 'minor');
      console.log(delta.summary + '\n');
      const showIds = new Set([...critical, ...important].map(t => t.id));
      const filtered = scored.filter(j => showIds.has('linkedin:' + j.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatJobsForWhatsApp(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');

      return closeBrowser();
    }).catch(err => {
      console.error('Error:', err.message);
      return closeBrowser();
    });
    "
    ;;

  hashtag)
    TAG="$2"
    if [ -z "$TAG" ]; then
      echo "Usage: linkedin-monitor.sh hashtag <tag>"
      exit 1
    fi
    node -e "
    const { searchHashtag, formatPostsForWhatsApp, closeBrowser } = require('$NANOCLAW_DIR/dist/linkedin-helper.js');

    searchHashtag('$TAG', 20).then(posts => {
      console.log(\`Posts with #$TAG:\n\`);
      console.log(formatPostsForWhatsApp(posts));
      return closeBrowser();
    }).catch(err => {
      console.error('Error:', err.message);
      return closeBrowser();
    });
    "
    ;;

  stats)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const stats = cd.getAllStats('$WORKSPACE_DIR');
    const liStats = stats.filter(s => s.source.startsWith('linkedin'));
    if (liStats.length === 0) {
      console.log('No change detection data yet. Run a monitor command first.');
    } else {
      console.log('LinkedIn change detection stats:');
      for (const s of liStats) {
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
    echo "Usage: linkedin-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  search-jobs [keywords] [min_score]  - Search for jobs"
    echo "  hashtag <tag>                       - Search hashtag posts"
    echo "  stats                               - Show change detection statistics"
    echo "  reset [source]                      - Reset change detection state"
    echo ""
    echo "All commands use change detection — only new/changed items are reported."
    echo ""
    echo "Examples:"
    echo "  linkedin-monitor.sh search-jobs 'n8n automation' 7"
    echo "  linkedin-monitor.sh hashtag n8n"
    ;;
esac
