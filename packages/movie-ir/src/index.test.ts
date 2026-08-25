import { describe, expect, it } from 'vitest';

import {
  createId,
  createProjectManifest,
  parseProjectManifest,
  serializeProjectManifest,
} from './index.js';

describe('Movie IR', () => {
  it('round-trips a project manifest through stable YAML', () => {
    const original = createProjectManifest('A Film', 'zh-CN');
    const first = serializeProjectManifest(original);
    const second = serializeProjectManifest(parseProjectManifest(first));

    expect(second).toBe(first);
    expect(parseProjectManifest(second)).toEqual(original);
  });

  it('creates valid unique entity IDs', () => {
    const first = createId('shot');
    const second = createId('shot');
    expect(first).toMatch(/^shot_[a-z0-9]+$/);
    expect(second).not.toBe(first);
  });

  it('rejects absolute entrypoint paths', () => {
    const manifest = createProjectManifest('Unsafe');
    manifest.entrypoints.brief = '/tmp/brief.yaml';
    expect(() => serializeProjectManifest(manifest)).toThrow(/POSIX relative/);
  });
});
