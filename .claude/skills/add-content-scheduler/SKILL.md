---
name: add-content-scheduler
description: Automated content scheduling for LinkedIn and Twitter. Andy drafts posts about your projects, schedules them for optimal times, and helps you stay visible to potential clients. Build your brand while you work.
---

# Add Content Scheduler

Automate your marketing presence on LinkedIn and Twitter. Andy drafts posts, schedules them, and keeps you visible to potential clients without constant manual posting.

## What It Does

**Content Generation:**
- Draft posts from project work
- Share technical insights
- Announce milestones
- Engage with trends

**Smart Scheduling:**
- Optimal posting times
- Consistent cadence
- No overwhelm
- Platform-specific optimization

**Engagement Tracking:**
- Monitor performance
- Learn what works
- Suggest improvements
- Build following

---

## Strategy

### LinkedIn (Professional)

**Post Types:**
1. **Project Updates** - "Just deployed automation that..."
2. **Technical Tips** - "3 ways to optimize n8n workflows"
3. **Lessons Learned** - "What I learned building..."
4. **Milestone Celebrations** - "Hit 100 stars on GitHub!"
5. **Helpful Answers** - Share n8n forum solutions

**Frequency:** 3-4 posts per week
**Best Times:** Tue-Thu, 9-11am or 12-2pm

### Twitter/X (Technical Community)

**Post Types:**
1. **Quick Tips** - Short automation hacks
2. **Code Snippets** - Useful n8n patterns
3. **Thread Breakdowns** - Technical deep dives
4. **Engagement** - Reply to automation discussions
5. **Portfolio Showcases** - Screenshots/demos

**Frequency:** 5-7 posts per week
**Best Times:** Weekdays 8-10am, 5-7pm

---

## Installation

### 1. Content Strategy Setup

```bash
mkdir -p ~/.nanoclaw-content
chmod 700 ~/.nanoclaw-content

cat > ~/.nanoclaw-content/strategy.json << 'EOF'
{
  "linkedin": {
    "enabled": true,
    "postsPerWeek": 3,
    "bestTimes": ["Tuesday 10:00", "Wednesday 13:00", "Thursday 10:00"],
    "topics": [
      "n8n automation",
      "API integration",
      "VPS deployment",
      "workflow optimization",
      "security automation"
    ],
    "tone": "professional-conversational",
    "hashtagLimit": 3
  },
  "twitter": {
    "enabled": true,
    "postsPerWeek": 5,
    "bestTimes": ["Weekdays 09:00", "Weekdays 17:00"],
    "topics": [
      "automation tips",
      "n8n patterns",
      "API tricks",
      "developer tools"
    ],
    "tone": "technical-friendly",
    "hashtagLimit": 2
  },
  "contentSources": [
    "GitHub commits",
    "n8n forum answers",
    "Project milestones",
    "Technical learnings",
    "Industry trends"
  ]
}
EOF
```

### 2. Install Dependencies

Already have Anthropic SDK from proposal generator!

```bash
cd /Users/tyler/dev/nanoclaw
# npm install @anthropic-ai/sdk (already installed)
```

### 3. Content Templates

```bash
cat > ~/.nanoclaw-content/templates.json << 'EOF'
{
  "linkedin": {
    "project_update": "Just finished building {project}. Key features: {features}. Built with {tech}. {learning}",
    "tip": "Pro tip for {topic}: {tip}. This saved me {time} on recent projects. #automation #{hashtag}",
    "milestone": "Excited to share: {achievement}! {context} Thanks to everyone who {acknowledgment}. #{hashtag}",
    "lesson": "What I learned {doing_what}: {lesson}. {detail} Would love to hear how others approach this. #{hashtag}"
  },
  "twitter": {
    "quick_tip": "{emoji} Quick n8n tip: {tip}\n\n{code_or_detail}\n\n#{hashtag1} #{hashtag2}",
    "thread_starter": "Let me show you how to {what} with {tool}:\n\n{hook}\n\n🧵 Thread 👇",
    "showcase": "Built {what} using {tech}:\n\n{features}\n\n{result}\n\n#{hashtag1} #{hashtag2}"
  }
}
EOF
```

---

## Implementation

### 4. Create Content Scheduler Helper

