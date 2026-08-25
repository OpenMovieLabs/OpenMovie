import { z } from 'zod';

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
    method: z.literal('object.import'),
    params: z.object({ path: z.string().min(1) }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('task.create'),
    params: z.object({
      goal: z.string().trim().min(1).max(10_000),
      plannerProviderId: z.string().min(1).default('fake'),
      plannerModel: z.string().min(1).default('fake-text-v1'),
      requiresApproval: z.boolean().default(false),
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
      id: z.string().min(1),
      baseUrl: z.string().url(),
      apiKey: z.string().min(1),
    }),
  }),
  z.object({
    id: commandIdSchema,
    method: z.literal('provider.list'),
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
export type MoviePatchOperation = z.infer<typeof moviePatchOperationSchema>;
export type RevisionRecord = z.infer<typeof revisionRecordSchema>;
export type BranchRecord = z.infer<typeof branchRecordSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type RevisionDiff = z.infer<typeof revisionDiffSchema>;
export type StoredObject = z.infer<typeof storedObjectSchema>;
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
