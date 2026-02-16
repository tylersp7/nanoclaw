import { sshExec, runCommand } from './vps-monitor.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface BloggerStatus {
  server: string;
  services: Array<{ name: string; status: string; healthy: boolean }>;
  queue: { pending: number; processing: number; failed: number; completed: number };
  recentPosts: Array<{ title: string; status: string; createdAt: string; site?: string }>;
  database: { connected: boolean; size: string };
  redis: { connected: boolean; memoryUsed: string };
  errors: string[];
}

/**
 * Get Auto Blogger service status
 */
export async function getBloggerStatus(): Promise<BloggerStatus> {
  const server = 'blogger';

  // Check Docker containers
  let dockerOutput: string;
  try {
    dockerOutput = await runCommand(server, 'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Image}}" 2>/dev/null');
  } catch {
    dockerOutput = '';
  }

  const services = dockerOutput
    .split('\n')
    .filter(l => l.trim())
    .map(line => {
      const [name, status, image] = line.split('|');
      return {
        name: name || 'unknown',
        status: status || 'unknown',
        healthy: (status || '').toLowerCase().includes('up'),
      };
    });

  // Check queue status (BullMQ via Redis)
  let queueInfo = { pending: 0, processing: 0, failed: 0, completed: 0 };
  try {
    const redisOutput = await runCommand(server,
      'redis-cli -n 0 <<\'REDIS\'\n' +
      'LLEN bull:blog-generation:wait\n' +
      'LLEN bull:blog-generation:active\n' +
      'ZCARD bull:blog-generation:failed\n' +
      'ZCARD bull:blog-generation:completed\n' +
      'REDIS'
    );
    const counts = redisOutput.split('\n').map((l: string) => parseInt(l.trim()) || 0);
    queueInfo = {
      pending: counts[0] || 0,
      processing: counts[1] || 0,
      failed: counts[2] || 0,
      completed: counts[3] || 0,
    };
  } catch {
    // Queue info unavailable
  }

  // Check recent posts from database
  let recentPosts: Array<{ title: string; status: string; createdAt: string; site?: string }> = [];
  try {
    const dbOutput = await runCommand(server,
      'docker exec -i $(docker ps -q --filter "name=postgres") psql -U postgres -d auto_blogger -t -c ' +
      '"SELECT title, status, created_at, site_name FROM posts ORDER BY created_at DESC LIMIT 5;" 2>/dev/null ' +
      '|| sudo -u postgres psql -d auto_blogger -t -c ' +
      '"SELECT title, status, created_at, site_name FROM posts ORDER BY created_at DESC LIMIT 5;" 2>/dev/null'
    );
    recentPosts = dbOutput
      .split('\n')
      .filter((l: string) => l.trim() && l.includes('|'))
      .map((line: string) => {
        const parts = line.split('|').map((p: string) => p.trim());
        return {
          title: parts[0] || 'Untitled',
          status: parts[1] || 'unknown',
          createdAt: parts[2] || '',
          site: parts[3] || undefined,
        };
      });
  } catch {
    // DB query failed
  }

  // Check database status
  let dbConnected = false;
  let dbSize = 'unknown';
  try {
    const dbCheck = await runCommand(server,
      'docker exec -i $(docker ps -q --filter "name=postgres") psql -U postgres -d auto_blogger -t -c ' +
      '"SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null ' +
      '|| sudo -u postgres psql -d auto_blogger -t -c ' +
      '"SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null'
    );
    if (dbCheck.trim()) {
      dbConnected = true;
      dbSize = dbCheck.trim();
    }
  } catch {
    // DB not accessible
  }

  // Check Redis
  let redisConnected = false;
  let redisMemory = 'unknown';
  try {
    const redisCheck = await runCommand(server, 'redis-cli info memory 2>/dev/null | grep used_memory_human');
    if (redisCheck.includes('used_memory_human')) {
      redisConnected = true;
      redisMemory = redisCheck.split(':')[1]?.trim() || 'unknown';
    }
  } catch {
    // Redis not accessible
  }

  // Get recent errors
  let errors: string[] = [];
  try {
    const errorLogs = await runCommand(server,
      'docker logs --tail 20 $(docker ps -q --filter "name=auto-blogger" --filter "name=blog" | head -1) 2>&1 | grep -i "error\\|fail\\|exception" | tail -5 2>/dev/null'
    );
    errors = errorLogs.split('\n').filter((l: string) => l.trim());
  } catch {
    // No error logs available
  }

  return {
    server: 'Auto Blogger VPS',
    services,
    queue: queueInfo,
    recentPosts,
    database: { connected: dbConnected, size: dbSize },
    redis: { connected: redisConnected, memoryUsed: redisMemory },
    errors,
  };
}

/**
 * Get post statistics
 */
