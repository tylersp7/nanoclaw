---
name: add-linkedin-monitor
description: Monitor LinkedIn for job postings, connection activity, and professional opportunities. Uses browser automation to search jobs, track connections, and engage with potential clients. Highest-quality B2B leads.
---

# Add LinkedIn Monitor for Professional Lead Generation

This skill adds LinkedIn monitoring for high-quality B2B clients and professional opportunities. Uses browser automation via Playwright for reliable access.

## What It Monitors

**Job Search:**
- Jobs matching your skills (n8n, automation, API)
- Remote/contract positions
- Filter by company size, budget indicators
- "Easy Apply" opportunities

**Network Activity:**
- Connections posting about needing help
- "Who's Hiring" posts in groups
- Relevant hashtag activity (#n8n, #automation)
- Connection requests from potential clients

**Company Intelligence:**
- Companies hiring for automation roles
- Startups needing contractors
- Growth-stage companies

---

## Installation

### 1. Install Browser Automation

```bash
cd /Users/tyler/dev/nanoclaw
npm install playwright
npx playwright install chromium
```

### 2. LinkedIn Session Setup

**USER ACTION REQUIRED**

Tell the user:

> LinkedIn doesn't have a public API, so we'll use browser automation. This is safe and mimics how you'd manually browse LinkedIn.
>
> I need you to log in to LinkedIn once so we can save your session:
>
> 1. I'll open a browser window
> 2. Log in to LinkedIn normally
> 3. Your session will be saved securely
> 4. Future checks will reuse this session (no repeated logins)

### 3. Create Config Directory

```bash
mkdir -p ~/.nanoclaw-linkedin
chmod 700 ~/.nanoclaw-linkedin
```

### 4. Initial Session Capture

We'll create a script to capture the session:

```bash
cat > /Users/tyler/dev/nanoclaw/scripts/linkedin-session-setup.js << 'EOF'
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function setupLinkedInSession() {
  console.log('Opening browser for LinkedIn login...');

  const browser = await chromium.launch({
    headless: false, // Visible so you can log in
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.linkedin.com/feed/');

  console.log('\n=================================');
  console.log('Please log in to LinkedIn now...');
  console.log('After logging in, press Enter here');
  console.log('=================================\n');

  // Wait for user to press Enter
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  // Save session
  const sessionDir = path.join(os.homedir(), '.nanoclaw-linkedin');
  const sessionFile = path.join(sessionDir, 'session.json');

  const cookies = await context.cookies();
  const session = {
    cookies,
    userAgent: await page.evaluate(() => navigator.userAgent),
    savedAt: new Date().toISOString(),
  };

  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  fs.chmodSync(sessionFile, 0o600);

  console.log('\n✅ Session saved to:', sessionFile);
  console.log('You can now close the browser.\n');

  await browser.close();
}

setupLinkedInSession().catch(console.error);
EOF

chmod +x /Users/tyler/dev/nanoclaw/scripts/linkedin-session-setup.js
```

Run the setup:

```bash
cd /Users/tyler/dev/nanoclaw
node scripts/linkedin-session-setup.js
```

---

### 5. Create LinkedIn Helper Module

```typescript
// src/linkedin-helper.ts
import { chromium, Browser, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface LinkedInSession {
  cookies: any[];
  userAgent: string;
  savedAt: string;
}

let browserInstance: Browser | null = null;

async function loadSession(): Promise<LinkedInSession> {
  const sessionFile = path.join(os.homedir(), '.nanoclaw-linkedin', 'session.json');

  if (!fs.existsSync(sessionFile)) {
    throw new Error('LinkedIn session not found. Run: node scripts/linkedin-session-setup.js');
  }

  return JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance) return browserInstance;

  const session = await loadSession();

  browserInstance = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  return browserInstance;
}

async function createPage(): Promise<Page> {
  const browser = await getBrowser();
  const session = await loadSession();

  const context = await browser.newContext({
    userAgent: session.userAgent,
  });

  await context.addCookies(session.cookies);

  const page = await context.newPage();
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export interface LinkedInJob {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedDate: string;
  easyApply: boolean;
  remote: boolean;
  relevanceScore?: number;
}

export interface LinkedInPost {
  id: string;
  author: string;
  authorTitle: string;
  content: string;
  url: string;
  postedAt: string;
  engagement: {
    likes: number;
    comments: number;
  };
}

/**
 * Search LinkedIn jobs
 */
export async function searchJobs(
  keywords: string,
  location: string = 'Remote',
  datePosted: string = 'past-week'
): Promise<LinkedInJob[]> {
  const page = await createPage();

  try {
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=${datePosted}&f_WT=2`; // f_WT=2 is remote filter

    await page.goto(searchUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const jobs: LinkedInJob[] = [];

    // Scroll to load more jobs
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1000);
    }

    // Extract job listings
    const jobElements = await page.$$('.job-card-container');

    for (const jobEl of jobElements.slice(0, 25)) {
      try {
        const title = await jobEl.$eval('.job-card-list__title', el => el.textContent?.trim() || '');
        const company = await jobEl.$eval('.job-card-container__company-name', el => el.textContent?.trim() || '');
        const location = await jobEl.$eval('.job-card-container__metadata-item', el => el.textContent?.trim() || '');
        const jobId = await jobEl.$eval('a', el => el.getAttribute('data-job-id') || '');
        const url = `https://www.linkedin.com/jobs/view/${jobId}`;

        // Check if Easy Apply
        const easyApply = await jobEl.$('.job-card-container__apply-method')
          .then(el => el?.textContent().then(text => text?.includes('Easy Apply')))
          .catch(() => false) || false;

        jobs.push({
          id: jobId,
          title,
          company,
          location,
          description: '', // Requires clicking into job
          url,
          postedDate: 'recent',
          easyApply,
          remote: location.toLowerCase().includes('remote'),
        });
      } catch (error) {
        // Skip jobs with parsing errors
        continue;
      }
    }

    return jobs;
  } finally {
    await page.close();
  }
}

