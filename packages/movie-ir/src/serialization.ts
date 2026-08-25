import { randomBytes } from 'node:crypto';

import { parse, stringify } from 'yaml';
import type { z } from 'zod';

import { SCHEMA_VERSION, projectManifestSchema, type ProjectManifest } from './schema.js';

export function createId(prefix: string): string {
  const normalized = prefix
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+$/, '');
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) throw new Error(`Invalid ID prefix: ${prefix}`);
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const entropy = randomBytes(8).toString('hex');
  return `${normalized}_${timestamp}${entropy}`.slice(0, 64);
}

export function parseYaml<T>(source: string, schema: z.ZodType<T>): T {
  const value: unknown = parse(source, { schema: 'core' });
  return schema.parse(value);
}

export function stringifyYaml(value: unknown): string {
  return stringify(value, {
    lineWidth: 100,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
    sortMapEntries: false,
  });
}

export function parseProjectManifest(source: string): ProjectManifest {
  return parseYaml(source, projectManifestSchema);
}

export function serializeProjectManifest(manifest: ProjectManifest): string {
  return stringifyYaml(projectManifestSchema.parse(manifest));
}

export function createProjectManifest(title: string, locale = 'en-US'): ProjectManifest {
  const now = new Date().toISOString();
  return projectManifestSchema.parse({
    schema_version: SCHEMA_VERSION,
    project: {
      id: createId('project'),
      title,
      default_locale: locale,
      created_at: now,
      updated_at: now,
    },
    delivery: {
      width: 1920,
      height: 1080,
      frame_rate: { numerator: 24, denominator: 1 },
      audio_sample_rate: 48_000,
    },
    entrypoints: {
      brief: 'brief.yaml',
      story_bible: 'story/bible.yaml',
      screenplay: 'story/screenplay.yaml',
      timeline: 'timeline/main.yaml',
      asset_manifest: 'assets/manifest.yaml',
    },
    policies: {
      default_generation_strategy: 'balanced',
      protected_revision: null,
    },
    extensions: {},
  });
}
