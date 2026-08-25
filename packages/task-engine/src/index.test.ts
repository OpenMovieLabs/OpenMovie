import { describe, expect, it } from 'vitest';

import { MemoryTaskPersistence, TaskEngine, type Task } from './index.js';

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

  it('pauses at an approval gate and resumes after approval', async () => {
    const engine = new TaskEngine();
    engine.registerStep('render', () => Promise.resolve('approved output'));
    const task = engine.create(
      'Render reviewed shot',
      [{ kind: 'render', title: 'Render', input: {} }],
      { requiresApproval: true },
    );

    expect((await engine.run(task.id)).status).toBe('awaiting_approval');
    const approved = await engine.approve(task.id);
    expect(approved.status).toBe('succeeded');
    expect(approved.approvedAt).toBeDefined();
  });

  it('recovers interrupted persisted tasks as retryable failures', () => {
    const persistence = new MemoryTaskPersistence();
    const now = new Date().toISOString();
    persistence.saveTask({
      id: 'task_interrupted',
      goal: 'Interrupted render',
      status: 'running',
      steps: [
        {
          id: 'step_interrupted',
          kind: 'render',
          title: 'Render',
          input: {},
          status: 'running',
          attempt: 1,
        },
      ],
      createdAt: now,
      updatedAt: now,
      requiresApproval: false,
    } satisfies Task);

    const recovered = new TaskEngine(persistence).get('task_interrupted');
    expect(recovered.status).toBe('failed');
    expect(recovered.steps[0]?.status).toBe('failed');
    expect(persistence.listEvents('task_interrupted')[0]?.type).toBe('task.recovered');
  });

  it('persists step checkpoints so asynchronous jobs can resume on retry', async () => {
    const persistence = new MemoryTaskPersistence();
    const engine = new TaskEngine(persistence);
    engine.registerStep('remote-job', (_input, context) => {
      if (context.step.output) return Promise.resolve({ resumed: context.step.output });
      context.checkpoint({ providerJobId: 'job_123' });
      return Promise.reject(new Error('connection interrupted'));
    });
    const task = engine.create('Run remote job', [
      { kind: 'remote-job', title: 'Remote job', input: {} },
    ]);
    expect((await engine.run(task.id)).status).toBe('failed');
    expect(engine.get(task.id).steps[0]?.output).toEqual({ providerJobId: 'job_123' });
    const retried = await engine.run(task.id);
    expect(retried.status).toBe('succeeded');
    expect(retried.steps[0]?.output).toEqual({ resumed: { providerJobId: 'job_123' } });
    expect(engine.listEvents(task.id).some((event) => event.type === 'step.checkpointed')).toBe(
      true,
    );
  });
});
