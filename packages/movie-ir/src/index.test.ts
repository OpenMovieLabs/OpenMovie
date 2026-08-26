import { describe, expect, it } from 'vitest';

import {
  agentPlanJsonSchema,
  agentPlanSchema,
  createId,
  createProjectManifest,
  parseProjectManifest,
  serializeProjectManifest,
} from './index.js';

describe('Movie IR', () => {
  it('exposes a Codex-compatible strict JSON schema without unsupported unions', () => {
    const serialized = JSON.stringify(agentPlanJsonSchema);
    expect(serialized).not.toContain('oneOf');
    expect(serialized).toContain('character.create');
    expect(serialized).toContain('visual_description');
  });

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

  it('validates bounded Direct Agent actions before they can modify Movie IR', () => {
    expect(
      agentPlanSchema.parse({
        summary: 'Create an opening scene and its first shot',
        actions: [
          {
            type: 'character.create',
            key: '@lead',
            name: 'Lin',
            appearance: 'Red raincoat',
          },
          { type: 'scene.create', title: 'Arrival', story_goal: 'Introduce the city' },
          {
            type: 'shot.create',
            scene_id: '@last_scene',
            duration_us: 4_000_000,
            character_refs: ['@lead'],
            framing: 'wide',
            visual_description: 'Lin enters the flooded station.',
          },
        ],
      }).actions,
    ).toHaveLength(3);
    expect(() =>
      agentPlanSchema.parse({
        summary: 'Unsafe plan',
        actions: [{ type: 'file.delete', path: 'openmovie.yaml' }],
      }),
    ).toThrow();
  });
});
