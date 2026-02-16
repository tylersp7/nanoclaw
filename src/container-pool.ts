/**
 * Container Pool — Pre-warms expensive setup for container spawns.
 *
 * Apple Containers are ephemeral (`container run -i --rm`), so we can't
 * keep containers alive between tasks. Instead we cache the *setup work*
 * that buildVolumeMounts() does on every spawn:
 *   - IPC directory creation (mkdirSync * 3 per group)
 *   - Skills file sync (readdir + copyFile per skill file)
 *   - Env file generation (for main group)
 *   - Session settings file creation
 *
 * The pool is an optimization layer — if the cache is stale or missing,
 * the existing code path runs unchanged.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, CONTAINER_POOL_ENABLED } from './config.js';
import { logger } from './logger.js';

export interface PoolConfig {
  maxPrewarmed: number;    // Max pre-prepared groups (default: 2)
  preloadOnIdle: boolean;  // Pre-prepare during idle periods (default: true)
}

interface CachedGroupState {
  /** Timestamp of last cache refresh */
  cachedAt: number;
  /** Whether IPC dirs have been created for this group */
  ipcReady: boolean;
  /** Whether session settings.json exists */
  settingsReady: boolean;
  /** MD5 of skills source directory (to detect changes) */
  skillsChecksum: string | null;
  /** Whether skills are synced with this checksum */
  skillsSynced: boolean;
  /** Checksum of the env file content (main group only) */
  envChecksum: string | null;
}

const SKILLS_SRC = path.join(process.cwd(), 'container', 'skills');

/**
 * Compute a fast checksum of the skills source directory.
 * Hashes file names + mtimeMs for each skill file. Only re-copies
 * when the checksum changes (new/modified/deleted skill files).
 */
function computeSkillsChecksum(): string | null {
  if (!fs.existsSync(SKILLS_SRC)) return null;

  const parts: string[] = [];
  try {
    for (const skillDir of fs.readdirSync(SKILLS_SRC)) {
      const srcDir = path.join(SKILLS_SRC, skillDir);
      const stat = fs.statSync(srcDir);
      if (!stat.isDirectory()) continue;
      for (const file of fs.readdirSync(srcDir)) {
        const fileStat = fs.statSync(path.join(srcDir, file));
        parts.push(`${skillDir}/${file}:${fileStat.size}:${fileStat.mtimeMs}`);
      }
    }
  } catch {
    return null;
  }

  if (parts.length === 0) return null;
  return crypto.createHash('md5').update(parts.sort().join('\n')).digest('hex');
}

/**
 * Sync skills from container/skills/ into a group's .claude/skills/.
 * Skips the copy entirely when the checksum matches the cached value.
 */
export function syncSkillsIfNeeded(
  groupSessionsDir: string,
  cached: CachedGroupState | undefined,
  currentChecksum: string | null,
): boolean {
  // Nothing to sync
  if (!currentChecksum || !fs.existsSync(SKILLS_SRC)) return false;

  // Already synced with this checksum
  if (cached?.skillsSynced && cached.skillsChecksum === currentChecksum) {
    return false; // no work done
  }

  const skillsDst = path.join(groupSessionsDir, 'skills');
  for (const skillDir of fs.readdirSync(SKILLS_SRC)) {
    const srcDir = path.join(SKILLS_SRC, skillDir);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    const dstDir = path.join(skillsDst, skillDir);
    fs.mkdirSync(dstDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
    }
  }

  return true; // work was done
}

export class ContainerPool {
  private cache = new Map<string, CachedGroupState>();
  private config: PoolConfig;
  private currentSkillsChecksum: string | null = null;
  private lastSkillsChecksumAt = 0;

  constructor(config?: Partial<PoolConfig>) {
    this.config = {
      maxPrewarmed: config?.maxPrewarmed ?? 2,
      preloadOnIdle: config?.preloadOnIdle ?? true,
    };
  }

  /**
   * Get the current skills checksum, refreshing at most once per 10 seconds.
   */
  getSkillsChecksum(): string | null {
    const now = Date.now();
    if (now - this.lastSkillsChecksumAt > 10_000) {
      this.currentSkillsChecksum = computeSkillsChecksum();
      this.lastSkillsChecksumAt = now;
    }
    return this.currentSkillsChecksum;
  }

