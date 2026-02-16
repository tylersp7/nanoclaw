#!/bin/bash
# Reddit monitoring tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,VPS,API,security,Python,JavaScript,bug bounty,workflow"

case "$1" in
  search)
    SUBREDDIT="$2"
    KEYWORDS="$3"
    node -e "
    const { searchSubreddit, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const keywords = '$KEYWORDS'.split(',');
    searchSubreddit('$SUBREDDIT', keywords).then(posts => {
      console.log(formatPostsForWhatsApp(posts));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  monitor-jobs)
    TIMESTAMP="${2:-0}"
    node -e "
    const { monitorSubreddits, filterByScore, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const subreddits = ['forhire', 'freelance_forhire', 'jobbit'];
    const keywords = '$USER_SKILLS'.split(',');
    const timestamp = parseInt('$TIMESTAMP') || (Date.now() / 1000 - 3600 * 24);

    monitorSubreddits(subreddits, keywords, timestamp).then(posts => {
      const scored = filterByScore(posts, '$USER_SKILLS'.split(','), 7);
      if (scored.length === 0) {
        console.log('No high-quality job postings found.');
      } else {
        console.log(\`Found \${scored.length} relevant opportunities:\n\`);
        console.log(formatPostsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  monitor-community)
    SUBREDDIT="$2"
    TIMESTAMP="${3:-0}"
    node -e "
    const { getPostsSince, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const timestamp = parseInt('$TIMESTAMP') || (Date.now() / 1000 - 3600 * 4);

    getPostsSince('$SUBREDDIT', timestamp).then(posts => {
      if (posts.length === 0) {
        console.log('No new posts in r/$SUBREDDIT.');
      } else {
        console.log(\`\${posts.length} new posts in r/$SUBREDDIT:\n\`);
        console.log(formatPostsForWhatsApp(posts));
      }
    }).catch(err => console.error('Error:', err.message));
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
    echo "  status                               - Show which backend is active"
    echo ""
    echo "Examples:"
    echo "  reddit-monitor.sh search forhire 'n8n,automation'"
    echo "  reddit-monitor.sh monitor-jobs"
    echo "  reddit-monitor.sh monitor-community n8n"
    echo "  reddit-monitor.sh status"
    ;;
esac
