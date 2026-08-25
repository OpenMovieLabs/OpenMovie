import { z } from 'zod';

export const SCHEMA_VERSION = 0 as const;

export const entityIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,63}$/, 'ID must match ^[a-z][a-z0-9_]{2,63}$');
export const relativeProjectPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('\\'), 'Path must be POSIX relative')
  .refine(
    (value) => !value.split('/').some((part) => part === '..' || part === '.' || part === ''),
    'Path must not escape the project',
  );

const extensionsSchema = z.record(z.string(), z.unknown()).default({});
const frameRateSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});

export const projectManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  project: z.object({
    id: entityIdSchema,
    title: z.string().trim().min(1).max(200),
    default_locale: z.string().min(2).max(35).default('en-US'),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime().optional(),
  }),
  delivery: z.object({
    width: z.number().int().min(16).max(16_384),
    height: z.number().int().min(16).max(16_384),
    frame_rate: frameRateSchema,
    audio_sample_rate: z.number().int().positive(),
  }),
  entrypoints: z.object({
    brief: relativeProjectPathSchema,
    story_bible: relativeProjectPathSchema,
    screenplay: relativeProjectPathSchema,
    timeline: relativeProjectPathSchema,
    asset_manifest: relativeProjectPathSchema,
  }),
  policies: z.object({
    default_generation_strategy: z.enum(['fast', 'balanced', 'quality']).default('balanced'),
    protected_revision: entityIdSchema.nullable().default(null),
  }),
  extensions: extensionsSchema,
});

export const briefSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  title: z.string().trim().min(1).max(200),
  premise: z.string().max(20_000).default(''),
  genres: z.array(z.string()).default([]),
  audience: z.string().default(''),
  tone: z.array(z.string()).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
});

export const storyBibleSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  themes: z.array(z.string()).default([]),
  world: z.string().default(''),
  rules: z.array(z.string()).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
});

export const screenplaySchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  scenes: z.array(entityIdSchema).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
});

const entityHeaderSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  id: entityIdSchema,
  revision: z.number().int().nonnegative(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  extensions: extensionsSchema,
});

export const characterSchema = entityHeaderSchema.extend({
  type: z.literal('character'),
  name: z.string().trim().min(1),
  identity: z
    .object({
      age_range: z.string().optional(),
      appearance: z.string().optional(),
      distinguishing_features: z.array(z.string()).default([]),
    })
    .default({ distinguishing_features: [] }),
  reference_assets: z.array(entityIdSchema).default([]),
  constraints: z.array(entityIdSchema).default([]),
});

export const sceneSchema = entityHeaderSchema.extend({
  type: z.literal('scene'),
  title: z.string().trim().min(1),
  order: z.number().int().nonnegative(),
  story_goal: z.string().default(''),
  location: entityIdSchema.optional(),
  characters: z.array(entityIdSchema).default([]),
  shots: z.array(entityIdSchema).default([]),
  constraints: z.array(entityIdSchema).default([]),
});

export const shotSchema = entityHeaderSchema.extend({
  type: z.literal('shot'),
  scene: entityIdSchema,
  order: z.number().int().nonnegative(),
  duration_us: z.number().int().positive(),
  characters: z.array(entityIdSchema).default([]),
  camera: z
    .object({
      framing: z.string().optional(),
      movement: z.string().optional(),
      screen_direction: z.string().optional(),
    })
    .default({}),
  performance: z.record(z.string(), z.unknown()).default({}),
  dialogue: z.object({ speaker: entityIdSchema, text: z.string() }).nullable().default(null),
  constraints: z.array(entityIdSchema).default([]),
  generation: z
    .object({
      strategy: z.enum(['fast', 'balanced', 'quality']).default('balanced'),
      preferred_mode: z.string().default('text_to_video'),
      references: z.array(entityIdSchema).default([]),
      provider_override: entityIdSchema.nullable().default(null),
    })
    .default({
      strategy: 'balanced',
      preferred_mode: 'text_to_video',
      references: [],
      provider_override: null,
    }),
  selected_take: entityIdSchema.nullable().default(null),
});

const timelineClipSchema = z.object({
  id: entityIdSchema,
  shot: entityIdSchema,
  take: entityIdSchema.nullable().default(null),
  start_us: z.number().int().nonnegative(),
  source_in_us: z.number().int().nonnegative().default(0),
  duration_us: z.number().int().positive(),
});

const timelineTrackSchema = z.object({
  id: entityIdSchema,
  clips: z.array(timelineClipSchema).default([]),
});

export const timelineSchema = entityHeaderSchema.extend({
  type: z.literal('timeline'),
  video_tracks: z.array(timelineTrackSchema).default([]),
  audio_tracks: z.array(timelineTrackSchema).default([]),
  subtitle_tracks: z.array(timelineTrackSchema).default([]),
});

export const assetManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  assets: z.array(
    z.object({
      id: entityIdSchema,
      type: z.enum(['image', 'video', 'audio', 'document', 'other']),
      object_uri: z.string().regex(/^om:\/\/object\/sha256\/[a-f0-9]{64}$/),
      original_name: z.string().min(1),
      mime_type: z.string().min(1),
      byte_size: z.number().int().nonnegative(),
      classification: z
        .enum(['public', 'internal', 'sensitive', 'sensitive_identity'])
        .default('internal'),
    }),
  ),
});

export const agentActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('story.update'),
    premise: z.string().max(20_000).optional(),
    themes: z.array(z.string().max(200)).max(100).optional(),
    world: z.string().max(20_000).optional(),
    rules: z.array(z.string().max(500)).max(200).optional(),
  }),
  z.object({
    type: z.literal('scene.create'),
    title: z.string().trim().min(1).max(200),
    story_goal: z.string().max(10_000).default(''),
  }),
  z.object({
    type: z.literal('shot.create'),
    scene_id: z.string().min(1),
    duration_us: z.number().int().positive(),
    framing: z.string().max(200).optional(),
    movement: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('shot.update'),
    shot_id: entityIdSchema,
    duration_us: z.number().int().positive().optional(),
    framing: z.string().max(200).optional(),
    movement: z.string().max(200).optional(),
    performance_emotion: z.string().max(500).optional(),
  }),
]);

export const agentPlanSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  actions: z.array(agentActionSchema).max(50),
});

export const movieEntitySchema = z.discriminatedUnion('type', [
  characterSchema,
  sceneSchema,
  shotSchema,
  timelineSchema,
]);

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type StoryBible = z.infer<typeof storyBibleSchema>;
export type Screenplay = z.infer<typeof screenplaySchema>;
export type MovieEntity = z.infer<typeof movieEntitySchema>;
export type Character = z.infer<typeof characterSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type AssetManifest = z.infer<typeof assetManifestSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentPlan = z.infer<typeof agentPlanSchema>;
