import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { ProjectStore } from '@openmovie/project-store';
import { describe, expect, it } from 'vitest';

import { createOpenMovieMcpServer } from './server.js';

describe('OpenMovie MCP Server', () => {
  it('exposes validated read and Revision-writing movie tools', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-mcp-'));
    const project = await ProjectStore.create(join(parent, 'movie'), { title: 'MCP Movie' });
    const server = createOpenMovieMcpServer(project);
    const client = new Client({ name: 'openmovie-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('scene_create');
    expect(tools.tools.map((tool) => tool.name)).toContain('revision_diff');
    expect(tools.tools.map((tool) => tool.name)).toContain('feedback_create');
    expect(tools.tools.map((tool) => tool.name)).toContain('timeline_assemble');
    expect(tools.tools.map((tool) => tool.name)).toContain('timeline_render_list');
    expect(tools.tools.map((tool) => tool.name)).toContain('proposal_list');

    const summary = await client.callTool({ name: 'project_summary', arguments: {} });
    expect(summary.structuredContent).toMatchObject({ title: 'MCP Movie', currentBranch: 'main' });

    const expectedRevisionId = project.revisions.currentRevisionId();
    if (!expectedRevisionId) throw new Error('Expected an initial Revision');
    const created = await client.callTool({
      name: 'scene_create',
      arguments: { title: 'MCP opening', expectedRevisionId },
    });
    expect(created.isError).not.toBe(true);
    const scenes = await project.movies.list('scene');
    expect(scenes).toHaveLength(1);
    const scene = scenes[0];
    if (!scene) throw new Error('Expected a Scene');
    const afterScene = project.revisions.currentRevisionId();
    if (!afterScene) throw new Error('Expected Scene Revision');
    const shotCreated = await client.callTool({
      name: 'shot_create',
      arguments: {
        sceneId: scene.id,
        durationUs: 1_500_000,
        framing: 'wide',
        movement: 'slow push',
        expectedRevisionId: afterScene,
      },
    });
    expect(shotCreated.isError).not.toBe(true);
    const shots = await client.callTool({ name: 'entity_list', arguments: { kind: 'shot' } });
    expect(shots.structuredContent).toMatchObject({
      entities: [expect.objectContaining({ type: 'shot' })],
    });

    const afterShot = project.revisions.currentRevisionId();
    if (!afterShot) throw new Error('Expected Shot Revision');
    expect(
      (
        await client.callTool({
          name: 'story_update',
          arguments: {
            premise: 'An arrival changes the city.',
            themes: ['change'],
            world: 'A silent metropolis',
            rules: ['Keep screen direction consistent'],
            expectedRevisionId: afterShot,
          },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name: 'story_get', arguments: {} })).structuredContent,
    ).toMatchObject({ brief: { premise: 'An arrival changes the city.' } });

    const afterStory = project.revisions.currentRevisionId();
    if (!afterStory) throw new Error('Expected Story Revision');
    expect(
      (
        await client.callTool({
          name: 'timeline_assemble',
          arguments: { expectedRevisionId: afterStory },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name: 'timeline_get', arguments: {} })).structuredContent,
    ).toMatchObject({ revision: 1 });
    expect(
      (await client.callTool({ name: 'timeline_render_list', arguments: {} })).structuredContent,
    ).toEqual({ renders: [] });

    const currentRevisionId = project.revisions.currentRevisionId();
    if (!currentRevisionId) throw new Error('Expected current Revision');
    const revisionList = (
      await client.callTool({ name: 'revision_list', arguments: { limit: 20 } })
    ).structuredContent as { revisions: Array<{ id: string }> };
    expect(revisionList.revisions.some((revision) => revision.id === currentRevisionId)).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'revision_diff',
          arguments: { revisionId: currentRevisionId },
        })
      ).structuredContent,
    ).toHaveProperty('files');
    expect(
      (await client.callTool({ name: 'working_changes', arguments: {} })).structuredContent,
    ).toEqual({
      files: [],
    });

    const feedback = await client.callTool({
      name: 'feedback_create',
      arguments: { targetType: 'scene', targetId: scene.id, body: 'Raise the emotional stakes' },
    });
    expect(feedback.isError).not.toBe(true);
    expect(project.feedback.list({ targetType: 'scene', targetId: scene.id })).toHaveLength(1);
    expect(
      (
        await client.callTool({
          name: 'feedback_list',
          arguments: { targetType: 'scene', targetId: scene.id, status: 'open' },
        })
      ).structuredContent,
    ).toMatchObject({
      feedback: [expect.objectContaining({ body: 'Raise the emotional stakes' })],
    });
    const shot = (await project.movies.list('shot'))[0];
    if (!shot) throw new Error('Expected a Shot');
    expect(
      (await client.callTool({ name: 'take_list', arguments: { shotId: shot.id } }))
        .structuredContent,
    ).toEqual({ takes: [] });
    expect(
      (await client.callTool({ name: 'evaluation_list', arguments: { takeId: 'take_missing' } }))
        .structuredContent,
    ).toEqual({ evaluations: [] });
    expect(
      (await client.callTool({ name: 'analysis_list', arguments: { takeId: 'take_missing' } }))
        .structuredContent,
    ).toEqual({ analyses: [] });
    expect(
      (await client.callTool({ name: 'proposal_list', arguments: {} })).structuredContent,
    ).toEqual({
      proposals: [],
    });
    expect(
      (await client.callTool({ name: 'branch_create', arguments: { name: 'mcp-branch' } })).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name: 'branch_switch', arguments: { name: 'mcp-branch' } })).isError,
    ).not.toBe(true);
    const branchList = (await client.callTool({ name: 'branch_list', arguments: {} }))
      .structuredContent as { branches: Array<{ name: string; current: boolean }> };
    expect(
      branchList.branches.some((branch) => branch.name === 'mcp-branch' && branch.current),
    ).toBe(true);

    await client.close();
    await server.close();
    await project.close();
  });
});
