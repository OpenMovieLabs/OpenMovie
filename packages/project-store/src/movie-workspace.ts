import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  characterSchema,
  createId,
  entityIdSchema,
  parseYaml,
  sceneSchema,
  shotSchema,
  stringifyYaml,
  type Character,
  type MovieEntity,
  type Scene,
  type Shot,
} from '@openmovie/movie-ir';

import { RevisionConflictError } from './errors.js';
import { type RevisionEngine, type RevisionRecord } from './revision.js';

export type EntityKind = 'character' | 'scene' | 'shot';

export type EntityCommitResult<T extends MovieEntity> = {
  entity: T;
  revision: RevisionRecord;
};

const directories: Record<EntityKind, string> = {
  character: 'characters',
  scene: 'scenes',
  shot: 'shots',
};

function entityPath(entity: MovieEntity): string {
  if (entity.type === 'timeline') return 'timeline/main.yaml';
  return `${directories[entity.type]}/${entity.id}.yaml`;
}

export class MovieWorkspace {
  constructor(
    private readonly root: string,
    private readonly revisions: RevisionEngine,
  ) {}

  async list(kind: EntityKind): Promise<MovieEntity[]> {
    const directory = join(this.root, directories[kind]);
    const names = (await readdir(directory)).filter((name) => name.endsWith('.yaml')).sort();
    return Promise.all(names.map((name) => this.parse(kind, join(directory, name))));
  }

  async read(kind: EntityKind, id: string): Promise<MovieEntity> {
    entityIdSchema.parse(id);
    return this.parse(kind, join(this.root, directories[kind], `${id}.yaml`));
  }

  async createCharacter(input: {
    name: string;
    appearance?: string | undefined;
    expectedRevisionId: string | null;
    authorId: string;
  }): Promise<EntityCommitResult<Character>> {
    const now = new Date().toISOString();
    const entity = characterSchema.parse({
      schema_version: 0,
      id: createId('char'),
      type: 'character',
      revision: 0,
      created_at: now,
      updated_at: now,
      name: input.name,
      identity: {
        ...(input.appearance ? { appearance: input.appearance } : {}),
        distinguishing_features: [],
      },
      reference_assets: [],
      constraints: [],
      extensions: {},
    });
    const revision = await this.revisions.commitFiles({
      expectedRevisionId: input.expectedRevisionId,
      authorType: 'user',
      authorId: input.authorId,
      message: `Create character ${entity.name}`,
      changes: [{ path: entityPath(entity), content: stringifyYaml(entity) }],
    });
    return { entity, revision };
  }

  async createScene(input: {
    title: string;
    storyGoal?: string | undefined;
    expectedRevisionId: string | null;
    authorId: string;
  }): Promise<EntityCommitResult<Scene>> {
    const existing = (await this.list('scene')) as Scene[];
    const now = new Date().toISOString();
    const entity = sceneSchema.parse({
      schema_version: 0,
      id: createId('scene'),
      type: 'scene',
      revision: 0,
      created_at: now,
      updated_at: now,
      title: input.title,
      order: existing.reduce((maximum, scene) => Math.max(maximum, scene.order), -1) + 1,
      story_goal: input.storyGoal ?? '',
      characters: [],
      shots: [],
      constraints: [],
      extensions: {},
    });
    const revision = await this.revisions.commitFiles({
      expectedRevisionId: input.expectedRevisionId,
      authorType: 'user',
      authorId: input.authorId,
      message: `Create scene ${entity.title}`,
      changes: [{ path: entityPath(entity), content: stringifyYaml(entity) }],
    });
    return { entity, revision };
  }

  async createShot(input: {
    sceneId: string;
    durationUs: number;
    framing?: string | undefined;
    movement?: string | undefined;
    expectedRevisionId: string | null;
    authorId: string;
  }): Promise<EntityCommitResult<Shot>> {
    const scene = sceneSchema.parse(await this.read('scene', input.sceneId));
    const sceneShots = (await this.list('shot'))
      .filter((entity): entity is Shot => entity.type === 'shot' && entity.scene === scene.id)
      .sort((left, right) => left.order - right.order);
    const now = new Date().toISOString();
    const entity = shotSchema.parse({
      schema_version: 0,
      id: createId('shot'),
      type: 'shot',
      revision: 0,
      created_at: now,
      updated_at: now,
      scene: scene.id,
      order: (sceneShots.at(-1)?.order ?? -1) + 1,
      duration_us: input.durationUs,
      characters: [],
      camera: {
        ...(input.framing ? { framing: input.framing } : {}),
        ...(input.movement ? { movement: input.movement } : {}),
      },
      performance: {},
      dialogue: null,
      constraints: [],
      generation: {
        strategy: 'balanced',
        preferred_mode: 'text_to_video',
        references: [],
        provider_override: null,
      },
      selected_take: null,
      extensions: {},
    });
    const updatedScene = sceneSchema.parse({
      ...scene,
      revision: scene.revision + 1,
      updated_at: now,
      shots: [...scene.shots, entity.id],
    });
    const revision = await this.revisions.commitFiles({
      expectedRevisionId: input.expectedRevisionId,
      authorType: 'user',
      authorId: input.authorId,
      message: `Create shot in ${scene.title}`,
      changes: [
        { path: entityPath(entity), content: stringifyYaml(entity) },
        { path: entityPath(updatedScene), content: stringifyYaml(updatedScene) },
      ],
    });
    return { entity, revision };
  }

  async update<T extends MovieEntity>(input: {
    entity: T;
    expectedEntityRevision: number;
    expectedRevisionId: string | null;
    authorType: 'user' | 'agent' | 'system';
    authorId: string;
    message: string;
  }): Promise<EntityCommitResult<T>> {
    if (input.entity.type === 'timeline') throw new Error('Timeline update is not exposed yet');
    const current = await this.read(input.entity.type, input.entity.id);
    if (current.revision !== input.expectedEntityRevision) {
      throw new RevisionConflictError(
        String(input.expectedEntityRevision),
        String(current.revision),
      );
    }
    const next = this.validate({
      ...input.entity,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    }) as T;
    const revision = await this.revisions.commitFiles({
      expectedRevisionId: input.expectedRevisionId,
      authorType: input.authorType,
      authorId: input.authorId,
      message: input.message,
      changes: [{ path: entityPath(next), content: stringifyYaml(next) }],
    });
    return { entity: next, revision };
  }

  private async parse(kind: EntityKind, path: string): Promise<MovieEntity> {
    const source = await readFile(path, 'utf8');
    if (kind === 'character') return parseYaml(source, characterSchema);
    if (kind === 'scene') return parseYaml(source, sceneSchema);
    return parseYaml(source, shotSchema);
  }

  private validate(entity: MovieEntity): MovieEntity {
    if (entity.type === 'character') return characterSchema.parse(entity);
    if (entity.type === 'scene') return sceneSchema.parse(entity);
    if (entity.type === 'shot') return shotSchema.parse(entity);
    return entity;
  }
}
