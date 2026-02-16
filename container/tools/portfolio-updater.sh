#!/bin/bash
# Portfolio updater tool for NanoClaw agents
# Scans GitHub activity, extracts highlights, updates portfolio files

NANOCLAW_DIR="/workspace/project"
CONFIG_FILE="/workspace/group/portfolio-config.json"
PORTFOLIO_DIR="/workspace/group/portfolio"
GITHUB_CREDS="/workspace/extra/.nanoclaw-github/credentials.json"
SCAN_CACHE="/workspace/group/portfolio-scan-cache.json"

# Load GitHub token
get_token() {
  if [ -f "$GITHUB_CREDS" ]; then
    node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$GITHUB_CREDS','utf8')).token)"
  else
    echo ""
  fi
}

# Load GitHub username
get_username() {
  if [ -f "$GITHUB_CREDS" ]; then
    node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$GITHUB_CREDS','utf8')).username)"
  else
    echo ""
  fi
}

case "$1" in
  scan)
    USERNAME="${2:-$(get_username)}"
    TOKEN=$(get_token)

    if [ -z "$TOKEN" ]; then
      echo "Error: GitHub credentials not found at $GITHUB_CREDS"
      echo "Run /add-github-monitor to set up GitHub access."
      exit 1
    fi

    if [ -z "$USERNAME" ]; then
      echo "Error: GitHub username not found. Usage: portfolio-updater.sh scan <username>"
      exit 1
    fi

    WEEK_AGO=$(date -u -d "7 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || node -e "console.log(new Date(Date.now()-7*86400000).toISOString())")

    # Read config for specific repos, or scan all
    if [ -f "$CONFIG_FILE" ]; then
      REPOS=$(node -e "
        const config = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));
        if (config.repos[0] === '*') {
          console.log('*');
        } else {
          console.log(config.repos.join(','));
        }
      ")
    else
      REPOS="*"
    fi

    echo "Scanning GitHub activity for $USERNAME since $WEEK_AGO..."
    echo ""

    node -e "
    const https = require('https');

    const TOKEN = '$TOKEN';
    const USERNAME = '$USERNAME';
    const WEEK_AGO = '$WEEK_AGO';
    const REPOS_STR = '$REPOS';

    function ghApi(path) {
      return new Promise((resolve, reject) => {
        const opts = {
          hostname: 'api.github.com',
          path: path,
          headers: {
            'Authorization': 'token ' + TOKEN,
            'User-Agent': 'NanoClaw-Portfolio',
            'Accept': 'application/vnd.github.v3+json'
          }
        };
        https.get(opts, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch(e) { resolve([]); }
          });
        }).on('error', reject);
      });
    }

    async function scanRepos() {
      let repoList = [];

      if (REPOS_STR === '*') {
        // Fetch all user repos
        const repos = await ghApi('/users/' + USERNAME + '/repos?sort=updated&per_page=50');
        repoList = (repos || []).filter(r => !r.fork).slice(0, 15).map(r => r.full_name);
      } else {
        repoList = REPOS_STR.split(',').map(r => r.trim());
      }

      const results = { repos: [] };
      const weekAgo = new Date(WEEK_AGO);

      for (const fullName of repoList) {
        const [owner, repo] = fullName.split('/');
        if (!owner || !repo) continue;

        try {
          // Fetch repo info
          const repoData = await ghApi('/repos/' + fullName);

          // Fetch recent commits
          const commits = await ghApi('/repos/' + fullName + '/commits?since=' + WEEK_AGO + '&per_page=100');
          const commitCount = Array.isArray(commits) ? commits.length : 0;

          // Fetch merged PRs
          const prs = await ghApi('/repos/' + fullName + '/pulls?state=closed&sort=updated&direction=desc&per_page=10');
          const mergedPrs = Array.isArray(prs) ? prs.filter(p => p.merged_at && new Date(p.merged_at) > weekAgo) : [];

          // Fetch releases
          const releases = await ghApi('/repos/' + fullName + '/releases?per_page=5');
          const recentReleases = Array.isArray(releases) ? releases.filter(r => r.published_at && new Date(r.published_at) > weekAgo) : [];

          // Fetch recent closed issues
          const issues = await ghApi('/repos/' + fullName + '/issues?state=closed&since=' + WEEK_AGO + '&per_page=20');
          const closedIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];

          const repoResult = {
            name: fullName,
            stars: repoData.stargazers_count || 0,
            forks: repoData.forks_count || 0,
            watchers: repoData.watchers_count || 0,
            language: repoData.language || 'Unknown',
            description: repoData.description || '',
            commits: commitCount,
            prs_merged: mergedPrs.map(p => ({ title: p.title, number: p.number, merged_at: p.merged_at })),
            releases: recentReleases.map(r => ({ tag: r.tag_name, name: r.name, published_at: r.published_at })),
            notable_issues: closedIssues.slice(0, 5).map(i => ({ title: i.title, number: i.number, state: i.state }))
          };

          // Only include repos with some activity
          if (commitCount > 0 || mergedPrs.length > 0 || recentReleases.length > 0 || closedIssues.length > 0 || repoData.stargazers_count > 0) {
            results.repos.push(repoResult);
          }
        } catch (err) {
          console.error('Error scanning ' + fullName + ': ' + err.message);
        }
      }

      // Save scan cache
      const fs = require('fs');
      fs.mkdirSync(require('path').dirname('$SCAN_CACHE'), { recursive: true });
      fs.writeFileSync('$SCAN_CACHE', JSON.stringify(results, null, 2));

      console.log(JSON.stringify(results, null, 2));
    }

    scanRepos().catch(err => {
      console.error('Scan failed:', err.message);
      process.exit(1);
    });
    "
    ;;

  highlights)
    if [ ! -f "$SCAN_CACHE" ]; then
      echo "Error: No scan data found. Run 'portfolio-updater.sh scan' first."
      exit 1
    fi

    node -e "
    const fs = require('fs');
    const scan = JSON.parse(fs.readFileSync('$SCAN_CACHE', 'utf8'));
    const highlights = [];

    for (const repo of scan.repos) {
      // Star milestones
      const milestones = [10, 25, 50, 100, 250, 500, 1000, 5000];
      for (const m of milestones) {
        if (repo.stars >= m && repo.stars < m * 1.5) {
          highlights.push({
            type: 'milestone',
            repo: repo.name,
            title: repo.name.split('/')[1] + ' reached ' + repo.stars + ' stars',
            description: repo.name.split('/')[1] + ' has reached ' + repo.stars + ' stars on GitHub, demonstrating growing community interest in ' + (repo.description || 'the project') + '.',
            social_post: 'Excited to see ' + repo.name.split('/')[1] + ' reach ' + repo.stars + ' stars! ' + (repo.description || '') + ' #opensource #devtools',
            importance: Math.min(10, 5 + Math.floor(Math.log10(m)))
          });
        }
      }

      // Merged PRs
      for (const pr of repo.prs_merged) {
        highlights.push({
          type: 'pr_merged',
          repo: repo.name,
          title: 'PR merged: ' + pr.title,
          description: 'Merged \"' + pr.title + '\" in ' + repo.name.split('/')[1] + ', enhancing the project with new capabilities.',
          social_post: 'Just merged a new PR in ' + repo.name.split('/')[1] + ': \"' + pr.title + '\". Building in public! #buildinpublic #opensource',
          importance: 6
        });
      }

      // Releases
      for (const release of repo.releases) {
        highlights.push({
          type: 'release',
          repo: repo.name,
          title: 'Released ' + release.tag + (release.name ? ' - ' + release.name : ''),
          description: repo.name.split('/')[1] + ' ' + release.tag + ' is out! ' + (release.name || 'New release with improvements and fixes.'),
          social_post: 'Just released ' + repo.name.split('/')[1] + ' ' + release.tag + '! ' + (release.name || '') + ' Check it out on GitHub. #opensource #release',
          importance: 8
        });
      }

      // High commit activity
      if (repo.commits >= 10) {
        highlights.push({
          type: 'productivity',
          repo: repo.name,
          title: repo.commits + ' commits to ' + repo.name.split('/')[1] + ' this week',
          description: 'Active development on ' + repo.name.split('/')[1] + ' with ' + repo.commits + ' commits this week, showing consistent progress on ' + (repo.description || 'the project') + '.',
          social_post: 'Productive week on ' + repo.name.split('/')[1] + ' with ' + repo.commits + ' commits! Steady progress. #buildinpublic #coding',
          importance: 5
        });
      }
    }

    // Sort by importance
    highlights.sort((a, b) => b.importance - a.importance);

    const result = { highlights: highlights.filter(h => h.importance >= 5) };
    console.log(JSON.stringify(result, null, 2));
    "
    ;;

  update)
    if [ ! -f "$SCAN_CACHE" ]; then
      echo "Error: No scan data found. Run 'portfolio-updater.sh scan' first."
      exit 1
    fi

    mkdir -p "$PORTFOLIO_DIR"

    node -e "
    const fs = require('fs');
    const path = require('path');
    const scan = JSON.parse(fs.readFileSync('$SCAN_CACHE', 'utf8'));
    const portfolioDir = '$PORTFOLIO_DIR';
    const now = new Date().toISOString().split('T')[0];

    // --- Update stats.json ---
    let stats = { weeks: [], last_updated: '' };
    const statsFile = path.join(portfolioDir, 'stats.json');
    if (fs.existsSync(statsFile)) {
      try { stats = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch(e) {}
    }

    const weekStats = {
      date: now,
      total_stars: scan.repos.reduce((s, r) => s + (r.stars || 0), 0),
      total_forks: scan.repos.reduce((s, r) => s + (r.forks || 0), 0),
      commits_this_week: scan.repos.reduce((s, r) => s + (r.commits || 0), 0),
      prs_merged_this_week: scan.repos.reduce((s, r) => s + (r.prs_merged?.length || 0), 0),
      active_repos: scan.repos.filter(r => r.commits > 0 || r.prs_merged?.length > 0).length,
      total_repos: scan.repos.length
    };

    if (!stats.weeks) stats.weeks = [];
    stats.weeks.unshift(weekStats);
    stats.weeks = stats.weeks.slice(0, 52); // Keep 1 year of history
    stats.last_updated = new Date().toISOString();
    stats.current = weekStats;

    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    console.log('Updated: stats.json');

    // --- Update README.md ---
    let readme = '# Portfolio\n\n';
    readme += '_Auto-updated by NanoClaw Portfolio Pipeline_\n\n';
    readme += '## Projects\n\n';

    const sortedRepos = [...scan.repos].sort((a, b) => (b.stars || 0) - (a.stars || 0));
    for (const repo of sortedRepos) {
      const name = repo.name.split('/')[1];
      readme += '### ' + name + '\n\n';
      if (repo.description) readme += repo.description + '\n\n';
      readme += '| Metric | Value |\n|--------|-------|\n';
      readme += '| Stars | ' + (repo.stars || 0) + ' |\n';
      readme += '| Forks | ' + (repo.forks || 0) + ' |\n';
      readme += '| Language | ' + (repo.language || 'N/A') + ' |\n';
      if (repo.commits > 0) readme += '| Commits (7d) | ' + repo.commits + ' |\n';
      if (repo.prs_merged?.length > 0) readme += '| PRs Merged (7d) | ' + repo.prs_merged.length + ' |\n';
      readme += '\n';
    }

    readme += '## Stats\n\n';
    readme += '| Metric | Value |\n|--------|-------|\n';
    readme += '| Total Stars | ' + weekStats.total_stars + ' |\n';
    readme += '| Total Forks | ' + weekStats.total_forks + ' |\n';
    readme += '| Active Repos | ' + weekStats.active_repos + ' |\n';
    readme += '| Commits This Week | ' + weekStats.commits_this_week + ' |\n';
    readme += '| PRs Merged This Week | ' + weekStats.prs_merged_this_week + ' |\n';
    readme += '\n_Last updated: ' + now + '_\n';

    fs.writeFileSync(path.join(portfolioDir, 'README.md'), readme);
    console.log('Updated: README.md');

    // --- Update HIGHLIGHTS.md ---
    let highlights = '';
    const highlightsFile = path.join(portfolioDir, 'HIGHLIGHTS.md');
    if (fs.existsSync(highlightsFile)) {
      highlights = fs.readFileSync(highlightsFile, 'utf8');
    }

    let newEntries = '## ' + now + '\n\n';
    let entryCount = 0;

    for (const repo of scan.repos) {
      if (repo.prs_merged?.length > 0) {
        for (const pr of repo.prs_merged) {
          newEntries += '### ' + now + ' - ' + repo.name.split('/')[1] + '\n';
          newEntries += '**PR Merged:** ' + pr.title + ' (#' + pr.number + ')\n\n';
          entryCount++;
        }
      }
      if (repo.releases?.length > 0) {
        for (const rel of repo.releases) {
          newEntries += '### ' + now + ' - ' + repo.name.split('/')[1] + '\n';
          newEntries += '**Release:** ' + rel.tag + (rel.name ? ' - ' + rel.name : '') + '\n\n';
          entryCount++;
        }
      }
      if (repo.commits >= 5) {
        newEntries += '### ' + now + ' - ' + repo.name.split('/')[1] + '\n';
        newEntries += '**Active Week:** ' + repo.commits + ' commits\n\n';
        entryCount++;
      }
    }

    if (entryCount > 0) {
      const header = '# Activity Highlights\n\n_Auto-maintained by NanoClaw Portfolio Pipeline_\n\n';
      // Remove old header if present
      const existingBody = highlights.replace(/^#.*\n\n_Auto-maintained.*\n\n/m, '');
      fs.writeFileSync(highlightsFile, header + newEntries + existingBody);
      console.log('Updated: HIGHLIGHTS.md (' + entryCount + ' new entries)');
    } else {
      if (!fs.existsSync(highlightsFile)) {
        fs.writeFileSync(highlightsFile, '# Activity Highlights\n\n_Auto-maintained by NanoClaw Portfolio Pipeline_\n\nNo highlights yet.\n');
        console.log('Created: HIGHLIGHTS.md (empty)');
      } else {
        console.log('HIGHLIGHTS.md: no new entries this week');
      }
    }

    console.log('\nPortfolio update complete.');
    "
    ;;

  stats)
    STATS_FILE="$PORTFOLIO_DIR/stats.json"

    if [ ! -f "$STATS_FILE" ]; then
      echo "No portfolio stats found. Run 'portfolio-updater.sh update' first."
      exit 1
    fi

    node -e "
    const stats = JSON.parse(require('fs').readFileSync('$STATS_FILE', 'utf8'));
    const c = stats.current || {};

    console.log('Portfolio Stats');
    console.log('===============');
    console.log('Last updated: ' + (stats.last_updated || 'never'));
    console.log('');
    console.log('Current:');
    console.log('  Total Stars:         ' + (c.total_stars || 0));
    console.log('  Total Forks:         ' + (c.total_forks || 0));
    console.log('  Active Repos:        ' + (c.active_repos || 0) + '/' + (c.total_repos || 0));
    console.log('  Commits This Week:   ' + (c.commits_this_week || 0));
    console.log('  PRs Merged (Week):   ' + (c.prs_merged_this_week || 0));
    console.log('');

    if (stats.weeks && stats.weeks.length > 1) {
      const prev = stats.weeks[1];
      console.log('Trends (vs last week):');
      const starsDelta = (c.total_stars || 0) - (prev.total_stars || 0);
      const forksDelta = (c.total_forks || 0) - (prev.total_forks || 0);
      console.log('  Stars:  ' + (starsDelta >= 0 ? '+' : '') + starsDelta);
      console.log('  Forks:  ' + (forksDelta >= 0 ? '+' : '') + forksDelta);
      console.log('');
      console.log('History: ' + stats.weeks.length + ' weeks tracked');
    }
    "
    ;;

  *)
    echo "Usage: portfolio-updater.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  scan [username]   - Scan GitHub activity for past week"
    echo "  highlights        - Extract highlights from most recent scan"
    echo "  update            - Update portfolio files from scan data"
    echo "  stats             - Show portfolio stats"
    echo ""
    echo "Examples:"
    echo "  portfolio-updater.sh scan tylersp7"
    echo "  portfolio-updater.sh highlights"
    echo "  portfolio-updater.sh update"
    echo "  portfolio-updater.sh stats"
    echo ""
    echo "Config: $CONFIG_FILE"
    echo "Portfolio: $PORTFOLIO_DIR"
    ;;
esac
