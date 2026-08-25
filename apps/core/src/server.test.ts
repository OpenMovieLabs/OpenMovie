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
      `let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const r=JSON.parse(b);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{text:'{"summary":"No IR change","actions":[]}',model:r.params.model,finishReason:'stop'}})+'\\n')})`,
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
