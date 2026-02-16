---
name: add-hn-monitor
description: Monitor HackerNews for "Who's Hiring" threads, "Ask HN" automation questions, and freelance opportunities. Perfect for finding remote contract work and building reputation in tech communities.
---

# Add HackerNews Monitor for Lead Generation

This skill adds HackerNews monitoring to track hiring threads, technical questions, and opportunities for automation consulting.

## What It Monitors

**Monthly "Who's Hiring" Thread:**
- Posted first weekday of each month
- 500-1000+ job postings
- Many remote/contract opportunities
- Filter by: remote, contract, automation, n8n, security

**"Ask HN" Posts:**
- Questions about automation, workflows, self-hosting
- Problems you can solve = consulting opportunities
- Build reputation by providing valuable answers

**"Show HN" Posts:**
- New tools/products needing integrations
- Early adopter opportunities
- Potential collaboration

---

## Installation

### 1. Install HN API Client

```bash
cd /Users/tyler/dev/nanoclaw
npm install hn-api
```

### 2. Create HN Helper Module

```typescript
// src/hn-helper.ts
import axios from 'axios';

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const HN_ALGOLIA_API = 'https://hn.algolia.com/api/v1';

export interface HNItem {
  id: number;
  type: 'story' | 'comment' | 'job';
  by: string;
  time: number;
  text?: string;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number; // comment count
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
    const response = await axios.get(`${HN_API_BASE}/item/${id}.json`);
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
  numericFilters?: string
): Promise<HNItem[]> {
  try {
    const params: any = {
      query,
      tags: tags || 'story',
      hitsPerPage: 50,
    };

    if (numericFilters) {
      params.numericFilters = numericFilters;
    }

    const response = await axios.get(`${HN_ALGOLIA_API}/search`, { params });
    return response.data.hits.map((hit: any) => ({
      id: hit.objectID,
      type: 'story',
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
  const results = await searchStories("Who is Hiring", "story", undefined);

  // Find the most recent one from username 'whoishiring'
  const thread = results.find(
    item => item.by === 'whoishiring' && item.title?.includes('Who is Hiring')
  );

  return thread || null;
}

/**
 * Get all comments from a thread
 */
export async function getThreadComments(threadId: number): Promise<HNItem[]> {
  const thread = await getItem(threadId);
  if (!thread || !thread.kids) return [];

  const comments: HNItem[] = [];

  // Fetch all top-level comments
  for (const kidId of thread.kids) {
    const comment = await getItem(kidId);
    if (comment) {
      comments.push(comment);
    }
  }

  return comments;
}

/**
 * Parse "Who's Hiring" comments for job details
 */
export function parseJobListing(comment: HNItem, keywords: string[]): HNJobListing | null {
  if (!comment.text) return null;

  const text = comment.text.toLowerCase();
  const originalText = comment.text;

  // Extract title (usually first line or before first pipe/dash)
  const titleMatch = originalText.match(/^([^\n|]+)/);
  const title = titleMatch ? titleMatch[1].trim() : 'Job Listing';

  // Check for keyword matches
  const matchedKeywords = keywords.filter(keyword =>
    text.includes(keyword.toLowerCase())
  );

  if (matchedKeywords.length === 0) return null;

  // Score the listing
  let score = 5;

  // Check for high-value indicators
  if (text.includes('remote') || text.includes('anywhere')) score += 2;
  if (text.includes('contract') || text.includes('freelance')) score += 2;
  if (text.includes('automation') || text.includes('workflow')) score += 1;
  if (text.includes('senior') || text.includes('lead')) score += 1;
  if (text.includes('equity') || text.includes('stock')) score += 1;

  // Check for match density
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
export async function searchWhoIsHiring(keywords: string[], minScore: number = 7): Promise<HNJobListing[]> {
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

  // Sort by relevance score
  return listings.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Find "Ask HN" posts about automation/workflows
 */
export async function findAskHNOpportunities(keywords: string[]): Promise<HNItem[]> {
  const results: HNItem[] = [];

  for (const keyword of keywords) {
    const posts = await searchStories(keyword, 'ask_hn', undefined);
    results.push(...posts);
  }

  // Deduplicate by ID
  const unique = Array.from(
    new Map(results.map(item => [item.id, item])).values()
  );

  // Filter for recent (last 7 days)
  const weekAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
  return unique.filter(item => item.time > weekAgo);
}

/**
 * Find "Show HN" posts
 */
export async function findShowHN(keywords: string[]): Promise<HNItem[]> {
  const results: HNItem[] = [];

  for (const keyword of keywords) {
    const posts = await searchStories(keyword, 'show_hn', undefined);
    results.push(...posts);
  }

  const unique = Array.from(
    new Map(results.map(item => [item.id, item])).values()
  );

  const weekAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
  return unique.filter(item => item.time > weekAgo);
}

/**
 * Format job listings for WhatsApp
 */
export function formatJobListings(listings: HNJobListing[]): string {
  if (listings.length === 0) return 'No matching jobs found.';

  return listings
    .slice(0, 15) // Top 15
    .map((job, i) => {
      const time = new Date(job.time * 1000).toLocaleDateString();
      const keywords = job.matchedKeywords.join(', ');

      return `${i + 1}. [Score: ${job.relevanceScore}/10]
