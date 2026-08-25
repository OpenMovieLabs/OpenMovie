import { describe, expect, it } from 'vitest';

import {
  BuiltInTakeEvaluator,
  compareEvaluationRuns,
  EvaluationEngine,
  TechnicalMediaEvaluator,
} from './index.js';

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

  it('reports technical evidence and detects evaluation regressions', async () => {
    const engine = new EvaluationEngine();
    engine.register(new TechnicalMediaEvaluator());
    const result = await engine.run({
      shot: {
        schema_version: 0,
        id: 'shot_technical',
        type: 'shot',
        revision: 0,
        scene: 'scene_test',
        order: 0,
        duration_us: 2_000_000,
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
        id: 'take_technical',
        mimeType: 'video/mp4',
        byteSize: 100,
        provider: {},
        generation: {},
      },
      delivery: { width: 1920, height: 1080 },
      technical: { width: 512, height: 512, durationUs: 3_000_000 },
    });
    expect(result.status).toBe('warning');
    expect(result.results[0]?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MEDIA_ASPECT_RATIO_MISMATCH' }),
        expect.objectContaining({ code: 'MEDIA_DURATION_MISMATCH' }),
      ]),
    );
    expect(
      compareEvaluationRuns(
        { id: 'base', status: 'passed', score: 1, findings: [] },
        {
          id: 'candidate',
          status: result.status,
          score: result.score,
          findings: result.results.flatMap((item) => item.findings),
        },
      ),
    ).toMatchObject({ regressed: true });
  });
});
