import axios from 'axios';
import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import os from 'os';

// --- Types ---

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  url: string;
  permalink: string;
  created: number;
  score: number;
  numComments: number;
  linkFlairText?: string;
}

interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  userAgent: string;
}

// --- Backend detection ---

let apiToken: string | null = null;
let apiTokenExpires = 0;

function loadCredentials(): RedditCredentials | null {
  const credPath = path.join(
    os.homedir(),
    '.nanoclaw-reddit',
    'credentials.json',
  );
  if (!fs.existsSync(credPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  } catch {
    return null;
  }
}

function hasApiCredentials(): boolean {
  const creds = loadCredentials();
  return !!(creds?.clientId && creds?.clientSecret);
}

async function getApiToken(): Promise<string | null> {
  if (apiToken && Date.now() < apiTokenExpires) return apiToken;

  const creds = loadCredentials();
  if (!creds) return null;

  try {
    const auth = Buffer.from(
      `${creds.clientId}:${creds.clientSecret}`,
    ).toString('base64');
    const resp = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': creds.userAgent || 'NanoClaw-Monitor/1.0',
        },
        timeout: 10000,
      },
    );
    apiToken = resp.data.access_token;
    apiTokenExpires = Date.now() + (resp.data.expires_in - 60) * 1000;
    return apiToken;
  } catch (err) {
    console.error('Reddit API auth failed, falling back to public feeds');
    return null;
  }
}

function getUserAgent(): string {
  const creds = loadCredentials();
  return creds?.userAgent || 'NanoClaw-Monitor/1.0 (personal use)';
}

// --- API backend ---

async function apiSearch(
  subreddit: string,
  keywords: string[],
  timeFilter: string,
  limit: number,
): Promise<RedditPost[]> {
  const token = await getApiToken();
  if (!token) throw new Error('no-api');

  const query = keywords.join(' OR ');
  const resp = await axios.get(
    `https://oauth.reddit.com/r/${subreddit}/search.json`,
    {
      params: {
        q: query,
        restrict_sr: 'on',
        sort: 'new',
        t: timeFilter,
        limit,
      },
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': getUserAgent(),
      },
      timeout: 15000,
    },
  );

  return resp.data.data.children.map((child: any) => mapApiPost(child.data));
}

async function apiGetNew(
  subreddit: string,
  limit: number,
): Promise<RedditPost[]> {
  const token = await getApiToken();
  if (!token) throw new Error('no-api');

  const resp = await axios.get(
    `https://oauth.reddit.com/r/${subreddit}/new.json`,
    {
      params: { limit },
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': getUserAgent(),
      },
      timeout: 15000,
    },
  );

  return resp.data.data.children.map((child: any) => mapApiPost(child.data));
}

function mapApiPost(data: any): RedditPost {
  return {
    id: data.id,
    title: data.title,
    selftext: data.selftext || '',
    author: data.author,
    subreddit: data.subreddit,
    url: data.url,
    permalink: `https://reddit.com${data.permalink}`,
    created: data.created_utc,
    score: data.score,
    numComments: data.num_comments,
    linkFlairText: data.link_flair_text || undefined,
  };
}

// --- Public feed backend (no auth) ---

async function publicGetNew(
  subreddit: string,
  limit: number,
): Promise<RedditPost[]> {
  const resp = await axios.get(
    `https://www.reddit.com/r/${subreddit}/new.json`,
    {
      params: { limit, raw_json: 1 },
      headers: { 'User-Agent': getUserAgent() },
      timeout: 15000,
    },
  );

  return resp.data.data.children.map((child: any) => mapApiPost(child.data));
}

async function publicSearch(
  subreddit: string,
  keywords: string[],
  timeFilter: string,
  limit: number,
): Promise<RedditPost[]> {
  const query = keywords.join(' OR ');
  const resp = await axios.get(
    `https://www.reddit.com/r/${subreddit}/search.json`,
    {
      params: {
        q: query,
        restrict_sr: 'on',
        sort: 'new',
        t: timeFilter,
        limit,
        raw_json: 1,
      },
      headers: { 'User-Agent': getUserAgent() },
      timeout: 15000,
    },
  );

  return resp.data.data.children.map((child: any) => mapApiPost(child.data));
}

const rssParser = new Parser();

async function rssGetNew(
  subreddit: string,
  limit: number,
): Promise<RedditPost[]> {
  const feed = await rssParser.parseURL(
    `https://www.reddit.com/r/${subreddit}/new/.rss?limit=${limit}`,
  );

  return feed.items.map((item) => ({
    id: item.guid || item.link || '',
    title: item.title || '',
    selftext: item.contentSnippet || item.content || '',
    author: item.creator || 'unknown',
    subreddit,
    url: item.link || '',
    permalink: item.link || '',
    created: item.isoDate ? new Date(item.isoDate).getTime() / 1000 : 0,
    score: 0,
    numComments: 0,
  }));
}

// --- Unified functions with fallback ---

/**
 * Search a subreddit for posts matching keywords.
 * Uses API if credentials available, falls back to public JSON endpoint.
 */
