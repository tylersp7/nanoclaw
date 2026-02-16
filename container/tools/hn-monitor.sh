#!/bin/bash
# HackerNews monitoring tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"
USER_KEYWORDS="n8n,automation,workflow,API,VPS,security,Python,JavaScript,freelance,contract,remote"

case "$1" in
  who-is-hiring)
    MIN_SCORE="${2:-7}"
    node -e "
    const { searchWhoIsHiring, formatJobListings } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const keywords = '$USER_KEYWORDS'.split(',');

    searchWhoIsHiring(keywords, $MIN_SCORE).then(jobs => {
      if (jobs.length === 0) {
        console.log('No jobs found matching your criteria in the latest Who\\'s Hiring thread.');
      } else {
        console.log(\`Found \${jobs.length} relevant jobs (score >= $MIN_SCORE/10):\n\`);
        console.log(formatJobListings(jobs));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  ask-hn)
    KEYWORDS="${2:-automation,workflow,self-hosted,api,integration}"
    node -e "
    const { findAskHNOpportunities, formatHNPosts } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const keywords = '$KEYWORDS'.split(',');

    findAskHNOpportunities(keywords).then(posts => {
      if (posts.length === 0) {
        console.log('No Ask HN posts found matching keywords.');
      } else {
        console.log(\`Found \${posts.length} Ask HN posts:\n\`);
        console.log(formatHNPosts(posts));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  show-hn)
    KEYWORDS="${2:-automation,workflow,api,integration,tool}"
    node -e "
    const { findShowHN, formatHNPosts } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const keywords = '$KEYWORDS'.split(',');

    findShowHN(keywords).then(posts => {
      if (posts.length === 0) {
        console.log('No Show HN posts found matching keywords.');
      } else {
        console.log(\`Found \${posts.length} Show HN posts:\n\`);
        console.log(formatHNPosts(posts));
      }
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

  *)
    echo "Usage: hn-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  who-is-hiring [min_score]       - Search Who's Hiring thread (default min: 7)"
    echo "  ask-hn [keywords]               - Find Ask HN opportunities"
    echo "  show-hn [keywords]              - Find Show HN posts"
    echo "  find-thread                     - Find latest Who's Hiring thread info"
    echo ""
    echo "Examples:"
    echo "  hn-monitor.sh who-is-hiring 8"
    echo "  hn-monitor.sh ask-hn 'automation,api,workflow'"
    echo "  hn-monitor.sh show-hn 'automation,integration'"
    ;;
esac
