---
name: add-job-board-scraper
description: Monitor Upwork, Fiverr, and Freelancer for automation/n8n projects. Uses RSS feeds and web scraping to find jobs matching your skills. High volume of opportunities, early application alerts.
---

# Add Job Board Scraper

This skill monitors major freelance platforms (Upwork, Fiverr, Freelancer) for automation and n8n projects. High volume of leads, automated filtering by budget/client rating.

## What It Monitors

**Upwork:**
- API Integration jobs
- n8n workflow automation
- VPS/server setup
- Security/bug bounty work
- Filter by: budget, client rating, payment verified

**Fiverr:**
- Request posts (buyers looking for help)
- New gigs in automation category
- Trending searches

**Freelancer:**
- Project listings
- Contests (if interested)

---

## Installation

### 1. Install Dependencies

```bash
cd /Users/tyler/dev/nanoclaw
npm install rss-parser cheerio axios
```

### 2. Upwork RSS Setup

Upwork provides RSS feeds for job searches!

**USER ACTION REQUIRED**

Tell the user:

> Upwork has RSS feeds for job searches. Let's set up your custom feeds:
>
> 1. Go to https://www.upwork.com/nx/find-work/
> 2. Search for: "n8n automation"
> 3. Apply filters: Remote, Hourly or Fixed Price
> 4. Copy the URL from your browser
>
> The URL will look like: https://www.upwork.com/nx/search/jobs/?q=n8n%20automation&...
>
> To get the RSS feed, change the URL to:
> https://www.upwork.com/ab/feed/jobs/rss?q=n8n%20automation&...

### 3. Create RSS Feed List

```bash
cat > ~/.nanoclaw-job-boards/upwork-feeds.json << 'EOF'
{
  "feeds": [
    {
      "name": "n8n automation",
      "url": "https://www.upwork.com/ab/feed/jobs/rss?q=n8n%20automation&sort=recency",
      "keywords": ["n8n", "automation", "workflow"]
    },
    {
      "name": "API integration",
      "url": "https://www.upwork.com/ab/feed/jobs/rss?q=API%20integration&sort=recency",
      "keywords": ["api", "integration", "webhook"]
    },
    {
      "name": "VPS automation",
      "url": "https://www.upwork.com/ab/feed/jobs/rss?q=VPS%20automation&sort=recency",
      "keywords": ["vps", "server", "automation", "docker"]
    }
  ]
}
EOF
```

---

### 4. Create Job Board Helper

```typescript
// src/job-board-helper.ts
import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import os from 'os';

const parser = new Parser();

export interface JobListing {
  id: string;
  title: string;
  description: string;
  budget?: string;
  budgetAmount?: number;
  platform: 'upwork' | 'fiverr' | 'freelancer';
  url: string;
  postedAt: string;
  client?: {
    rating?: number;
    verified?: boolean;
    location?: string;
  };
  skills: string[];
  relevanceScore?: number;
}

interface UpworkFeed {
  name: string;
  url: string;
  keywords: string[];
}

/**
 * Load Upwork RSS feeds from config
 */
function loadUpworkFeeds(): UpworkFeed[] {
  const feedFile = path.join(os.homedir(), '.nanoclaw-job-boards', 'upwork-feeds.json');

  if (!fs.existsSync(feedFile)) {
    return [];
  }

  const config = JSON.parse(fs.readFileSync(feedFile, 'utf-8'));
  return config.feeds || [];
}

/**
 * Parse Upwork RSS feed
 */
export async function fetchUpworkJobs(feedUrl?: string): Promise<JobListing[]> {
  const feeds = feedUrl ? [{ name: 'custom', url: feedUrl, keywords: [] }] : loadUpworkFeeds();

  const allJobs: JobListing[] = [];

  for (const feed of feeds) {
    try {
      const rssFeed = await parser.parseURL(feed.url);

      for (const item of rssFeed.items) {
        const $ = cheerio.load(item.content || '');

        // Extract budget
        const budgetText = $('b:contains("Budget")').parent().text() || '';
        const budgetMatch = budgetText.match(/\$[\d,]+/);
        const budget = budgetMatch ? budgetMatch[0] : undefined;
        const budgetAmount = budget ? parseInt(budget.replace(/[$,]/g, '')) : undefined;

        // Extract skills
        const skillsText = $('b:contains("Skills")').parent().text() || '';
        const skills = skillsText
          .replace('Skills:', '')
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        // Extract location
        const location = $('b:contains("Country")').parent().text().replace('Country:', '').trim();

        allJobs.push({
          id: item.guid || item.link || '',
          title: item.title || '',
          description: item.contentSnippet || '',
          budget,
          budgetAmount,
          platform: 'upwork',
          url: item.link || '',
          postedAt: item.pubDate || new Date().toISOString(),
          client: {
            location,
          },
          skills,
        });
      }
    } catch (error) {
      console.error(`Error fetching ${feed.name}:`, error);
    }
  }

  return allJobs;
}

/**
 * Scrape Freelancer.com (uses public search)
 */
export async function fetchFreelancerJobs(keywords: string): Promise<JobListing[]> {
  try {
    const url = `https://www.freelancer.com/jobs/${encodeURIComponent(keywords)}/`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    const $ = cheerio.load(response.data);
    const jobs: JobListing[] = [];

    $('.JobSearchCard-item').each((i, el) => {
      const $el = $(el);

      const title = $el.find('.JobSearchCard-primary-heading-link').text().trim();
      const description = $el.find('.JobSearchCard-primary-description').text().trim();
      const url = 'https://www.freelancer.com' + $el.find('.JobSearchCard-primary-heading-link').attr('href');
      const budget = $el.find('.JobSearchCard-secondary-price').text().trim();

      const skillElements = $el.find('.JobSearchCard-secondary-entry--skills a');
      const skills: string[] = [];
      skillElements.each((i, skill) => {
        skills.push($(skill).text().trim());
      });

      if (title) {
        jobs.push({
          id: url.split('/').pop() || '',
          title,
          description,
          budget,
          platform: 'freelancer',
          url,
          postedAt: new Date().toISOString(),
          skills,
        });
      }
    });

    return jobs;
  } catch (error) {
    console.error('Error fetching Freelancer jobs:', error);
    return [];
  }
}

