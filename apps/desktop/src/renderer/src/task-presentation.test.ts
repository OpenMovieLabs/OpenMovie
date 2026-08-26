import { describe, expect, it } from 'vitest';

import type { Task } from '@openmovie/contracts';

import { taskResponseText, visibleExecutionSteps } from './task-presentation.js';

const task = (overrides: Partial<Task>): Task => ({
  id: 'task-1',
  goal: 'hello',
  status: 'succeeded',
  steps: [],
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:01.000Z',
  requiresApproval: false,
  ...overrides,
});

describe('task presentation', () => {
  it('shows the conversational summary instead of internal plan JSON', () => {
    const result = taskResponseText(
      task({
        steps: [
          {
            id: 'step-1',
            kind: 'text.generate',
            title: 'Reply to the user',
            input: {},
            status: 'succeeded',
            attempt: 1,
            output: {
              text: '{"summary":"这是直接回复","actions":[]}',
            },
          },
        ],
      }),
      'zh-CN',
    );
    expect(result).toBe('这是直接回复');
  });

  it('cleans plan JSON persisted inside legacy proposal summaries', () => {
    const result = taskResponseText(
      task({
        steps: [
          {
            id: 'step-1',
            kind: 'proposal.create_from_plan',
            title: 'Prepare reviewable Movie IR actions',
            input: {},
            status: 'succeeded',
            attempt: 1,
            output: {
              proposal: null,
              summary: '{"summary":"只显示这句话","actions":[]}',
            },
          },
        ],
      }),
      'zh-CN',
    );
    expect(result).toBe('只显示这句话');
  });

  it('hides conversational implementation steps but keeps real tool work', () => {
    const steps = visibleExecutionSteps(
      task({
        steps: [
          {
            id: 'step-1',
            kind: 'text.generate',
            title: 'Reply',
            input: {},
            status: 'succeeded',
            attempt: 1,
          },
          {
            id: 'step-2',
            kind: 'image.generate',
            title: 'Generate an image Take',
            input: {},
            status: 'running',
            attempt: 1,
          },
        ],
      }),
    );
    expect(steps.map((step) => step.kind)).toEqual(['image.generate']);
  });

  it('returns a resource confirmation for a completed image task', () => {
    expect(
      taskResponseText(
        task({
          steps: [
            {
              id: 'step-1',
              kind: 'image.generate',
              title: 'Generate an image Take',
              input: {},
              status: 'succeeded',
              attempt: 1,
            },
          ],
        }),
        'zh-CN',
      ),
    ).toContain('右侧资源区');
  });
});
