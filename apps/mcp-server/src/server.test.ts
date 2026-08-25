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

    const summary = await client.callTool({ name: 'project_summary', arguments: {} });
    expect(summary.structuredContent).toMatchObject({ title: 'MCP Movie', currentBranch: 'main' });

    const expectedRevisionId = project.revisions.currentRevisionId();
    if (!expectedRevisionId) throw new Error('Expected an initial Revision');
    const created = await client.callTool({
      name: 'scene_create',
      arguments: { title: 'MCP opening', expectedRevisionId },
    });
    expect(created.isError).not.toBe(true);
    expect(await project.movies.list('scene')).toHaveLength(1);

    await client.close();
    await server.close();
    await project.close();
  });
});
