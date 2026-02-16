---
name: add-reddit-monitor
description: Monitor Reddit for freelance opportunities, automation help requests, and lead generation. Tracks r/forhire, r/n8n, r/selfhosted, and other relevant subreddits for consulting opportunities.
---

# Add Reddit Monitor for Lead Generation

This skill adds Reddit monitoring capabilities to NanoClaw for finding freelance opportunities and building your reputation in automation communities.

## Target Subreddits

**High-Value Job Boards:**
- r/forhire - General freelance work
- r/freelance_forhire - Freelance-specific postings
- r/jobbit - Tech job postings
- r/slavelabour - Quick gigs (lower budget but fast)

**Technical Communities (Lead Generation):**
- r/n8n - n8n specific help requests
- r/selfhosted - VPS/automation needs
- r/sysadmin - IT automation problems
- r/devops - Infrastructure automation
- r/automation - General automation questions
- r/homelab - Self-hosting enthusiasts
- r/webdev - Web automation needs

## Prerequisites

### 1. Create Reddit App

**USER ACTION REQUIRED**

Tell the user:

> I need you to create a Reddit app to access their API:
>
> 1. Go to https://www.reddit.com/prefs/apps
> 2. Scroll down and click **"create another app..."** or **"are you a developer? create an app..."**
> 3. Fill in the form:
>    - **name:** NanoClaw-Monitor (or anything)
>    - **App type:** Select **script**
>    - **description:** Personal Reddit monitoring for freelance work
>    - **about url:** (leave blank)
>    - **redirect uri:** http://localhost:8080
> 4. Click **Create app**

Wait for confirmation, then continue:

> 5. You'll see your app listed. Note these values:
>    - Under the app name in small text: This is your **Client ID** (looks like: dQw4w9WgXcQ)
>    - **secret:** This is your **Client Secret** (looks like: a1b2c3d4e5f6g7h8i9j0)
>
> Please provide:
> - Client ID
> - Client Secret
> - Your Reddit username

### 2. Create Config Directory

```bash
mkdir -p ~/.nanoclaw-reddit
chmod 700 ~/.nanoclaw-reddit
```

### 3. Store Credentials

After user provides credentials:

```bash
cat > ~/.nanoclaw-reddit/credentials.json << 'EOF'
{
  "clientId": "PASTE_CLIENT_ID",
  "clientSecret": "PASTE_CLIENT_SECRET",
  "username": "your_reddit_username",
  "userAgent": "NanoClaw-Monitor/1.0"
}
EOF
chmod 600 ~/.nanoclaw-reddit/credentials.json
```

Replace with actual values provided by user.

---

## Installation

### 1. Install Reddit API Client

```bash
cd /Users/tyler/dev/nanoclaw
npm install snoowrap
```

### 2. Create Reddit Helper Module

```typescript
// src/reddit-helper.ts
import Snoowrap from 'snoowrap';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  userAgent: string;
}

let redditClient: Snoowrap | null = null;

function loadCredentials(): RedditCredentials {
  const credPath = path.join(os.homedir(), '.nanoclaw-reddit', 'credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error('Reddit credentials not found. Run /add-reddit-monitor to set up.');
  }
  return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
}

function getClient(): Snoowrap {
  if (redditClient) return redditClient;

  const creds = loadCredentials();
  redditClient = new Snoowrap({
    userAgent: creds.userAgent,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    username: creds.username,
    password: '', // Script apps don't need password
  });

  return redditClient;
}

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

/**
 * Search a subreddit for posts matching keywords
 */
export async function searchSubreddit(
  subreddit: string,
  keywords: string[],
  timeFilter: 'hour' | 'day' | 'week' | 'month' = 'day',
  limit: number = 25
): Promise<RedditPost[]> {
  const client = getClient();
  const sub = client.getSubreddit(subreddit);

  // Build search query
  const query = keywords.join(' OR ');

  const results = await sub.search({
    query,
    time: timeFilter,
    limit,
    sort: 'new',
  });

  return results.map(post => ({
    id: post.id,
    title: post.title,
    selftext: post.selftext,
    author: post.author.name,
    subreddit: post.subreddit.display_name,
    url: post.url,
    permalink: `https://reddit.com${post.permalink}`,
    created: post.created_utc,
    score: post.score,
    numComments: post.num_comments,
    linkFlairText: post.link_flair_text || undefined,
  }));
}

/**
 * Get new posts from a subreddit
 */
export async function getNewPosts(
  subreddit: string,
  limit: number = 25
): Promise<RedditPost[]> {
  const client = getClient();
  const sub = client.getSubreddit(subreddit);

  const posts = await sub.getNew({ limit });

  return posts.map(post => ({
    id: post.id,
    title: post.title,
    selftext: post.selftext,
    author: post.author.name,
    subreddit: post.subreddit.display_name,
    url: post.url,
    permalink: `https://reddit.com${post.permalink}`,
    created: post.created_utc,
    score: post.score,
    numComments: post.num_comments,
    linkFlairText: post.link_flair_text || undefined,
  }));
}

