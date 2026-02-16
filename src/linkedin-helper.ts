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
    // f_WT=2 is remote filter
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=${datePosted}&f_WT=2`;

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const jobs: LinkedInJob[] = [];

    for (let i = 0; i < 3; i++) {
      await page.evaluate('window.scrollBy(0, 1000)');
      await page.waitForTimeout(1000);
    }

    const jobElements = await page.$$('.job-card-container, .jobs-search-results__list-item');

    for (const jobEl of jobElements.slice(0, 25)) {
      try {
        const title = await jobEl.$eval(
          '.job-card-list__title, .job-card-container__link',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const company = await jobEl.$eval(
          '.job-card-container__company-name, .artdeco-entity-lockup__subtitle',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const loc = await jobEl.$eval(
          '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const linkEl = await jobEl.$('a');
        const href = linkEl ? await linkEl.getAttribute('href') || '' : '';
        const jobIdMatch = href.match(/\/(\d+)/);
        const jobId = jobIdMatch ? jobIdMatch[1] : '';

        const easyApplyEl = await jobEl.$('.job-card-container__apply-method');
        const easyApplyText = easyApplyEl ? await easyApplyEl.textContent() : '';
        const easyApply = easyApplyText?.includes('Easy Apply') || false;

        if (title) {
          jobs.push({
            id: jobId,
            title,
            company,
            location: loc,
            description: '',
            url: jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : `https://www.linkedin.com${href}`,
            postedDate: 'recent',
            easyApply,
            remote: loc.toLowerCase().includes('remote'),
          });
        }
      } catch {
        continue;
      }
    }

    return jobs;
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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const posts: LinkedInPost[] = [];

    for (let i = 0; i < 3; i++) {
      await page.evaluate('window.scrollBy(0, 1000)');
      await page.waitForTimeout(1500);
    }

    const postElements = await page.$$('.feed-shared-update-v2');

    for (const postEl of postElements.slice(0, limit)) {
      try {
        const author = await postEl.$eval(
          '.feed-shared-actor__name, .update-components-actor__name',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const authorTitle = await postEl.$eval(
          '.feed-shared-actor__description, .update-components-actor__description',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const content = await postEl.$eval(
          '.feed-shared-text, .update-components-text',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const likes = await postEl.$eval(
          '.social-details-social-counts__reactions-count',
          (el) => parseInt(el.textContent?.replace(/\D/g, '') || '0')
        ).catch(() => 0);

        const comments = await postEl.$eval(
          '.social-details-social-counts__comments',
          (el) => parseInt(el.textContent?.replace(/\D/g, '') || '0')
        ).catch(() => 0);

        if (author || content) {
          posts.push({
            id: Date.now().toString() + Math.random(),
            author,
            authorTitle,
            content,
            url: `https://www.linkedin.com/feed/hashtag/${hashtag}/`,
            postedAt: 'recent',
            engagement: { likes, comments },
          });
        }
      } catch {
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

  if (job.easyApply) score += 2;
  if (job.remote) score += 2;

  const matches = userSkills.filter((skill) => text.includes(skill.toLowerCase())).length;
  score += Math.min(matches, 3);

  if (text.includes('senior') || text.includes('lead')) score += 1;
  if (text.includes('contract') || text.includes('freelance')) score += 1;
  if (text.includes('automation') || text.includes('n8n')) score += 2;

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

👍 ${post.engagement.likes} • 💬 ${post.engagement.comments}`;
    })
    .join('\n\n---\n\n');
}