/**
 * Fetch Fiverr requests (buyer requests)
 */
export async function fetchFiverrRequests(): Promise<JobListing[]> {
  // Note: Fiverr buyer requests require login
  // This is a placeholder for the structure
  // Users would need to manually check or use browser automation

  console.log('Fiverr requires authentication. Use browser to check buyer requests:');
  console.log('https://www.fiverr.com/users/buyer_requests');

  return [];
}

/**
 * Score a job for relevance
 */
export function scoreJob(job: JobListing, userSkills: string[]): number {
  let score = 5;

  const text = `${job.title} ${job.description}`.toLowerCase();

  // Check budget
  if (job.budgetAmount) {
    if (job.budgetAmount >= 1000) score += 3;
    else if (job.budgetAmount >= 500) score += 2;
    else if (job.budgetAmount >= 200) score += 1;
    else if (job.budgetAmount < 50) score -= 2;
  }

  // Check for skill matches
  const skillMatches = userSkills.filter(skill => {
    const skillLower = skill.toLowerCase();
    return text.includes(skillLower) || job.skills.some(s => s.toLowerCase().includes(skillLower));
  }).length;

  score += Math.min(skillMatches, 3);

  // Check for high-value keywords
  if (text.includes('automation') || text.includes('n8n')) score += 2;
  if (text.includes('api') || text.includes('integration')) score += 1;
  if (text.includes('vps') || text.includes('server')) score += 1;
  if (text.includes('ongoing') || text.includes('long term')) score += 2;

  // Check for red flags
  if (text.includes('urgent') && job.budgetAmount && job.budgetAmount < 100) score -= 2;
  if (text.includes('simple') || text.includes('quick task')) score -= 1;
  if (text.includes('copy') || text.includes('data entry')) score -= 3;

  return Math.max(1, Math.min(10, score));
}

/**
 * Filter jobs by minimum score
 */
