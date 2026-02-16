#!/bin/bash
# LinkedIn monitoring tool

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,workflow,Python,JavaScript,VPS,security,integration"

case "$1" in
  search-jobs)
    KEYWORDS="${2:-automation n8n}"
    MIN_SCORE="${3:-7}"
    node -e "
    const { searchJobs, scoreJob, formatJobsForWhatsApp, closeBrowser } = require('$NANOCLAW_DIR/dist/linkedin-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    searchJobs('$KEYWORDS', 'Remote', 'past-week').then(jobs => {
      const scored = jobs.map(job => ({
        ...job,
        relevanceScore: scoreJob(job, skills)
      })).filter(j => j.relevanceScore >= $MIN_SCORE).sort((a, b) => b.relevanceScore - a.relevanceScore);

      if (scored.length === 0) {
        console.log('No high-scoring jobs found.');
      } else {
        console.log(\`Found \${scored.length} relevant jobs (score >= $MIN_SCORE/10):\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }

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

  *)
    echo "Usage: linkedin-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  search-jobs [keywords] [min_score]  - Search for jobs"
    echo "  hashtag <tag>                       - Search hashtag posts"
    echo ""
    echo "Examples:"
    echo "  linkedin-monitor.sh search-jobs 'n8n automation' 7"
    echo "  linkedin-monitor.sh hashtag n8n"
    ;;
esac
