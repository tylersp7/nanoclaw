---
name: add-n8n-monitor
description: Monitor n8n community (forum, Discord, GitHub) for help requests, template opportunities, and consulting leads. Build reputation as n8n expert by providing valuable help.
---

# Add n8n Community Monitor

This skill monitors n8n's community channels to find consulting opportunities and build your reputation as an n8n automation expert.

## What It Monitors

**n8n Community Forum:**
- Unanswered questions about complex workflows
- Self-hosting issues (your VPS expertise!)
- API integration questions
- Security and deployment topics

**n8n GitHub:**
- Feature requests you could implement
- Bugs you could help fix
- Discussions about advanced use cases
- Template/workflow ideas

**n8n Discord (optional):**
- #help channel questions
- #workflows discussions
- #show-and-tell inspiration

---

## Installation

### 1. Install Dependencies

```bash
cd /Users/tyler/dev/nanoclaw
npm install axios cheerio rss-parser
```

### 2. Create n8n Community Helper

```typescript
// src/n8n-helper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
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
    // n8n forum uses Discourse, which has a JSON API
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
  solved: boolean = false
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
      // Filter by solved status if requested
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
export async function getUnansweredPosts(keywords?: string[]): Promise<ForumPost[]> {
  let posts: ForumPost[];

  if (keywords && keywords.length > 0) {
    posts = await searchForum(keywords, false);
  } else {
    posts = await getForumLatest(50);
  }

  // Filter for unanswered (0-1 replies) and not solved
  return posts.filter(post => post.replies <= 1 && !post.solved);
}

/**
 * Get n8n GitHub issues
 */
export async function getN8nIssues(labels?: string[]): Promise<GitHubIssue[]> {
  try {
    const params: any = {
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
 * Get feature requests (issues with "feature request" label)
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

  // Unanswered is good
  if (post.replies === 0) score += 3;
  else if (post.replies === 1) score += 2;

  // Not solved is good
  if (!post.solved) score += 2;

  // Recent is better
  const hoursSincePost = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
  if (hoursSincePost < 24) score += 2;
  else if (hoursSincePost < 72) score += 1;

  // High views = important question
  if (post.views > 50) score += 1;
  if (post.views > 100) score += 1;

  // Check for skill matches
  const skillMatches = userSkills.filter(skill =>
    text.includes(skill.toLowerCase())
  ).length;
  score += Math.min(skillMatches, 3);

  // Check for complexity indicators (good for consulting)
  if (text.includes('complex') || text.includes('advanced')) score += 1;
  if (text.includes('self-host') || text.includes('vps') || text.includes('docker')) score += 2;
  if (text.includes('api') || text.includes('integration')) score += 1;
  if (text.includes('security') || text.includes('authentication')) score += 1;

  // Check for negative indicators
  if (text.includes('simple') || text.includes('basic')) score -= 1;
  if (post.replies > 5) score -= 2; // Already has lots of help

  return Math.max(1, Math.min(10, score));
}

/**
 * Score GitHub issue for contribution opportunity
 */
export function scoreGitHubIssue(issue: GitHubIssue, userSkills: string[]): number {
  let score = 5;

  const text = `${issue.title} ${issue.body}`.toLowerCase();

  // Check labels
  if (issue.labels.includes('good first issue')) score += 2;
  if (issue.labels.includes('help wanted')) score += 2;
  if (issue.labels.includes('bug')) score += 1;
  if (issue.labels.includes('feature request')) score -= 1; // Usually complex

  // No comments = fresh opportunity
  if (issue.comments === 0) score += 2;
  else if (issue.comments <= 2) score += 1;

  // Check for skill matches
  const skillMatches = userSkills.filter(skill =>
    text.includes(skill.toLowerCase())
  ).length;
  score += Math.min(skillMatches, 3);

  // Recent is better
  const daysSinceCreated = (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated < 7) score += 2;
  else if (daysSinceCreated < 30) score += 1;

  return Math.max(1, Math.min(10, score));
}

/**
 * Generate response draft for forum post
 */
export function draftForumResponse(post: ForumPost, userExperience: string[]): string {
  return `I've worked with similar n8n workflows. Here's an approach that should work:

[Specific solution based on the question]

A few things to keep in mind:
- [Technical point 1]
- [Technical point 2]

I've implemented this type of workflow in my own n8n instances (${userExperience.slice(0, 2).join(' and ')}). If you need help setting it up or run into issues, feel free to ask!

