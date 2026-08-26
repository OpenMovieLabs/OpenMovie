import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  projectSummarySchema,
  takeRecordSchema,
  taskSchema,
  timelineRenderRecordSchema,
} from '@openmovie/contracts';
import { FfmpegTimelineRenderer } from '@openmovie/media-engine';

import { CoreServer } from './server.js';

let commandSequence = 0;

async function sendCore(
  server: CoreServer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await server.handle({ id: `test-${commandSequence++}`, method, params });
  if (!response.ok) throw Object.assign(new Error(response.error.message), response.error);
  return response.result;
}

describe('CoreServer', () => {
  it('initializes a compatible client', async () => {
    const response = await new CoreServer().handle({
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        client: { name: 'test', version: '0.0.0', platform: 'linux' },
      },
    });

    expect(response.ok).toBe(true);
  });

  it('returns typed failures for invalid commands', async () => {
    const response = await new CoreServer().handle({ id: 'bad', method: 'unknown' });
    expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });

  it('loads an explicitly enabled development Plugin as a planning Provider', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-core-plugin-'));
    const entry = join(parent, 'plugin.mjs');
    await writeFile(
      entry,
      `let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const r=JSON.parse(b);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{text:'{"summary":"Add an alternate scene","actions":[{"type":"scene.create","title":"Agent scene","story_goal":"Reveal the signal"}]}',model:r.params.model,finishReason:'stop'}})+'\\n')})`,
    );
    const manifest = join(parent, 'openmovie.plugin.json');
    await writeFile(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        id: 'plugin.core_fixture',
        name: 'Core Fixture',
        apiVersion: '0.1.0',
        entry: 'plugin.mjs',
        capabilities: ['text.generate'],
      }),
    );
    const previous = process.env.OPENMOVIE_PLUGIN_DEV_MANIFESTS;
    process.env.OPENMOVIE_PLUGIN_DEV_MANIFESTS = manifest;
    const server = new CoreServer();
    try {
      const initialized = await server.handle({
        id: 'plugin-init',
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          client: { name: 'test', version: '0.0.0', platform: 'linux' },
        },
      });
      expect(initialized.ok).toBe(true);
      const listed = await server.handle({
        id: 'plugin-list',
        method: 'provider.list',
        params: {},
      });
      expect(listed).toMatchObject({
        ok: true,
        result: [
          expect.objectContaining({ id: 'fake' }),
          expect.objectContaining({ id: 'plugin.core_fixture' }),
        ],
      });
      const summary = projectSummarySchema.parse(
        await sendCore(server, 'project.create', {
          path: join(parent, 'movie'),
          title: 'Plugin Planning',
        }),
      );
      const scene = (await sendCore(server, 'movie.scene_create', {
        title: 'User scene',
        expectedRevisionId: summary.currentRevisionId,
        authorId: 'test',
      })) as { entity: { id: string }; revision: { id: string } };
      const shot = (await sendCore(server, 'movie.shot_create', {
        sceneId: scene.entity.id,
        durationUs: 1_000_000,
        expectedRevisionId: scene.revision.id,
        authorId: 'test',
      })) as { entity: { id: string } };
      const createTask = async (): Promise<void> => {
        const task = taskSchema.parse(
          await sendCore(server, 'task.create', {
            goal: 'Add an alternate scene',
            plannerProviderId: 'plugin.core_fixture',
            plannerModel: 'fixture-model',
            requiresApproval: false,
            targetShotId: shot.entity.id,
            mediaKind: 'image',
            mediaProviderId: 'fake',
            mediaModel: 'fake-image-v1',
          }),
        );
        expect(
          taskSchema.parse(await sendCore(server, 'task.run', { taskId: task.id })).status,
        ).toBe('succeeded');
      };
      await createTask();
      const rejectedProposal = (
        (await sendCore(server, 'proposal.list', { status: 'pending' })) as Array<{ id: string }>
      )[0];
      if (!rejectedProposal) throw new Error('Expected a pending proposal');
      expect(
        await sendCore(server, 'proposal.reject', { proposalId: rejectedProposal.id }),
      ).toMatchObject({ status: 'rejected' });

      await createTask();
      const acceptedProposal = (
        (await sendCore(server, 'proposal.list', { status: 'pending' })) as Array<{
          id: string;
          baseRevisionId: string;
        }>
      )[0];
      if (!acceptedProposal) throw new Error('Expected another pending proposal');
      expect(
        await sendCore(server, 'proposal.accept', {
          proposalId: acceptedProposal.id,
          expectedRevisionId: acceptedProposal.baseRevisionId,
        }),
      ).toMatchObject({ status: 'accepted' });
      expect(await sendCore(server, 'movie.entity_list', { kind: 'scene' })).toHaveLength(2);
    } finally {
      await server.close();
      if (previous === undefined) delete process.env.OPENMOVIE_PLUGIN_DEV_MANIFESTS;
      else process.env.OPENMOVIE_PLUGIN_DEV_MANIFESTS = previous;
    }
  });

  it('requires approval for remote Providers and versions project data policy changes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-core-policy-'));
    const server = new CoreServer();
    try {
      let sequence = 0;
      const send = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
        const response = await server.handle({ id: `policy-${sequence++}`, method, params });
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
        return response.result;
      };
      let summary = projectSummarySchema.parse(
        await send('project.create', { path: join(parent, 'movie'), title: 'Policy Movie' }),
      );
      expect(summary.policies).toEqual({
        monthlyBudgetUsdMicros: null,
        remoteMediaPolicy: 'confirm',
      });
      const remoteTask = taskSchema.parse(
        await send('task.create', {
          goal: 'Remote planning request',
          plannerProviderId: 'remote_fixture',
          plannerModel: 'fixture-model',
          requiresApproval: false,
          mediaKind: 'image',
          mediaProviderId: 'fake',
          mediaModel: 'fake-image-v1',
        }),
      );
      expect(remoteTask.requiresApproval).toBe(true);
      expect(taskSchema.parse(await send('task.run', { taskId: remoteTask.id })).status).toBe(
        'awaiting_approval',
      );

      await send('project.policy_update', {
        expectedRevisionId: summary.currentRevisionId,
        monthlyBudgetUsdMicros: 5_000_000,
        remoteMediaPolicy: 'deny',
        authorId: 'test',
      });
      summary = projectSummarySchema.parse(await send('project.get_summary', {}));
      expect(summary.policies).toEqual({
        monthlyBudgetUsdMicros: 5_000_000,
        remoteMediaPolicy: 'deny',
      });
    } finally {
      await server.close();
    }
  });

  it('routes project editing, timeline, feedback, storage, and Revision commands', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-core-commands-'));
    const importedPath = join(parent, 'reference.png');
    await writeFile(
      importedPath,
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('fixture')]),
    );
    const server = new CoreServer();
    try {
      const summary = projectSummarySchema.parse(
        await sendCore(server, 'project.create', {
          path: join(parent, 'movie'),
          title: 'Command Surface',
        }),
      );
      const character = (await sendCore(server, 'movie.character_create', {
        name: 'Mira',
        appearance: 'Silver coat',
        expectedRevisionId: summary.currentRevisionId,
        authorId: 'test',
      })) as { entity: Record<string, unknown>; revision: { id: string } };
      const scene = (await sendCore(server, 'movie.scene_create', {
        title: 'Arrival',
        storyGoal: 'Introduce the city',
        expectedRevisionId: character.revision.id,
        authorId: 'test',
      })) as { entity: { id: string }; revision: { id: string } };
      const shot = (await sendCore(server, 'movie.shot_create', {
        sceneId: scene.entity.id,
        durationUs: 2_000_000,
        framing: 'wide',
        expectedRevisionId: scene.revision.id,
        authorId: 'test',
      })) as { entity: Record<string, unknown>; revision: { id: string } };

      expect(await sendCore(server, 'movie.entity_list', { kind: 'character' })).toHaveLength(1);
      expect(await sendCore(server, 'movie.entity_list', { kind: 'scene' })).toHaveLength(1);
      expect(await sendCore(server, 'movie.entity_list', { kind: 'shot' })).toHaveLength(1);
      const updatedShot = (await sendCore(server, 'movie.entity_update', {
        entity: {
          ...shot.entity,
          camera: { framing: 'close-up', movement: 'locked' },
        },
        expectedEntityRevision: shot.entity.revision,
        expectedRevisionId: shot.revision.id,
        authorType: 'user',
        authorId: 'test',
        message: 'Tighten the shot',
      })) as {
        entity: { camera: { framing: string }; revision: number };
        revision: { id: string };
      };
      expect(updatedShot.entity).toMatchObject({ camera: { framing: 'close-up' }, revision: 1 });

      const story = (await sendCore(server, 'story.update', {
        premise: 'A courier reaches a silent city.',
        themes: ['memory'],
        world: 'A flooded metropolis',
        rules: ['No spoken exposition'],
        expectedRevisionId: updatedShot.revision.id,
        authorId: 'test',
      })) as { revision: { id: string } };
      expect(await sendCore(server, 'story.get')).toMatchObject({
        brief: { premise: 'A courier reaches a silent city.' },
        bible: { themes: ['memory'] },
      });
      const assembled = (await sendCore(server, 'timeline.assemble', {
        expectedRevisionId: story.revision.id,
        authorId: 'test',
      })) as { timeline: { video_tracks: Array<{ clips: unknown[] }> }; revision: { id: string } };
      expect(assembled.timeline.video_tracks[0]?.clips).toHaveLength(1);
      expect(await sendCore(server, 'timeline.get')).toMatchObject({ revision: 1 });

      const feedback = (await sendCore(server, 'feedback.create', {
        targetType: 'shot',
        targetId: shot.entity.id,
        body: 'Hold the close-up longer',
        authorId: 'reviewer',
        timeRangeUs: { startUs: 100_000, endUs: 500_000 },
      })) as { id: string };
      expect(await sendCore(server, 'feedback.list', { status: 'open' })).toMatchObject([
        { id: feedback.id, targetId: shot.entity.id },
      ]);
      expect(
        await sendCore(server, 'feedback.resolve', {
          feedbackId: feedback.id,
          revisionId: assembled.revision.id,
        }),
      ).toMatchObject({ status: 'resolved', resolutionRevisionId: assembled.revision.id });

      expect(await sendCore(server, 'object.import', { path: importedPath })).toMatchObject({
        mimeType: 'image/png',
      });
      expect(await sendCore(server, 'project.doctor', { deep: true })).toMatchObject({
        status: 'healthy',
      });
      expect(await sendCore(server, 'project.storage_report')).toHaveProperty('totalBytes');
      expect(
        await sendCore(server, 'project.storage_clean', { categories: ['cache', 'previews'] }),
      ).toHaveProperty('reclaimableBytes');
      const revisions = (await sendCore(server, 'revision.list', { limit: 100 })) as Array<{
        id: string;
      }>;
      expect(revisions.length).toBeGreaterThan(4);
      expect(
        await sendCore(server, 'revision.diff', { revisionId: assembled.revision.id }),
      ).toHaveProperty('files');
      expect(await sendCore(server, 'revision.working_changes')).toEqual([]);
      await sendCore(server, 'revision.branch_create', { name: 'alternate-cut' });
      await sendCore(server, 'revision.branch_switch', { name: 'alternate-cut' });
      expect(await sendCore(server, 'revision.branch_list')).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'alternate-cut', current: true })]),
      );
    } finally {
      await server.close();
    }
  });

  it('configures Provider protocols and persists task, Take, evaluation, and usage state', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-core-task-surface-'));
    const root = join(parent, 'movie');
    const server = new CoreServer();
    try {
      const summary = projectSummarySchema.parse(
        await sendCore(server, 'project.create', { path: root, title: 'Task Surface' }),
      );
      const scene = (await sendCore(server, 'movie.scene_create', {
        title: 'Opening',
        expectedRevisionId: summary.currentRevisionId,
        authorId: 'test',
      })) as { entity: { id: string }; revision: { id: string } };
      const shot = (await sendCore(server, 'movie.shot_create', {
        sceneId: scene.entity.id,
        durationUs: 1_000_000,
        expectedRevisionId: scene.revision.id,
        authorId: 'test',
      })) as { entity: { id: string }; revision: { id: string } };

      await sendCore(server, 'provider.configure_openai_compatible', {
        id: 'chat-fixture',
        baseUrl: 'https://example.invalid/v1/',
        apiKey: 'test-key',
        imageGeneration: true,
      });
      await sendCore(server, 'provider.configure_openai_responses', {
        id: 'responses-fixture',
        baseUrl: 'https://example.invalid/v1/',
        apiKey: 'test-key',
      });
      await sendCore(server, 'provider.configure_http_video', {
        id: 'video-fixture',
        baseUrl: 'https://example.invalid/v1/',
        apiKey: 'test-key',
        path: 'jobs',
      });
      expect(await sendCore(server, 'provider.list')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'chat-fixture' }),
          expect.objectContaining({ id: 'responses-fixture' }),
          expect.objectContaining({ id: 'video-fixture' }),
        ]),
      );

      const task = taskSchema.parse(
        await sendCore(server, 'task.create', {
          goal: 'Generate a deterministic opening frame',
          plannerProviderId: 'fake',
          plannerModel: 'fake-text-v1',
          requiresApproval: false,
          targetShotId: shot.entity.id,
          mediaKind: 'image',
          mediaProviderId: 'fake',
          mediaModel: 'fake-image-v1',
        }),
      );
      expect(taskSchema.parse(await sendCore(server, 'task.run', { taskId: task.id })).status).toBe(
        'succeeded',
      );
      expect(await sendCore(server, 'task.list')).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.id, status: 'succeeded' })]),
      );
      expect(
        await sendCore(server, 'task.events', { taskId: task.id, afterSequence: 0 }),
      ).not.toHaveLength(0);
      const take = takeRecordSchema
        .array()
        .parse(await sendCore(server, 'take.list', { shotId: shot.entity.id }))[0];
      if (!take) throw new Error('Expected a generated Take');
      expect(await sendCore(server, 'evaluation.list', { takeId: take.id })).not.toHaveLength(0);
      const analysisTask = taskSchema.parse(
        await sendCore(server, 'analysis.create_task', {
          takeId: take.id,
          providerId: 'fake',
          model: 'fake-vision-v1',
          prompt: 'Describe the opening frame',
        }),
      );
      expect(
        taskSchema.parse(await sendCore(server, 'task.run', { taskId: analysisTask.id })).status,
      ).toBe('succeeded');
      expect(await sendCore(server, 'analysis.list', { takeId: take.id })).toMatchObject([
        { kind: 'image', summary: 'Fake visual analysis: Describe the opening frame' },
      ]);
      const selected = (await sendCore(server, 'take.select', {
        takeId: take.id,
        expectedRevisionId: shot.revision.id,
        authorId: 'test',
      })) as { revisionId: string };
      const renderTask = taskSchema.parse(
        await sendCore(server, 'timeline.render_create_task', {
          sourceRevisionId: selected.revisionId,
        }),
      );
      expect(
        taskSchema.parse(await sendCore(server, 'task.cancel', { taskId: renderTask.id })).status,
      ).toBe('cancelled');

      const approvalTask = taskSchema.parse(
        await sendCore(server, 'task.create', {
          goal: 'Generate another review frame',
          plannerProviderId: 'fake',
          plannerModel: 'fake-text-v1',
          requiresApproval: true,
          targetShotId: shot.entity.id,
          mediaKind: 'image',
          mediaProviderId: 'fake',
          mediaModel: 'fake-image-v1',
        }),
      );
      expect(
        taskSchema.parse(await sendCore(server, 'task.run', { taskId: approvalTask.id })).status,
      ).toBe('awaiting_approval');
      expect(
        taskSchema.parse(await sendCore(server, 'task.approve', { taskId: approvalTask.id }))
          .status,
      ).toBe('succeeded');
      expect(await sendCore(server, 'timeline.render_list')).toEqual([]);
      expect(await sendCore(server, 'provider.usage_summary')).toMatchObject({ runCount: 5 });

      await sendCore(server, 'project.close');
      expect(
        await sendCore(server, 'project.open', { path: root, takeoverStaleLock: false }),
      ).toMatchObject({ title: 'Task Surface' });
      expect(await sendCore(server, 'task.list')).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.id, status: 'succeeded' })]),
      );
    } finally {
      await server.close();
    }
  });

  it('renders a selected Take into a persisted Current Cut when FFmpeg is available', async () => {
    if (!(await new FfmpegTimelineRenderer().detect()).available) return;
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-core-render-'));
    const server = new CoreServer();
    try {
      let sequence = 0;
      const send = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
        const response = await server.handle({ id: `render-${sequence++}`, method, params });
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
        return response.result;
      };
      let summary = projectSummarySchema.parse(
        await send('project.create', { path: join(parent, 'movie'), title: 'Rendered Movie' }),
      );
      const scene = (await send('movie.scene_create', {
        title: 'Opening',
        expectedRevisionId: summary.currentRevisionId,
        authorId: 'test',
      })) as { entity: { id: string }; revision: { id: string } };
      const shot = (await send('movie.shot_create', {
        sceneId: scene.entity.id,
        durationUs: 250_000,
        expectedRevisionId: scene.revision.id,
        authorId: 'test',
      })) as { entity: { id: string }; revision: { id: string } };
      const generated = taskSchema.parse(
        await send('task.create', {
          goal: 'Create a fixture frame',
          plannerProviderId: 'fake',
          plannerModel: 'fake-text-v1',
          requiresApproval: false,
          targetShotId: shot.entity.id,
          mediaKind: 'image',
          mediaProviderId: 'fake',
          mediaModel: 'fake-image-v1',
        }),
      );
      expect(taskSchema.parse(await send('task.run', { taskId: generated.id })).status).toBe(
        'succeeded',
      );
      const take = takeRecordSchema
        .array()
        .parse(await send('take.list', { shotId: shot.entity.id }))[0];
      if (!take) throw new Error('Expected generated Take');
      const selected = (await send('take.select', {
        takeId: take.id,
        expectedRevisionId: shot.revision.id,
        authorId: 'test',
      })) as { revisionId: string };
      const assembled = (await send('timeline.assemble', {
        expectedRevisionId: selected.revisionId,
        authorId: 'test',
      })) as { revision: { id: string } };
      summary = projectSummarySchema.parse(await send('project.get_summary', {}));
      expect(summary.currentRevisionId).toBe(assembled.revision.id);
      const renderTask = taskSchema.parse(
        await send('timeline.render_create_task', { sourceRevisionId: assembled.revision.id }),
      );
      expect(taskSchema.parse(await send('task.run', { taskId: renderTask.id })).status).toBe(
        'succeeded',
      );
      expect(
        timelineRenderRecordSchema.array().parse(await send('timeline.render_list', {}))[0],
      ).toMatchObject({ mimeType: 'video/mp4', durationUs: 250_000 });
    } finally {
      await server.close();
    }
  }, 30_000);
});
