#!/bin/bash
# Proposal generator tool for NanoClaw agents
#
# This tool loads the user's professional profile and proposal templates,
# formats them for the Claude agent to use when writing proposals.
# The heavy lifting (actually writing the proposal) is done by Claude.
#
# Config location (inside container): /home/node/.nanoclaw-proposals/
# Generated proposals saved to: /workspace/group/proposals/

PROPOSALS_DIR="/home/node/.nanoclaw-proposals"
PROFILE_FILE="$PROPOSALS_DIR/profile.json"
TEMPLATES_DIR="$PROPOSALS_DIR/templates"
OUTPUT_DIR="/workspace/group/proposals"

case "$1" in
  generate)
    JOB_FILE="$2"

    if [ -z "$JOB_FILE" ]; then
      echo "Usage: proposal-generator.sh generate <job-description-file>"
      echo ""
      echo "Reads the job description from the file, loads your profile and"
      echo "best-matching template, and outputs everything formatted for"
      echo "Claude to write the proposal."
      exit 1
    fi

    if [ ! -f "$JOB_FILE" ]; then
      echo "Error: Job description file not found: $JOB_FILE"
      exit 1
    fi

    if [ ! -f "$PROFILE_FILE" ]; then
      echo "Error: Profile not found at $PROFILE_FILE"
      echo "Run /add-proposal-generator to set up your profile."
      exit 1
    fi

    JOB_DESC=$(cat "$JOB_FILE")

    # Find the best-matching template by counting keyword overlaps
    BEST_TEMPLATE=""
    BEST_SCORE=0
    BEST_NAME=""

    if [ -d "$TEMPLATES_DIR" ]; then
      for template_file in "$TEMPLATES_DIR"/*.md; do
        [ -f "$template_file" ] || continue

        # Extract keywords line from template
        KEYWORDS_LINE=$(grep -A1 "^## Keywords" "$template_file" | tail -1)

        # Count how many keywords appear in the job description (case-insensitive)
        MATCH_COUNT=0
        IFS=',' read -ra KW_ARRAY <<< "$KEYWORDS_LINE"
        for kw in "${KW_ARRAY[@]}"; do
          kw=$(echo "$kw" | sed 's/^ *//;s/ *$//')  # trim whitespace
          if echo "$JOB_DESC" | grep -qi "$kw"; then
            MATCH_COUNT=$((MATCH_COUNT + 1))
          fi
        done

        if [ "$MATCH_COUNT" -gt "$BEST_SCORE" ]; then
          BEST_SCORE=$MATCH_COUNT
          BEST_TEMPLATE=$(cat "$template_file")
          BEST_NAME=$(basename "$template_file" .md)
        fi
      done
    fi

    # Fall back to general-freelance if no good match
    if [ "$BEST_SCORE" -eq 0 ] && [ -f "$TEMPLATES_DIR/general-freelance.md" ]; then
      BEST_TEMPLATE=$(cat "$TEMPLATES_DIR/general-freelance.md")
      BEST_NAME="general-freelance"
    fi

    # Output everything formatted for Claude
    echo "=== PROPOSAL GENERATION CONTEXT ==="
    echo ""
    echo "--- YOUR PROFILE ---"
    cat "$PROFILE_FILE"
    echo ""
    echo ""
    echo "--- JOB DESCRIPTION ---"
    echo "$JOB_DESC"
    echo ""
    echo ""
    if [ -n "$BEST_TEMPLATE" ]; then
      echo "--- BEST MATCHING TEMPLATE ($BEST_NAME, $BEST_SCORE keyword matches) ---"
      echo "$BEST_TEMPLATE"
    else
      echo "--- NO TEMPLATE MATCHED ---"
      echo "Write a professional proposal using the profile above and the job description."
      echo "Structure: Introduction, Relevant Experience, Proposed Approach, Timeline & Pricing, Next Steps."
    fi
    echo ""
    echo ""
    echo "--- INSTRUCTIONS FOR CLAUDE ---"
    echo "Using the profile and template above, write a tailored proposal for this job."
    echo "Replace all {{placeholders}} with appropriate content from the profile."
    echo "Make the proposal sound natural and human -- not corporate or generic."
    echo "Reference specific details from the job description to show you read it."
    echo "Keep it concise: 250-400 words."
    echo "Output ONLY the proposal text, ready to copy and send."
    ;;

  list-templates)
    if [ ! -d "$TEMPLATES_DIR" ]; then
      echo "No templates directory found at $TEMPLATES_DIR"
      echo "Run /add-proposal-generator to set up templates."
      exit 1
    fi

    echo "Available proposal templates:"
    echo ""

    for template_file in "$TEMPLATES_DIR"/*.md; do
      [ -f "$template_file" ] || continue
      NAME=$(basename "$template_file" .md)
      # Extract the first line after "# Template:" for description
      DESC=$(grep "^# Template:" "$template_file" | sed 's/^# Template: //')
      # Extract keywords
      KW=$(grep -A1 "^## Keywords" "$template_file" | tail -1)
      echo "  $NAME"
      [ -n "$DESC" ] && echo "    Type: $DESC"
      [ -n "$KW" ] && echo "    Keywords: $KW"
      echo ""
    done
    ;;

  profile)
    if [ ! -f "$PROFILE_FILE" ]; then
      echo "No profile found at $PROFILE_FILE"
      echo "Run /add-proposal-generator to create your profile."
      exit 1
    fi

    echo "=== YOUR PROFESSIONAL PROFILE ==="
    echo ""
    cat "$PROFILE_FILE"
    ;;

  save)
    CLIENT_NAME="$2"
    PROPOSAL_TEXT="$3"

    if [ -z "$CLIENT_NAME" ] || [ -z "$PROPOSAL_TEXT" ]; then
      echo "Usage: proposal-generator.sh save <client-name> <proposal-text>"
      echo ""
      echo "Saves a generated proposal to /workspace/group/proposals/ for tracking."
      exit 1
    fi

    mkdir -p "$OUTPUT_DIR"

    # Generate filename with date and client name
    DATE=$(date +%Y-%m-%d)
    SAFE_NAME=$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')
    FILENAME="${DATE}-${SAFE_NAME}.md"
    FILEPATH="$OUTPUT_DIR/$FILENAME"

    # Write proposal with metadata header
    cat > "$FILEPATH" << PROPOSAL_EOF
# Proposal: $CLIENT_NAME
**Date:** $DATE
**Generated by:** proposal-generator

---

$PROPOSAL_TEXT
PROPOSAL_EOF

    echo "Proposal saved to: $FILEPATH"
    ;;

  *)
    echo "Usage: proposal-generator.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  generate <job-desc-file>           - Load profile + template for a job description"
    echo "  list-templates                     - Show available proposal templates"
    echo "  profile                            - Show your professional profile"
    echo "  save <client-name> <proposal-text> - Save a generated proposal"
    echo ""
    echo "The 'generate' command outputs your profile and best-matching template,"
    echo "formatted for Claude to write the actual proposal."
    echo ""
    echo "Examples:"
    echo "  proposal-generator.sh generate /tmp/job.txt"
    echo "  proposal-generator.sh list-templates"
    echo "  proposal-generator.sh profile"
    echo "  proposal-generator.sh save 'acme-corp' 'Hi, I noticed your posting...'"
    ;;
esac
