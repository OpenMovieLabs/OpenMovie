import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  SCHEMA_VERSION,
  briefSchema,
  createId,
  createProjectManifest,
  parseProjectManifest,
  serializeProjectManifest,
  screenplaySchema,
  storyBibleSchema,
  stringifyYaml,
  type ProjectManifest,
} from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

import { openProjectDatabase } from './database.js';
import { writeFileAtomic } from './fs.js';
import { FeedbackRepository } from './feedback-repository.js';
import { ProjectDoctor } from './doctor.js';
import { ProjectLock } from './lock.js';
import { MediaRepository } from './media-repository.js';
import { MovieWorkspace } from './movie-workspace.js';
import { ObjectStore } from './object-store.js';
import { ProposalRepository } from './proposal-repository.js';
import { RevisionEngine } from './revision.js';
import { StorageManager } from './storage-manager.js';
import { SqliteTaskPersistence } from './task-persistence.js';
import { UsageRepository } from './usage-repository.js';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export type CreateProjectOptions = {
  title: string;
  locale?: string;
};

export type OpenProjectOptions = {
  takeoverStaleLock?: boolean;
};

export class ProjectStore {
  readonly root: string;
  readonly metadataRoot: string;
  readonly objects: ObjectStore;
  readonly revisions: RevisionEngine;
  readonly taskPersistence: SqliteTaskPersistence;
  readonly movies: MovieWorkspace;
  readonly media: MediaRepository;
  readonly doctor: ProjectDoctor;
  readonly feedback: FeedbackRepository;
  readonly proposals: ProposalRepository;
  readonly storage: StorageManager;
  readonly usage: UsageRepository;

  private closed = false;

  private constructor(
    root: string,
    readonly manifest: ProjectManifest,
    private readonly database: Database.Database,
    private readonly lock: ProjectLock,
  ) {
    this.root = root;
    this.metadataRoot = join(root, '.openmovie');
    this.objects = new ObjectStore(this.metadataRoot);
    this.revisions = new RevisionEngine(root, manifest.project.id, database);
    this.taskPersistence = new SqliteTaskPersistence(database);
    this.movies = new MovieWorkspace(root, this.revisions);
    this.media = new MediaRepository(database, this.movies);
    this.doctor = new ProjectDoctor(root, manifest, database, this.objects, this.revisions);
    this.feedback = new FeedbackRepository(database, this.movies);
    this.proposals = new ProposalRepository(database, this.movies, this.revisions, this.feedback);
    this.storage = new StorageManager(root, this.metadataRoot);
    this.usage = new UsageRepository(database);
  }

