import axios from 'axios';

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const HN_ALGOLIA_API = 'https://hn.algolia.com/api/v1';

export interface HNItem {
  id: number;
  type: 'story' | 'comment' | 'job';
  by: string;
  time: number;
  kids?: number[];
  text?: string;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
}

export interface HNJobListing {
  id: number;
  title: string;
  text: string;
  author: string;
  time: number;
  url: string;
  relevanceScore: number;
  matchedKeywords: string[];
}

/**
 * Get an item by ID
 */
export async function getItem(id: number): Promise<HNItem | null> {
  try {
    const response = await axios.get(`${HN_API_BASE}/item/${id}.json`, {
      timeout: 10000,
    });
    return response.data;
  } catch {
    return null;
  }
}

/**
 * Search HN using Algolia API
 */
export async function searchStories(
  query: string,
  tags?: string,
  numericFilters?: string,
): Promise<HNItem[]> {
  try {
    const params: Record<string, any> = {
      query,
      tags: tags || 'story',
      hitsPerPage: 50,
    };

    if (numericFilters) {
      params.numericFilters = numericFilters;
    }

    const response = await axios.get(`${HN_ALGOLIA_API}/search`, {
      params,
      timeout: 15000,
    });
    return response.data.hits.map((hit: any) => ({
      id: parseInt(hit.objectID),
      type: 'story' as const,
      by: hit.author,
      time: hit.created_at_i,
      title: hit.title,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      text: hit.story_text,
      score: hit.points,
      descendants: hit.num_comments,
    }));
  } catch {
    return [];
  }
}

/**
 * Find the latest "Who's Hiring" thread
 */
export async function findWhoIsHiringThread(): Promise<HNItem | null> {
  try {
    // Search for the monthly "Ask HN: Who is hiring?" threads by whoishiring
    const response = await axios.get(`${HN_ALGOLIA_API}/search_by_date`, {
      params: {
        query: 'Ask HN: Who is hiring?',
        tags: 'story,author_whoishiring',
        hitsPerPage: 5,
      },
      timeout: 15000,
    });

    const hits = response.data.hits;
    if (!hits || hits.length === 0) return null;

    // Filter to only monthly hiring threads (title contains month/year)
    const monthly =
      hits.find((h: any) => /who is hiring\??\s*\(/i.test(h.title)) || hits[0];

    return {
      id: parseInt(monthly.objectID),
      type: 'story',
      by: monthly.author,
      time: monthly.created_at_i,
      title: monthly.title,
      url: `https://news.ycombinator.com/item?id=${monthly.objectID}`,
      score: monthly.points,
      descendants: monthly.num_comments,
    };
  } catch {
    return null;
  }
}

/**
 * Get top-level comments from a thread
 */
export async function getThreadComments(threadId: number): Promise<HNItem[]> {
  const thread = await getItem(threadId);
  if (!thread || !thread.kids) return [];

  const comments: HNItem[] = [];

  // Fetch top-level comments (batch to avoid hammering API)
  const batchSize = 20;
  for (let i = 0; i < Math.min(thread.kids.length, 200); i += batchSize) {
    const batch = thread.kids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((id) => getItem(id)));
    for (const comment of results) {
      if (comment && comment.text) comments.push(comment);
    }
  }

  return comments;
}

/**
 * Parse a "Who's Hiring" comment into a job listing
 */
export function parseJobListing(
  comment: HNItem,
  keywords: string[],
): HNJobListing | null {
  if (!comment.text) return null;

  const text = comment.text.toLowerCase();
  const originalText = comment.text;

  const titleMatch = originalText.match(/^([^\n|<]+)/);
  const title = titleMatch ? titleMatch[1].trim() : 'Job Listing';

  const matchedKeywords = keywords.filter((keyword) =>
    text.includes(keyword.toLowerCase()),
  );

  if (matchedKeywords.length === 0) return null;

  let score = 5;

  if (text.includes('remote') || text.includes('anywhere')) score += 2;
  if (text.includes('contract') || text.includes('freelance')) score += 2;
  if (text.includes('automation') || text.includes('workflow')) score += 1;
  if (text.includes('senior') || text.includes('lead')) score += 1;

  score += Math.min(matchedKeywords.length, 3);

  return {
    id: comment.id,
    title,
    text: originalText,
    author: comment.by,
    time: comment.time,
    url: `https://news.ycombinator.com/item?id=${comment.id}`,
    relevanceScore: Math.min(score, 10),
    matchedKeywords,
  };
}

/**
 * Search "Who's Hiring" thread for relevant jobs
 */
export async function searchWhoIsHiring(
  keywords: string[],
  minScore: number = 7,
): Promise<HNJobListing[]> {
  const thread = await findWhoIsHiringThread();
  if (!thread) {
    throw new Error('Could not find latest "Who is Hiring" thread');
  }

  console.log(`Found thread: ${thread.title} (ID: ${thread.id})`);

  const comments = await getThreadComments(thread.id);
  console.log(`Fetched ${comments.length} job listings`);

  const listings: HNJobListing[] = [];

  for (const comment of comments) {
    const listing = parseJobListing(comment, keywords);
    if (listing && listing.relevanceScore >= minScore) {
      listings.push(listing);
    }
  }

  return listings.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Find "Ask HN" posts about automation/workflows
 */
export async function findAskHNOpportunities(
  keywords: string[],
): Promise<HNItem[]> {
  const results: HNItem[] = [];

  for (const keyword of keywords) {
    const posts = await searchStories(keyword, 'ask_hn');
    results.push(...posts);
  }

  const unique = Array.from(
    new Map(results.map((item) => [item.id, item])).values(),
  );

  const weekAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
  return unique.filter((item) => item.time > weekAgo);
}

/**
 * Find "Show HN" posts
 */
export async function findShowHN(keywords: string[]): Promise<HNItem[]> {
  const results: HNItem[] = [];

  for (const keyword of keywords) {
    const posts = await searchStories(keyword, 'show_hn');
    results.push(...posts);
  }

  const unique = Array.from(
    new Map(results.map((item) => [item.id, item])).values(),
  );

  const weekAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
  return unique.filter((item) => item.time > weekAgo);
}

/**
 * Format job listings for WhatsApp
 */
export function formatJobListings(listings: HNJobListing[]): string {
  if (listings.length === 0) return 'No matching jobs found.';

  return listings
    .slice(0, 15)
    .map((job, i) => {
      const time = new Date(job.time * 1000).toLocaleDateString();
      const keywords = job.matchedKeywords.join(', ');

      // Strip HTML tags for cleaner display
      const cleanText = job.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      return `${i + 1}. [Score: ${job.relevanceScore}/10]
*${job.title}*

Keywords: ${keywords}
Posted: ${time} by ${job.author}

${cleanText.substring(0, 300)}${cleanText.length > 300 ? '...' : ''}

🔗 ${job.url}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format Ask/Show HN posts for WhatsApp
 */
export function formatHNPosts(posts: HNItem[]): string {
  if (posts.length === 0) return 'No posts found.';

  return posts
    .slice(0, 10)
    .map((post, i) => {
      const time = new Date(post.time * 1000).toLocaleDateString();

      return `${i + 1}. *${post.title || 'Post'}*
${post.by} • ${time} • ↑${post.score || 0} • ${post.descendants || 0} comments

${post.text ? post.text.replace(/<[^>]+>/g, ' ').substring(0, 200) : 'Click link to view'}${post.text && post.text.length > 200 ? '...' : ''}

🔗 https://news.ycombinator.com/item?id=${post.id}`;
    })
    .join('\n\n---\n\n');
}
