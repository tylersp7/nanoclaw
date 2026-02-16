#!/bin/bash
# Proposal generator tool

NANOCLAW_DIR="/workspace/project"

case "$1" in
  generate)
    JOB_TITLE="$2"
    JOB_DESC="$3"
    PLATFORM="${4:-upwork}"

    if [ -z "$JOB_TITLE" ] || [ -z "$JOB_DESC" ]; then
      echo "Usage: proposal-generator.sh generate 'title' 'description' [platform]"
      exit 1
    fi

    node -e "
    const { generateProposal, formatProposalForWhatsApp } = require('$NANOCLAW_DIR/dist/proposal-generator.js');

    const job = {
      title: process.argv[1],
      description: process.argv[2],
      platform: process.argv[3]
    };

    generateProposal(job).then(proposal => {
      console.log(formatProposalForWhatsApp(proposal));
    }).catch(err => console.error('Error:', err.message));
    " "$JOB_TITLE" "$JOB_DESC" "$PLATFORM"
    ;;

  analyze)
    JOB_TITLE="$2"
    JOB_DESC="$3"

    if [ -z "$JOB_TITLE" ] || [ -z "$JOB_DESC" ]; then
      echo "Usage: proposal-generator.sh analyze 'title' 'description'"
      exit 1
    fi

    node -e "
    const { analyzeJobFit } = require('$NANOCLAW_DIR/dist/proposal-generator.js');

    const job = {
      title: process.argv[1],
      description: process.argv[2],
      platform: 'upwork'
    };

    analyzeJobFit(job).then(analysis => {
      console.log('*JOB FIT ANALYSIS*');
      console.log('Score:', analysis.score + '/10');
      console.log('\nStrengths:');
      analysis.strengths.forEach(s => console.log('  +', s));
      console.log('\nConcerns:');
      analysis.concerns.forEach(c => console.log('  -', c));
      console.log('\nRecommendation:', analysis.recommendation);
    }).catch(err => console.error('Error:', err.message));
    " "$JOB_TITLE" "$JOB_DESC"
    ;;

  variations)
    JOB_TITLE="$2"
    JOB_DESC="$3"

    if [ -z "$JOB_TITLE" ] || [ -z "$JOB_DESC" ]; then
      echo "Usage: proposal-generator.sh variations 'title' 'description'"
      exit 1
    fi

    node -e "
    const { generateProposalVariations } = require('$NANOCLAW_DIR/dist/proposal-generator.js');

    const job = {
      title: process.argv[1],
      description: process.argv[2],
      platform: 'upwork'
    };

    generateProposalVariations(job, 3).then(variations => {
      variations.forEach((proposal, i) => {
        console.log(\`\n=== VARIATION \${i + 1} ===\n\`);
        console.log(proposal.proposal);
        console.log('\nConfidence:', proposal.confidence);
      });
    }).catch(err => console.error('Error:', err.message));
    " "$JOB_TITLE" "$JOB_DESC"
    ;;

  *)
    echo "Usage: proposal-generator.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  generate 'title' 'description' [platform]  - Generate proposal"
    echo "  analyze 'title' 'description'              - Analyze job fit"
    echo "  variations 'title' 'description'           - Generate 3 versions"
    echo ""
    echo "Examples:"
    echo "  proposal-generator.sh generate 'n8n Automation Expert' 'Need help with...'"
    echo "  proposal-generator.sh analyze 'API Integration' 'Looking for...'"
    ;;
esac
