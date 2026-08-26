import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProjectLock, forceWriteLockFixture } from './lock.js';

describe('ProjectLock', () => {
  it('prevents concurrent writers and releases only its own lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-lock-live-'));
    const path = join(root, 'writer.lock');
    const first = await ProjectLock.acquire(path);
    await expect(ProjectLock.acquire(path)).rejects.toMatchObject({
      code: 'PROJECT_LOCKED',
      retryable: false,
    });
    const lockData = JSON.parse(await readFile(path, 'utf8')) as { pid: number; host: string };
    expect(lockData).toMatchObject({ pid: process.pid, host: hostname() });
    await first.release();

    const reopened = await ProjectLock.acquire(path);
    await reopened.release();
  });

  it('requires explicit takeover for stale or malformed locks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-lock-stale-'));
    const path = join(root, 'writer.lock');
    await forceWriteLockFixture(path, {
      instance_id: 'instance_stale',
      pid: 2_147_483_647,
      host: hostname(),
      created_at: '2000-01-01T00:00:00.000Z',
      heartbeat_at: '2000-01-01T00:00:00.000Z',
    });
    await expect(ProjectLock.acquire(path)).rejects.toMatchObject({
      code: 'PROJECT_LOCK_STALE',
      retryable: true,
    });
    const takeover = await ProjectLock.acquire(path, true);
    await takeover.release();

    await writeFile(path, 'not-json');
    await expect(ProjectLock.acquire(path)).rejects.toMatchObject({ code: 'PROJECT_LOCK_STALE' });
    const malformedTakeover = await ProjectLock.acquire(path, true);
    await malformedTakeover.release();
  });
});
