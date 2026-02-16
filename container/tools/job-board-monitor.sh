#!/bin/bash
# Job board monitoring tool

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,workflow,Python,JavaScript,VPS,Docker,security,integration,webhook"

case "$1" in
  upwork)
    MIN_SCORE="${2:-7}"
    node -e "
    const { fetchUpworkJobs, filterJobsByScore, formatJobsForWhatsApp } = require('$NANOCLAW_DIR/dist/job-board-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    fetchUpworkJobs().then(jobs => {
      const scored = filterJobsByScore(jobs, skills, $MIN_SCORE);

      if (scored.length === 0) {
        console.log('No high-scoring Upwork jobs found.');
      } else {
        console.log(\`Found \${scored.length} Upwork jobs (score >= $MIN_SCORE/10):\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  freelancer)
    KEYWORDS="${2:-automation api}"
    MIN_SCORE="${3:-7}"
    node -e "
    const { fetchFreelancerJobs, filterJobsByScore, formatJobsForWhatsApp } = require('$NANOCLAW_DIR/dist/job-board-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    fetchFreelancerJobs('$KEYWORDS').then(jobs => {
      const scored = filterJobsByScore(jobs, skills, $MIN_SCORE);

      if (scored.length === 0) {
        console.log('No high-scoring Freelancer jobs found.');
      } else {
        console.log(\`Found \${scored.length} Freelancer jobs (score >= $MIN_SCORE/10):\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  all)
    MIN_SCORE="${2:-7}"
    node -e "
    const { fetchFreelancerJobs, filterJobsByScore, formatJobsForWhatsApp } = require('$NANOCLAW_DIR/dist/job-board-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    Promise.all([
      fetchFreelancerJobs('automation api integration'),
      fetchFreelancerJobs('n8n workflow'),
    ]).then(results => {
      const allJobs = results.flat();
      // Deduplicate by id
      const unique = [...new Map(allJobs.map(j => [j.id, j])).values()];
      const scored = filterJobsByScore(unique, skills, $MIN_SCORE);

      if (scored.length === 0) {
        console.log('No high-scoring jobs found.');
      } else {
        console.log(\`Found \${scored.length} jobs (score >= $MIN_SCORE/10):\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }
      console.log('\nNote: For Upwork, use agent-browser to search directly.');
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: job-board-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  upwork [min_score]                  - Check Upwork (RSS)"
    echo "  freelancer [keywords] [min_score]   - Check Freelancer"
    echo "  all [min_score]                     - Check all platforms"
    echo ""
    echo "Examples:"
    echo "  job-board-monitor.sh upwork 8"
    echo "  job-board-monitor.sh freelancer 'n8n automation' 7"
    echo "  job-board-monitor.sh all 7"
    ;;
esac