  static async create(rootInput: string, options: CreateProjectOptions): Promise<ProjectStore> {
    const root = resolve(rootInput);
    try {
      await stat(join(root, 'openmovie.yaml'));
      throw new Error(`An OpenMovie project already exists at ${root}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    const metadataRoot = join(root, '.openmovie');
    await Promise.all(
      [
        root,
        join(root, 'story'),
        join(root, 'characters'),
        join(root, 'locations'),
        join(root, 'scenes'),
        join(root, 'shots'),
        join(root, 'timeline'),
        join(root, 'tests'),
        join(root, 'assets'),
        metadataRoot,
        join(metadataRoot, 'objects', 'sha256'),
        join(metadataRoot, 'cache'),
        join(metadataRoot, 'previews'),
        join(metadataRoot, 'temp'),
        join(metadataRoot, 'locks'),
        join(metadataRoot, 'logs'),
      ].map((path) => mkdir(path, { recursive: true })),
    );

    const lock = await ProjectLock.acquire(join(metadataRoot, 'locks', 'core.lock'));
    try {
      const manifest = createProjectManifest(options.title, options.locale);
      const manifestYaml = serializeProjectManifest(manifest);
      await Promise.all([
        writeFileAtomic(join(root, 'openmovie.yaml'), manifestYaml),
        writeFileAtomic(
          join(root, 'brief.yaml'),
          stringifyYaml(
            briefSchema.parse({
              schema_version: SCHEMA_VERSION,
              title: options.title,
              premise: '',
            }),
          ),
        ),
        writeFileAtomic(
          join(root, 'story', 'bible.yaml'),
          stringifyYaml(storyBibleSchema.parse({ schema_version: SCHEMA_VERSION })),
        ),
        writeFileAtomic(
          join(root, 'story', 'screenplay.yaml'),
          stringifyYaml(screenplaySchema.parse({ schema_version: SCHEMA_VERSION })),
        ),
        writeFileAtomic(
          join(root, 'timeline', 'main.yaml'),
          stringifyYaml({
            schema_version: SCHEMA_VERSION,
            id: 'timeline_main',
            type: 'timeline',
            revision: 0,
            video_tracks: [],
            audio_tracks: [],
            subtitle_tracks: [],
            extensions: {},
          }),
        ),
        writeFileAtomic(
          join(root, 'assets', 'manifest.yaml'),
          stringifyYaml({ schema_version: SCHEMA_VERSION, assets: [] }),
        ),
      ]);

      const database = openProjectDatabase(join(metadataRoot, 'state.sqlite'));
      const now = new Date().toISOString();
      const initialRevision = createId('rev');
      const manifestHash = digest(manifestYaml);
      database.transaction(() => {
        database
          .prepare(
            `INSERT INTO projects(id, title, manifest_hash, current_revision_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            manifest.project.id,
            manifest.project.title,
            manifestHash,
            initialRevision,
            now,
            now,
          );
        database
          .prepare(
            `INSERT INTO revisions(
              id, project_id, parent_id, status, author_type, author_id, message,
              patch_json, snapshot_yaml, manifest_hash, created_at
             ) VALUES (?, ?, NULL, 'committed', 'system', 'openmovie', 'Create project', '[]', ?, ?, ?)`,
          )
          .run(initialRevision, manifest.project.id, manifestYaml, manifestHash, now);
      })();
      const store = new ProjectStore(root, manifest, database, lock);
      await store.revisions.initializeCurrentSnapshot();
      await store.objects.initialize();
      return store;
    } catch (error) {
      await lock.release();
      throw error;
    }
  }

  static async open(rootInput: string, options: OpenProjectOptions = {}): Promise<ProjectStore> {
    const root = resolve(rootInput);
    const metadataRoot = join(root, '.openmovie');
    const manifestYaml = await readFile(join(root, 'openmovie.yaml'), 'utf8');
    const manifest = parseProjectManifest(manifestYaml);
    await Promise.all(
      [
        join(metadataRoot, 'objects', 'sha256'),
        join(metadataRoot, 'cache'),
        join(metadataRoot, 'previews'),
        join(metadataRoot, 'temp'),
        join(metadataRoot, 'locks'),
        join(metadataRoot, 'logs'),
      ].map((path) => mkdir(path, { recursive: true })),
    );
    const lock = await ProjectLock.acquire(
      join(metadataRoot, 'locks', 'core.lock'),
      options.takeoverStaleLock,
    );
    try {
      const database = openProjectDatabase(join(metadataRoot, 'state.sqlite'));
      const projectRows = database.prepare('SELECT id FROM projects ORDER BY id').all() as Array<{
        id: string;
      }>;
      if (!projectRows.some((row) => row.id === manifest.project.id)) {
        if (projectRows.length > 0) {
          database.close();
          throw new Error('Runtime database belongs to a different OpenMovie project');
        }
        initializeRecoveredState(database, manifest, manifestYaml);
      }
      const store = new ProjectStore(root, manifest, database, lock);
      await store.revisions.recover();
      await store.revisions.initializeCurrentSnapshot();
      await store.objects.initialize();
      return store;
    } catch (error) {
      await lock.release();
      throw error;
    }
  }

  async readManifest(): Promise<ProjectManifest> {
    this.assertOpen();
    return parseProjectManifest(await readFile(join(this.root, 'openmovie.yaml'), 'utf8'));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
    await this.lock.release();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('ProjectStore is closed');
  }
}

function initializeRecoveredState(
  database: Database.Database,
  manifest: ProjectManifest,
  manifestYaml: string,
): void {
  const now = new Date().toISOString();
  const revisionId = createId('rev');
  const manifestHash = digest(manifestYaml);
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO projects(id, title, manifest_hash, current_revision_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.project.id,
        manifest.project.title,
        manifestHash,
        revisionId,
        manifest.project.created_at,
        now,
      );
    database
      .prepare(
        `INSERT INTO revisions(
          id, project_id, parent_id, status, author_type, author_id, message,
          patch_json, snapshot_yaml, manifest_hash, branch, created_at
         ) VALUES (?, ?, NULL, 'committed', 'system', 'openmovie_recovery',
          'Recover runtime state from Movie IR', '[]', ?, ?, 'main', ?)`,
      )
      .run(revisionId, manifest.project.id, manifestYaml, manifestHash, now);
  })();
}