export async function searchSubreddit(
  subreddit: string,
  keywords: string[],
  timeFilter: 'hour' | 'day' | 'week' | 'month' = 'day',
  limit: number = 25,
): Promise<RedditPost[]> {
  // Try API first
  if (hasApiCredentials()) {
    try {
      return await apiSearch(subreddit, keywords, timeFilter, limit);
    } catch (err) {
      console.error(
        `API search failed for r/${subreddit}, falling back to public`,
      );
    }
  }

  // Fallback: public JSON search
  try {
    return await publicSearch(subreddit, keywords, timeFilter, limit);
  } catch (err) {
    console.error(`Public search failed for r/${subreddit}, trying RSS`);
  }

  // Last resort: RSS feed with client-side keyword filter
  try {
    const posts = await rssGetNew(subreddit, 100);
    const lowerKeywords = keywords.map((k) => k.toLowerCase());
    return posts
      .filter((p) => {
        const text = `${p.title} ${p.selftext}`.toLowerCase();
        return lowerKeywords.some((kw) => text.includes(kw));
      })
      .slice(0, limit);
  } catch (err) {
    console.error(`All backends failed for r/${subreddit}`);
    return [];
  }
}

/**
 * Get new posts from a subreddit.
 * API → public JSON → RSS fallback chain.
 */
export async function getNewPosts(
  subreddit: string,
  limit: number = 25,
): Promise<RedditPost[]> {
  if (hasApiCredentials()) {
    try {
      return await apiGetNew(subreddit, limit);
    } catch (err) {
      console.error(`API failed for r/${subreddit}, falling back to public`);
    }
  }

  try {
    return await publicGetNew(subreddit, limit);
  } catch (err) {
    console.error(`Public JSON failed for r/${subreddit}, trying RSS`);
  }

  try {
    return await rssGetNew(subreddit, limit);
  } catch (err) {
    console.error(`All backends failed for r/${subreddit}`);
    return [];
  }
}

/**
 * Get posts newer than a specific timestamp
 */
export async function getPostsSince(
  subreddit: string,
  sinceTimestamp: number,
  limit: number = 100,
): Promise<RedditPost[]> {
  const posts = await getNewPosts(subreddit, limit);
  return posts.filter((post) => post.created > sinceTimestamp);
}

/**
 * Monitor multiple subreddits for keywords
 */
export async function monitorSubreddits(
  subreddits: string[],
  keywords: string[],
  sinceTimestamp: number,
): Promise<RedditPost[]> {
  const allPosts: RedditPost[] = [];

  for (const subreddit of subreddits) {
    try {
      const posts = await searchSubreddit(subreddit, keywords, 'day', 50);
      const newPosts = posts.filter((post) => post.created > sinceTimestamp);
      allPosts.push(...newPosts);
    } catch (error) {
      console.error(`Error monitoring r/${subreddit}:`, error);
    }
  }

  return allPosts.sort((a, b) => b.created - a.created);
}

/**
 * Score a post for relevance (1-10)
 */
export function scorePost(post: RedditPost, userSkills: string[]): number {
  let score = 5;

  const text = `${post.title} ${post.selftext}`.toLowerCase();

  if (text.includes('urgent') || text.includes('asap')) score += 1;
  if (text.includes('budget') && !text.includes('low budget')) score += 1;
  if (text.includes('long term') || text.includes('ongoing')) score += 2;
  if (text.includes('experienced') || text.includes('expert')) score += 1;

  const skillMatches = userSkills.filter((skill) =>
    text.includes(skill.toLowerCase()),
  ).length;
  score += Math.min(skillMatches, 3);

  if (text.includes('free') || text.includes('unpaid')) score -= 3;
  if (text.includes('equity only') || text.includes('rev share')) score -= 2;
  if (text.includes('spec work') || text.includes('contest')) score -= 2;

  if (post.score > 10) score += 1;
  if (post.numComments > 5) score += 1;

  return Math.max(1, Math.min(10, score));
}

/**
 * Filter posts by minimum score
 */
export function filterByScore(
  posts: RedditPost[],
  userSkills: string[],
  minScore: number = 7,
): Array<RedditPost & { relevanceScore: number }> {
  return posts
    .map((post) => ({
      ...post,
      relevanceScore: scorePost(post, userSkills),
    }))
    .filter((post) => post.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Format posts for WhatsApp display
 */
export function formatPostsForWhatsApp(
  posts: Array<RedditPost & { relevanceScore?: number }>,
): string {
  if (posts.length === 0) return 'No relevant posts found.';

  return posts
    .slice(0, 10)
    .map((post, i) => {
      const time = new Date(post.created * 1000).toLocaleString();
      const scoreStr = post.relevanceScore
        ? ` [Score: ${post.relevanceScore}/10]`
        : '';
      const flair = post.linkFlairText ? ` [${post.linkFlairText}]` : '';

      return `${i + 1}. r/${post.subreddit}${flair}${scoreStr}
*${post.title}*
u/${post.author} • ${time} • ↑${post.score} • ${post.numComments} comments

${post.selftext.substring(0, 200)}${post.selftext.length > 200 ? '...' : ''}

🔗 ${post.permalink}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Report which backend is active
 */
export function getBackendStatus(): string {
  const hasApi = hasApiCredentials();
  return hasApi
    ? 'Reddit API (authenticated) with public feed fallback'
    : 'Public feeds only (add ~/.nanoclaw-reddit/credentials.json for full API access)';
}
