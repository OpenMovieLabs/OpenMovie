import { describe, expect, it } from 'vitest';

import { BuiltInTakeEvaluator, EvaluationEngine } from './index.js';

describe('EvaluationEngine', () => {
  it('turns reproducibility and media checks into a deterministic gate', async () => {
    const engine = new EvaluationEngine();
    engine.register(new BuiltInTakeEvaluator());
    const result = await engine.run({
      shot: {
        schema_version: 0,
        id: 'shot_test',
        type: 'shot',
        revision: 0,
        scene: 'scene_test',
        order: 0,
        duration_us: 1_000_000,
        characters: [],
        camera: {},
        performance: {},
        dialogue: null,
        constraints: [],
        generation: {
          strategy: 'balanced',
          preferred_mode: 'text_to_video',
          references: [],
          provider_override: null,
        },
        selected_take: null,
        extensions: {},
      },
      take: {
        id: 'take_test',
        mimeType: 'image/png',
        byteSize: 100,
        provider: {},
        generation: {},
      },
    });
    expect(result.status).toBe('failed');
    expect(result.results[0]?.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'MEDIA_KIND_MISMATCH',
        'PROVENANCE_REQUEST_HASH_MISSING',
        'PROVENANCE_PROVIDER_MISSING',
      ]),
    );
  });
});