```typescript
// src/content-scheduler.ts
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface ContentStrategy {
  linkedin: {
    enabled: boolean;
    postsPerWeek: number;
    bestTimes: string[];
    topics: string[];
    tone: string;
    hashtagLimit: number;
  };
  twitter: {
    enabled: boolean;
    postsPerWeek: number;
    bestTimes: string[];
    topics: string[];
    tone: string;
    hashtagLimit: number;
  };
  contentSources: string[];
}

interface GeneratedPost {
  platform: 'linkedin' | 'twitter';
  content: string;
  hashtags: string[];
  scheduledTime?: string;
  category: string;
}

function loadStrategy(): ContentStrategy {
  const strategyPath = path.join(os.homedir(), '.nanoclaw-content', 'strategy.json');
  return JSON.parse(fs.readFileSync(strategyPath, 'utf-8'));
}

function loadAnthropicConfig() {
  const configPath = path.join(os.homedir(), '.nanoclaw-proposals', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Generate LinkedIn post from project update
 */
export async function generateLinkedInPost(
  context: {
    projectName?: string;
    achievement?: string;
    learning?: string;
    topic?: string;
  },
  type: 'project_update' | 'tip' | 'milestone' | 'lesson' = 'project_update'
): Promise<GeneratedPost> {
  const config = loadAnthropicConfig();
  const strategy = loadStrategy();
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `Generate a LinkedIn post for a freelance automation specialist.

CONTEXT:
${context.projectName ? `Project: ${context.projectName}` : ''}
${context.achievement ? `Achievement: ${context.achievement}` : ''}
${context.learning ? `Learning: ${context.learning}` : ''}
${context.topic ? `Topic: ${context.topic}` : ''}

REQUIREMENTS:
- Tone: ${strategy.linkedin.tone}
- Length: 100-200 words
- Include: Hook, value/insight, call-to-action
- Type: ${type}
- Hashtags: ${strategy.linkedin.hashtagLimit} max, relevant to: ${strategy.linkedin.topics.join(', ')}

Format as JSON:
{
  "content": "The post text without hashtags",
  "hashtags": ["hashtag1", "hashtag2"],
  "category": "project_update|tip|milestone|lesson"
}`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response');

  const result = JSON.parse(content.text);

  return {
    platform: 'linkedin',
    content: result.content,
    hashtags: result.hashtags,
    category: result.category,
  };
}

/**
 * Generate Twitter thread
 */
export async function generateTwitterThread(
  topic: string,
  tweets: number = 3
): Promise<GeneratedPost[]> {
  const config = loadAnthropicConfig();
  const strategy = loadStrategy();
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `Create a ${tweets}-tweet thread about: ${topic}

STYLE: ${strategy.twitter.tone}
TOPICS: ${strategy.twitter.topics.join(', ')}

Each tweet:
- 280 characters max
- Technical but accessible
- Actionable insights
- Hashtags: ${strategy.twitter.hashtagLimit} max

Format as JSON array:
[
  {"content": "Tweet 1...", "hashtags": ["hashtag1"], "category": "thread"},
  {"content": "Tweet 2...", "hashtags": [], "category": "thread"},
  ...
]`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response');

  const results = JSON.parse(content.text);

  return results.map((r: any) => ({
    platform: 'twitter',
    content: r.content,
    hashtags: r.hashtags,
    category: r.category,
  }));
}

/**
 * Generate quick tip
 */
export async function generateQuickTip(
  tool: string = 'n8n',
  topic?: string
): Promise<GeneratedPost> {
  const config = loadAnthropicConfig();
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `Generate a quick automation tip about ${tool}${topic ? ` related to ${topic}` : ''}.

Keep it:
- Short (1-2 sentences + example)
- Actionable
- Useful for practitioners

