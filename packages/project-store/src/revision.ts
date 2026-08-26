import { createHash } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import {
  assetManifestSchema,
  characterSchema,
  createId,
  parseProjectManifest,
  parseYaml,
  parseYamlDocument,
  projectManifestSchema,
  sceneSchema,
  serializeProjectManifest,
  shotSchema,
  timelineSchema,
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

export type MovieFileChange = { path: string; content: string };

export type CommitFilesInput = Omit<CommitRevisionInput, 'patch'> & {
  changes: MovieFileChange[];
};

export type RevisionRecord = {
  id: string;
  parentId: string | null;
  authorType: string;
  authorId: string;
  message: string;
  patch: MoviePatchOperation[];
  manifestHash: string;
  changedPaths: string[];
  createdAt: string;
};

export type StructuralChange = {
  pointer: string;
  operation: 'add' | 'replace' | 'remove';
  before?: unknown;
  after?: unknown;
};

export type FileDiff = {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  beforeHash?: string;
  afterHash?: string;
  changes: StructuralChange[];
};

export type RevisionDiff = {
  revisionId: string;
  baseRevisionId: string | null;
  files: FileDiff[];
};

type SnapshotFile = { path: string; content: string; hash: string };

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hashSnapshot(files: SnapshotFile[]): string {
  const digest = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(file.path).update('\0').update(file.hash).update('\0');
  }
  return digest.digest('hex');
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

function normalizeMoviePath(path: string): string {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid movie file path: ${path}`);
  }
  if (!path.endsWith('.yaml')) throw new Error(`Movie source files must be YAML: ${path}`);
  if (path.startsWith('.openmovie/'))
    throw new Error('Runtime metadata cannot be revised as Movie IR');
  return path;
}

function validateMovieFile(path: string, content: string): void {
  if (path === 'openmovie.yaml') {
    parseProjectManifest(content);
  } else if (path === 'assets/manifest.yaml') {
    parseYaml(content, assetManifestSchema);
  } else if (path.startsWith('characters/')) {
    parseYaml(content, characterSchema);
  } else if (path.startsWith('scenes/')) {
    parseYaml(content, sceneSchema);
  } else if (path.startsWith('shots/')) {
    parseYaml(content, shotSchema);
  } else if (path.startsWith('timeline/')) {
    parseYaml(content, timelineSchema);
  } else {
    parseYaml(content, projectManifestSchema.partial().passthrough());
  }
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function structuralDiff(before: unknown, after: unknown, pointer = ''): StructuralChange[] {
  if (Object.is(before, after)) return [];
  if (before === undefined) return [{ pointer: pointer || '/', operation: 'add', after }];
  if (after === undefined) return [{ pointer: pointer || '/', operation: 'remove', before }];
  if (
    typeof before !== 'object' ||
    before === null ||
    typeof after !== 'object' ||
    after === null ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return [{ pointer: pointer || '/', operation: 'replace', before, after }];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: StructuralChange[] = [];
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      changes.push(...structuralDiff(before[index], after[index], `${pointer}/${index}`));
    }
    return changes;
  }
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) =>
    structuralDiff(left[key], right[key], `${pointer}/${escapePointer(key)}`),
  );
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
  private readonly journalDirectory: string;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly projectRoot: string,
    private readonly projectId: string,
    private readonly database: Database.Database,
  ) {
    this.journalDirectory = join(projectRoot, '.openmovie', 'temp');
  }

  currentRevisionId(): string | null {
    const row = this.database
      .prepare('SELECT current_revision_id FROM projects WHERE id = ?')
      .get(this.projectId) as { current_revision_id: string | null } | undefined;
    return row?.current_revision_id ?? null;
  }

  async initializeCurrentSnapshot(): Promise<void> {
    const revisionId = this.currentRevisionId();
    if (!revisionId) return;
    const existing = this.database
      .prepare('SELECT COUNT(*) AS count FROM revision_files WHERE revision_id = ?')
      .get(revisionId) as { count: number };
    if (existing.count > 0) return;
    const snapshot = await this.captureWorkingSnapshot();
    this.database.transaction(() => this.insertSnapshotFiles(revisionId, snapshot))();
  }

  commit(input: CommitRevisionInput): Promise<RevisionRecord> {
    return this.exclusive(async () => {
      this.assertExpectedRevision(input.expectedRevisionId);
      const snapshot = await this.captureWorkingSnapshot();
      const root = snapshot.find((file) => file.path === 'openmovie.yaml');
      if (!root) throw new Error('openmovie.yaml is missing');
      root.content = serializeProjectManifest(
        applyMoviePatch(parseProjectManifest(root.content), input.patch),
      );
      root.hash = hash(root.content);
      return this.persistRevision(input, input.expectedRevisionId, snapshot, ['openmovie.yaml']);
    });
  }

  commitFiles(input: CommitFilesInput): Promise<RevisionRecord> {
    return this.exclusive(async () => {
      this.assertExpectedRevision(input.expectedRevisionId);
      const snapshot = await this.captureWorkingSnapshot();
      const files = new Map(snapshot.map((file) => [file.path, file]));
      const changedPaths = new Set<string>();
      for (const change of input.changes) {
        const path = normalizeMoviePath(change.path);
        validateMovieFile(path, change.content);
        files.set(path, { path, content: change.content, hash: hash(change.content) });
        changedPaths.add(path);
      }
      const root = files.get('openmovie.yaml');
      if (!root) throw new Error('openmovie.yaml is missing');
      const manifest = parseProjectManifest(root.content);
      manifest.project.updated_at = new Date().toISOString();
      root.content = serializeProjectManifest(manifest);
      root.hash = hash(root.content);
      changedPaths.add('openmovie.yaml');
      return this.persistRevision(
        { ...input, patch: [] },
        input.expectedRevisionId,
        [...files.values()],
        [...changedPaths],
      );
    });
  }

  restore(
    revisionId: string,
    expectedRevisionId: string | null,
    authorId: string,
  ): Promise<RevisionRecord> {
    return this.exclusive(async () => {
      this.assertExpectedRevision(expectedRevisionId);
      const snapshot = this.snapshotForRevision(revisionId);
      if (snapshot.length === 0) throw new Error(`Revision not found: ${revisionId}`);
      return this.persistRevision(
        {
          expectedRevisionId,
          authorType: 'user',
          authorId,
          message: `Restore ${revisionId}`,
          patch: [],
        },
        expectedRevisionId,
        snapshot,
        snapshot.map((file) => file.path),
      );
    });
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
      changedPaths: this.changedPathsFor(row.id, row.parent_id),
      createdAt: row.created_at,
    }));
  }

  diff(revisionId: string, baseRevisionId?: string | null): RevisionDiff {
    const revision = this.database
      .prepare('SELECT parent_id FROM revisions WHERE id = ? AND project_id = ?')
      .get(revisionId, this.projectId) as { parent_id: string | null } | undefined;
    if (!revision) throw new Error(`Revision not found: ${revisionId}`);
    const baseId = baseRevisionId === undefined ? revision.parent_id : baseRevisionId;
    return {
      revisionId,
      baseRevisionId: baseId,
      files: this.compareSnapshots(
        baseId ? this.snapshotForRevision(baseId) : [],
        this.snapshotForRevision(revisionId),
      ),
    };
  }

  async workingChanges(): Promise<FileDiff[]> {
    const revisionId = this.currentRevisionId();
    const committed = revisionId ? this.snapshotForRevision(revisionId) : [];
    return this.compareSnapshots(committed, await this.captureWorkingSnapshot());
  }

  async recover(): Promise<number> {
    return this.exclusive(async () => {
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
          snapshotFiles?: SnapshotFile[];
          snapshotYaml?: string;
        };
        const snapshot =
          journal.snapshotFiles ??
          (journal.snapshotYaml
            ? [
                {
                  path: 'openmovie.yaml',
                  content: journal.snapshotYaml,
                  hash: hash(journal.snapshotYaml),
                },
              ]
            : []);
        if (snapshot.length > 0) {
          await this.writeSnapshot(snapshot);
          this.insertRevision(journal.record, snapshot);
          recovered += 1;
        }
        await unlink(path);
      }
      return recovered;
    });
  }

  private async persistRevision(
    input: CommitRevisionInput,
    parentId: string | null,
    snapshot: SnapshotFile[],
    changedPaths: string[],
  ): Promise<RevisionRecord> {
    for (const file of snapshot) validateMovieFile(file.path, file.content);
    const record: RevisionRecord = {
      id: createId('rev'),
      parentId,
      authorType: input.authorType,
      authorId: input.authorId,
      message: input.message,
      patch: input.patch,
      manifestHash: hashSnapshot(snapshot),
      changedPaths: [...new Set(changedPaths)].sort(),
      createdAt: new Date().toISOString(),
    };
    const journalPath = join(this.journalDirectory, `revision-${record.id}.json`);
    await writeFileAtomic(
      journalPath,
      JSON.stringify({ version: 2, record, snapshotFiles: snapshot }),
    );
    await this.writeSnapshot(snapshot);
    this.database.transaction(() => this.insertRevision(record, snapshot))();
    await unlink(journalPath);
    return record;
  }

  private insertRevision(record: RevisionRecord, snapshot: SnapshotFile[]): void {
    const root = snapshot.find((file) => file.path === 'openmovie.yaml');
    if (!root) throw new Error('Revision snapshot has no openmovie.yaml');
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
        root.content,
        record.manifestHash,
        record.createdAt,
      );
    this.insertSnapshotFiles(record.id, snapshot);
    this.database
      .prepare(
        `UPDATE projects SET current_revision_id = ?, manifest_hash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(record.id, record.manifestHash, record.createdAt, this.projectId);
    this.database
      .prepare('INSERT INTO events(type, payload_json, created_at) VALUES (?, ?, ?)')
      .run(
        'revision.committed',
        JSON.stringify({
          revisionId: record.id,
          changedPaths: record.changedPaths,
        }),
        record.createdAt,
      );
  }

  private insertSnapshotFiles(revisionId: string, snapshot: SnapshotFile[]): void {
    const statement = this.database.prepare(
      `INSERT OR IGNORE INTO revision_files(revision_id, relative_path, content, content_hash)
       VALUES (?, ?, ?, ?)`,
    );
    for (const file of snapshot) statement.run(revisionId, file.path, file.content, file.hash);
  }

  private snapshotForRevision(revisionId: string): SnapshotFile[] {
    const rows = this.database
      .prepare(
        `SELECT relative_path, content, content_hash FROM revision_files
         WHERE revision_id = ? ORDER BY relative_path`,
      )
      .all(revisionId) as Array<{ relative_path: string; content: string; content_hash: string }>;
    if (rows.length > 0) {
      return rows.map((row) => ({
        path: row.relative_path,
        content: row.content,
        hash: row.content_hash,
      }));
    }
    const legacy = this.database
      .prepare('SELECT snapshot_yaml FROM revisions WHERE id = ? AND project_id = ?')
      .get(revisionId, this.projectId) as { snapshot_yaml: string } | undefined;
    return legacy
      ? [
          {
            path: 'openmovie.yaml',
            content: legacy.snapshot_yaml,
            hash: hash(legacy.snapshot_yaml),
          },
        ]
      : [];
  }

  private changedPathsFor(revisionId: string, parentId: string | null): string[] {
    const current = new Map(
      this.snapshotForRevision(revisionId).map((file) => [file.path, file.hash] as const),
    );
    if (!parentId) return [...current.keys()].sort();
    const parent = new Map(
      this.snapshotForRevision(parentId).map((file) => [file.path, file.hash] as const),
    );
    return [...new Set([...current.keys(), ...parent.keys()])]
      .filter((path) => current.get(path) !== parent.get(path))
      .sort();
  }

  private compareSnapshots(beforeFiles: SnapshotFile[], afterFiles: SnapshotFile[]): FileDiff[] {
    const before = new Map(beforeFiles.map((file) => [file.path, file] as const));
    const after = new Map(afterFiles.map((file) => [file.path, file] as const));
    return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path): FileDiff[] => {
      const left = before.get(path);
      const right = after.get(path);
      if (left?.hash === right?.hash) return [];
      const status = left ? (right ? 'modified' : 'deleted') : 'added';
      let changes: StructuralChange[];
      try {
        changes = structuralDiff(
          left ? parseYamlDocument(left.content) : undefined,
          right ? parseYamlDocument(right.content) : undefined,
        );
      } catch {
        changes = structuralDiff(left?.content, right?.content);
      }
      return [
        {
          path,
          status,
          ...(left ? { beforeHash: left.hash } : {}),
          ...(right ? { afterHash: right.hash } : {}),
          changes,
        },
      ];
    });
  }

  private async captureWorkingSnapshot(): Promise<SnapshotFile[]> {
    const paths = await this.listYamlFiles(this.projectRoot);
    return Promise.all(
      paths.map(async (absolutePath) => {
        const path = relative(this.projectRoot, absolutePath).split(sep).join('/');
        const content = await readFile(absolutePath, 'utf8');
        return { path: normalizeMoviePath(path), content, hash: hash(content) };
      }),
    );
  }

  private async listYamlFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.name === '.openmovie') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) paths.push(...(await this.listYamlFiles(path)));
      else if (entry.isFile() && entry.name.endsWith('.yaml')) paths.push(path);
    }
    return paths.sort();
  }

  private async writeSnapshot(snapshot: SnapshotFile[]): Promise<void> {
    const expected = new Set(snapshot.map((file) => file.path));
    const current = await this.listYamlFiles(this.projectRoot);
    for (const file of snapshot) {
      const target = resolve(this.projectRoot, file.path);
      if (relative(this.projectRoot, target).startsWith('..'))
        throw new Error('Snapshot escapes project');
      await writeFileAtomic(target, file.content);
    }
    for (const absolutePath of current) {
      const path = relative(this.projectRoot, absolutePath).split(sep).join('/');
      if (!expected.has(path)) await unlink(absolutePath);
    }
  }

  private assertExpectedRevision(expectedRevisionId: string | null): void {
    const actual = this.currentRevisionId();
    if (actual !== expectedRevisionId) throw new RevisionConflictError(expectedRevisionId, actual);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(work, work);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