*${job.title}*

Keywords: ${keywords}
Posted: ${time} by ${job.author}

${job.text.substring(0, 300)}${job.text.length > 300 ? '...' : ''}

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

${post.text ? post.text.substring(0, 200) : 'Click link to view'}${post.text && post.text.length > 200 ? '...' : ''}

🔗 https://news.ycombinator.com/item?id=${post.id}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Draft a response to Ask HN
 */
export function draftAskHNResponse(post: HNItem, userExperience: string[]): string {
  return `I've worked with similar challenges. In my experience with ${userExperience.slice(0, 2).join(' and ')}, here's an approach that works well:

[Specific suggestion based on the question]

A few things to consider:
- [Key point 1]
- [Key point 2]

If you'd like to discuss implementation details, feel free to reach out. Happy to share more specific examples.`;
}
```

Save to `src/hn-helper.ts`.

### 3. Create CLI Tool

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/hn-monitor.sh << 'EOF'
#!/bin/bash
# HackerNews monitoring tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"
USER_KEYWORDS="n8n,automation,workflow,API,VPS,security,Python,JavaScript,freelance,contract,remote"

case "$1" in
  who-is-hiring)
    MIN_SCORE="${2:-7}"
    node -e "
    const { searchWhoIsHiring, formatJobListings } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const keywords = '$USER_KEYWORDS'.split(',');

    searchWhoIsHiring(keywords, $MIN_SCORE).then(jobs => {
      if (jobs.length === 0) {
        console.log('No jobs found matching your criteria in the latest Who\\'s Hiring thread.');
      } else {
        console.log(\`Found \${jobs.length} relevant jobs (score >= $MIN_SCORE/10):\\n\`);
        console.log(formatJobListings(jobs));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  ask-hn)
    KEYWORDS="${2:-automation,workflow,self-hosted,api,integration}"
    node -e "
    const { findAskHNOpportunities, formatHNPosts } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const keywords = '$KEYWORDS'.split(',');

    findAskHNOpportunities(keywords).then(posts => {
      if (posts.length === 0) {
        console.log('No Ask HN posts found matching keywords.');
      } else {
        console.log(\`Found \${posts.length} Ask HN posts:\\n\`);
        console.log(formatHNPosts(posts));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  show-hn)
    KEYWORDS="${2:-automation,workflow,api,integration,tool}"
    node -e "
    const { findShowHN, formatHNPosts } = require('$NANOCLAW_DIR/dist/hn-helper.js');
    const keywords = '$KEYWORDS'.split(',');

    findShowHN(keywords).then(posts => {
      if (posts.length === 0) {
        console.log('No Show HN posts found matching keywords.');
      } else {
        console.log(\`Found \${posts.length} Show HN posts:\\n\`);
        console.log(formatHNPosts(posts));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  find-thread)
    node -e "
    const { findWhoIsHiringThread } = require('$NANOCLAW_DIR/dist/hn-helper.js');

    findWhoIsHiringThread().then(thread => {
      if (!thread) {
        console.log('Could not find Who\\'s Hiring thread');
      } else {
        console.log(\`Latest thread: \${thread.title}\`);
        console.log(\`Posted: \${new Date(thread.time * 1000).toLocaleDateString()}\`);
        console.log(\`URL: https://news.ycombinator.com/item?id=\${thread.id}\`);
        console.log(\`Comments: \${thread.descendants || 0}\`);
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: hn-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  who-is-hiring [min_score]       - Search Who's Hiring thread (default min: 7)"
    echo "  ask-hn [keywords]               - Find Ask HN opportunities"
    echo "  show-hn [keywords]              - Find Show HN posts"
    echo "  find-thread                     - Find latest Who's Hiring thread info"
    echo ""
    echo "Examples:"
    echo "  hn-monitor.sh who-is-hiring 8"
    echo "  hn-monitor.sh ask-hn 'automation,api,workflow'"
    echo "  hn-monitor.sh show-hn 'automation,integration'"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/hn-monitor.sh
```

