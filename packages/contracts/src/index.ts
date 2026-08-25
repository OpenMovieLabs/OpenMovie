import { z } from 'zod';
import { agentPlanSchema } from '@openmovie/movie-ir';

export const PROTOCOL_VERSION = '0.1.0' as const;
export const CORE_API_VERSION = '0.1.0' as const;

export const commandIdSchema = z.string().min(1).max(128);

export const initializeParamsSchema = z.object({
  protocolVersion: z.string().min(1),
  client: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    platform: z.enum(['darwin', 'win32', 'linux']),
  }),
});

export const moviePatchOperationSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.string().startsWith('/'),
  value: z.unknown().optional(),
});

const projectPathParamsSchema = z.object({ path: z.string().min(1) });
const configurableProviderIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)
  .refine(
    (id) => id !== 'fake' && !id.startsWith('plugin.') && !id.startsWith('harness.'),
    'Provider ID uses a reserved local namespace',
  );

export const coreCommandSchema = z.discriminatedUnion('method', [
  z.object({
    id: commandIdSchema,
    method: z.literal('initialize'),
    params: initializeParamsSchema,
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('core.health'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.create'),
    params: projectPathParamsSchema.extend({
      title: z.string().trim().min(1).max(200),
      locale: z.string().min(2).max(35).optional(),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.open'),
    params: projectPathParamsSchema.extend({ takeoverStaleLock: z.boolean().default(false) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.close'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.get_summary'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.doctor'),
    params: z.object({ deep: z.boolean().default(false) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.storage_report'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.storage_clean'),
    params: z.object({
      categories: z.array(z.enum(['cache', 'previews', 'temp'])).min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('project.policy_update'),
    params: z.object({
      expectedRevisionId: z.string().nullable(),
      monthlyBudgetUsdMicros: z.number().int().nonnegative().nullable(),
      remoteMediaPolicy: z.enum(['allow', 'confirm', 'deny']),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.commit'),
    params: z.object({
      expectedRevisionId: z.string().nullable(),
      authorType: z.enum(['user', 'agent', 'system']),
      authorId: z.string().min(1),
      message: z.string().trim().min(1).max(500),
      patch: z.array(moviePatchOperationSchema).min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.list'),
    params: z.object({ limit: z.number().int().positive().max(500).default(100) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.restore'),
    params: z.object({
      revisionId: z.string().min(1),
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.branch_list'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.diff'),
    params: z.object({
      revisionId: z.string().min(1),
      baseRevisionId: z.string().nullable().optional(),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.working_changes'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.branch_create'),
    params: z.object({ name: z.string().min(1).max(64) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('revision.branch_switch'),
    params: z.object({ name: z.string().min(1).max(64) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('movie.entity_list'),
    params: z.object({ kind: z.enum(['character', 'scene', 'shot']) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('movie.character_create'),
    params: z.object({
      name: z.string().trim().min(1).max(200),
      appearance: z.string().max(5000).optional(),
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('movie.scene_create'),
    params: z.object({
      title: z.string().trim().min(1).max(200),
      storyGoal: z.string().max(10_000).optional(),
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('movie.shot_create'),
    params: z.object({
      sceneId: z.string().min(1),
      durationUs: z.number().int().positive(),
      framing: z.string().max(200).optional(),
      movement: z.string().max(200).optional(),
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('movie.entity_update'),
    params: z.object({
      entity: z
        .object({
          id: z.string().min(1),
          type: z.enum(['character', 'scene', 'shot', 'timeline']),
          revision: z.number().int().nonnegative(),
        })
        .passthrough(),
      expectedEntityRevision: z.number().int().nonnegative(),
      expectedRevisionId: z.string().nullable(),
      authorType: z.enum(['user', 'agent', 'system']),
      authorId: z.string().min(1),
      message: z.string().trim().min(1).max(500),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('story.get'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('story.update'),
    params: z.object({
      premise: z.string().max(20_000),
      themes: z.array(z.string().max(200)).max(100),
      world: z.string().max(20_000),
      rules: z.array(z.string().max(500)).max(200),
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('timeline.get'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('timeline.assemble'),
    params: z.object({
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('timeline.render_create_task'),
    params: z.object({ sourceRevisionId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('timeline.render_list'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('object.import'),
    params: z.object({ path: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('take.list'),
    params: z.object({ shotId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('take.select'),
    params: z.object({
      takeId: z.string().min(1),
      expectedRevisionId: z.string().nullable(),
      authorId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('evaluation.list'),
    params: z.object({ takeId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('feedback.create'),
    params: z.object({
      targetType: z.enum(['project', 'scene', 'shot', 'take', 'revision']),
      targetId: z.string().min(1),
      body: z.string().trim().min(1).max(10_000),
      authorId: z.string().min(1),
      timeRangeUs: z
        .object({
          startUs: z.number().int().nonnegative(),
          endUs: z.number().int().positive(),
        })
        .refine((range) => range.endUs > range.startUs, 'End must be after start')
        .optional(),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('feedback.list'),
    params: z.object({
      targetType: z.enum(['project', 'scene', 'shot', 'take', 'revision']).optional(),
      targetId: z.string().min(1).optional(),
      status: z.enum(['open', 'resolved']).optional(),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('feedback.resolve'),
    params: z.object({
      feedbackId: z.string().min(1),
      revisionId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('analysis.create_task'),
    params: z.object({
      takeId: z.string().min(1),
      providerId: z.string().min(1),
      model: z.string().min(1),
      prompt: z.string().trim().min(1).max(10_000),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('analysis.list'),
    params: z.object({ takeId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('proposal.list'),
    params: z.object({ status: z.enum(['pending', 'accepted', 'rejected']).optional() }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('proposal.accept'),
    params: z.object({
      proposalId: z.string().min(1),
      expectedRevisionId: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('proposal.reject'),
    params: z.object({ proposalId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.create'),
    params: z.object({
      goal: z.string().trim().min(1).max(10_000),
      plannerProviderId: z.string().min(1).default('fake'),
      plannerModel: z.string().min(1).default('fake-text-v1'),
      requiresApproval: z.boolean().default(false),
      targetShotId: z.string().min(1).optional(),
      mediaKind: z.enum(['image', 'video']).default('image'),
      mediaProviderId: z.string().min(1).default('fake'),
      mediaModel: z.string().min(1),
      feedbackId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.run'),
    params: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.list'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.cancel'),
    params: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.approve'),
    params: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.events'),
    params: z.object({
      taskId: z.string().min(1),
      afterSequence: z.number().int().nonnegative().default(0),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('provider.configure_openai_compatible'),
    params: z.object({
      id: configurableProviderIdSchema,
      baseUrl: z.string().url(),
      apiKey: z.string().min(1),
      imageGeneration: z.boolean().default(false),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('provider.configure_openai_responses'),
    params: z.object({
      id: configurableProviderIdSchema,
      baseUrl: z.string().url(),
      apiKey: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('provider.configure_http_video'),
    params: z.object({
      id: configurableProviderIdSchema,
      baseUrl: z.string().url(),
      apiKey: z.string().min(1),
      path: z.string().min(1).default('videos'),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('provider.list'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('provider.usage_summary'),
    params: z.object({}).default({}),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('harness.list'),
    params: z.object({}).default({}),
  }),
]);

export const coreErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const initializeResultSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  coreApiVersion: z.literal(CORE_API_VERSION),
  server: z.object({
    name: z.literal('openmovie-core'),
    version: z.string().min(1),
  }),
  capabilities: z.array(z.string()),
});

export const coreHealthSchema = z.object({
  status: z.literal('ok'),
  startedAt: z.string().datetime(),
  uptimeMs: z.number().nonnegative(),
  media: z.object({
    ffmpeg: z.object({
      available: z.boolean(),
      version: z.string().optional(),
      source: z.enum(['bundled', 'custom', 'system']),
    }),
  }),
});

export const projectSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  root: z.string(),
  locale: z.string(),
  currentRevisionId: z.string().nullable(),
  currentBranch: z.string(),
  delivery: z.object({
    width: z.number().int(),
    height: z.number().int(),
    frameRate: z.object({ numerator: z.number().int(), denominator: z.number().int() }),
  }),
  policies: z.object({
    monthlyBudgetUsdMicros: z.number().int().nonnegative().nullable(),
    remoteMediaPolicy: z.enum(['allow', 'confirm', 'deny']),
  }),
});

export const providerUsageSummarySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  runCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsdMicros: z.number().int().nonnegative(),
  unpricedRunCount: z.number().int().nonnegative(),
});

export const revisionRecordSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  authorType: z.string(),
  authorId: z.string(),
  message: z.string(),
  patch: z.array(moviePatchOperationSchema),
  manifestHash: z.string(),
  changedPaths: z.array(z.string()),
  branch: z.string(),
  createdAt: z.string().datetime(),
});

export const branchRecordSchema = z.object({
  name: z.string(),
  headRevisionId: z.string(),
  current: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const structuralChangeSchema = z.object({
  pointer: z.string(),
  operation: z.enum(['add', 'replace', 'remove']),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

export const fileDiffSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted']),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
  changes: z.array(structuralChangeSchema),
});

export const revisionDiffSchema = z.object({
  revisionId: z.string(),
  baseRevisionId: z.string().nullable(),
  files: z.array(fileDiffSchema),
});

export const storedObjectSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  uri: z.string(),
  byteSize: z.number().int().nonnegative(),
  mimeType: z.string(),
  path: z.string(),
});

export const doctorIssueSchema = z.object({
  severity: z.enum(['warning', 'error']),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

export const doctorReportSchema = z.object({
  status: z.enum(['healthy', 'warning', 'failed']),
  projectId: z.string(),
  checkedAt: z.string().datetime(),
  checks: z.number().int().nonnegative(),
  issues: z.array(doctorIssueSchema),
});

export const storageReportSchema = z.object({
  measuredAt: z.string().datetime(),
  totalBytes: z.number().int().nonnegative(),
  reclaimableBytes: z.number().int().nonnegative(),
  categories: z.object({
    objects: z.number().int().nonnegative(),
    cache: z.number().int().nonnegative(),
    previews: z.number().int().nonnegative(),
    temp: z.number().int().nonnegative(),
    database: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
  }),
  disk: z.object({
    totalBytes: z.number().int().nonnegative(),
    freeBytes: z.number().int().nonnegative(),
    lowSpace: z.boolean(),
  }),
});

export const takeRecordSchema = z.object({
  id: z.string(),
  shotId: z.string(),
  artifactId: z.string(),
  artifact: z.object({
    id: z.string(),
    objectUri: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime(),
  }),
  runId: z.string().optional(),
  provider: z.record(z.string(), z.unknown()),
  generation: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const evaluationRecordSchema = z.object({
  id: z.string(),
  takeId: z.string(),
  evaluator: z.string(),
  status: z.enum(['passed', 'warning', 'failed']),
  score: z.number().optional(),
  findings: z.array(z.record(z.string(), z.unknown())),
  provenance: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const feedbackRecordSchema = z.object({
  id: z.string(),
  targetType: z.enum(['project', 'scene', 'shot', 'take', 'revision']),
  targetId: z.string(),
  body: z.string(),
  status: z.enum(['open', 'resolved']),
  authorId: z.string(),
  resolutionRevisionId: z.string().optional(),
  timeRangeUs: z
    .object({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const analysisRecordSchema = z.object({
  id: z.string(),
  takeId: z.string(),
  kind: z.enum(['image', 'video']),
  providerId: z.string(),
  modelId: z.string(),
  summary: z.string(),
  evidence: z.array(z.record(z.string(), z.unknown())),
  provenance: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const timelineRenderRecordSchema = z.object({
  id: z.string(),
  sourceRevisionId: z.string(),
  timelineRevision: z.number().int().nonnegative(),
  objectUri: z.string().regex(/^om:\/\/object\/sha256\/[a-f0-9]{64}$/),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  durationUs: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

export const revisionProposalRecordSchema = z.object({
  id: z.string(),
  baseRevisionId: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  summary: z.string(),
  plan: agentPlanSchema,
  authorId: z.string(),
  feedbackId: z.string().optional(),
  acceptedRevisionId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const taskStepSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
  attempt: z.number().int().nonnegative(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

export const taskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.enum([
    'queued',
    'planning',
    'awaiting_approval',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  steps: z.array(taskStepSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  requiresApproval: z.boolean(),
  approvedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});

export const taskEventSchema = z.object({
  sequence: z.number().int().positive(),
  taskId: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const harnessHealthSchema = z.object({
  id: z.enum(['codex', 'claude_code', 'direct']),
  name: z.string(),
  available: z.boolean(),
  version: z.string().optional(),
  capabilities: z.array(z.string()),
  error: z.string().optional(),
});

export const coreSuccessSchema = z.object({
  id: commandIdSchema,
  ok: z.literal(true),
  result: z.unknown(),
});

export const coreFailureSchema = z.object({
  id: commandIdSchema,
  ok: z.literal(false),
  error: coreErrorSchema,
});

export const coreResponseSchema = z.union([coreSuccessSchema, coreFailureSchema]);

export type InitializeParams = z.infer<typeof initializeParamsSchema>;
export type CoreCommand = z.infer<typeof coreCommandSchema>;
export type CoreError = z.infer<typeof coreErrorSchema>;
export type CoreResponse = z.infer<typeof coreResponseSchema>;
export type InitializeResult = z.infer<typeof initializeResultSchema>;
export type CoreHealth = z.infer<typeof coreHealthSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProviderUsageSummary = z.infer<typeof providerUsageSummarySchema>;
export type MoviePatchOperation = z.infer<typeof moviePatchOperationSchema>;
export type RevisionRecord = z.infer<typeof revisionRecordSchema>;
export type BranchRecord = z.infer<typeof branchRecordSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type RevisionDiff = z.infer<typeof revisionDiffSchema>;
export type StoredObject = z.infer<typeof storedObjectSchema>;
export type DoctorReport = z.infer<typeof doctorReportSchema>;
export type StorageReport = z.infer<typeof storageReportSchema>;
export type TakeRecord = z.infer<typeof takeRecordSchema>;
export type EvaluationRecord = z.infer<typeof evaluationRecordSchema>;
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;
export type AnalysisRecord = z.infer<typeof analysisRecordSchema>;
export type TimelineRenderRecord = z.infer<typeof timelineRenderRecordSchema>;
export type RevisionProposalRecord = z.infer<typeof revisionProposalRecordSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskEvent = z.infer<typeof taskEventSchema>;
export type HarnessHealth = z.infer<typeof harnessHealthSchema>;

export function assertProtocolCompatible(clientVersion: string): void {
  const clientMajor = clientVersion.split('.')[0];
  const serverMajor = PROTOCOL_VERSION.split('.')[0];
  if (clientMajor !== serverMajor) {
    throw new Error(`Protocol major mismatch: client=${clientVersion}, core=${PROTOCOL_VERSION}`);
  }
}
