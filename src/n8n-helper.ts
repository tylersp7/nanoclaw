import axios from 'axios';
import Parser from 'rss-parser';

const N8N_FORUM_URL = 'https://community.n8n.io';
const N8N_GITHUB_API = 'https://api.github.com/repos/n8n-io/n8n';

interface ForumPost {
  id: number;
  title: string;
  url: string;
  author: string;
  category: string;
  createdAt: string;
  replies: number;
  views: number;
  solved: boolean;
  tags: string[];
  excerpt?: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  labels: string[];
  author: string;
  createdAt: string;
  comments: number;
}

/**
 * Get latest forum posts
 */
export async function getForumLatest(limit: number = 30): Promise<ForumPost[]> {
  try {
    const response = await axios.get(`${N8N_FORUM_URL}/latest.json`, {
      params: { page: 0 },
    });

    const posts: ForumPost[] = [];

    for (const topic of response.data.topic_list.topics.slice(0, limit)) {
      posts.push({
        id: topic.id,
        title: topic.title,
        url: `${N8N_FORUM_URL}/t/${topic.slug}/${topic.id}`,
        author: topic.last_poster_username,
        category: topic.category_id.toString(),
        createdAt: topic.created_at,
        replies: topic.posts_count - 1,
        views: topic.views,
        solved: topic.has_accepted_answer || false,
        tags: topic.tags || [],
        excerpt: topic.excerpt,
      });
    }

    return posts;
  } catch (error) {
    console.error('Error fetching forum posts:', error);
    return [];
  }
}

/**
 * Search forum for keywords
 */
export async function searchForum(
  keywords: string[],
  solved: boolean = false,
): Promise<ForumPost[]> {
  try {
    const query = keywords.join(' ');
    const response = await axios.get(`${N8N_FORUM_URL}/search.json`, {
      params: {
        q: query,
        page: 0,
      },
    });

    const posts: ForumPost[] = [];

    for (const result of response.data.topics || []) {
      if (!solved && result.has_accepted_answer) continue;

      posts.push({
        id: result.id,
        title: result.title,
        url: `${N8N_FORUM_URL}/t/${result.slug}/${result.id}`,
        author: result.last_poster_username || 'unknown',
        category: result.category_id?.toString() || 'general',
        createdAt: result.created_at,
        replies: (result.posts_count || 1) - 1,
        views: result.views || 0,
        solved: result.has_accepted_answer || false,
        tags: result.tags || [],
      });
    }

    return posts;
  } catch (error) {
    console.error('Error searching forum:', error);
    return [];
  }
}

/**
 * Get unanswered posts (posts with 0-1 replies)
 */
export async function getUnansweredPosts(
  keywords?: string[],
): Promise<ForumPost[]> {
  let posts: ForumPost[];

  if (keywords && keywords.length > 0) {
    posts = await searchForum(keywords, false);
  } else {
    posts = await getForumLatest(50);
  }

  return posts.filter((post) => post.replies <= 1 && !post.solved);
}

/**
 * Get n8n GitHub issues
 */
export async function getN8nIssues(labels?: string[]): Promise<GitHubIssue[]> {
  try {
    const params: Record<string, any> = {
      state: 'open',
      per_page: 50,
      sort: 'created',
      direction: 'desc',
    };

    if (labels && labels.length > 0) {
      params.labels = labels.join(',');
    }

    const response = await axios.get(`${N8N_GITHUB_API}/issues`, { params });

    return response.data.map((issue: any) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      url: issue.html_url,
      state: issue.state,
      labels: issue.labels.map((l: any) => l.name),
      author: issue.user.login,
      createdAt: issue.created_at,
      comments: issue.comments,
    }));
  } catch (error) {
    console.error('Error fetching GitHub issues:', error);
    return [];
  }
}

/**
 * Get feature requests
 */
export async function getFeatureRequests(): Promise<GitHubIssue[]> {
  return getN8nIssues(['feature request', 'enhancement']);
}

/**
 * Score forum post for consulting opportunity
 */
