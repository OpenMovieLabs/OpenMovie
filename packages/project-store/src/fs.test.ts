import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveProjectPath, writeFileAtomic } from './fs.js';

describe('project filesystem helpers', () => {
  it('resolves nested project paths without allowing root escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-fs-path-'));
    expect(resolveProjectPath(root, 'scenes/scene_1.yaml')).toBe(
      join(root, 'scenes', 'scene_1.yaml'),
    );
    expect(resolveProjectPath(root, '.')).toBe(root);
    expect(() => resolveProjectPath(root, '../outside.yaml')).toThrow(/escapes project root/);
    expect(() => resolveProjectPath(root, join(root, '..', 'outside.yaml'))).toThrow(
      /escapes project root/,
    );
  });

  it('atomically creates parent directories and replaces existing content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-fs-write-'));
    const target = join(root, 'nested', 'document.yaml');
    await writeFileAtomic(target, 'first');
    expect(await readFile(target, 'utf8')).toBe('first');
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }

    await writeFileAtomic(target, Uint8Array.from(Buffer.from('second')));
    expect(await readFile(target, 'utf8')).toBe('second');
  });
});
