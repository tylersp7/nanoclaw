#!/bin/bash
# Job board scraper tool for NanoClaw agents
# Scrapes Upwork, Fiverr, and Freelancer for automation/n8n projects
# Uses RSS feeds and public APIs with curl, jq, and xmllint
#
# Usage:
#   job-board-scraper.sh upwork <keywords>
#   job-board-scraper.sh fiverr <keywords>
#   job-board-scraper.sh freelancer <keywords>
#   job-board-scraper.sh all <keywords>

set -euo pipefail

# --- Dependency checks ---
check_deps() {
  local missing=()
  command -v curl >/dev/null 2>&1 || missing+=("curl")
  command -v jq >/dev/null 2>&1 || missing+=("jq")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: Missing required dependencies: ${missing[*]}" >&2
    echo "Install with: apt-get update && apt-get install -y ${missing[*]}" >&2
    exit 1
  fi

  # xmllint is optional — we can parse XML with sed/grep fallback
  if ! command -v xmllint >/dev/null 2>&1; then
    XMLLINT_AVAILABLE=false
  else
    XMLLINT_AVAILABLE=true
  fi
}

# --- Configuration ---
DEFAULT_KEYWORDS="n8n,automation,workflow,zapier alternative,make.com alternative,API integration"
MIN_BUDGET="${MIN_BUDGET:-500}"
USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
SEEN_FILE="${SEEN_FILE:-/tmp/job-board-seen.json}"

# Initialize seen file if it doesn't exist
if [ ! -f "$SEEN_FILE" ]; then
  echo '{}' > "$SEEN_FILE"
fi

# --- Helper functions ---

# URL-encode a string
urlencode() {
  local string="$1"
  python3 -c "import urllib.parse; print(urllib.parse.quote('$string'))" 2>/dev/null \
    || echo "$string" | sed 's/ /%20/g; s/,/%2C/g; s/\./%2E/g'
}

# Extract text between XML tags (fallback when xmllint unavailable)
xml_extract() {
  local xml="$1"
  local tag="$2"
  echo "$xml" | sed -n "s/.*<${tag}>\(.*\)<\/${tag}>.*/\1/p" | head -1
}

# Extract CDATA content
xml_extract_cdata() {
  local xml="$1"
  local tag="$2"
  echo "$xml" | sed -n "s/.*<${tag}><!\[CDATA\[\(.*\)\]\]><\/${tag}>.*/\1/p" | head -1
}

# Strip HTML tags
strip_html() {
  echo "$1" | sed 's/<[^>]*>//g' | sed 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&#39;/'"'"'/g; s/&nbsp;/ /g'
}

