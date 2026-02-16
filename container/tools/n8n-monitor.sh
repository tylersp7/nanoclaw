#!/bin/bash
# n8n community monitoring tool

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,VPS,Docker,webhook,self-host,integration,security,Python,JavaScript"

case "$1" in
  unanswered)
    KEYWORDS="${2:-}"
    node -e "
    const { getUnansweredPosts, formatForumPostsForWhatsApp, scoreForumPost } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const keywords = '$KEYWORDS' ? '$KEYWORDS'.split(',') : undefined;
    const skills = '$USER_SKILLS'.split(',');

    getUnansweredPosts(keywords).then(posts => {
      const scored = posts.map(post => ({
        ...post,
        score: scoreForumPost(post, skills)
      })).filter(p => p.score >= 6).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No unanswered posts found.');
      } else {
        console.log(\`Found \${scored.length} unanswered posts (score >= 6/10):\n\`);
        console.log(formatForumPostsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  search)
    KEYWORDS="$2"
    if [ -z "$KEYWORDS" ]; then
      echo "Usage: n8n-monitor.sh search 'keywords'"
      exit 1
    fi
    node -e "
    const { searchForum, formatForumPostsForWhatsApp, scoreForumPost } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const keywords = '$KEYWORDS'.split(',');
    const skills = '$USER_SKILLS'.split(',');

    searchForum(keywords, false).then(posts => {
      const scored = posts.map(post => ({
        ...post,
        score: scoreForumPost(post, skills)
      })).filter(p => p.score >= 5).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No posts found matching keywords.');
      } else {
        console.log(\`Found \${scored.length} posts:\n\`);
        console.log(formatForumPostsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  github-issues)
    LABELS="${2:-}"
    node -e "
    const { getN8nIssues, formatGitHubIssuesForWhatsApp, scoreGitHubIssue } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const labels = '$LABELS' ? '$LABELS'.split(',') : undefined;
    const skills = '$USER_SKILLS'.split(',');

    getN8nIssues(labels).then(issues => {
      const scored = issues.map(issue => ({
        ...issue,
        score: scoreGitHubIssue(issue, skills)
      })).filter(i => i.score >= 6).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No issues found.');
      } else {
        console.log(\`Found \${scored.length} issues (score >= 6/10):\n\`);
        console.log(formatGitHubIssuesForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  template-ideas)
    node -e "
    const { findTemplateOpportunities, formatForumPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/n8n-helper.js');

    findTemplateOpportunities().then(posts => {
      if (posts.length === 0) {
        console.log('No template opportunities found.');
      } else {
        console.log('Popular unsolved problems (template opportunities):\n');
        console.log(formatForumPostsForWhatsApp(posts));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  feature-requests)
    node -e "
    const { getFeatureRequests, formatGitHubIssuesForWhatsApp, scoreGitHubIssue } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    getFeatureRequests().then(issues => {
      const scored = issues.map(issue => ({
        ...issue,
        score: scoreGitHubIssue(issue, skills)
      })).filter(i => i.score >= 5).sort((a, b) => b.score - a.score);

      console.log(\`Found \${scored.length} feature requests:\n\`);
      console.log(formatGitHubIssuesForWhatsApp(scored));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: n8n-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  unanswered [keywords]    - Find unanswered forum posts"
    echo "  search 'keywords'        - Search forum for keywords"
    echo "  github-issues [labels]   - Get n8n GitHub issues"
    echo "  template-ideas           - Find template opportunities"
    echo "  feature-requests         - Get feature requests from GitHub"
    echo ""
    echo "Examples:"
    echo "  n8n-monitor.sh unanswered 'api,webhook'"
    echo "  n8n-monitor.sh search 'vps,docker,self-host'"
    echo "  n8n-monitor.sh github-issues 'bug,help wanted'"
    echo "  n8n-monitor.sh template-ideas"
    ;;
esac