  /**
   * Pre-create IPC directories for a group. Returns true if already done.
   */
  ensureIpcDirs(groupFolder: string): boolean {
    const cached = this.cache.get(groupFolder);
    if (cached?.ipcReady) return true;

    const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
    fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
    fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });

    const state = this.getOrCreate(groupFolder);
    state.ipcReady = true;
    return false;
  }

  /**
   * Ensure session settings.json exists. Returns true if already done.
   */
  ensureSettings(groupSessionsDir: string, groupFolder: string): boolean {
    const cached = this.cache.get(groupFolder);
    if (cached?.settingsReady) return true;

    fs.mkdirSync(groupSessionsDir, { recursive: true });
    const settingsFile = path.join(groupSessionsDir, 'settings.json');
    if (!fs.existsSync(settingsFile)) {
      fs.writeFileSync(settingsFile, JSON.stringify({
        env: {
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
          CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
        },
      }, null, 2) + '\n');
    }

    const state = this.getOrCreate(groupFolder);
    state.settingsReady = true;
    return false;
  }

  /**
   * Check if skills are already synced for a group.
   */
  areSkillsSynced(groupFolder: string): boolean {
    const cached = this.cache.get(groupFolder);
    if (!cached) return false;
    const currentChecksum = this.getSkillsChecksum();
    return cached.skillsSynced && cached.skillsChecksum === currentChecksum;
  }

  /**
   * Mark skills as synced for a group with the given checksum.
   */
  markSkillsSynced(groupFolder: string, checksum: string | null): void {
    const state = this.getOrCreate(groupFolder);
    state.skillsChecksum = checksum;
    state.skillsSynced = true;
  }

  /**
   * Check if an env file content matches the cached version.
   */
  isEnvCurrent(groupFolder: string, content: string): boolean {
    const cached = this.cache.get(groupFolder);
    if (!cached?.envChecksum) return false;
    const checksum = crypto.createHash('md5').update(content).digest('hex');
    return cached.envChecksum === checksum;
  }

  /**
   * Mark env file as written with the given content checksum.
   */
  markEnvWritten(groupFolder: string, content: string): void {
    const state = this.getOrCreate(groupFolder);
    state.envChecksum = crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Invalidate cache for a specific group (e.g., when config changes).
   */
  invalidateCache(groupFolder: string): void {
    this.cache.delete(groupFolder);
    logger.debug({ groupFolder }, 'Container pool cache invalidated');
  }

  /**
   * Pre-prepare mounts for known groups during idle periods.
   * Called by the scheduler when no tasks are running.
   */
  warmup(groupFolders: string[]): void {
    if (!CONTAINER_POOL_ENABLED || !this.config.preloadOnIdle) return;

    const toWarm = groupFolders.slice(0, this.config.maxPrewarmed);
    let warmedCount = 0;

    for (const folder of toWarm) {
      let didWork = false;

      // Pre-create IPC directories
      if (!this.ensureIpcDirs(folder)) didWork = true;

      // Pre-create session dirs and settings
      const groupSessionsDir = path.join(DATA_DIR, 'sessions', folder, '.claude');
      if (!this.ensureSettings(groupSessionsDir, folder)) didWork = true;

      // Pre-sync skills
      const checksum = this.getSkillsChecksum();
      if (checksum && !this.areSkillsSynced(folder)) {
        if (syncSkillsIfNeeded(groupSessionsDir, this.cache.get(folder), checksum)) {
          this.markSkillsSynced(folder, checksum);
          didWork = true;
        }
      }

      if (didWork) warmedCount++;
    }

    if (warmedCount > 0) {
      logger.debug(
        { warmedCount, total: toWarm.length },
        'Container pool warmup completed',
      );
    }
  }

  private getOrCreate(groupFolder: string): CachedGroupState {
    let state = this.cache.get(groupFolder);
    if (!state) {
      state = {
        cachedAt: Date.now(),
        ipcReady: false,
        settingsReady: false,
        skillsChecksum: null,
        skillsSynced: false,
        envChecksum: null,
      };
      this.cache.set(groupFolder, state);
    }
    return state;
  }
}

/** Singleton pool instance */
let poolInstance: ContainerPool | null = null;

export function getContainerPool(): ContainerPool {
  if (!poolInstance) {
    poolInstance = new ContainerPool();
  }
  return poolInstance;
}