/**
 * Get job details (full description)
 */
export async function getJobDetails(jobUrl: string): Promise<string> {
  const page = await createPage();

  try {
    await page.goto(jobUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const description = await page.$eval(
      '.jobs-description__content',
      el => el.textContent?.trim() || ''
    ).catch(() => '');

    return description;
  } finally {
    await page.close();
  }
}

/**
 * Search posts by hashtag
 */
export async function searchHashtag(
  hashtag: string,
  limit: number = 20
): Promise<LinkedInPost[]> {
  const page = await createPage();

  try {
    const url = `https://www.linkedin.com/feed/hashtag/${hashtag}/`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const posts: LinkedInPost[] = [];

    // Scroll to load posts
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1500);
    }

    const postElements = await page.$$('.feed-shared-update-v2');

    for (const postEl of postElements.slice(0, limit)) {
      try {
        const author = await postEl.$eval('.feed-shared-actor__name', el => el.textContent?.trim() || '');
        const authorTitle = await postEl.$eval('.feed-shared-actor__description', el => el.textContent?.trim() || '');
        const content = await postEl.$eval('.feed-shared-text', el => el.textContent?.trim() || '');
        const postUrl = await postEl.$eval('a.app-aware-link', el => el.getAttribute('href') || '');

        const likes = await postEl.$eval('.social-details-social-counts__reactions-count', el =>
          parseInt(el.textContent?.replace(/\D/g, '') || '0')
        ).catch(() => 0);

        const comments = await postEl.$eval('.social-details-social-counts__comments', el =>
          parseInt(el.textContent?.replace(/\D/g, '') || '0')
        ).catch(() => 0);

        posts.push({
          id: postUrl.split('/').pop() || '',
          author,
          authorTitle,
          content,
          url: postUrl,
          postedAt: 'recent',
          engagement: { likes, comments },
        });
      } catch (error) {
        continue;
      }
    }

    return posts;
  } finally {
    await page.close();
  }
}

/**
 * Get your connections' recent posts
 */
export async function getConnectionPosts(limit: number = 10): Promise<LinkedInPost[]> {
  const page = await createPage();

  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const posts: LinkedInPost[] = [];

    // Scroll feed
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
    }

    const postElements = await page.$$('.feed-shared-update-v2');

    for (const postEl of postElements.slice(0, limit)) {
      try {
        const author = await postEl.$eval('.feed-shared-actor__name', el => el.textContent?.trim() || '');
        const authorTitle = await postEl.$eval('.feed-shared-actor__description', el => el.textContent?.trim() || '');
        const content = await postEl.$eval('.feed-shared-text', el => el.textContent?.trim() || '').catch(() => '');

        posts.push({
          id: Date.now().toString(),
          author,
          authorTitle,
          content,
          url: 'https://www.linkedin.com/feed/',
          postedAt: 'recent',
          engagement: { likes: 0, comments: 0 },
        });
      } catch (error) {
        continue;
      }
    }

    return posts;
  } finally {
    await page.close();
  }
}

/**
 * Score a LinkedIn job for relevance
 */