Hope this helps!`;
}

/**
 * Find template opportunities (popular unsolved problems)
 */
export async function findTemplateOpportunities(): Promise<ForumPost[]> {
  const posts = await getForumLatest(100);

  // Find posts with high views, multiple replies, but not solved
  return posts
    .filter(post => !post.solved && post.views > 30 && post.replies >= 2)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
}

/**
 * Format posts for WhatsApp
 */
export function formatForumPostsForWhatsApp(
  posts: Array<ForumPost & { score?: number }>
): string {
  if (posts.length === 0) return 'No posts found.';

  return posts
    .slice(0, 10)
    .map((post, i) => {
      const time = new Date(post.createdAt).toLocaleDateString();
      const scoreStr = post.score ? ` [Score: ${post.score}/10]` : '';
      const tags = post.tags.length > 0 ? ` | Tags: ${post.tags.join(', ')}` : '';

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
  issues: Array<GitHubIssue & { score?: number }>
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
```

Save to `src/n8n-helper.ts`.

### 3. Create CLI Tool

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/n8n-monitor.sh << 'EOF'
#!/bin/bash
# n8n community monitoring tool

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,VPS,Docker,webhook,self-host,integration,security,Python,JavaScript"

case "$1" in
  unanswered)
    KEYWORDS="${2:-}"
    node -e "
    const { getUnansweredPosts, formatForumPostsForWhatsApp, scoreForumPost } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const keywords = '$KEYWORDS' ? '$KEYWORDS'.split(',') : undefined;
    const skills = '$USER_SKILLS'.split(',');

    getUnansweredPosts(keywords).then(posts => {
      // Score posts
      const scored = posts.map(post => ({
        ...post,
        score: scoreForumPost(post, skills)
      })).filter(p => p.score >= 6).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No unanswered posts found.');
      } else {
        console.log(\`Found \${scored.length} unanswered posts (score >= 6/10):\\n\`);
        console.log(formatForumPostsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  search)
    KEYWORDS="$2"
    if [ -z "$KEYWORDS" ]; then
      echo "Usage: n8n-monitor.sh search 'keywords'"
      exit 1
    fi
    node -e "
    const { searchForum, formatForumPostsForWhatsApp, scoreForumPost } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const keywords = '$KEYWORDS'.split(',');
    const skills = '$USER_SKILLS'.split(',');

    searchForum(keywords, false).then(posts => {
      const scored = posts.map(post => ({
        ...post,
        score: scoreForumPost(post, skills)
      })).filter(p => p.score >= 5).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No posts found matching keywords.');
      } else {
        console.log(\`Found \${scored.length} posts:\\n\`);
        console.log(formatForumPostsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  github-issues)
    LABELS="${2:-}"
    node -e "
    const { getN8nIssues, formatGitHubIssuesForWhatsApp, scoreGitHubIssue } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const labels = '$LABELS' ? '$LABELS'.split(',') : undefined;
    const skills = '$USER_SKILLS'.split(',');

    getN8nIssues(labels).then(issues => {
      const scored = issues.map(issue => ({
        ...issue,
        score: scoreGitHubIssue(issue, skills)
      })).filter(i => i.score >= 6).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        console.log('No issues found.');
      } else {
        console.log(\`Found \${scored.length} issues (score >= 6/10):\\n\`);
        console.log(formatGitHubIssuesForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  template-ideas)
    node -e "
    const { findTemplateOpportunities, formatForumPostsForWhatsApp } = require('$NANOCLAW_DIR/dist/n8n-helper.js');

    findTemplateOpportunities().then(posts => {
      if (posts.length === 0) {
        console.log('No template opportunities found.');
      } else {
        console.log('Popular unsolved problems (template opportunities):\\n');
        console.log(formatForumPostsForWhatsApp(posts));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  feature-requests)
    node -e "
    const { getFeatureRequests, formatGitHubIssuesForWhatsApp, scoreGitHubIssue } = require('$NANOCLAW_DIR/dist/n8n-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    getFeatureRequests().then(issues => {
      const scored = issues.map(issue => ({
        ...issue,
        score: scoreGitHubIssue(issue, skills)
      })).filter(i => i.score >= 5).sort((a, b) => b.score - a.score);

      console.log(\`Found \${scored.length} feature requests:\\n\`);
      console.log(formatGitHubIssuesForWhatsApp(scored));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: n8n-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  unanswered [keywords]    - Find unanswered forum posts"
    echo "  search 'keywords'        - Search forum for keywords"
    echo "  github-issues [labels]   - Get n8n GitHub issues"
    echo "  template-ideas           - Find template opportunities"
    echo "  feature-requests         - Get feature requests from GitHub"
    echo ""
    echo "Examples:"
    echo "  n8n-monitor.sh unanswered 'api,webhook'"
    echo "  n8n-monitor.sh search 'vps,docker,self-host'"
    echo "  n8n-monitor.sh github-issues 'bug,help wanted'"
    echo "  n8n-monitor.sh template-ideas"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/n8n-monitor.sh
```

### 4. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## n8n Community Monitoring

Monitor n8n community for opportunities:

**Find unanswered posts:**
```bash
/workspace/project/container/tools/n8n-monitor.sh unanswered "api,vps"
```

**Search forum:**
```bash
/workspace/project/container/tools/n8n-monitor.sh search "docker,self-host"
```

**Check GitHub issues:**
```bash
/workspace/project/container/tools/n8n-monitor.sh github-issues "bug,help wanted"
```

**Find template ideas:**
```bash
/workspace/project/container/tools/n8n-monitor.sh template-ideas
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
const { getUnansweredPosts } = require('./dist/n8n-helper.js');
getUnansweredPosts().then(posts => {
  console.log('Unanswered posts:', posts.length);
  if (posts.length > 0) console.log('First:', posts[0].title);
}).catch(err => console.error(err));
"
```

Test from WhatsApp:

```
@Andy check n8n forum for unanswered questions about VPS or self-hosting

@Andy find n8n GitHub issues I could help with
```

---

## Scheduled Monitoring Tasks

### Daily Forum Check (Reputation Building)

```
@Andy every day at 10am, check n8n forum for unanswered posts from the past 24 hours about VPS, Docker, self-hosting, API, or security. Score each 1-10 for my expertise. Send me top 3 (score 8+) with draft responses so I can help and build credibility.
```

### Weekly GitHub Contribution Opportunities

```
@Andy every Monday at 9am, check n8n GitHub for issues tagged "help wanted" or "good first issue" related to Docker, API, security, or Python. Send me top 5 where I could contribute and potentially get consulting work.
```

### Template Opportunity Scanner

```
@Andy every 2 weeks, analyze n8n forum for popular unsolved problems (high views, multiple replies, not solved). These are template opportunities. Send me top 5 with descriptions of what template would solve them.
```

### Feature Request Monitor

```
@Andy every week, check n8n GitHub feature requests. Find ones related to self-hosting, VPS, security, or advanced workflows. Send me interesting ones where I could: offer to implement it, provide consulting, or influence the direction.
```

---

## Reputation Building Strategy

### Week 1-2: Answer Easy Questions

```
@Andy find 5-10 simple unanswered n8n forum questions I can answer quickly (score 6-7). Help me build initial reputation and forum karma.
```

### Week 3-4: Tackle Complex Problems

```
@Andy find complex n8n questions about VPS/Docker/self-hosting (score 8-10). These showcase my expertise and are more likely to lead to consulting opportunities.
```

### Month 2+: Thought Leadership

- Create n8n templates from popular problems
- Write detailed forum answers (become known expert)
- Contribute to GitHub (get your name in contributors)
- Share advanced workflows in #show-and-tell

---

## Template Creation Workflow

When Andy finds a template opportunity:

1. **Validate demand:** Check views/replies (30+ views, 3+ replies)
2. **Build template:** Create workflow solving the problem
3. **Document it:** Clear README, setup instructions
4. **Share it:**
   - Post on n8n forum with solution
   - Submit to n8n workflow library
   - Share on LinkedIn/Twitter
5. **Monitor usage:** Track downloads/feedback
6. **Iterate:** Update based on feedback

This builds:
- Reputation in n8n community
- Portfolio of work
- Inbound consulting leads
- Passive visibility

---

## Success Criteria

✅ Can monitor n8n forum
✅ Can find unanswered posts
✅ Can check GitHub issues
✅ Scoring system working
✅ Template opportunities identified
✅ Scheduled monitoring active

---

## Pro Tips

### Best Times to Answer

- **Early morning (6-9am):** People post questions overnight
- **Lunch (12-2pm):** People check forums at lunch
- **Evening (6-8pm):** After-work forum activity

Answer within first few hours for maximum visibility!

### Answer Quality

**Bad Answer:**
"Try using the HTTP Request node."

**Good Answer:**
"Here's how to do this:

1. Use HTTP Request node with these settings:
   - Method: POST
   - URL: [endpoint]
   - Authentication: Bearer token

2. Set the body to:
   ```json
   {relevant JSON}
   ```

3. Handle the response with...

I've used this exact pattern in my own workflows for [similar use case]. Let me know if you run into any issues!

[Optional: Screenshot or workflow screenshot]"

### Build Reputation Fast

1. **Answer consistently:** 1-2 answers per day
2. **Be thorough:** Show code/screenshots
3. **Follow up:** Check back if OP has questions
4. **Share workflows:** Visual examples help
5. **Be friendly:** Community first, consulting second

---

Tell the user:

> n8n Community monitoring is ready! 🎉
>
> Andy will help you become known as an n8n expert by:
> - Finding questions you can answer
> - Identifying consulting opportunities
> - Suggesting template ideas
> - Tracking GitHub contributions
>
> Answer 1-2 questions per day and you'll be seen as an expert within a month!
