import { describe, expect, it } from 'vitest';

import { TaskEngine } from './index.js';

describe('TaskEngine', () => {
  it('runs typed steps and emits ordered events', async () => {
    const engine = new TaskEngine();
    engine.registerStep('uppercase', ({ text }) => Promise.resolve(String(text).toUpperCase()));
    const task = engine.create('Transform text', [
      { kind: 'uppercase', title: 'Uppercase', input: { text: 'movie' } },
    ]);
    const result = await engine.run(task.id);
    expect(result.status).toBe('succeeded');
    expect(result.steps[0]?.output).toBe('MOVIE');
    const events = engine.listEvents(task.id);
    expect(events.map((event) => event.sequence)).toEqual(
      [...events.map((event) => event.sequence)].sort((a, b) => a - b),
    );
  });

  it('fails safely and retries incomplete steps', async () => {
    const engine = new TaskEngine();
    let attempts = 0;
    engine.registerStep('flaky', () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('temporary')) : Promise.resolve('ok');
    });
    const task = engine.create('Retry', [{ kind: 'flaky', title: 'Flaky', input: {} }]);
    expect((await engine.run(task.id)).status).toBe('failed');
    const retried = await engine.run(task.id);
    expect(retried.status).toBe('succeeded');
    expect(retried.steps[0]?.attempt).toBe(2);
  });
});
