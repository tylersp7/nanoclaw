#!/bin/bash
# GitHub monitoring tool for NanoClaw agents
# Includes OSINT-style change detection — only reports new/changed items across runs

NANOCLAW_DIR="/workspace/project"
WORKSPACE_DIR="/workspace/group"
USER_SKILLS="n8n,automation,API,workflow,VPS,Python,JavaScript,security,integration,QA,testing,test automation,quality assurance,vibe coding,AI coding"

case "$1" in
  my-repos)
    node -e "
    const { getMyRepos, formatReposForWhatsApp } = require('$NANOCLAW_DIR/dist/github-helper.js');
    getMyRepos().then(repos => {
      console.log(\`You have \${repos.length} public repositories:\n\`);
      console.log(formatReposForWhatsApp(repos));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  repo-activity)
    REPO="$2"
    if [ -z "$REPO" ]; then
      echo "Usage: github-monitor.sh repo-activity owner/repo"
      exit 1
    fi
    OWNER=$(echo "$REPO" | cut -d/ -f1)
    REPO_NAME=$(echo "$REPO" | cut -d/ -f2)
    node -e "
    const { getRepoActivity } = require('$NANOCLAW_DIR/dist/github-helper.js');
    getRepoActivity('$OWNER', '$REPO_NAME').then(activity => {
      console.log(\`\${activity.repo}:\`);
      console.log(\`Stars: \${activity.stars}\`);
      console.log(\`Forks: \${activity.forks}\`);
      console.log(\`New issues (7d): \${activity.newIssues || 0}\`);
      console.log(\`Recent commits (7d): \${activity.recentCommits || 0}\`);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  help-wanted)
    KEYWORDS="${2:-automation,n8n,workflow,api}"
    node -e "
    const { findHelpWantedIssues, formatIssuesForWhatsApp, scoreIssue } = require('$NANOCLAW_DIR/dist/github-helper.js');
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const keywords = '$KEYWORDS'.split(',');
    const skills = '$USER_SKILLS'.split(',');

    findHelpWantedIssues(keywords).then(issues => {
      const scored = issues.map(issue => ({
        ...issue,
        score: scoreIssue(issue, skills)
      })).filter(i => i.score >= 6).sort((a, b) => b.score - a.score);

      const detected = scored.map(i => cd.githubIssueToDetectedItem(i));
      const delta = cd.detectChanges('$WORKSPACE_DIR', 'github-help-wanted', detected);
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
      const filtered = scored.filter(i => showIds.has('github:' + i.id));
      if (critical.length > 0) console.log('CRITICAL (' + critical.length + '):');
      if (important.length > 0) console.log('IMPORTANT (' + important.length + '):');
      if (filtered.length > 0) console.log(formatIssuesForWhatsApp(filtered));
      if (minor.length > 0) console.log('MINOR (' + minor.length + '): ' + minor.map(m => m.id).join(', ') + ' (logged only)');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  trending)
    KEYWORDS="${2:-automation,workflow,n8n}"
    node -e "
    const { getTrendingRepos, formatReposForWhatsApp } = require('$NANOCLAW_DIR/dist/github-helper.js');
    const keywords = '$KEYWORDS'.split(',');

    getTrendingRepos(keywords).then(repos => {
      if (repos.length === 0) {
        console.log('No trending repos found.');
      } else {
        console.log(\`Trending repositories:\n\`);
        console.log(formatReposForWhatsApp(repos));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  portfolio-summary)
    REPO="$2"
    DAYS="${3:-30}"
    if [ -z "$REPO" ]; then
      echo "Usage: github-monitor.sh portfolio-summary owner/repo [days]"
      exit 1
    fi
    OWNER=$(echo "$REPO" | cut -d/ -f1)
    REPO_NAME=$(echo "$REPO" | cut -d/ -f2)
    node -e "
    const { generatePortfolioSummary } = require('$NANOCLAW_DIR/dist/github-helper.js');
    const since = new Date(Date.now() - $DAYS * 24 * 60 * 60 * 1000);

    generatePortfolioSummary('$OWNER', '$REPO_NAME', since).then(summary => {
      console.log(summary);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  stats)
    node -e "
    const cd = require('$NANOCLAW_DIR/dist/change-detector.js');
    const stats = cd.getAllStats('$WORKSPACE_DIR');
    const ghStats = stats.filter(s => s.source.startsWith('github'));
    if (ghStats.length === 0) {
      console.log('No change detection data yet. Run a monitor command first.');
    } else {
      console.log('GitHub change detection stats:');
      for (const s of ghStats) {
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
    echo "Usage: github-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  my-repos                        - List your repositories"
    echo "  repo-activity <owner/repo>      - Get repo stats"
    echo "  help-wanted [keywords]          - Find help wanted issues"
    echo "  trending [keywords]             - Find trending repos"
    echo "  portfolio-summary <owner/repo> [days] - Generate portfolio update"
    echo "  stats                           - Show change detection statistics"
    echo "  reset [source]                  - Reset change detection state"
    echo ""
    echo "Help-wanted uses change detection — only new/changed issues are reported."
    echo ""
    echo "Examples:"
    echo "  github-monitor.sh my-repos"
    echo "  github-monitor.sh repo-activity tylersp7/nanoclaw"
    echo "  github-monitor.sh help-wanted 'automation,api'"
    echo "  github-monitor.sh trending 'n8n,workflow'"
    ;;
esac