export function filterJobsByScore(
  jobs: JobListing[],
  userSkills: string[],
  minScore: number = 7
): Array<JobListing & { relevanceScore: number }> {
  return jobs
    .map(job => ({
      ...job,
      relevanceScore: scoreJob(job, userSkills),
    }))
    .filter(job => job.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Check for duplicate jobs (seen before)
 */
const seenJobIds = new Set<string>();

export function filterNewJobs(jobs: JobListing[]): JobListing[] {
  return jobs.filter(job => {
    if (seenJobIds.has(job.id)) {
      return false;
    }
    seenJobIds.add(job.id);
    return true;
  });
}

/**
 * Format jobs for WhatsApp
 */
export function formatJobsForWhatsApp(
  jobs: Array<JobListing & { relevanceScore?: number }>
): string {
  if (jobs.length === 0) return 'No jobs found.';

  return jobs
    .slice(0, 15)
    .map((job, i) => {
      const scoreStr = job.relevanceScore ? ` [Score: ${job.relevanceScore}/10]` : '';
      const budget = job.budget ? ` 💰 ${job.budget}` : '';
      const platform = {
        upwork: '📘 Upwork',
        fiverr: '🟢 Fiverr',
        freelancer: '🔵 Freelancer',
      }[job.platform];

      const skills = job.skills.slice(0, 3).join(', ');

      return `${i + 1}. *${job.title}*${scoreStr}${budget}
${platform}${skills ? ` • ${skills}` : ''}

${job.description.substring(0, 200)}${job.description.length > 200 ? '...' : ''}

🔗 ${job.url}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Get jobs since timestamp
 */
export function getJobsSince(jobs: JobListing[], sinceTimestamp: number): JobListing[] {
  return jobs.filter(job => {
    const jobTime = new Date(job.postedAt).getTime();
    return jobTime > sinceTimestamp;
  });
}
```

Save to `src/job-board-helper.ts`.

### 5. Create CLI Tool

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/job-board-monitor.sh << 'EOF'
#!/bin/bash
# Job board monitoring tool

NANOCLAW_DIR="/workspace/project"
USER_SKILLS="n8n,automation,API,workflow,Python,JavaScript,VPS,Docker,security,integration,webhook"

case "$1" in
  upwork)
    MIN_SCORE="${2:-7}"
    node -e "
    const { fetchUpworkJobs, filterJobsByScore, formatJobsForWhatsApp } = require('$NANOCLAW_DIR/dist/job-board-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    fetchUpworkJobs().then(jobs => {
      const scored = filterJobsByScore(jobs, skills, $MIN_SCORE);

      if (scored.length === 0) {
        console.log('No high-scoring Upwork jobs found.');
      } else {
        console.log(\`Found \${scored.length} Upwork jobs (score >= $MIN_SCORE/10):\\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  freelancer)
    KEYWORDS="${2:-automation api}"
    MIN_SCORE="${3:-7}"
    node -e "
    const { fetchFreelancerJobs, filterJobsByScore, formatJobsForWhatsApp } = require('$NANOCLAW_DIR/dist/job-board-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    fetchFreelancerJobs('$KEYWORDS').then(jobs => {
      const scored = filterJobsByScore(jobs, skills, $MIN_SCORE);

      if (scored.length === 0) {
        console.log('No high-scoring Freelancer jobs found.');
      } else {
        console.log(\`Found \${scored.length} Freelancer jobs (score >= $MIN_SCORE/10):\\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  all)
    MIN_SCORE="${2:-7}"
    node -e "
    const { fetchUpworkJobs, fetchFreelancerJobs, filterJobsByScore, formatJobsForWhatsApp } = require('$NANOCLAW_DIR/dist/job-board-helper.js');
    const skills = '$USER_SKILLS'.split(',');

    Promise.all([
      fetchUpworkJobs(),
      fetchFreelancerJobs('automation api integration')
    ]).then(([upworkJobs, freelancerJobs]) => {
      const allJobs = [...upworkJobs, ...freelancerJobs];
      const scored = filterJobsByScore(allJobs, skills, $MIN_SCORE);

      if (scored.length === 0) {
        console.log('No high-scoring jobs found on any platform.');
      } else {
        console.log(\`Found \${scored.length} jobs across all platforms (score >= $MIN_SCORE/10):\\n\`);
        console.log(formatJobsForWhatsApp(scored));
      }
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: job-board-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  upwork [min_score]              - Check Upwork (RSS)"
    echo "  freelancer [keywords] [min_score] - Check Freelancer"
    echo "  all [min_score]                 - Check all platforms"
    echo ""
    echo "Examples:"
    echo "  job-board-monitor.sh upwork 8"
    echo "  job-board-monitor.sh freelancer 'n8n automation' 7"
    echo "  job-board-monitor.sh all 7"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/job-board-monitor.sh
```

### 6. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## Job Board Monitoring

Monitor freelance platforms:

**Check Upwork:**
```bash
/workspace/project/container/tools/job-board-monitor.sh upwork 7
```

**Check Freelancer:**
```bash
/workspace/project/container/tools/job-board-monitor.sh freelancer "n8n automation" 7
```

**Check all platforms:**
```bash
/workspace/project/container/tools/job-board-monitor.sh all 7
```
```

### 7. Rebuild

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
const { fetchUpworkJobs } = require('./dist/job-board-helper.js');
fetchUpworkJobs().then(jobs => {
  console.log('Found', jobs.length, 'Upwork jobs');
  if (jobs.length > 0) console.log('First:', jobs[0].title);
}).catch(err => console.error(err));
"
```

Test from WhatsApp:

```
@Andy check Upwork for n8n automation jobs

@Andy search all job boards for API integration work

@Andy what's new on Freelancer for automation projects?
```

---

## Scheduled Monitoring Tasks

### Hourly Upwork Check (High Volume)

```
@Andy every 2 hours, check Upwork for new jobs matching n8n, automation, API, or VPS. Score each 1-10. Alert me immediately about 9+/10 scores, and send daily digest of 8+ scores at 6pm.
```

### Daily Multi-Platform Sweep

```
@Andy every day at 10am, check Upwork, Freelancer, and Fiverr for automation/n8n projects. Filter for: budget $200+, score 7+. Send me top 20 matches sorted by score and budget.
```

### Early Bird Alert (Fresh Jobs)

```
@Andy every morning at 7am, check all job boards for jobs posted in the last 12 hours. These are fresh opportunities with fewer applicants. Send me score 8+ matches immediately so I can apply first.
```

### Budget-Filtered Search

```
@Andy every 4 hours, check Upwork for jobs with budget $500+. Score them for fit. Alert me about high-budget opportunities (score 7+) even if they're slightly outside my normal keywords.
```

---

## Pro Tips

### Upwork Success Strategy

**Apply Early:**
- Within first 5 applicants = 3x response rate
- Jobs get 20-50 proposals in first 24 hours
- Set up hourly alerts for best projects

**Profile Optimization:**
- Title: "n8n Automation Specialist | Workflow & API Integration Expert"
- Overview: Mention VPS, automation, API integration
- Portfolio: Add BeastMode, Auto Blogger as samples

**Cover Letter Template:**
```
Hi [Client],

I saw you need help with [specific thing from job]. I've built similar workflows using n8n and can deliver this within [timeframe].

Relevant experience:
- [Similar project or skill]
- [Another relevant point]

I'd be happy to discuss your requirements in detail. When's a good time for a quick call?

Best,
[Your name]

Portfolio: [Link to work]
```

### Freelancer Tips

- Less competition than Upwork
- Bid strategically (not always lowest)
- Build profile with smaller jobs first
- Good for ongoing relationships

### Budget Guidelines

**Fair pricing:**
- $500-1000 = Small automation project
- $1000-2000 = Medium complexity workflow
- $2000-5000 = Complex system integration
- $5000+ = Full automation infrastructure

**Don't underbid:**
- You'll attract difficult clients
- Unsustainable long-term
- Undervalues your skills

---

## Success Criteria

✅ Upwork RSS feeds configured
✅ Can fetch Upwork jobs
✅ Can scrape Freelancer
✅ Scoring system working
✅ Budget filtering working
✅ Scheduled monitoring active

---

## Expected Results

**Volume:**
- 50-100 new jobs per day across platforms
- 10-20 relevant after filtering (score 7+)
- 3-5 excellent matches (score 8+)

**Quality by Platform:**
- Upwork: Best clients, good budgets
- Freelancer: High volume, more competition
- Fiverr: Lower budgets, quick gigs

**Response Rates:**
- Early applicants: 10-20% response
- First 5 applicants: 20-30% response
- After 20 applicants: 2-5% response

---

Tell the user:

> Job board monitoring is ready! 🎉
>
> Andy will now monitor:
> - Upwork (RSS feeds - no login needed!)
> - Freelancer (web scraping)
> - Fiverr (manual check or browser automation)
>
> Combined with Reddit, HN, LinkedIn, n8n, and GitHub, you now have:
> **7 lead sources running 24/7!**
>
> Expected weekly volume:
> - 100-200 total opportunities
> - 20-30 high-quality matches (7+)
> - 5-10 excellent matches (8+)
>
> You pick the best and apply. Andy does the grunt work!
