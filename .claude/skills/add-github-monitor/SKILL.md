---
name: add-github-monitor
description: Monitor GitHub for portfolio opportunities, "help wanted" issues, stars/forks on your repos, and consulting opportunities in automation-related repositories. Auto-update portfolio based on your activity.
---

# Add GitHub Monitor for Portfolio & Lead Generation

This skill monitors GitHub for consulting opportunities and automatically tracks your portfolio growth.

## What It Monitors

**Your Repos:**
- Stars, forks, and watchers (social proof!)
- Issues opened on your projects
- PRs and contributors
- Repository traffic

**Opportunity Discovery:**
- "Help Wanted" issues in n8n, automation repos
- GitHub Discussions asking for help
- Trending automation tools/repos
- Projects needing integrations

**Portfolio Automation:**
- Track commits and completed features
- Generate project descriptions
- Update skills list
- Document milestones

---

## Prerequisites

### 1. Generate GitHub Personal Access Token

**USER ACTION REQUIRED**

Tell the user:

> I need you to create a GitHub Personal Access Token (classic):
>
> 1. Go to https://github.com/settings/tokens
> 2. Click **Generate new token** → **Generate new token (classic)**
> 3. Name it: **NanoClaw GitHub Monitor**
> 4. Select these scopes:
>    - ✅ `public_repo` - Access public repositories
>    - ✅ `read:user` - Read user profile
>    - ✅ `read:org` - Read org info (if you monitor org repos)
>    - ✅ `notifications` - Access notifications
> 5. Set expiration: **No expiration** (or 1 year)
> 6. Click **Generate token**
> 7. **Copy the token now** (you won't see it again!)

Wait for user to provide token.

### 2. Create Config Directory

```bash
mkdir -p ~/.nanoclaw-github
chmod 700 ~/.nanoclaw-github
```

### 3. Store Credentials

```bash
cat > ~/.nanoclaw-github/credentials.json << 'EOF'
{
  "token": "ghp_YOUR_TOKEN_HERE",
  "username": "your-github-username"
}
EOF
chmod 600 ~/.nanoclaw-github/credentials.json
```

Replace with actual values.

---

## Installation

### 1. Install GitHub API Client

```bash
cd /Users/tyler/dev/nanoclaw
npm install @octokit/rest
```

### 2. Create GitHub Helper Module

```typescript
// src/github-helper.ts
import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface GitHubCredentials {
  token: string;
  username: string;
}

let octokit: Octokit | null = null;
let credentials: GitHubCredentials | null = null;

function loadCredentials(): GitHubCredentials {
  if (credentials) return credentials;

  const credPath = path.join(os.homedir(), '.nanoclaw-github', 'credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error('GitHub credentials not found. Run /add-github-monitor to set up.');
  }

  credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  return credentials;
}

function getClient(): Octokit {
  if (octokit) return octokit;

  const creds = loadCredentials();
  octokit = new Octokit({ auth: creds.token });
  return octokit;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string | null;
  topics: string[];
  updated: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  url: string;
  htmlUrl: string;
  state: string;
  labels: string[];
  repo: string;
  createdAt: string;
  comments: number;
}

export interface RepoActivity {
  repo: string;
  stars: number;
  forks: number;
  starsDelta?: number;
  forksDelta?: number;
  newIssues?: number;
  recentCommits?: number;
}

/**
 * Get your repositories
 */
export async function getMyRepos(): Promise<GitHubRepo[]> {
  const client = getClient();
  const creds = loadCredentials();

  const { data } = await client.repos.listForUser({
    username: creds.username,
    sort: 'updated',
    per_page: 100,
  });

  return data.map(repo => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    language: repo.language,
    topics: repo.topics || [],
    updated: repo.updated_at,
  }));
}

/**
 * Get repository activity/stats
 */
export async function getRepoActivity(owner: string, repo: string): Promise<RepoActivity> {
  const client = getClient();

  const [repoData, commits, issues] = await Promise.all([
    client.repos.get({ owner, repo }),
    client.repos.listCommits({ owner, repo, per_page: 10 }),
    client.issues.listForRepo({ owner, repo, state: 'open', per_page: 100 }),
  ]);

  // Count recent commits (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentCommits = commits.data.filter(
    c => c.commit.author?.date && new Date(c.commit.author.date) > weekAgo
  ).length;

  // Count new issues (last 7 days)
  const newIssues = issues.data.filter(
    i => new Date(i.created_at) > weekAgo
  ).length;

  return {
    repo: `${owner}/${repo}`,
    stars: repoData.data.stargazers_count,
    forks: repoData.data.forks_count,
    newIssues,
    recentCommits,
  };
}

/**
 * Search for "help wanted" issues
 */
export async function findHelpWantedIssues(
  keywords: string[],
  labels: string[] = ['help wanted', 'good first issue']
): Promise<GitHubIssue[]> {
  const client = getClient();

  const labelQuery = labels.map(l => `label:"${l}"`).join(' ');
  const keywordQuery = keywords.join(' ');
  const query = `${keywordQuery} ${labelQuery} state:open`;

  const { data } = await client.search.issuesAndPullRequests({
    q: query,
    sort: 'created',
    order: 'desc',
    per_page: 50,
  });

  return data.items.map(issue => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body || null,
    url: issue.url,
    htmlUrl: issue.html_url,
    state: issue.state,
    labels: issue.labels.map((l: any) => l.name),
    repo: issue.repository_url.split('/').slice(-2).join('/'),
    createdAt: issue.created_at,
    comments: issue.comments,
  }));
}

/**
 * Search GitHub Discussions for questions
 */
export async function searchDiscussions(
  repo: string,
  keywords: string[]
): Promise<any[]> {
  const client = getClient();
  const [owner, repoName] = repo.split('/');

  try {
    // Use GraphQL for discussions
    const query = `
      query($owner: String!, $repo: String!, $query: String!) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              id
              title
              body
              url
              createdAt
              comments(first: 1) {
                totalCount
              }
              category {
                name
              }
            }
          }
        }
      }
    `;

    const result: any = await client.graphql(query, {
      owner,
      repo: repoName,
      query: keywords.join(' '),
    });

    return result.repository?.discussions?.nodes || [];
  } catch {
    return [];
  }
}

/**
 * Get trending repositories
 */
export async function getTrendingRepos(
  keywords: string[],
  language?: string
): Promise<GitHubRepo[]> {
  const client = getClient();

  const keywordQuery = keywords.join(' ');
  let query = `${keywordQuery} stars:>100`;

  if (language) {
    query += ` language:${language}`;
  }

  // Get repos created/updated in last month
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  query += ` pushed:>${monthAgo.toISOString().split('T')[0]}`;

  const { data } = await client.search.repos({
    q: query,
    sort: 'stars',
    order: 'desc',
    per_page: 20,
  });

  return data.items.map(repo => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    language: repo.language,
    topics: repo.topics || [],
    updated: repo.updated_at,
  }));
}

/**
 * Track repository milestone (stars/forks)
 */
export interface RepoMilestone {
  repo: string;
  metric: 'stars' | 'forks';
  threshold: number;
  current: number;
  reached: boolean;
}

export async function checkMilestones(
  repos: Array<{ owner: string; repo: string }>,
  thresholds: number[]
): Promise<RepoMilestone[]> {
  const milestones: RepoMilestone[] = [];

  for (const { owner, repo } of repos) {
    const activity = await getRepoActivity(owner, repo);

    for (const threshold of thresholds) {
      // Check stars
      if (activity.stars >= threshold) {
        milestones.push({
          repo: `${owner}/${repo}`,
          metric: 'stars',
          threshold,
          current: activity.stars,
          reached: true,
        });
      }

      // Check forks
      if (activity.forks >= threshold) {
        milestones.push({
          repo: `${owner}/${repo}`,
          metric: 'forks',
          threshold,
          current: activity.forks,
          reached: true,
        });
      }
    }
  }

  return milestones;
}

/**
 * Generate portfolio summary from commits
 */
export async function generatePortfolioSummary(
  owner: string,
  repo: string,
  since: Date
): Promise<string> {
  const client = getClient();

  const commits = await client.repos.listCommits({
    owner,
    repo,
    since: since.toISOString(),
    per_page: 100,
  });

  const commitMessages = commits.data.map(c => c.commit.message);

  // Categorize commits
  const features = commitMessages.filter(m =>
    /^(feat|feature|add)/i.test(m)
  ).length;
  const fixes = commitMessages.filter(m => /^fix/i.test(m)).length;
  const refactors = commitMessages.filter(m => /^refactor/i.test(m)).length;
  const docs = commitMessages.filter(m => /^docs/i.test(m)).length;

  return `${repo} Updates (${commits.data.length} commits):