Format as JSON:
{"content": "Tip text", "hashtags": ["relevant", "hashtags"], "category": "tip"}`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response');

  const result = JSON.parse(content.text);

  return {
    platform: 'twitter',
    content: result.content,
    hashtags: result.hashtags,
    category: result.category,
  };
}

/**
 * Generate week's content calendar
 */
export async function generateWeeklyCalendar(): Promise<GeneratedPost[]> {
  const strategy = loadStrategy();
  const calendar: GeneratedPost[] = [];

  // LinkedIn posts
  for (let i = 0; i < strategy.linkedin.postsPerWeek; i++) {
    const post = await generateLinkedInPost(
      {
        topic: strategy.linkedin.topics[i % strategy.linkedin.topics.length],
      },
      ['project_update', 'tip', 'lesson'][i % 3] as any
    );

    post.scheduledTime = strategy.linkedin.bestTimes[i % strategy.linkedin.bestTimes.length];
    calendar.push(post);
  }

  // Twitter posts
  for (let i = 0; i < strategy.twitter.postsPerWeek; i++) {
    const post = await generateQuickTip('n8n', strategy.twitter.topics[i % strategy.twitter.topics.length]);

    post.scheduledTime = strategy.twitter.bestTimes[i % strategy.twitter.bestTimes.length];
    calendar.push(post);
  }

  return calendar;
}

/**
 * Format for WhatsApp review
 */
export function formatContentCalendar(posts: GeneratedPost[]): string {
  let output = '*WEEKLY CONTENT CALENDAR*\\n\\n';

  const byPlatform = posts.reduce((acc, post) => {
    if (!acc[post.platform]) acc[post.platform] = [];
    acc[post.platform].push(post);
    return acc;
  }, {} as { [key: string]: GeneratedPost[] });

  for (const [platform, platformPosts] of Object.entries(byPlatform)) {
    output += `*${platform.toUpperCase()}*\\n`;

    platformPosts.forEach((post, i) => {
      output += `\\n${i + 1}. [${post.category}] ${post.scheduledTime || 'Unscheduled'}\\n`;
      output += `${post.content.substring(0, 150)}${post.content.length > 150 ? '...' : ''}\\n`;
      output += `${post.hashtags.map(h => '#' + h).join(' ')}\\n`;
    });

    output += '\\n---\\n\\n';
  }

  return output;
}

/**
 * Save approved post to queue
 */
export function saveToQueue(post: GeneratedPost): void {
  const queueDir = path.join(os.homedir(), '.nanoclaw-content', 'queue');
  fs.mkdirSync(queueDir, { recursive: true });

  const timestamp = Date.now();
  const filename = `${post.platform}-${timestamp}.json`;
  const filepath = path.join(queueDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(post, null, 2));
}
```

Save to `src/content-scheduler.ts`.

---

## Usage Examples

### Generate LinkedIn Post

```
@Andy I just finished the BeastMode VPS update. Write a LinkedIn post about it highlighting the new features and security improvements.
```

### Weekly Content Plan

```
@Andy generate my content calendar for next week - mix of LinkedIn and Twitter posts about n8n, automation, and my projects
```

### Quick Twitter Tip

```
@Andy write a quick Twitter tip about n8n workflow optimization
```

### Thread on Technical Topic

```
@Andy create a 5-tweet thread explaining how to self-host n8n on a VPS
```

---

## Posting Workflow

### Review & Approve

Andy generates → You review → Approve → Andy saves to queue

### Manual Posting (For Now)

1. Andy sends you the post
2. You copy & paste to LinkedIn/Twitter
3. Post at suggested time

### Future: Automation

- LinkedIn API (requires company page)
- Twitter API (requires approval)
- Buffer/Hootsuite integration

---

## Content Ideas Andy Can Generate

**From Your Work:**
- "Just automated X using n8n..."
- "Deployed VPS with Y features..."
- "Solved interesting problem with Z..."

**Educational:**
- "3 ways to optimize n8n workflows"
- "How to secure your VPS"
- "API integration patterns"

**Engagement:**
- "What's your biggest automation challenge?"
- "Show me your n8n workflows"
- "Who else is building with automation?"

**Milestone Celebrations:**
- GitHub stars reached
- Project completed
- Client testimonial
- New skill learned

---

## Success Criteria

✅ Content strategy configured
✅ Can generate LinkedIn posts
✅ Can generate Twitter threads
✅ Can create weekly calendars
✅ Posts sound natural/authentic
✅ Consistent brand voice

---

## Benefits

**Visibility:** Stay top-of-mind for potential clients
**Authority:** Position yourself as n8n expert
**Inbound Leads:** Clients reach out directly
**Network Growth:** Build following organically
**Portfolio Showcase:** Share your work naturally

**Time Investment:** 30 min/week to review and post
**Result:** Consistent professional presence

---

Tell the user:

> Content Scheduler ready! 🎉
>
> Andy will help you maintain consistent presence on LinkedIn and Twitter.
>
> Benefits:
> - 30 min/week instead of hours
> - Consistent professional brand
> - Attract inbound leads
> - Build authority in n8n space
>
> Andy generates, you review and post. Simple!
