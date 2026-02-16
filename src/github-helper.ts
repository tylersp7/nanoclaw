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
  return credentials!;
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

  return data.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    watchers: repo.watchers_count ?? 0,
    language: repo.language ?? null,
    topics: repo.topics || [],
    updated: repo.updated_at!,
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

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentCommits = commits.data.filter(
    (c) => c.commit.author?.date && new Date(c.commit.author.date) > weekAgo
  ).length;

  const newIssues = issues.data.filter(
    (i) => new Date(i.created_at) > weekAgo
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

  const labelQuery = labels.map((l) => `label:"${l}"`).join(' ');
  const keywordQuery = keywords.join(' ');
  const query = `${keywordQuery} ${labelQuery} state:open`;

  const { data } = await client.search.issuesAndPullRequests({
    q: query,
    sort: 'created',
    order: 'desc',
    per_page: 50,
  });

  return data.items.map((issue) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body || null,
    url: issue.url,
    htmlUrl: issue.html_url,
    state: issue.state!,
    labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
    repo: issue.repository_url.split('/').slice(-2).join('/'),
    createdAt: issue.created_at,
    comments: issue.comments,
  }));
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

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  query += ` pushed:>${monthAgo.toISOString().split('T')[0]}`;

  const { data } = await client.search.repos({
    q: query,
    sort: 'stars',
    order: 'desc',
    per_page: 20,
  });

  return data.items.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count!,
    forks: repo.forks_count!,
    watchers: repo.watchers_count!,
    language: repo.language,
    topics: repo.topics || [],
    updated: repo.updated_at!,
  }));
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

  const commitMessages = commits.data.map((c) => c.commit.message);

  const features = commitMessages.filter((m) => /^(feat|feature|add)/i.test(m)).length;
  const fixes = commitMessages.filter((m) => /^fix/i.test(m)).length;
  const refactors = commitMessages.filter((m) => /^refactor/i.test(m)).length;
  const docs = commitMessages.filter((m) => /^docs/i.test(m)).length;

  return `${repo} Updates (${commits.data.length} commits):
- ${features} new features
- ${fixes} bug fixes
- ${refactors} refactorings
- ${docs} documentation updates

Recent work: ${commitMessages.slice(0, 3).join(', ')}`;
}

/**
 * Score an issue for relevance
 */
export function scoreIssue(issue: GitHubIssue, userSkills: string[]): number {
  let score = 5;

  const text = `${issue.title} ${issue.body || ''}`.toLowerCase();

  const matches = userSkills.filter((skill) => text.includes(skill.toLowerCase()));
  score += Math.min(matches.length, 3);

  if (issue.labels.includes('good first issue')) score += 2;
  if (issue.labels.includes('help wanted')) score += 1;
  if (issue.comments === 0) score += 1;
  if (text.includes('paid') || text.includes('bounty')) score += 2;

  if (text.includes('bug') && text.length < 500) score += 1;
  if (text.includes('feature') && text.length > 1000) score -= 1;

  return Math.max(1, Math.min(10, score));
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