/**
 * Get posts newer than a specific timestamp
 */
export async function getPostsSince(
  subreddit: string,
  sinceTimestamp: number,
  limit: number = 100
): Promise<RedditPost[]> {
  const posts = await getNewPosts(subreddit, limit);
  return posts.filter(post => post.created > sinceTimestamp);
}

/**
 * Monitor multiple subreddits for keywords
 */
export async function monitorSubreddits(
  subreddits: string[],
  keywords: string[],
  sinceTimestamp: number
): Promise<RedditPost[]> {
  const allPosts: RedditPost[] = [];

  for (const subreddit of subreddits) {
    try {
      const posts = await searchSubreddit(subreddit, keywords, 'day', 50);
      const newPosts = posts.filter(post => post.created > sinceTimestamp);
      allPosts.push(...newPosts);
    } catch (error) {
      console.error(`Error monitoring r/${subreddit}:`, error);
    }
  }

  // Sort by created time, newest first
  return allPosts.sort((a, b) => b.created - a.created);
}

/**
 * Score a post for relevance (1-10)
 */
export function scorePost(post: RedditPost, userSkills: string[]): number {
  let score = 5; // Base score

  const text = `${post.title} ${post.selftext}`.toLowerCase();

  // Check for high-value keywords
  if (text.includes('urgent') || text.includes('asap')) score += 1;
  if (text.includes('budget') && !text.includes('low budget')) score += 1;
  if (text.includes('long term') || text.includes('ongoing')) score += 2;
  if (text.includes('experienced') || text.includes('expert')) score += 1;

  // Check for skill matches
  const skillMatches = userSkills.filter(skill =>
    text.includes(skill.toLowerCase())
  ).length;
  score += Math.min(skillMatches, 3);

  // Check for red flags
  if (text.includes('free') || text.includes('unpaid')) score -= 3;
  if (text.includes('equity only') || text.includes('rev share')) score -= 2;
  if (text.includes('quick job') && text.includes('$5')) score -= 2;
  if (text.includes('spec work') || text.includes('contest')) score -= 2;

  // Post engagement indicates quality
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
  minScore: number = 7
): Array<RedditPost & { relevanceScore: number }> {
  return posts
    .map(post => ({
      ...post,
      relevanceScore: scorePost(post, userSkills),
    }))
    .filter(post => post.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Format posts for WhatsApp display
 */
export function formatPostsForWhatsApp(
  posts: Array<RedditPost & { relevanceScore?: number }>
): string {
  if (posts.length === 0) return 'No relevant posts found.';

  return posts
    .slice(0, 10) // Limit to top 10
    .map((post, i) => {
      const time = new Date(post.created * 1000).toLocaleString();
      const score = post.relevanceScore ? ` [Score: ${post.relevanceScore}/10]` : '';
      const flair = post.linkFlairText ? ` [${post.linkFlairText}]` : '';

      return `${i + 1}. r/${post.subreddit}${flair}${score}
*${post.title}*
u/${post.author} • ${time} • ↑${post.score} • ${post.numComments} comments

${post.selftext.substring(0, 200)}${post.selftext.length > 200 ? '...' : ''}

🔗 ${post.permalink}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Generate a draft response for a post
 */
export function draftResponse(post: RedditPost, userExperience: string[]): string {
  const isHiring = post.subreddit.toLowerCase().includes('hire') ||
                   post.title.toLowerCase().includes('hiring');

  if (isHiring) {
    return `Hi! I'm interested in this opportunity. I have experience with ${userExperience.slice(0, 3).join(', ')}, which seems like a great fit for what you're looking for.

I've worked on similar projects including [mention relevant project]. I'd be happy to discuss your needs in more detail and provide examples of my work.

What's the best way to proceed? Feel free to DM me or we can schedule a quick call.

Looking forward to hearing from you!`;
  } else {
    return `I might be able to help with this! I've worked with ${userExperience.slice(0, 2).join(' and ')} on similar projects.

[Specific suggestion based on their problem]

If you'd like to chat about implementing this, feel free to DM me. Happy to provide more details or examples.`;
  }
}
```

Save to `src/reddit-helper.ts`.

### 3. Create CLI Tool for Agents

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/reddit-monitor.sh << 'EOF'
#!/bin/bash
# Reddit monitoring tool for NanoClaw agents

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,VPS,API,security,Python,JavaScript,bug bounty,workflow"

case "$1" in
  search)
    SUBREDDIT="$2"
    KEYWORDS="$3"
    node -e "
    const { searchSubreddit, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const keywords = '$KEYWORDS'.split(',');
    searchSubreddit('$SUBREDDIT', keywords).then(posts => {
      console.log(formatPostsForWhatsApp(posts));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  monitor-jobs)
    TIMESTAMP="\${2:-0}"
    node -e "
    const { monitorSubreddits, filterByScore, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const subreddits = ['forhire', 'freelance_forhire', 'jobbit'];
    const keywords = ['$USER_SKILLS'.split(',')];
    const timestamp = parseInt('$TIMESTAMP') || (Date.now() / 1000 - 3600 * 24);

    monitorSubreddits(subreddits, keywords, timestamp).then(posts => {
      const scored = filterByScore(posts, '$USER_SKILLS'.split(','), 7);
      if (scored.length === 0) {
        console.log('No high-quality job postings found.');
      } else {
        console.log(\`Found \${scored.length} relevant opportunities:\\n\`);
        console.log(formatPostsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  monitor-community)
    SUBREDDIT="$2"
    TIMESTAMP="${3:-0}"
    node -e "
    const { getPostsSince, formatPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/reddit-helper.js');
    const timestamp = parseInt('$TIMESTAMP') || (Date.now() / 1000 - 3600 * 4);

    getPostsSince('$SUBREDDIT', timestamp).then(posts => {
      if (posts.length === 0) {
        console.log('No new posts in r/$SUBREDDIT.');
      } else {
        console.log(\`\${posts.length} new posts in r/$SUBREDDIT:\\n\`);
        console.log(formatPostsForWhatsApp(posts));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  draft-response)
    POST_ID="$2"
    echo "Feature coming soon: Draft response for post $POST_ID"
    ;;

  *)
    echo "Usage: reddit-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  search <subreddit> <keywords>       - Search subreddit for keywords"
    echo "  monitor-jobs [since_timestamp]      - Check job boards for opportunities"
    echo "  monitor-community <subreddit> [since] - Get new posts from subreddit"
    echo "  draft-response <post_id>            - Generate response draft"
    echo ""
    echo "Examples:"
    echo "  reddit-monitor.sh search forhire 'n8n,automation'"
    echo "  reddit-monitor.sh monitor-jobs"
    echo "  reddit-monitor.sh monitor-community n8n"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/reddit-monitor.sh
```

### 4. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## Reddit Monitoring

You can monitor Reddit for freelance opportunities using `reddit-monitor.sh`:

**Check job boards:**
```bash
/workspace/project/container/tools/reddit-monitor.sh monitor-jobs
```

**Monitor specific community:**
```bash
/workspace/project/container/tools/reddit-monitor.sh monitor-community n8n
```

**Search for keywords:**
```bash
/workspace/project/container/tools/reddit-monitor.sh search forhire "n8n,automation,api"
```

Use these when the user asks about freelance opportunities or Reddit monitoring.
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
const { searchSubreddit, formatPostsForWhatsApp } = require('./dist/reddit-helper.js');
searchSubreddit('forhire', ['automation', 'n8n'], 'day', 10).then(posts => {
  console.log('Found', posts.length, 'posts');
  console.log(formatPostsForWhatsApp(posts));
}).catch(err => console.error(err));
"
```

Test from WhatsApp:

```
@Andy check r/forhire for posts about automation, n8n, or API work

@Andy monitor r/n8n for people asking for help with complex workflows
```

---

## Scheduled Monitoring Tasks

### Job Board Monitor (Every 2 hours)

```
@Andy every 2 hours, check r/forhire, r/freelance_forhire, and r/jobbit for posts mentioning n8n, automation, API, security, VPS, or workflow. Score each post 1-10 for fit. Only send me posts scored 7+, with a draft response for each. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://reddit.com/...", "source": "reddit", "score": 8, "summary": "..."}</signal>
```

### Community Engagement (Daily)

```
@Andy every day at 9am, check r/n8n, r/selfhosted, and r/sysadmin for new posts from the past 24 hours where someone is asking for help. Filter for problems I can solve (automation, VPS, API work). Send me 3-5 best opportunities to build credibility by helping. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://reddit.com/...", "source": "reddit", "score": 8, "summary": "..."}</signal>
```

### Weekly Opportunity Summary

```
@Andy every Sunday at 6pm, analyze all freelance job postings from Reddit this week. Tell me: total opportunities found, top 5 by relevance score, most common skill requests, average budget ranges (if mentioned), and whether I should adjust my monitoring keywords. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "https://reddit.com/...", "source": "reddit", "score": 8, "summary": "..."}</signal>
```

---

## Configuration

### Customize Your Skills

Edit the USER_SKILLS in `reddit-monitor.sh`:

```bash
USER_SKILLS="n8n,automation,VPS,API,security,Python,JavaScript,bug bounty,workflow,integration"
```

### Add More Subreddits

Edit the subreddits array in monitoring tasks:

```javascript
const subreddits = ['forhire', 'freelance_forhire', 'jobbit', 'hiring'];
```

---

## Success Criteria

✅ Reddit API credentials configured
✅ Can search subreddits from Andy
✅ Can monitor job boards
✅ Scoring system filters low-quality posts
✅ Scheduled monitoring tasks running
✅ Draft responses generated

---

Tell the user:

> Reddit monitoring is set up! 🎉
>
> Andy can now find freelance opportunities and help requests on Reddit. Try:
> - "@Andy check r/forhire for automation jobs"
> - "@Andy what's new in r/n8n?"
>
> Ready to set up automated monitoring? I can create scheduled tasks to check job boards every 2 hours and alert you to high-quality opportunities!
