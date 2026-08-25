import Database from 'better-sqlite3';

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        current_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES revisions(id),
        status TEXT NOT NULL CHECK (status IN ('committed', 'rejected')),
        author_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        message TEXT NOT NULL,
        patch_json TEXT NOT NULL,
        snapshot_yaml TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS revisions_project_created
        ON revisions(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS entity_index (
        entity_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        entity_revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        object_uri TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS object_refs (
        digest TEXT PRIMARY KEY,
        byte_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        ref_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS takes (
        id TEXT PRIMARY KEY,
        shot_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id),
        run_id TEXT,
        provider_json TEXT NOT NULL,
        generation_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        task_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_updated_at
        ON tasks(updated_at DESC);
      CREATE TABLE IF NOT EXISTS task_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_events_task_sequence
        ON task_events(task_id, sequence);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE projects ADD COLUMN current_branch TEXT NOT NULL DEFAULT 'main';
      ALTER TABLE revisions ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
      CREATE TABLE IF NOT EXISTS revision_files (
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        PRIMARY KEY(revision_id, relative_path)
      );
      CREATE INDEX IF NOT EXISTS revision_files_hash
        ON revision_files(content_hash);
      CREATE TABLE IF NOT EXISTS branches (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        head_revision_id TEXT NOT NULL REFERENCES revisions(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, name)
      );
      INSERT OR IGNORE INTO branches(project_id, name, head_revision_id, created_at, updated_at)
        SELECT id, 'main', current_revision_id, created_at, updated_at
        FROM projects WHERE current_revision_id IS NOT NULL;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE artifacts ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE IF NOT EXISTS provider_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        provider_job_id TEXT,
        status TEXT NOT NULL,
        usage_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        take_id TEXT NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
        evaluator TEXT NOT NULL,
        status TEXT NOT NULL,
        score REAL,
        findings_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS evaluations_take_created
        ON evaluations(take_id, created_at DESC);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        author_id TEXT NOT NULL,
        resolution_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_target_status
        ON feedback(target_type, target_id, status, created_at DESC);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        take_id TEXT NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analyses_take_created
        ON analyses(take_id, created_at DESC);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS timeline_renders (
        id TEXT PRIMARY KEY,
        source_revision_id TEXT NOT NULL,
        timeline_revision INTEGER NOT NULL,
        object_uri TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        duration_us INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS timeline_renders_created
        ON timeline_renders(created_at DESC);
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS revision_proposals (
        id TEXT PRIMARY KEY,
        base_revision_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
        summary TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        author_id TEXT NOT NULL,
        feedback_id TEXT,
        accepted_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS revision_proposals_status_created
        ON revision_proposals(status, created_at DESC);
    `,
  },
] as const;

export function openProjectDatabase(path: string, readonly = false): Database.Database {
  const database = new Database(path, { readonly, fileMustExist: readonly });
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (!readonly) {
    database.pragma('journal_mode = WAL');
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      database
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row) => (row as { version: number }).version),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      database.transaction(() => {
        database.exec(migration.sql);
        database
          .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      })();
    }
  }
  return database;
}