- ${features} new features
- ${fixes} bug fixes
- ${refactors} refactorings
- ${docs} documentation updates

Recent work: ${commitMessages.slice(0, 3).join(', ')}`;
}

/**
 * Format issues for WhatsApp
 */
export function formatIssuesForWhatsApp(issues: GitHubIssue[]): string {
  if (issues.length === 0) return 'No issues found.';

  return issues
    .slice(0, 10)
    .map((issue, i) => {
      const labels = issue.labels.join(', ');
      const time = new Date(issue.createdAt).toLocaleDateString();

      return `${i + 1}. ${issue.repo}
*${issue.title}*
[${labels}] • ${time} • ${issue.comments} comments

${issue.body?.substring(0, 200) || 'No description'}${issue.body && issue.body.length > 200 ? '...' : ''}

🔗 ${issue.htmlUrl}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format repos for WhatsApp
 */
export function formatReposForWhatsApp(repos: GitHubRepo[]): string {
  if (repos.length === 0) return 'No repositories found.';

  return repos
    .slice(0, 10)
    .map((repo, i) => {
      const topics = repo.topics.slice(0, 3).join(', ');

      return `${i + 1}. *${repo.name}*
⭐ ${repo.stars} • 🍴 ${repo.forks} • 👁️ ${repo.watchers}
${repo.language || 'N/A'} ${topics ? `• ${topics}` : ''}

${repo.description || 'No description'}

🔗 ${repo.url}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Score an issue for relevance
 */
export function scoreIssue(issue: GitHubIssue, userSkills: string[]): number {
  let score = 5;

  const text = `${issue.title} ${issue.body || ''}`.toLowerCase();

  // Check for skill matches
  const matches = userSkills.filter(skill => text.includes(skill.toLowerCase()));
  score += Math.min(matches.length, 3);

  // Check for good indicators
  if (issue.labels.includes('good first issue')) score += 2;
  if (issue.labels.includes('help wanted')) score += 1;
  if (issue.comments === 0) score += 1; // Fresh issue
  if (text.includes('paid') || text.includes('bounty')) score += 2;

  // Check for complexity indicators
  if (text.includes('bug') && text.length < 500) score += 1; // Simple bug
  if (text.includes('feature') && text.length > 1000) score -= 1; // Complex feature

  return Math.max(1, Math.min(10, score));
}
```

Save to `src/github-helper.ts`.

### 3. Create CLI Tool

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/github-monitor.sh << 'EOF'
#!/bin/bash
# GitHub monitoring tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,workflow,VPS,Python,JavaScript,security,integration"
GITHUB_USERNAME="tylersp7"  # Update this

case "$1" in
  my-repos)
    node -e "
    const { getMyRepos, formatReposForWhatsApp } = require('$NANOCLAW_DIR/dist/github-helper.js');
    getMyRepos().then(repos => {
      console.log(\`You have \${repos.length} public repositories:\\n\`);
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
      console.log(\`⭐ Stars: \${activity.stars}\`);
      console.log(\`🍴 Forks: \${activity.forks}\`);
      console.log(\`📝 New issues (7d): \${activity.newIssues || 0}\`);
      console.log(\`💻 Recent commits (7d): \${activity.recentCommits || 0}\`);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  help-wanted)
    KEYWORDS="${2:-automation,n8n,workflow,api}"
    node -e "
    const { findHelpWantedIssues, formatIssuesForWhatsApp, scoreIssue } = require('$NANOCLAW_DIR/dist/github-helper.js');
    const keywords = '$KEYWORDS'.split(',');
    const skills = '$USER_SKILLS'.split(',');

    findHelpWantedIssues(keywords).then(issues => {
      // Score and filter
      const scored = issues.map(issue => ({
        ...issue,
        score: scoreIssue(issue, skills)
      })).filter(i => i.score >= 6).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No help wanted issues found matching your skills.');
      } else {
        console.log(\`Found \${scored.length} help wanted issues (score >= 6/10):\\n\`);
        console.log(formatIssuesForWhatsApp(scored));
      }
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
        console.log(\`Trending repositories:\\n\`);
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

  *)
    echo "Usage: github-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  my-repos                        - List your repositories"
    echo "  repo-activity <owner/repo>      - Get repo stats"
    echo "  help-wanted [keywords]          - Find help wanted issues"
    echo "  trending [keywords]             - Find trending repos"
    echo "  portfolio-summary <owner/repo> [days] - Generate portfolio update"
    echo ""
    echo "Examples:"
    echo "  github-monitor.sh my-repos"
    echo "  github-monitor.sh repo-activity tylersp7/vps_bugbounty"
    echo "  github-monitor.sh help-wanted 'automation,api'"
    echo "  github-monitor.sh trending 'n8n,workflow'"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/github-monitor.sh
```

### 4. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## GitHub Monitoring

Monitor GitHub for opportunities and portfolio tracking:

**List your repos:**
```bash
/workspace/project/container/tools/github-monitor.sh my-repos
```

**Find help wanted issues:**
```bash
/workspace/project/container/tools/github-monitor.sh help-wanted "automation,n8n,api"
```

**Check repo activity:**
```bash
/workspace/project/container/tools/github-monitor.sh repo-activity tylersp7/vps_bugbounty
```

**Generate portfolio summary:**
```bash
/workspace/project/container/tools/github-monitor.sh portfolio-summary tylersp7/vps_bugbounty 30
```
```

### 5. Rebuild

```bash
cd /Users/tyler/dev/nanoclaw
npm run build
./container/build.sh
```

---

## Verification

Test from terminal:

```bash
cd /Users/tyler/dev/nanoclaw
node -e "
const { getMyRepos } = require('./dist/github-helper.js');
getMyRepos().then(repos => {
  console.log('Your repos:', repos.map(r => r.name));
}).catch(err => console.error(err));
"
```

Test from WhatsApp:

```
@Andy show me my GitHub repositories

@Andy check vps_bugbounty and auto_blogger_vps for recent activity

@Andy find help wanted issues related to automation or n8n
```

---

## Scheduled Monitoring Tasks

### Weekly Repo Activity Report

```
@Andy every Monday at 9am, check GitHub activity on tylersp7/vps_bugbounty and tylersp7/auto_blogger_vps for the past week. Report: new stars/forks, commits, issues opened, and any milestones reached. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://github.com/...", "source": "github", "score": 8, "summary": "..."}</signal>
```

### Daily Help Wanted Issues

```
@Andy every day at 10am, search GitHub for help wanted issues in n8n, automation, and workflow repos. Score each for fit. Send me top 5 issues (score 7+) where I can contribute and potentially get consulting work. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://github.com/...", "source": "github", "score": 8, "summary": "..."}</signal>
```

### Monthly Portfolio Update

```
@Andy on the last day of every month, generate a portfolio summary for vps_bugbounty and auto_blogger_vps. Include: commits this month, features added, issues resolved. Draft a LinkedIn post about the work. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://github.com/...", "source": "github", "score": 8, "summary": "..."}</signal>
```

### Milestone Celebrations

```
@Andy check my GitHub repos daily for milestones (10, 25, 50, 100 stars/forks). When reached, alert me and suggest posting about it on LinkedIn for visibility. For any milestone that represents a consulting opportunity scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://github.com/...", "source": "github", "score": 8, "summary": "..."}</signal>
```

---

## Portfolio Automation

### Auto-Generate Case Studies

```
@Andy every quarter, review commits on vps_bugbounty and auto_blogger_vps. Generate case study drafts highlighting: problem solved, technical approach, technologies used, and results/impact.
```

### Skills Tracking

```
@Andy track new technologies/tools I use in GitHub commits. When you see a new language, framework, or service, add it to my skills list. Every 3 months, suggest skills I should highlight based on recent work.
```

---

## Success Criteria

✅ GitHub token configured
✅ Can list your repositories
✅ Can find help wanted issues
✅ Can track repo activity
✅ Portfolio summaries generated
✅ Milestone tracking working

---

Tell the user:

> GitHub monitoring is set up! 🎉
>
> Andy can now:
> - Track your repo stars/forks for social proof
> - Find consulting opportunities in open issues
> - Auto-generate portfolio updates from commits
> - Monitor trending automation repos
>
> Try: "@Andy show me help wanted issues for n8n or automation projects"
