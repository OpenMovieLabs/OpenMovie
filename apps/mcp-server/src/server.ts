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

  server.registerTool(
    'story_get',
    {
      description: 'Read the structured Story Brief, Bible, and Screenplay.',
      inputSchema: z.object({}),
    },
    async () => result(await project.movies.getStory()),
  );

  server.registerTool(
    'story_update',
    {
      description: 'Update Story intent and commit the files as one Movie Revision.',
      inputSchema: z.object({
        premise: z.string().max(20_000),
        themes: z.array(z.string().max(200)).max(100),
        world: z.string().max(20_000),
        rules: z.array(z.string().max(500)).max(200),
        expectedRevisionId: expectedRevisionSchema,
      }),
    },
    async ({ expectedRevisionId, ...input }) =>
      result(
        await project.movies.updateStory({
          ...input,
          expectedRevisionId,
          authorId: 'mcp_agent',
        }),
      ),
  );

  server.registerTool(
    'timeline_get',
    {
      description: 'Read the Current Cut Timeline and its Shot/Take clips.',
      inputSchema: z.object({}),
    },
    async () => result(await project.movies.readTimeline()),
  );

  server.registerTool(
    'timeline_assemble',
    {
      description: 'Assemble ordered Shots and selected Takes into the Current Cut Revision.',
      inputSchema: z.object({ expectedRevisionId: expectedRevisionSchema }),
    },
    async ({ expectedRevisionId }) =>
      result(await project.movies.assembleTimeline({ expectedRevisionId, authorId: 'mcp_agent' })),
  );

  server.registerTool(
    'timeline_render_list',
    {
      description: 'List rendered Current Cut artifacts and their source Revisions.',
      inputSchema: z.object({}),
    },
    () => Promise.resolve(result({ renders: project.media.listTimelineRenders() })),
  );

  server.registerTool(
    'take_list',
    {
      description: 'List immutable generated Takes and provenance for a Shot.',
      inputSchema: z.object({ shotId: z.string().min(1) }),
    },
    ({ shotId }) => Promise.resolve(result({ takes: project.media.listTakes(shotId) })),
  );

  server.registerTool(
    'evaluation_list',
    {
      description: 'List deterministic and model-based evaluations for a Take.',
      inputSchema: z.object({ takeId: z.string().min(1) }),
    },
    ({ takeId }) => Promise.resolve(result({ evaluations: project.media.listEvaluations(takeId) })),
  );

  server.registerTool(
    'feedback_list',
    {
      description: 'List open or resolved feedback bound to Movie entities and Takes.',
      inputSchema: z.object({
        targetType: z.enum(['project', 'scene', 'shot', 'take', 'revision']).optional(),
        targetId: z.string().min(1).optional(),
        status: z.enum(['open', 'resolved']).optional(),
      }),
    },
    (input) => Promise.resolve(result({ feedback: project.feedback.list(input) })),
  );

  server.registerTool(
    'feedback_create',
    {
      description: 'Attach actionable feedback to a Project, Scene, Shot, Take, or Revision.',
      inputSchema: z.object({
        targetType: z.enum(['project', 'scene', 'shot', 'take', 'revision']),
        targetId: z.string().min(1),
        body: z.string().trim().min(1).max(10_000),
      }),
    },
    async (input) => result(await project.feedback.create({ ...input, authorId: 'mcp_agent' })),
  );

  server.registerTool(
    'analysis_list',
    {
      description: 'List persisted image or timecoded video analysis results for a Take.',
      inputSchema: z.object({ takeId: z.string().min(1) }),
    },
    ({ takeId }) => Promise.resolve(result({ analyses: project.media.listAnalyses(takeId) })),
  );

  server.registerTool(
    'proposal_list',
    {
      description:
        'List reviewable Direct Agent Movie IR proposals without applying them. Acceptance remains a user-controlled desktop action.',
      inputSchema: z.object({
        status: z.enum(['pending', 'accepted', 'rejected']).optional(),
      }),
    },
    ({ status }) => Promise.resolve(result({ proposals: project.proposals.list(status) })),
  );

  return server;
}
