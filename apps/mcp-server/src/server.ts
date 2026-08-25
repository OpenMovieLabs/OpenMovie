import { McpServer } from '@modelcontextprotocol/server';
import type { ProjectStore } from '@openmovie/project-store';
import * as z from 'zod/v4';

function result(value: unknown): {
  content: [{ type: 'text'; text: string }];
  structuredContent: Record<string, unknown>;
} {
  const structuredContent =
    typeof value === 'object' && value !== null
      ? (structuredClone(value) as Record<string, unknown>)
      : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

const expectedRevisionSchema = z.string().min(1).describe('Current project Revision ID');

export function createOpenMovieMcpServer(project: ProjectStore): McpServer {
  const server = new McpServer({ name: 'openmovie', version: '0.0.0' });

  server.registerTool(
    'project_summary',
    {
      description:
        'Read the current OpenMovie project identity, delivery settings, branch, and Revision.',
      inputSchema: z.object({}),
    },
    async () => {
      const manifest = await project.readManifest();
      return result({
        id: manifest.project.id,
        title: manifest.project.title,
        locale: manifest.project.default_locale,
        delivery: manifest.delivery,
        currentRevisionId: project.revisions.currentRevisionId(),
        currentBranch: project.revisions.currentBranch(),
      });
    },
  );

  server.registerTool(
    'entity_list',
    {
      description: 'List structured characters, scenes, or shots from Movie IR.',
      inputSchema: z.object({ kind: z.enum(['character', 'scene', 'shot']) }),
    },
    async ({ kind }) => result({ entities: await project.movies.list(kind) }),
  );

  server.registerTool(
    'revision_list',
    {
      description: 'List recent Movie IR Revisions and their changed files.',
      inputSchema: z.object({ limit: z.number().int().positive().max(100).default(20) }),
    },
    ({ limit }) => Promise.resolve(result({ revisions: project.revisions.list(limit) })),
  );

  server.registerTool(
    'revision_diff',
    {
      description: 'Inspect file and field-level structured changes for a Revision.',
      inputSchema: z.object({ revisionId: z.string().min(1) }),
    },
    ({ revisionId }) => Promise.resolve(result(project.revisions.diff(revisionId))),
  );

  server.registerTool(
    'working_changes',
    {
      description: 'Detect uncommitted Movie IR changes made outside OpenMovie.',
      inputSchema: z.object({}),
    },
    async () => result({ files: await project.revisions.workingChanges() }),
  );

  server.registerTool(
    'scene_create',
    {
      description: 'Create a Scene and commit it as a new atomic Movie Revision.',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200),
        storyGoal: z.string().max(10_000).optional(),
        expectedRevisionId: expectedRevisionSchema,
      }),
    },
    async ({ title, storyGoal, expectedRevisionId }) =>
      result(
        await project.movies.createScene({
          title,
          expectedRevisionId,
          authorId: 'mcp_agent',
          ...(storyGoal ? { storyGoal } : {}),
        }),
      ),
  );

  server.registerTool(
    'shot_create',
    {
      description: 'Create a Shot and atomically update its parent Scene in one Movie Revision.',
      inputSchema: z.object({
        sceneId: z.string().min(1),
        durationUs: z.number().int().positive(),
        framing: z.string().max(200).optional(),
        movement: z.string().max(200).optional(),
        expectedRevisionId: expectedRevisionSchema,
      }),
    },
    async ({ sceneId, durationUs, framing, movement, expectedRevisionId }) =>
      result(
        await project.movies.createShot({
          sceneId,
          durationUs,
          expectedRevisionId,
          authorId: 'mcp_agent',
          ...(framing ? { framing } : {}),
          ...(movement ? { movement } : {}),
        }),
      ),
  );

  server.registerTool(
    'branch_list',
    {
      description: 'List isolated creative branches and their Revision heads.',
      inputSchema: z.object({}),
    },
    () => Promise.resolve(result({ branches: project.revisions.listBranches() })),
  );

  server.registerTool(
    'branch_create',
    {
      description: 'Create an isolated creative branch at the current Revision.',
      inputSchema: z.object({ name: z.string().min(1).max(64) }),
    },
    ({ name }) => Promise.resolve(result(project.revisions.createBranch(name))),
  );

  server.registerTool(
    'branch_switch',
    {
      description: 'Switch the working Movie IR file tree to another creative branch.',
      inputSchema: z.object({ name: z.string().min(1).max(64) }),
    },
    async ({ name }) => result(await project.revisions.switchBranch(name)),
  );

  return server;
}
