import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// --- Types ---

export interface DetectedItem {
  id: string;
  contentHash: string;
  data: Record<string, unknown>;
}

interface SeenItem {
  contentHash: string;
  titleHash: string; // normalized title hash for cross-platform dedup
  firstSeen: string;
  lastSeen: string;
  timesSeen: number;
  gone: boolean; // true if item was absent in the last run
}

interface SeenItemStore {
  items: Record<string, SeenItem>;
  lastRun: string;
}

export type ChangeType = 'new' | 'changed' | 'returning' | 'unchanged';

// --- Significance tiers ---

export type SignificanceTier = 'critical' | 'important' | 'minor';

export interface TieredItem extends DetectedItem {
  tier: SignificanceTier;
  score?: number;
}

/**
 * Classify an item's significance based on its relevance score.
 * Critical (9-10): immediate alert, bypasses quiet hours
 * Important (7-8): include in next batch
 * Minor (5-6): log only, weekly digest
 */
export function classifySignificance(score: number): SignificanceTier {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'important';
  return 'minor';
}

/**
 * Tag detected items with significance tiers based on their scores.
 */
export function tagWithSignificance(
  items: DetectedItem[],
  scoreField: string = 'relevanceScore',
): TieredItem[] {
  return items.map((item) => {
    const score =
      typeof item.data[scoreField] === 'number'
        ? (item.data[scoreField] as number)
        : typeof item.data['match_score'] === 'number'
          ? (item.data['match_score'] as number)
          : typeof item.data['score'] === 'number'
            ? (item.data['score'] as number)
            : 5;
    return { ...item, tier: classifySignificance(score), score };
  });
}

export interface ChangeResult {
  newItems: DetectedItem[];
  changedItems: DetectedItem[];
  returningItems: DetectedItem[];
  goneCount: number;
  unchangedCount: number;
  totalCurrent: number;
  summary: string;
}

// --- Core logic ---

const CHANGE_DETECTION_DIR = '.change-detection';

function getStoreDir(workspaceDir: string): string {
  return path.join(workspaceDir, CHANGE_DETECTION_DIR);
}

function getStorePath(workspaceDir: string, source: string): string {
  const safe = source.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getStoreDir(workspaceDir), `${safe}.json`);
}