### 4. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## HackerNews Monitoring

Monitor HN for freelance opportunities:

**Check Who's Hiring thread:**
```bash
/workspace/project/container/tools/hn-monitor.sh who-is-hiring 7
```

**Find Ask HN about automation:**
```bash
/workspace/project/container/tools/hn-monitor.sh ask-hn "automation,workflow,api"
```

**Find Show HN with new tools:**
```bash
/workspace/project/container/tools/hn-monitor.sh show-hn "automation,integration"
```

Use when user asks about HackerNews or freelance jobs.
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
const { findWhoIsHiringThread } = require('./dist/hn-helper.js');
findWhoIsHiringThread().then(thread => {
  console.log('Latest thread:', thread?.title);
  console.log('ID:', thread?.id);
}).catch(err => console.error(err));
"
```

Test from WhatsApp:

```
@Andy check the latest HackerNews Who's Hiring thread for remote automation jobs

@Andy find Ask HN posts about workflow automation from the past week
```

---

## Scheduled Monitoring Tasks

### Monthly "Who's Hiring" Alert

```
@Andy on the first weekday of every month, check the HackerNews Who's Hiring thread. Search for jobs mentioning n8n, automation, API, security, or remote work. Score each 1-10 and send me the top 10 matches with direct links.
```

### Daily "Ask HN" Monitor

```
@Andy every day at 10am, check HackerNews for Ask HN posts from the past 24 hours about automation, workflows, self-hosting, or API integration. If any match my expertise, send me the post with a draft response I can use to build credibility.
```

### Weekly "Show HN" Opportunities

```
@Andy every Monday at 9am, check HackerNews Show HN posts from the past week about new automation tools, workflow platforms, or API services. Send me interesting ones where I could offer integration consulting or become an early adopter.
```

### Real-time Job Alerts (First Few Days of Month)

```
@Andy on the 1st through 5th of each month, check the Who's Hiring thread every 4 hours for new high-score jobs (8+/10). Alert me immediately so I can apply early before the thread gets crowded.
```

---

## Pro Tips

### Timing Matters

- **Who's Hiring** posts on first weekday of month around 11am ET
- First 24-48 hours get most views
- Apply early for better response rates
- Thread stays active for 2-3 days

### Keyword Strategy

**High Value:**
- "remote" + "contract" + your tech stack
- "automation", "workflow", "integration"
- "senior" or "lead" (higher pay)
- Company names you recognize

**Red Flags:**
- "unpaid", "equity only", "deferred"
- "junior" (unless that's your level)
- "relocation required" (if you want remote)

### Standing Out

1. **Apply within first 24 hours**
2. **Reference specific tech mentioned** in posting
3. **Link to relevant projects** (your VPS automation!)
4. **Keep initial email short** (3-4 paragraphs max)

---

## Success Criteria

✅ Can find latest Who's Hiring thread
✅ Can search jobs by keywords
✅ Scoring system filters irrelevant posts
✅ Can monitor Ask HN and Show HN
✅ Scheduled tasks running
✅ Monthly reminders set up

---

Tell the user:

> HackerNews monitoring is ready! 🎉
>
> Andy will now track:
> - Monthly "Who's Hiring" threads
> - "Ask HN" opportunities to build reputation
> - "Show HN" for potential collaboration
>
> The next Who's Hiring thread will post around March 1st. Want me to set up an alert so Andy monitors it automatically?