export async function getPostStats(days: number = 7): Promise<{
  total: number;
  published: number;
  failed: number;
  pending: number;
  bySite: Record<string, number>;
  byDay: Record<string, number>;
}> {
  const server = 'blogger';

  try {
    const output = await runCommand(server,
      `docker exec -i $(docker ps -q --filter "name=postgres") psql -U postgres -d auto_blogger -t -c "` +
      `SELECT status, site_name, DATE(created_at) as day, COUNT(*) ` +
      `FROM posts WHERE created_at > NOW() - INTERVAL '${days} days' ` +
      `GROUP BY status, site_name, DATE(created_at) ORDER BY day DESC;" 2>/dev/null ` +
      `|| sudo -u postgres psql -d auto_blogger -t -c "` +
      `SELECT status, site_name, DATE(created_at) as day, COUNT(*) ` +
      `FROM posts WHERE created_at > NOW() - INTERVAL '${days} days' ` +
      `GROUP BY status, site_name, DATE(created_at) ORDER BY day DESC;" 2>/dev/null`
    );

    let total = 0, published = 0, failed = 0, pending = 0;
    const bySite: Record<string, number> = {};
    const byDay: Record<string, number> = {};

    output.split('\n').filter((l: string) => l.trim() && l.includes('|')).forEach((line: string) => {
      const parts = line.split('|').map((p: string) => p.trim());
      const status = parts[0];
      const site = parts[1] || 'unknown';
      const day = parts[2] || 'unknown';
      const count = parseInt(parts[3]) || 0;

      total += count;
      if (status === 'published') published += count;
      else if (status === 'failed') failed += count;
      else pending += count;

      bySite[site] = (bySite[site] || 0) + count;
      byDay[day] = (byDay[day] || 0) + count;
    });

    return { total, published, failed, pending, bySite, byDay };
  } catch {
    return { total: 0, published: 0, failed: 0, pending: 0, bySite: {}, byDay: {} };
  }
}

/**
 * Retry failed posts
 */
export async function retryFailedPosts(): Promise<string> {
  const server = 'blogger';

  try {
    // Move failed jobs back to waiting queue in Redis
    const output = await runCommand(server,
      'redis-cli -n 0 <<\'REDIS\'\n' +
      'EVAL "local jobs = redis.call(\'zrange\', KEYS[1], 0, -1) for i, job in ipairs(jobs) do redis.call(\'rpush\', KEYS[2], job) redis.call(\'zrem\', KEYS[1], job) end return #jobs" 2 bull:blog-generation:failed bull:blog-generation:wait\n' +
      'REDIS'
    );
    return `Retried ${output.trim() || '0'} failed jobs`;
  } catch (err: any) {
    return `Failed to retry: ${err.message}`;
  }
}

/**
 * Restart Auto Blogger services
 */
export async function restartBloggerServices(): Promise<string> {
  const server = 'blogger';
  const results: string[] = [];

  try {
    // Try docker-compose first, then individual containers
    const output = await runCommand(server,
      'cd /opt/auto-blogger && docker-compose restart 2>/dev/null || ' +
      'cd ~/auto-blogger && docker-compose restart 2>/dev/null || ' +
      'docker restart $(docker ps -q --filter "name=blog" --filter "name=auto") 2>/dev/null'
    );
    results.push(output || 'Restart command executed');
  } catch (err: any) {
    results.push(`Restart failed: ${err.message}`);
  }

  return results.join('\n');
}

/**
 * Format blogger status for WhatsApp
 */
export function formatBloggerStatusForWhatsApp(status: BloggerStatus): string {
  const serviceLines = status.services.length > 0
    ? status.services.map(s =>
        `${s.healthy ? '✅' : '❌'} ${s.name} - ${s.status}`
      ).join('\n')
    : 'No containers found';

  const queueLine = `Pending: ${status.queue.pending} • Active: ${status.queue.processing} • Failed: ${status.queue.failed} • Done: ${status.queue.completed}`;

  const postLines = status.recentPosts.length > 0
    ? status.recentPosts.map(p => {
        const statusEmoji = p.status === 'published' ? '✅' : p.status === 'failed' ? '❌' : '⏳';
        return `${statusEmoji} ${p.title.substring(0, 50)}${p.title.length > 50 ? '...' : ''}${p.site ? ` (${p.site})` : ''}`;
      }).join('\n')
    : 'No recent posts';

  const dbLine = `${status.database.connected ? '✅' : '❌'} PostgreSQL (${status.database.size})`;
  const redisLine = `${status.redis.connected ? '✅' : '❌'} Redis (${status.redis.memoryUsed})`;

  const errorLines = status.errors.length > 0
    ? status.errors.slice(0, 3).map(e => `• ${e.substring(0, 100)}`).join('\n')
    : 'No recent errors';

  return `*Auto Blogger Status*

*Services:*
${serviceLines}

*Queue:*
${queueLine}

*Data:*
${dbLine}
${redisLine}

*Recent Posts:*
${postLines}

*Errors:*
${errorLines}`;
}

/**
 * Format post stats for WhatsApp
 */
export function formatPostStatsForWhatsApp(stats: {
  total: number;
  published: number;
  failed: number;
  pending: number;
  bySite: Record<string, number>;
  byDay: Record<string, number>;
}, days: number): string {
  const siteLines = Object.entries(stats.bySite)
    .map(([site, count]) => `• ${site}: ${count} posts`)
    .join('\n');

  const dayLines = Object.entries(stats.byDay)
    .slice(0, 7)
    .map(([day, count]) => `• ${day}: ${count} posts`)
    .join('\n');

  return `*Auto Blogger Stats (${days} days)*

Total: ${stats.total}
✅ Published: ${stats.published}
❌ Failed: ${stats.failed}
⏳ Pending: ${stats.pending}

*By Site:*
${siteLines || 'No data'}

*By Day:*
${dayLines || 'No data'}`;
}