# Truncate text to N characters
truncate_text() {
  local text="$1"
  local max="${2:-200}"
  if [ ${#text} -gt "$max" ]; then
    echo "${text:0:$max}..."
  else
    echo "$text"
  fi
}

# Check if job was already seen (by URL hash)
is_seen() {
  local url="$1"
  local hash
  hash=$(echo -n "$url" | md5sum 2>/dev/null | cut -d' ' -f1 || echo "$url")
  jq -r --arg h "$hash" '.[$h] // empty' "$SEEN_FILE" 2>/dev/null
}

# Mark job as seen
mark_seen() {
  local url="$1"
  local hash
  hash=$(echo -n "$url" | md5sum 2>/dev/null | cut -d' ' -f1 || echo "$url")
  local tmp
  tmp=$(mktemp)
  jq --arg h "$hash" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {($h): $t}' "$SEEN_FILE" > "$tmp" 2>/dev/null && mv "$tmp" "$SEEN_FILE"
}

# --- Platform scrapers ---

scrape_upwork() {
  local keywords="$1"
  local results="[]"

  # Split keywords by comma and search each
  IFS=',' read -ra KW_ARRAY <<< "$keywords"

  for kw in "${KW_ARRAY[@]}"; do
    kw=$(echo "$kw" | xargs)  # trim whitespace
    local encoded
    encoded=$(urlencode "$kw")
    local feed_url="https://www.upwork.com/ab/feed/jobs/rss?q=${encoded}&sort=recency&paging=0%3B20"

    local response
    response=$(curl -sL --max-time 15 \
      -H "User-Agent: $USER_AGENT" \
      -H "Accept: application/rss+xml, application/xml, text/xml" \
      "$feed_url" 2>/dev/null) || continue

    # Check if we got valid RSS
    if ! echo "$response" | grep -q '<rss\|<item>' 2>/dev/null; then
      continue
    fi

    # Parse RSS items
    if [ "$XMLLINT_AVAILABLE" = true ]; then
      # Use xmllint for robust parsing
      local item_count
      item_count=$(echo "$response" | xmllint --xpath 'count(//item)' - 2>/dev/null) || item_count=0

      for ((i=1; i<=item_count && i<=20; i++)); do
        local title url description pub_date link
        title=$(echo "$response" | xmllint --xpath "string(//item[$i]/title)" - 2>/dev/null || echo "")
        link=$(echo "$response" | xmllint --xpath "string(//item[$i]/link)" - 2>/dev/null || echo "")
        description=$(echo "$response" | xmllint --xpath "string(//item[$i]/description)" - 2>/dev/null || echo "")
        pub_date=$(echo "$response" | xmllint --xpath "string(//item[$i]/pubDate)" - 2>/dev/null || echo "")

        [ -z "$title" ] && continue

        # Strip HTML from description and truncate
        local clean_desc
        clean_desc=$(strip_html "$description")
        clean_desc=$(truncate_text "$clean_desc" 300)

        # Extract budget from description
        local budget=""
        local budget_amount=0
        budget=$(echo "$description" | grep -oP '(?:Budget|Fixed Price|Hourly Range):\s*\$[\d,]+(?:\s*-\s*\$[\d,]+)?' 2>/dev/null | head -1 || echo "")
        if [ -n "$budget" ]; then
          budget_amount=$(echo "$budget" | grep -oP '\d[\d,]*' | head -1 | tr -d ',' || echo "0")
        fi

        # Build JSON for this job
        local job_json
        job_json=$(jq -n \
          --arg title "$title" \
          --arg url "$link" \
          --arg desc "$clean_desc" \
          --arg budget "$budget" \
          --argjson budget_amount "${budget_amount:-0}" \
          --arg platform "upwork" \
          --arg posted_date "$pub_date" \
          --arg keyword "$kw" \
          '{
            title: $title,
            url: $url,
            description: $desc,
            budget: $budget,
            budget_amount: $budget_amount,
            platform: $platform,
            posted_date: $posted_date,
            search_keyword: $keyword
          }')

        results=$(echo "$results" | jq --argjson job "$job_json" '. + [$job]')
      done
    else
      # Fallback: parse with sed/awk
      echo "$response" | awk '/<item>/,/<\/item>/' | while IFS= read -r line; do
        if echo "$line" | grep -q '<title>' 2>/dev/null; then
          local title
          title=$(xml_extract "$line" "title")
          # Basic extraction - less reliable without xmllint
          echo "$title"
        fi
      done > /dev/null  # Suppress fallback output, we'll still get xmllint path results
    fi
  done

  echo "$results"
}

scrape_fiverr() {
  local keywords="$1"
  local results="[]"

  # Fiverr doesn't have public RSS/API for buyer requests
  # We scrape their search results page for gig requests
  IFS=',' read -ra KW_ARRAY <<< "$keywords"

  for kw in "${KW_ARRAY[@]}"; do
    kw=$(echo "$kw" | xargs)
    local encoded
    encoded=$(urlencode "$kw")

    # Fiverr search URL
    local search_url="https://www.fiverr.com/search/gigs?query=${encoded}&source=top-bar&search_in=everywhere&search-autocomplete-original-term=${encoded}"

    local response
    response=$(curl -sL --max-time 15 \
      -H "User-Agent: $USER_AGENT" \
      -H "Accept: text/html" \
      "$search_url" 2>/dev/null) || continue

    # Fiverr embeds JSON data in script tags - try to extract
    # Look for __NEXT_DATA__ or similar JSON payload
    local json_data
    json_data=$(echo "$response" | grep -oP '(?<=<script id="__NEXT_DATA__" type="application/json">).*?(?=</script>)' 2>/dev/null | head -1) || json_data=""

    if [ -n "$json_data" ]; then
      # Extract gig listings from Next.js data
      local gigs
      gigs=$(echo "$json_data" | jq -r '.props.pageProps.searchResults.gigs // [] | .[] | {
        title: .title,
        url: ("https://www.fiverr.com" + .url),
        description: (.title + " - " + (.seller_name // "unknown seller")),
        budget: ((.price // 0) | tostring | "Starting at $" + .),
        budget_amount: (.price // 0),
        platform: "fiverr",
        posted_date: "",
        search_keyword: "'"$kw"'"
      }' 2>/dev/null) || gigs=""

      if [ -n "$gigs" ]; then
        while IFS= read -r gig_json; do
          [ -z "$gig_json" ] && continue
          results=$(echo "$results" | jq --argjson job "$gig_json" '. + [$job]' 2>/dev/null) || true
        done <<< "$gigs"
      fi
    fi

    # If JSON extraction failed, try basic HTML scraping
    if [ "$(echo "$results" | jq 'length')" = "0" ]; then
      # Look for gig cards in HTML
      local titles
      titles=$(echo "$response" | grep -oP '(?<=class="[^"]*gig-card[^"]*"[^>]*>).*?(?=</a>)' 2>/dev/null | head -10) || true

      if [ -z "$titles" ]; then
        # Fiverr heavily blocks scraping - note this for the user
        local note_json
        note_json=$(jq -n \
          --arg kw "$kw" \
          '{
            title: ("Fiverr search for: " + $kw),
            url: ("https://www.fiverr.com/search/gigs?query=" + $kw),
            description: "Fiverr blocks automated access. Visit the URL manually or use agent-browser tool for full results.",
            budget: "",
            budget_amount: 0,
            platform: "fiverr",
            posted_date: "",
            search_keyword: $kw,
            note: "manual_check_required"
          }')
        results=$(echo "$results" | jq --argjson job "$note_json" '. + [$job]')
      fi
    fi
  done

  echo "$results"
}

scrape_freelancer() {
  local keywords="$1"
  local results="[]"

  IFS=',' read -ra KW_ARRAY <<< "$keywords"

  for kw in "${KW_ARRAY[@]}"; do
    kw=$(echo "$kw" | xargs)
    local encoded
    encoded=$(urlencode "$kw")

    # Freelancer public API for active projects
    local api_url="https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encoded}&compact=true&limit=20&sort_field=time_submitted&sort_direction=desc"

    local response
    response=$(curl -sL --max-time 15 \
      -H "User-Agent: $USER_AGENT" \
      -H "Accept: application/json" \
      "$api_url" 2>/dev/null) || continue

    # Check for valid JSON response
    if ! echo "$response" | jq -e '.result.projects' >/dev/null 2>&1; then
      continue
    fi

    # Parse projects from API response
    local projects
    projects=$(echo "$response" | jq -r --arg kw "$kw" '
      .result.projects // [] | .[] | {
        title: .title,
        url: ("https://www.freelancer.com/projects/" + (.seo_url // (.id | tostring))),
        description: ((.preview_description // .title) | .[0:300]),
        budget: (
          if .budget then
            if .budget.minimum and .budget.maximum then
              "$" + (.budget.minimum | tostring) + " - $" + (.budget.maximum | tostring)
            elif .budget.minimum then
              "$" + (.budget.minimum | tostring) + "+"
            else
              ""
            end
          else
            ""
          end
        ),
        budget_amount: (
          if .budget and .budget.maximum then
            .budget.maximum
          elif .budget and .budget.minimum then
            .budget.minimum
          else
            0
          end
        ),
        platform: "freelancer",
        posted_date: (if .time_submitted then (.time_submitted | todate) else "" end),
        search_keyword: $kw
      }
    ' 2>/dev/null) || projects=""

    if [ -n "$projects" ]; then
      while IFS= read -r project_json; do
        [ -z "$project_json" ] && continue
        # Validate it's proper JSON before appending
        if echo "$project_json" | jq -e . >/dev/null 2>&1; then
          results=$(echo "$results" | jq --argjson job "$project_json" '. + [$job]' 2>/dev/null) || true
        fi
      done <<< "$projects"
    fi
  done

  echo "$results"
}

# --- Scoring ---

score_job() {
  local job_json="$1"
  local title desc budget_amount platform

  title=$(echo "$job_json" | jq -r '.title' | tr '[:upper:]' '[:lower:]')
  desc=$(echo "$job_json" | jq -r '.description' | tr '[:upper:]' '[:lower:]')
  budget_amount=$(echo "$job_json" | jq -r '.budget_amount // 0')
  platform=$(echo "$job_json" | jq -r '.platform')

  local text="$title $desc"
  local score=5

  # Budget scoring
  if [ "$budget_amount" -ge 2000 ] 2>/dev/null; then
    score=$((score + 3))
  elif [ "$budget_amount" -ge 1000 ] 2>/dev/null; then
    score=$((score + 2))
  elif [ "$budget_amount" -ge 500 ] 2>/dev/null; then
    score=$((score + 1))
  elif [ "$budget_amount" -gt 0 ] 2>/dev/null && [ "$budget_amount" -lt 100 ] 2>/dev/null; then
    score=$((score - 2))
  fi

  # High-value keyword matches
  echo "$text" | grep -qi 'n8n' && score=$((score + 2))
  echo "$text" | grep -qi 'automation' && score=$((score + 1))
  echo "$text" | grep -qi 'workflow' && score=$((score + 1))
  echo "$text" | grep -qi 'api integration' && score=$((score + 1))
  echo "$text" | grep -qi 'zapier\|make\.com' && score=$((score + 1))
  echo "$text" | grep -qi 'ongoing\|long.term\|retainer' && score=$((score + 2))
  echo "$text" | grep -qi 'urgent\|asap' && score=$((score + 1))

  # Red flags
  echo "$text" | grep -qi 'data entry\|copy paste\|typing' && score=$((score - 3))
  echo "$text" | grep -qi 'unpaid\|free\|volunteer' && score=$((score - 3))
  echo "$text" | grep -qi 'equity only\|rev share only' && score=$((score - 2))
  echo "$text" | grep -qi 'simple task\|easy job\|quick fix' && score=$((score - 1))

  # Clamp to 1-10
  [ "$score" -lt 1 ] && score=1
  [ "$score" -gt 10 ] && score=10

  echo "$score"
}

# --- Output formatting ---

format_results() {
  local jobs_json="$1"
  local min_budget="${2:-0}"
  local scored_results="[]"

  local count
  count=$(echo "$jobs_json" | jq 'length')

  for ((i=0; i<count; i++)); do
    local job
    job=$(echo "$jobs_json" | jq ".[$i]")

    # Filter by minimum budget (skip if budget_amount > 0 and below threshold)
    local ba
    ba=$(echo "$job" | jq -r '.budget_amount // 0')
    if [ "$ba" -gt 0 ] 2>/dev/null && [ "$ba" -lt "$min_budget" ] 2>/dev/null; then
      continue
    fi

    # Score the job
    local match_score
    match_score=$(score_job "$job")

    # Add score to job
    job=$(echo "$job" | jq --argjson score "$match_score" '. + {match_score: $score}')
    scored_results=$(echo "$scored_results" | jq --argjson job "$job" '. + [$job]')
  done

  # Sort by score descending
  scored_results=$(echo "$scored_results" | jq 'sort_by(-.match_score)')

  echo "$scored_results"
}

# --- Main command handler ---

check_deps

COMMAND="${1:-}"
KEYWORDS="${2:-$DEFAULT_KEYWORDS}"

case "$COMMAND" in
  upwork)
    echo "Searching Upwork for: $KEYWORDS" >&2
    results=$(scrape_upwork "$KEYWORDS")
    scored=$(format_results "$results" "$MIN_BUDGET")
    echo "$scored" | jq .
    ;;

  fiverr)
    echo "Searching Fiverr for: $KEYWORDS" >&2
    results=$(scrape_fiverr "$KEYWORDS")
    scored=$(format_results "$results" "0")  # Fiverr has different pricing model
    echo "$scored" | jq .
    ;;

  freelancer)
    echo "Searching Freelancer for: $KEYWORDS" >&2
    results=$(scrape_freelancer "$KEYWORDS")
    scored=$(format_results "$results" "$MIN_BUDGET")
    echo "$scored" | jq .
    ;;

  all)
    echo "Searching all platforms for: $KEYWORDS" >&2
    all_results="[]"

    # Upwork
    echo "  -> Upwork..." >&2
    upwork_results=$(scrape_upwork "$KEYWORDS") || upwork_results="[]"
    all_results=$(echo "$all_results" "$upwork_results" | jq -s '.[0] + .[1]')

    # Freelancer
    echo "  -> Freelancer..." >&2
    freelancer_results=$(scrape_freelancer "$KEYWORDS") || freelancer_results="[]"
    all_results=$(echo "$all_results" "$freelancer_results" | jq -s '.[0] + .[1]')

    # Fiverr
    echo "  -> Fiverr..." >&2
    fiverr_results=$(scrape_fiverr "$KEYWORDS") || fiverr_results="[]"
    all_results=$(echo "$all_results" "$fiverr_results" | jq -s '.[0] + .[1]')

    # Deduplicate by URL
    all_results=$(echo "$all_results" | jq '[group_by(.url)[] | .[0]]')

    scored=$(format_results "$all_results" "$MIN_BUDGET")
    echo "$scored" | jq .
    ;;

  *)
    cat <<'USAGE'
Usage: job-board-scraper.sh <command> [keywords]

Commands:
  upwork <keywords>       Search Upwork RSS feed for matching jobs
  fiverr <keywords>       Search Fiverr for buyer requests/gigs
  freelancer <keywords>   Search Freelancer public API
  all <keywords>          Search all platforms

Keywords:
  Comma-separated list of search terms.
  Default: n8n,automation,workflow,zapier alternative,make.com alternative,API integration

Environment Variables:
  MIN_BUDGET    Minimum budget filter in USD (default: 500)
  SEEN_FILE     Path to seen-jobs tracking file (default: /tmp/job-board-seen.json)

Output:
  JSON array of job objects, each with:
    title, url, description, budget, budget_amount, platform, posted_date, match_score

Examples:
  job-board-scraper.sh upwork "n8n,automation"
  job-board-scraper.sh freelancer "workflow,API integration"
  job-board-scraper.sh all "n8n,automation,workflow"
  MIN_BUDGET=200 job-board-scraper.sh all "automation"
USAGE
    ;;
esac