export function scoreForumPost(post: ForumPost, userSkills: string[]): number {
  let score = 5;

  const text = `${post.title} ${post.excerpt || ''}`.toLowerCase();

  if (post.replies === 0) score += 3;
  else if (post.replies === 1) score += 2;

  if (!post.solved) score += 2;

  const hoursSincePost =
    (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
  if (hoursSincePost < 24) score += 2;
  else if (hoursSincePost < 72) score += 1;

  if (post.views > 50) score += 1;
  if (post.views > 100) score += 1;

  const skillMatches = userSkills.filter((skill) =>
    text.includes(skill.toLowerCase()),
  ).length;
  score += Math.min(skillMatches, 3);

  if (text.includes('complex') || text.includes('advanced')) score += 1;
  if (
    text.includes('self-host') ||
    text.includes('vps') ||
    text.includes('docker')
  )
    score += 2;
  if (text.includes('api') || text.includes('integration')) score += 1;
  if (text.includes('security') || text.includes('authentication')) score += 1;

  if (text.includes('simple') || text.includes('basic')) score -= 1;
  if (post.replies > 5) score -= 2;

  return Math.max(1, Math.min(10, score));
}

/**
 * Score GitHub issue for contribution opportunity
 */
export function scoreGitHubIssue(
  issue: GitHubIssue,
  userSkills: string[],
): number {
  let score = 5;

  const text = `${issue.title} ${issue.body}`.toLowerCase();

  if (issue.labels.includes('good first issue')) score += 2;
  if (issue.labels.includes('help wanted')) score += 2;
  if (issue.labels.includes('bug')) score += 1;
  if (issue.labels.includes('feature request')) score -= 1;

  if (issue.comments === 0) score += 2;
  else if (issue.comments <= 2) score += 1;

  const skillMatches = userSkills.filter((skill) =>
    text.includes(skill.toLowerCase()),
  ).length;
  score += Math.min(skillMatches, 3);

  const daysSinceCreated =
    (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated < 7) score += 2;
  else if (daysSinceCreated < 30) score += 1;

  return Math.max(1, Math.min(10, score));
}

/**
 * Find template opportunities (popular unsolved problems)
 */
export async function findTemplateOpportunities(): Promise<ForumPost[]> {
  const posts = await getForumLatest(100);

  return posts
    .filter((post) => !post.solved && post.views > 30 && post.replies >= 2)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
}

/**
 * Format posts for WhatsApp
 */
export function formatForumPostsForWhatsApp(
  posts: Array<ForumPost & { score?: number }>,
): string {
  if (posts.length === 0) return 'No posts found.';

  return posts
    .slice(0, 10)
    .map((post, i) => {
      const time = new Date(post.createdAt).toLocaleDateString();
      const scoreStr = post.score ? ` [Score: ${post.score}/10]` : '';
      const tags =
        post.tags.length > 0 ? ` | Tags: ${post.tags.join(', ')}` : '';

      return `${i + 1}. ${post.solved ? '✅' : '❓'} *${post.title}*${scoreStr}
${post.author} • ${time} • 👁️ ${post.views} • 💬 ${post.replies}${tags}

${post.excerpt ? post.excerpt.substring(0, 150) : 'Click link to view'}${post.excerpt && post.excerpt.length > 150 ? '...' : ''}

🔗 ${post.url}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format GitHub issues for WhatsApp
 */
export function formatGitHubIssuesForWhatsApp(
  issues: Array<GitHubIssue & { score?: number }>,
): string {
  if (issues.length === 0) return 'No issues found.';

  return issues
    .slice(0, 10)
    .map((issue, i) => {
      const time = new Date(issue.createdAt).toLocaleDateString();
      const scoreStr = issue.score ? ` [Score: ${issue.score}/10]` : '';
      const labels = issue.labels.slice(0, 3).join(', ');

      return `${i + 1}. #${issue.number} *${issue.title}*${scoreStr}
[${labels}] • ${issue.author} • ${time} • 💬 ${issue.comments}

${issue.body.substring(0, 200)}${issue.body.length > 200 ? '...' : ''}

🔗 ${issue.url}`;
    })
    .join('\n\n---\n\n');
}