export function scoreJob(job: LinkedInJob, userSkills: string[]): number {
  let score = 5;

  const text = `${job.title} ${job.description} ${job.company}`.toLowerCase();

  // Easy Apply is valuable
  if (job.easyApply) score += 2;

  // Remote is preferred
  if (job.remote) score += 2;

  // Check for skill matches
  const matches = userSkills.filter(skill => text.includes(skill.toLowerCase())).length;
  score += Math.min(matches, 3);

  // Check for high-value indicators
  if (text.includes('senior') || text.includes('lead')) score += 1;
  if (text.includes('contract') || text.includes('freelance')) score += 1;
  if (text.includes('automation') || text.includes('n8n')) score += 2;

  // Check for red flags
  if (text.includes('unpaid') || text.includes('intern')) score -= 3;

  return Math.max(1, Math.min(10, score));
}

/**
 * Format jobs for WhatsApp
 */
export function formatJobsForWhatsApp(
  jobs: Array<LinkedInJob & { relevanceScore?: number }>
): string {
  if (jobs.length === 0) return 'No jobs found.';

  return jobs
    .slice(0, 10)
    .map((job, i) => {
      const scoreStr = job.relevanceScore ? ` [Score: ${job.relevanceScore}/10]` : '';
      const easyApply = job.easyApply ? ' 🟢 Easy Apply' : '';
      const remote = job.remote ? ' 🌍 Remote' : '';

      return `${i + 1}. *${job.title}*${scoreStr}${easyApply}${remote}
${job.company} • ${job.location}

${job.description ? job.description.substring(0, 200) : 'Click link for details'}${job.description && job.description.length > 200 ? '...' : ''}

🔗 ${job.url}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format posts for WhatsApp
 */
export function formatPostsForWhatsApp(posts: LinkedInPost[]): string {
  if (posts.length === 0) return 'No posts found.';

  return posts
    .slice(0, 10)
    .map((post, i) => {
      return `${i + 1}. *${post.author}*
${post.authorTitle}

${post.content.substring(0, 250)}${post.content.length > 250 ? '...' : ''}

👍 ${post.engagement.likes} • 💬 ${post.engagement.comments}

🔗 ${post.url}`;
    })
    .join('\n\n---\n\n');
}
```

Save to `src/linkedin-helper.ts`.

### 6. Create CLI Tool

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/linkedin-monitor.sh << 'EOF'
#!/bin/bash
# LinkedIn monitoring tool

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,workflow,Python,JavaScript,VPS,security,integration"

case "$1" in
  search-jobs)
    KEYWORDS="${2:-automation n8n}"
    MIN_SCORE="${3:-7}"
    node -e "
    const { searchJobs, scoreJob, formatJobsForWhatsApp, closeBrowser } = require('$NANOCLAW_DIR/dist/linkedin-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    searchJobs('$KEYWORDS', 'Remote', 'past-week').then(jobs => {
      const scored = jobs.map(job => ({
        ...job,
        relevanceScore: scoreJob(job, skills)
      })).filter(j => j.relevanceScore >= $MIN_SCORE).sort((a, b) => b.relevanceScore - a.relevanceScore);

      if (scored.length === 0) {
        console.log('No high-scoring jobs found.');
      } else {
        console.log(\`Found \${scored.length} relevant jobs (score >= $MIN_SCORE/10):\\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }

      return closeBrowser();
    }).catch(err => {
      console.error('Error:', err.message);
      return closeBrowser();
    });
    "
    ;;

  hashtag)
    TAG="$2"
    if [ -z "$TAG" ]; then
      echo "Usage: linkedin-monitor.sh hashtag <tag>"
      exit 1
    fi
    node -e "
    const { searchHashtag, formatPostsForWhatsApp, closeBrowser } = require('$NANOCLAW_DIR/dist/linkedin-helper.js');

    searchHashtag('$TAG', 20).then(posts => {
      console.log(\`Posts with #$TAG:\\n\`);
      console.log(formatPostsForWhatsApp(posts));
      return closeBrowser();
    }).catch(err => {
      console.error('Error:', err.message);
      return closeBrowser();
    });
    "
    ;;

  feed)
    node -e "
    const { getConnectionPosts, formatPostsForWhatsApp, closeBrowser } = require('$NANOCLAW_DIR/dist/linkedin-helper.js');

    getConnectionPosts(10).then(posts => {
      console.log('Recent posts from your network:\\n');
      console.log(formatPostsForWhatsApp(posts));
      return closeBrowser();
    }).catch(err => {
      console.error('Error:', err.message);
      return closeBrowser();
    });
    "
    ;;

  *)
    echo "Usage: linkedin-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  search-jobs [keywords] [min_score]  - Search for jobs"
    echo "  hashtag <tag>                       - Search hashtag posts"
    echo "  feed                                - Check your feed"
    echo ""
    echo "Examples:"
    echo "  linkedin-monitor.sh search-jobs 'n8n automation' 7"
    echo "  linkedin-monitor.sh hashtag n8n"
    echo "  linkedin-monitor.sh feed"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/linkedin-monitor.sh
```

### 7. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## LinkedIn Monitoring

Monitor LinkedIn for professional opportunities:

**Search jobs:**
```bash
/workspace/project/container/tools/linkedin-monitor.sh search-jobs "n8n automation" 7
```

**Monitor hashtag:**
```bash
/workspace/project/container/tools/linkedin-monitor.sh hashtag n8n
```

**Check feed:**
```bash
/workspace/project/container/tools/linkedin-monitor.sh feed
```
```

### 8. Rebuild

```bash
cd /Users/tyler/dev/nanoclaw
npm run build
./container/build.sh
```

---

## Verification

### Setup Session First

```bash
cd /Users/tyler/dev/nanoclaw
node scripts/linkedin-session-setup.js
```

Log in to LinkedIn when browser opens, then press Enter.

### Test from Terminal

```bash
cd /Users/tyler/dev/nanoclaw
node -e "
const { searchJobs } = require('./dist/linkedin-helper.js');
searchJobs('n8n automation', 'Remote', 'past-week').then(jobs => {
  console.log('Found', jobs.length, 'jobs');
  jobs.slice(0, 3).forEach(j => console.log('-', j.title, 'at', j.company));
}).catch(err => console.error(err));
"
```

### Test from WhatsApp

```
@Andy search LinkedIn for remote n8n automation jobs from the past week

@Andy check LinkedIn hashtag #n8n for recent posts

@Andy what's happening in my LinkedIn feed?
```

---

## Scheduled Monitoring Tasks

### Daily Job Search

```
@Andy every day at 9am, search LinkedIn for remote jobs matching: n8n, automation, workflow, API integration. Score each 1-10. Send me jobs scored 8+ with Easy Apply priority.
```

### Hashtag Monitoring

```
@Andy every day at 11am, check LinkedIn hashtags: #n8n, #automation, #workflows, #freelance. Find posts where people are asking for help or posting about hiring. Send me relevant opportunities.
```

### Weekly Job Digest

```
@Andy every Monday at 8am, search LinkedIn for all remote automation/n8n jobs from the past week. Send me top 15 matches sorted by score with company info and direct links.
```

### Connection Activity

```
@Andy every day at 5pm, check my LinkedIn feed for connections posting about needing help with automation, workflows, APIs, or technical projects. Alert me to opportunities where I can offer consulting.
```

---

## Pro Tips

### Optimize Your Profile First

Before monitoring, make sure your LinkedIn profile says:

**Headline:**
"n8n Automation Specialist | Workflow Automation | API Integration | VPS & Security"

**About:**
"I help businesses eliminate repetitive tasks through workflow automation. Built production systems including automated bug bounty platform (Python, 40+ modules) and AI content pipeline (n8n-style architecture).

Specialties: n8n workflows, API integration, VPS deployment, process automation, security automation."

### Best Job Keywords

- "n8n automation"
- "workflow automation engineer"
- "API integration specialist"
- "automation consultant"
- "process automation"

### Response Time Matters

- Apply within 2 hours for Easy Apply
- Apply within 24 hours for other jobs
- Be one of first 10 applicants

### Session Maintenance

LinkedIn sessions last ~30 days. If you get logged out:

```bash
cd ~/dev/nanoclaw
node scripts/linkedin-session-setup.js
```

---

## Success Criteria

✅ LinkedIn session saved
✅ Can search jobs
✅ Can monitor hashtags
✅ Can check feed
✅ Scoring working
✅ Scheduled tasks set up

---

## Security Notes

- Session stored locally (never leaves your machine)
- Browser runs in headless mode (invisible)
- Mimics normal browsing (safe, not scraping)
- No API violations (uses actual browser)
- 2-3 second delays between actions (polite)

---

Tell the user:

> LinkedIn monitoring is ready! 🎉
>
> This is your highest-quality lead source. LinkedIn jobs typically have:
> - Better budgets ($75-150/hr vs $30-50 on job boards)
> - More professional clients
> - Clearer requirements
> - Better response rates
>
> Run the session setup, then Andy will monitor LinkedIn 24/7 for you!
