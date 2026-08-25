import { hostname } from 'node:os';
import { open, readFile, unlink, type FileHandle } from 'node:fs/promises';

import { createId } from '@openmovie/movie-ir';

import { writeFileAtomic } from './fs.js';
import { ProjectStoreError } from './errors.js';

type LockData = {
  instance_id: string;
  pid: number;
  host: string;
  created_at: string;
  heartbeat_at: string;
};

const HEARTBEAT_MS = 5_000;
const STALE_MS = 20_000;

export class ProjectLock {
  private heartbeat: NodeJS.Timeout | undefined;

  private constructor(
    private readonly path: string,
    private readonly handle: FileHandle,
    private readonly data: LockData,
  ) {}

  static async acquire(path: string, takeoverStale = false): Promise<ProjectLock> {
    let handle: FileHandle;
    try {
      handle = await open(path, 'wx+', 0o600);
    } catch (error) {
      if (!ProjectLock.isAlreadyExists(error)) throw error;
      const existing = await ProjectLock.read(path);
      const stale = !existing || ProjectLock.isStale(existing);
      if (!stale || !takeoverStale) {
        throw new ProjectStoreError(
          stale ? 'PROJECT_LOCK_STALE' : 'PROJECT_LOCKED',
          stale
            ? 'Project has a stale writer lock; explicit takeover is required'
            : `Project is already open for writing by process ${String(existing?.pid ?? 'unknown')}`,
          stale,
        );
      }
      await unlink(path);
      handle = await open(path, 'wx+', 0o600);
    }

    const now = new Date().toISOString();
    const lock = new ProjectLock(path, handle, {
      instance_id: createId('instance'),
      pid: process.pid,
      host: hostname(),
      created_at: now,
      heartbeat_at: now,
    });
    await lock.write();
    lock.heartbeat = setInterval(() => void lock.pulse(), HEARTBEAT_MS);
    lock.heartbeat.unref();
    return lock;
  }

  async release(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    await this.handle.close();
    const current = await ProjectLock.read(this.path);
    if (current?.instance_id === this.data.instance_id)
      await unlink(this.path).catch(() => undefined);
  }

  private async pulse(): Promise<void> {
    this.data.heartbeat_at = new Date().toISOString();
    await this.write().catch(() => undefined);
  }

  private async write(): Promise<void> {
    await this.handle.truncate(0);
    await this.handle.write(JSON.stringify(this.data), 0, 'utf8');
    await this.handle.sync();
  }

  private static async read(path: string): Promise<LockData | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as LockData;
    } catch {
      return undefined;
    }
  }

  private static isStale(data: LockData): boolean {
    const heartbeatAge = Date.now() - Date.parse(data.heartbeat_at);
    if (!Number.isFinite(heartbeatAge) || heartbeatAge > STALE_MS) return true;
    if (data.host !== hostname()) return false;
    try {
      process.kill(data.pid, 0);
      return false;
    } catch {
      return true;
    }
  }

  private static isAlreadyExists(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST';
  }
}

export async function forceWriteLockFixture(path: string, data: LockData): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(data));
}
