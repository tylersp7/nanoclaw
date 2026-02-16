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

function loadUpworkFeeds(): UpworkFeed[] {
  const feedFile = path.join(os.homedir(), '.nanoclaw-job-boards', 'upwork-feeds.json');

  if (!fs.existsSync(feedFile)) return [];

  const config = JSON.parse(fs.readFileSync(feedFile, 'utf-8'));
  return config.feeds || [];
}

/**
 * Fetch Upwork jobs.
 * Upwork blocks direct scraping — use Andy's agent-browser for live results.
 * This function tries RSS first (legacy), then returns empty with instructions.
 */
export async function fetchUpworkJobs(searchQuery?: string): Promise<JobListing[]> {
  const feeds = loadUpworkFeeds();
  const allJobs: JobListing[] = [];

  // Try RSS feeds (may still work for some users)
  for (const feed of feeds) {
    try {
      const rssFeed = await parser.parseURL(feed.url);
      for (const item of rssFeed.items) {
        const $ = cheerio.load(item.content || item['content:encoded'] || '');
        const budgetText = $('b:contains("Budget")').parent().text() || '';
        const budgetMatch = budgetText.match(/\$[\d,]+/);
        const budget = budgetMatch ? budgetMatch[0] : undefined;

        allJobs.push({
          id: item.guid || item.link || '',
          title: item.title || '',
          description: item.contentSnippet || '',
          budget,
          budgetAmount: budget ? parseInt(budget.replace(/[$,]/g, '')) : undefined,
          platform: 'upwork',
          url: item.link || '',
          postedAt: item.pubDate || new Date().toISOString(),
          skills: [],
        });
      }
    } catch {
      // RSS feeds likely deprecated, skip silently
    }
  }

  if (allJobs.length === 0) {
    const query = searchQuery || 'n8n automation';
    console.log(`Upwork blocks direct scraping. Use agent-browser to search:`);
    console.log(`  agent-browser open "https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(query)}&sort=recency"`);
    console.log(`  agent-browser snapshot -i`);
  }

  return allJobs;
}

/**
 * Fetch jobs from Indeed RSS (public, no auth needed)
 */
export async function fetchIndeedJobs(keywords: string): Promise<JobListing[]> {
  try {
    const query = encodeURIComponent(keywords);
    const rssFeed = await parser.parseURL(
      `https://www.indeed.com/rss?q=${query}&l=remote&sort=date`
    );

    return rssFeed.items.map((item) => ({
      id: item.guid || item.link || '',
      title: item.title || '',
      description: item.contentSnippet || item.content || '',
      platform: 'upwork' as const, // grouped under general
      url: item.link || '',
      postedAt: item.pubDate || new Date().toISOString(),
      skills: [],
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch Freelancer jobs via their public API
 */
export async function fetchFreelancerJobs(keywords: string): Promise<JobListing[]> {
  try {
    const response = await axios.get('https://www.freelancer.com/api/projects/0.1/projects/active/', {
      params: {
        query: keywords,
        compact: true,
        limit: 50,
        job_details: true,
        sort_field: 'time_submitted',
        sort_direction: 'desc',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      timeout: 15000,
    });

    const projects = response.data?.result?.projects || [];

    return projects.map((p: any) => ({
      id: String(p.id),
      title: p.title || '',
      description: p.preview_description || p.description || '',
      budget: p.budget?.maximum ? `$${p.budget.minimum}-$${p.budget.maximum}` : undefined,
      budgetAmount: p.budget?.maximum ? p.budget.maximum : undefined,
      platform: 'freelancer' as const,
      url: `https://www.freelancer.com/projects/${p.seo_url || p.id}`,
      postedAt: p.time_submitted ? new Date(p.time_submitted * 1000).toISOString() : new Date().toISOString(),
      skills: (p.jobs || []).map((j: any) => j.name || j),
    }));
  } catch (error: any) {
    console.error('Error fetching Freelancer jobs:', error.message || error);
    return [];
  }
}

/**
 * Score a job for relevance
 */
export function scoreJob(job: JobListing, userSkills: string[]): number {
  let score = 5;

  const text = `${job.title} ${job.description}`.toLowerCase();

  if (job.budgetAmount) {
    if (job.budgetAmount >= 1000) score += 3;
    else if (job.budgetAmount >= 500) score += 2;
    else if (job.budgetAmount >= 200) score += 1;
    else if (job.budgetAmount < 50) score -= 2;
  }

  const skillMatches = userSkills.filter((skill) => {
    const skillLower = skill.toLowerCase();
    return text.includes(skillLower) || job.skills.some((s) => s.toLowerCase().includes(skillLower));
  }).length;

  score += Math.min(skillMatches, 3);

  if (text.includes('automation') || text.includes('n8n')) score += 2;
  if (text.includes('api') || text.includes('integration')) score += 1;
  if (text.includes('vps') || text.includes('server')) score += 1;
  if (text.includes('ongoing') || text.includes('long term')) score += 2;

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
    .map((job) => ({
      ...job,
      relevanceScore: scoreJob(job, userSkills),
    }))
    .filter((job) => job.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
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
      const platformLabel = {
        upwork: 'Upwork',
        fiverr: 'Fiverr',
        freelancer: 'Freelancer',
      }[job.platform];

      const skills = job.skills.slice(0, 3).join(', ');

      return `${i + 1}. *${job.title}*${scoreStr}${budget}
${platformLabel}${skills ? ` • ${skills}` : ''}

${job.description.substring(0, 200)}${job.description.length > 200 ? '...' : ''}

🔗 ${job.url}`;
    })
    .join('\n\n---\n\n');
}