function loadStore(storePath: string): SeenItemStore {
  try {
    if (fs.existsSync(storePath)) {
      return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { items: {}, lastRun: '' };
}

function saveStore(storePath: string, store: SeenItemStore): void {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

/**
 * Hash content for change detection.
 * Uses first 1000 chars to stay fast while catching meaningful changes.
 */
export function hashContent(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content.substring(0, 1000))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Detect changes in a set of items against previously seen state.
 *
 * @param workspaceDir - Path to the group workspace (e.g., /workspace/group)
 * @param source - Monitor name (e.g., 'reddit-jobs', 'hn-hiring', 'linkedin')
 * @param items - Current batch of items with id, content hash, and full data
 * @param maxGoneRuns - How many consecutive absent runs before an item is purged (default: 3)
 */
export function detectChanges(
  workspaceDir: string,
  source: string,
  items: DetectedItem[],
  maxGoneRuns: number = 3,
): ChangeResult {
  const storePath = getStorePath(workspaceDir, source);
  const store = loadStore(storePath);
  const now = new Date().toISOString();

  const currentIds = new Set(items.map((i) => i.id));
  const newItems: DetectedItem[] = [];
  const changedItems: DetectedItem[] = [];
  const returningItems: DetectedItem[] = [];
  let unchangedCount = 0;

  for (const item of items) {
    const prev = store.items[item.id];
    const titleHash = hashTitle(item.data);

    if (!prev) {
      // Never seen before
      newItems.push(item);
      store.items[item.id] = {
        contentHash: item.contentHash,
        titleHash,
        firstSeen: now,
        lastSeen: now,
        timesSeen: 1,
        gone: false,
      };
    } else if (prev.gone) {
      // Was marked gone in a previous run, now it's back — repost/returning
      returningItems.push(item);
      store.items[item.id] = {
        ...prev,
        contentHash: item.contentHash,
        titleHash,
        lastSeen: now,
        timesSeen: prev.timesSeen + 1,
        gone: false,
      };
    } else if (prev.contentHash !== item.contentHash) {
      // Content changed since last seen
      changedItems.push(item);
      store.items[item.id] = {
        ...prev,
        contentHash: item.contentHash,
        titleHash,
        lastSeen: now,
        timesSeen: prev.timesSeen + 1,
        gone: false,
      };
    } else {
      // Same content, just update lastSeen
      unchangedCount++;
      store.items[item.id] = {
        ...prev,
        lastSeen: now,
        timesSeen: prev.timesSeen + 1,
        gone: false,
      };
    }
  }

  // Mark items that disappeared and purge very old ones
  let goneCount = 0;
  const idsToRemove: string[] = [];

  for (const [id, seen] of Object.entries(store.items)) {
    if (!currentIds.has(id)) {
      goneCount++;
      // Mark as gone (will be detected as "returning" if it comes back)
      store.items[id] = { ...seen, gone: true };
      // Purge items that have been gone for too long
      const lastSeenDate = new Date(seen.lastSeen);
      const daysSinceLastSeen =
        (Date.now() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastSeen > maxGoneRuns * 7) {
        idsToRemove.push(id);
      }
    }
  }

  for (const id of idsToRemove) {
    delete store.items[id];
  }

  store.lastRun = now;
  saveStore(storePath, store);

  const summary = buildSummary(
    newItems.length,
    changedItems.length,
    returningItems.length,
    unchangedCount,
    goneCount,
    items.length,
    store.lastRun ? store.lastRun : undefined,
  );

  return {
    newItems,
    changedItems,
    returningItems,
    goneCount,
    unchangedCount,
    totalCurrent: items.length,
    summary,
  };
}

function buildSummary(
  newCount: number,
  changedCount: number,
  returningCount: number,
  unchangedCount: number,
  goneCount: number,
  totalCount: number,
  _lastRun?: string,
): string {
  const parts: string[] = [];

  if (newCount > 0) parts.push(`${newCount} new`);
  if (changedCount > 0) parts.push(`${changedCount} updated`);
  if (returningCount > 0) parts.push(`${returningCount} returning`);
  if (unchangedCount > 0) parts.push(`${unchangedCount} unchanged`);
  if (goneCount > 0) parts.push(`${goneCount} gone`);

  if (parts.length === 0) return 'No items found.';

  const actionable = newCount + changedCount + returningCount;
  if (actionable === 0) {
    return `${totalCount} items checked — nothing new since last run.`;
  }

  return `Delta: ${parts.join(', ')} (${totalCount} total)`;
}

// --- Convenience helpers for each monitor type ---

/**
 * Build DetectedItem from a Reddit post.
 */
export function redditToDetectedItem(post: {
  id: string;
  title: string;
  selftext: string;
  [key: string]: unknown;
}): DetectedItem {
  return {
    id: `reddit:${post.id}`,
    contentHash: hashContent(`${post.title}\n${post.selftext}`),
    data: post as Record<string, unknown>,
  };
}

/**
 * Build DetectedItem from an HN job listing.
 */
export function hnToDetectedItem(listing: {
  id: number;
  title: string;
  text: string;
  [key: string]: unknown;
}): DetectedItem {
  return {
    id: `hn:${listing.id}`,
    contentHash: hashContent(`${listing.title}\n${listing.text}`),
    data: listing as unknown as Record<string, unknown>,
  };
}

/**
 * Build DetectedItem from an HN story (Ask HN, Show HN).
 */
export function hnStoryToDetectedItem(story: {
  id: number;
  title?: string;
  text?: string;
  [key: string]: unknown;
}): DetectedItem {
  return {
    id: `hn:${story.id}`,
    contentHash: hashContent(`${story.title || ''}\n${story.text || ''}`),
    data: story as unknown as Record<string, unknown>,
  };
}

/**
 * Build DetectedItem from a LinkedIn job.
 */
export function linkedinToDetectedItem(job: {
  id: string;
  title: string;
  company: string;
  description: string;
  [key: string]: unknown;
}): DetectedItem {
  return {
    id: `linkedin:${job.id}`,
    contentHash: hashContent(
      `${job.title}\n${job.company}\n${job.description}`,
    ),
    data: job as Record<string, unknown>,
  };
}

/**
 * Build DetectedItem from a job board listing.
 */
export function jobBoardToDetectedItem(job: {
  id: string;
  title: string;
  description: string;
  platform: string;
  [key: string]: unknown;
}): DetectedItem {
  return {
    id: `${job.platform}:${job.id}`,
    contentHash: hashContent(`${job.title}\n${job.description}`),
    data: job as Record<string, unknown>,
  };
}

/**
 * Build DetectedItem from a GitHub issue.
 */
export function githubIssueToDetectedItem(issue: {
  id: number;
  title: string;
  body?: string;
  [key: string]: unknown;
}): DetectedItem {
  return {
    id: `github:${issue.id}`,
    contentHash: hashContent(`${issue.title}\n${issue.body || ''}`),
    data: issue as unknown as Record<string, unknown>,
  };
}

/**
 * Get stats about tracked items for a given source.
 */
export function getSourceStats(
  workspaceDir: string,
  source: string,
): { tracked: number; lastRun: string | null } {
  const storePath = getStorePath(workspaceDir, source);
  const store = loadStore(storePath);
  return {
    tracked: Object.keys(store.items).length,
    lastRun: store.lastRun || null,
  };
}

/**
 * Get stats across all sources in a workspace.
 */
export function getAllStats(
  workspaceDir: string,
): Array<{ source: string; tracked: number; lastRun: string | null }> {
  const dir = getStoreDir(workspaceDir);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const source = f.replace('.json', '');
      const stats = getSourceStats(workspaceDir, source);
      return { source, ...stats };
    });
}

/**
 * Reset change detection state for a source (or all sources).
 */
export function resetState(workspaceDir: string, source?: string): void {
  if (source) {
    const storePath = getStorePath(workspaceDir, source);
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
  } else {
    const dir = getStoreDir(workspaceDir);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  }
}

// --- Cross-platform dedup (#1) ---

/**
 * Normalize a title for fuzzy matching across platforms.
 * Strips common noise: brackets, platform prefixes, budget mentions, etc.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[.*?\]/g, '') // strip [Hiring], [For Hire], etc.
    .replace(/\(.*?\)/g, '') // strip (Remote), ($500), etc.
    .replace(/\$[\d,]+(?:\s*-\s*\$[\d,]+)?/g, '') // strip budget ranges
    .replace(/https?:\/\/\S+/g, '') // strip URLs
    .replace(/[^a-z0-9\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hash a normalized title for cross-platform comparison.
 */
function hashTitle(data: Record<string, unknown>): string {
  const title = (data.title as string) || '';
  return hashContent(normalizeTitle(title));
}

/**
 * Find duplicate items across multiple sources by normalized title hash.
 * Returns a Set of item IDs that are duplicates of items already seen
 * in earlier sources (preserves the first occurrence).
 */
export function findCrossPlatformDuplicates(
  workspaceDir: string,
  sources: string[],
): Set<string> {
  const seenTitleHashes = new Map<string, string>(); // titleHash → first source:id
  const duplicateIds = new Set<string>();

  for (const source of sources) {
    const storePath = getStorePath(workspaceDir, source);
    const store = loadStore(storePath);

    for (const [id, seen] of Object.entries(store.items)) {
      if (!seen.titleHash || seen.gone) continue;

      const existing = seenTitleHashes.get(seen.titleHash);
      if (existing && !existing.startsWith(source + ':')) {
        // This title was already seen in a different source
        duplicateIds.add(id);
      } else if (!existing) {
        seenTitleHashes.set(seen.titleHash, `${source}:${id}`);
      }
    }
  }

  return duplicateIds;
}

/**
 * Filter out cross-platform duplicates from a change result.
 * Call after detectChanges to remove items already reported by another source.
 */
export function deduplicateAcrossSources(
  workspaceDir: string,
  result: ChangeResult,
  currentSource: string,
  otherSources: string[],
): ChangeResult {
  const duplicateIds = findCrossPlatformDuplicates(workspaceDir, [
    ...otherSources,
    currentSource,
  ]);

  // Only filter items from the current source that are dupes of other sources
  const filterDupes = (items: DetectedItem[]) =>
    items.filter((item) => !duplicateIds.has(item.id));

  const newItems = filterDupes(result.newItems);
  const changedItems = filterDupes(result.changedItems);
  const returningItems = filterDupes(result.returningItems);
  const dedupedCount =
    result.newItems.length +
    result.changedItems.length +
    result.returningItems.length -
    newItems.length -
    changedItems.length -
    returningItems.length;

  let summary = result.summary;
  if (dedupedCount > 0) {
    summary += ` (${dedupedCount} cross-platform duplicates filtered)`;
  }

  return {
    ...result,
    newItems,
    changedItems,
    returningItems,
    summary,
  };
}

// --- Staleness alerts (#6) ---

export interface StalenessCheck {
  source: string;
  lastRun: string | null;
  expectedIntervalHours: number;
  hoursOverdue: number;
  isStale: boolean;
}

/**
 * Check if sources are stale (haven't run in >2x their expected interval).
 *
 * @param workspaceDir - Group workspace path
 * @param expectations - Map of source name → expected interval in hours
 */
export function checkStaleness(
  workspaceDir: string,
  expectations: Record<string, number>,
): StalenessCheck[] {
  const results: StalenessCheck[] = [];

  for (const [source, expectedHours] of Object.entries(expectations)) {
    const stats = getSourceStats(workspaceDir, source);
    const threshold = expectedHours * 2;

    if (!stats.lastRun) {
      results.push({
        source,
        lastRun: null,
        expectedIntervalHours: expectedHours,
        hoursOverdue: Infinity,
        isStale: true,
      });
      continue;
    }

    const hoursSinceRun =
      (Date.now() - new Date(stats.lastRun).getTime()) / (1000 * 60 * 60);
    const hoursOverdue = Math.max(0, hoursSinceRun - threshold);

    results.push({
      source,
      lastRun: stats.lastRun,
      expectedIntervalHours: expectedHours,
      hoursOverdue,
      isStale: hoursSinceRun > threshold,
    });
  }

  return results;
}

/**
 * Format staleness checks for display.
 */
export function formatStalenessReport(checks: StalenessCheck[]): string {
  const stale = checks.filter((c) => c.isStale);
  if (stale.length === 0) return 'All monitors running on schedule.';

  const lines = stale.map((c) => {
    if (!c.lastRun) {
      return `  ${c.source}: NEVER RUN (expected every ${c.expectedIntervalHours}h)`;
    }
    const ago = Math.round(c.hoursOverdue + c.expectedIntervalHours * 2);
    return `  ${c.source}: last run ${ago}h ago (expected every ${c.expectedIntervalHours}h, ${Math.round(c.hoursOverdue)}h overdue)`;
  });

  return `STALE MONITORS (${stale.length}):\n${lines.join('\n')}`;
}

// --- Unified pipeline delta summary (#5) ---

export interface AggregatedDelta {
  bySource: Record<string, ChangeResult>;
  totalNew: number;
  totalChanged: number;
  totalReturning: number;
  totalUnchanged: number;
  totalGone: number;
  totalItems: number;
  summary: string;
}

/**
 * Aggregate multiple change results into a unified summary.
 * Used by the lead pipeline to produce a single cross-source report.
 */
export function aggregateDeltas(
  results: Record<string, ChangeResult>,
): AggregatedDelta {
  let totalNew = 0;
  let totalChanged = 0;
  let totalReturning = 0;
  let totalUnchanged = 0;
  let totalGone = 0;
  let totalItems = 0;

  for (const result of Object.values(results)) {
    totalNew += result.newItems.length;
    totalChanged += result.changedItems.length;
    totalReturning += result.returningItems.length;
    totalUnchanged += result.unchangedCount;
    totalGone += result.goneCount;
    totalItems += result.totalCurrent;
  }

  const parts: string[] = [];
  if (totalNew > 0) parts.push(`${totalNew} new`);
  if (totalChanged > 0) parts.push(`${totalChanged} updated`);
  if (totalReturning > 0) parts.push(`${totalReturning} returning`);
  if (totalUnchanged > 0) parts.push(`${totalUnchanged} unchanged`);
  if (totalGone > 0) parts.push(`${totalGone} gone`);

  const actionable = totalNew + totalChanged + totalReturning;
  let summary: string;

  if (parts.length === 0) {
    summary = 'No items found across any source.';
  } else if (actionable === 0) {
    summary = `${totalItems} items checked across ${Object.keys(results).length} sources — nothing new.`;
  } else {
    // Break down by source for the actionable items
    const sourceBreakdown = Object.entries(results)
      .filter(
        ([, r]) =>
          r.newItems.length + r.changedItems.length + r.returningItems.length >
          0,
      )
      .map(([source, r]) => {
        const counts: string[] = [];
        if (r.newItems.length > 0) counts.push(`${r.newItems.length} new`);
        if (r.changedItems.length > 0)
          counts.push(`${r.changedItems.length} updated`);
        if (r.returningItems.length > 0)
          counts.push(`${r.returningItems.length} returning`);
        return `  ${source}: ${counts.join(', ')}`;
      })
      .join('\n');

    summary = `Lead Pipeline Delta: ${parts.join(', ')} (${totalItems} total across ${Object.keys(results).length} sources)\n${sourceBreakdown}`;
  }

  return {
    bySource: results,
    totalNew,
    totalChanged,
    totalReturning,
    totalUnchanged,
    totalGone,
    totalItems,
    summary,
  };
}
