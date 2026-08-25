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
