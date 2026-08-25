import { createHash } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createId,
  parseProjectManifest,
  projectManifestSchema,
  serializeProjectManifest,
  type ProjectManifest,
} from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

import { RevisionConflictError } from './errors.js';
import { writeFileAtomic } from './fs.js';

export type MoviePatchOperation = {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
};

export type CommitRevisionInput = {
  expectedRevisionId: string | null;
  authorType: 'user' | 'agent' | 'system';
  authorId: string;
  message: string;
  patch: MoviePatchOperation[];
};

export type RevisionRecord = {
  id: string;
  parentId: string | null;
  authorType: string;
  authorId: string;
  message: string;
  patch: MoviePatchOperation[];
  manifestHash: string;
  createdAt: string;
};

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function pointerParts(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Patch path must be a JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((part) => {
      if (part === '__proto__' || part === 'prototype' || part === 'constructor') {
        throw new Error(`Unsafe patch path segment: ${part}`);
      }
      return part;
    });
}

export function applyMoviePatch(
  manifest: ProjectManifest,
  operations: MoviePatchOperation[],
): ProjectManifest {
  const result: unknown = structuredClone(manifest);
  for (const operation of operations) {
    const parts = pointerParts(operation.path);
    if (parts.length === 0) throw new Error('Replacing the project root is not allowed');
    let parent: unknown = result;
    for (const part of parts.slice(0, -1)) {
      if (typeof parent !== 'object' || parent === null || !(part in parent)) {
        throw new Error(`Patch parent does not exist: ${operation.path}`);
      }
      parent = (parent as Record<string, unknown>)[part];
    }
    if (typeof parent !== 'object' || parent === null) {
      throw new Error(`Patch target parent is not an object: ${operation.path}`);
    }
    const key = parts.at(-1);
    if (!key) throw new Error(`Invalid patch path: ${operation.path}`);
    const record = parent as Record<string, unknown>;
    if (operation.op === 'remove') {
      if (!(key in record)) throw new Error(`Patch target does not exist: ${operation.path}`);
      delete record[key];
    } else {
      if (operation.op === 'replace' && !(key in record)) {
        throw new Error(`Patch target does not exist: ${operation.path}`);
      }
      record[key] = operation.value;
    }
  }
  const parsed = projectManifestSchema.parse(result);
  parsed.project.updated_at = new Date().toISOString();
  return projectManifestSchema.parse(parsed);
}

export class RevisionEngine {
  private readonly manifestPath: string;
  private readonly journalDirectory: string;

  constructor(
    private readonly projectRoot: string,
    private readonly projectId: string,
    private readonly database: Database.Database,
  ) {
    this.manifestPath = join(projectRoot, 'openmovie.yaml');
    this.journalDirectory = join(projectRoot, '.openmovie', 'temp');
  }

  currentRevisionId(): string | null {
    const row = this.database
      .prepare('SELECT current_revision_id FROM projects WHERE id = ?')
      .get(this.projectId) as { current_revision_id: string | null } | undefined;
    return row?.current_revision_id ?? null;
  }

  async commit(input: CommitRevisionInput): Promise<RevisionRecord> {
    const actualRevisionId = this.currentRevisionId();
    if (actualRevisionId !== input.expectedRevisionId) {
      throw new RevisionConflictError(input.expectedRevisionId, actualRevisionId);
    }

    const current = parseProjectManifest(await readFile(this.manifestPath, 'utf8'));
    const next = applyMoviePatch(current, input.patch);
    const snapshotYaml = serializeProjectManifest(next);
    return this.persistRevision(input, actualRevisionId, snapshotYaml);
  }

  async restore(
    revisionId: string,
    expectedRevisionId: string | null,
    authorId: string,
  ): Promise<RevisionRecord> {
    const target = this.database
      .prepare('SELECT snapshot_yaml FROM revisions WHERE id = ? AND project_id = ?')
      .get(revisionId, this.projectId) as { snapshot_yaml: string } | undefined;
    if (!target) throw new Error(`Revision not found: ${revisionId}`);
    if (this.currentRevisionId() !== expectedRevisionId) {
      throw new RevisionConflictError(expectedRevisionId, this.currentRevisionId());
    }
    const validated = serializeProjectManifest(parseProjectManifest(target.snapshot_yaml));
    return this.persistRevision(
      {
        expectedRevisionId,
        authorType: 'user',
        authorId,
        message: `Restore ${revisionId}`,
        patch: [],
      },
      expectedRevisionId,
      validated,
    );
  }

  list(limit = 100): RevisionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, parent_id, author_type, author_id, message, patch_json, manifest_hash, created_at
         FROM revisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(this.projectId, limit) as Array<{
      id: string;
      parent_id: string | null;
      author_type: string;
      author_id: string;
      message: string;
      patch_json: string;
      manifest_hash: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      authorType: row.author_type,
      authorId: row.author_id,
      message: row.message,
      patch: JSON.parse(row.patch_json) as MoviePatchOperation[],
      manifestHash: row.manifest_hash,
      createdAt: row.created_at,
    }));
  }

  async recover(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.journalDirectory);
    } catch {
      return 0;
    }
    let recovered = 0;
    for (const name of names.filter(
      (item) => item.startsWith('revision-') && item.endsWith('.json'),
    )) {
      const path = join(this.journalDirectory, name);
      const journal = JSON.parse(await readFile(path, 'utf8')) as {
        record: RevisionRecord;
        snapshotYaml: string;
      };
      const manifestYaml = await readFile(this.manifestPath, 'utf8');
      if (hash(manifestYaml) === journal.record.manifestHash) {
        this.insertRevision(journal.record, journal.snapshotYaml);
        recovered += 1;
      }
      await unlink(path);
    }
    return recovered;
  }

  private async persistRevision(
    input: CommitRevisionInput,
    parentId: string | null,
    snapshotYaml: string,
  ): Promise<RevisionRecord> {
    const record: RevisionRecord = {
      id: createId('rev'),
      parentId,
      authorType: input.authorType,
      authorId: input.authorId,
      message: input.message,
      patch: input.patch,
      manifestHash: hash(snapshotYaml),
      createdAt: new Date().toISOString(),
    };
    const journalPath = join(this.journalDirectory, `revision-${record.id}.json`);
    await writeFileAtomic(journalPath, JSON.stringify({ record, snapshotYaml }));

    const transaction = this.database.transaction(() => {
      this.insertRevision(record, snapshotYaml);
    });
    await writeFileAtomic(this.manifestPath, snapshotYaml);
    transaction();
    await unlink(journalPath);
    return record;
  }

  private insertRevision(record: RevisionRecord, snapshotYaml: string): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO revisions(
          id, project_id, parent_id, status, author_type, author_id, message,
          patch_json, snapshot_yaml, manifest_hash, created_at
        ) VALUES (?, ?, ?, 'committed', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        this.projectId,
        record.parentId,
        record.authorType,
        record.authorId,
        record.message,
        JSON.stringify(record.patch),
        snapshotYaml,
        record.manifestHash,
        record.createdAt,
      );
    this.database
      .prepare(
        `UPDATE projects SET current_revision_id = ?, manifest_hash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(record.id, record.manifestHash, record.createdAt, this.projectId);
    this.database
      .prepare('INSERT INTO events(type, payload_json, created_at) VALUES (?, ?, ?)')
      .run('revision.committed', JSON.stringify({ revisionId: record.id }), record.createdAt);
  }
}
