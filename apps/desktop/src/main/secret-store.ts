import Database from 'better-sqlite3';

export type SecretMetadata = {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type SecretCrypto = {
  isAvailable: () => boolean;
  encrypt: (plaintext: string) => Promise<Buffer>;
  decrypt: (ciphertext: Buffer) => Promise<{ plaintext: string; shouldReEncrypt: boolean }>;
};

export type ProviderProfile = {
  id: string;
  label: string;
  baseUrl: string;
  protocol: 'openai_chat' | 'openai_responses' | 'openai_images' | 'http_video_jobs' | 'custom';
  model: string;
  secretId: string;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecentProject = { path: string; title: string; lastOpenedAt: string };

export class EncryptedSecretStore {
  private readonly database: Database.Database;

  constructor(
    path: string,
    private readonly crypto: SecretCrypto,
  ) {
    this.database = new Database(path);
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_profiles (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        base_url TEXT NOT NULL,
        protocol TEXT NOT NULL,
        model TEXT NOT NULL,
        secret_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recent_projects (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );
    `);
  }

  async set(id: string, label: string, plaintext: string): Promise<SecretMetadata> {
    if (!this.crypto.isAvailable()) throw new Error('System credential encryption is unavailable');
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(id)) throw new Error('Invalid secret ID');
    if (!plaintext) throw new Error('Secret value is empty');
    const ciphertext = await this.crypto.encrypt(plaintext);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO secrets(id, label, ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label,
           ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(id, label, ciphertext, now, now);
    return this.getMetadata(id);
  }

  async get(id: string): Promise<string> {
    if (!this.crypto.isAvailable()) throw new Error('System credential encryption is unavailable');
    const row = this.database.prepare('SELECT ciphertext FROM secrets WHERE id = ?').get(id) as
      { ciphertext: Buffer } | undefined;
    if (!row) throw new Error(`Secret not found: ${id}`);
    const decrypted = await this.crypto.decrypt(row.ciphertext);
    if (decrypted.shouldReEncrypt) {
      const replacement = await this.crypto.encrypt(decrypted.plaintext);
      this.database
        .prepare('UPDATE secrets SET ciphertext = ?, updated_at = ? WHERE id = ?')
        .run(replacement, new Date().toISOString(), id);
    }
    return decrypted.plaintext;
  }

  list(): SecretMetadata[] {
    const rows = this.database
      .prepare('SELECT id, label, created_at, updated_at FROM secrets ORDER BY label')
      .all() as Array<{ id: string; label: string; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  delete(id: string): boolean {
    return this.database.prepare('DELETE FROM secrets WHERE id = ?').run(id).changes > 0;
  }

  setProviderProfile(
    input: Omit<ProviderProfile, 'hasSecret' | 'createdAt' | 'updatedAt'>,
  ): ProviderProfile {
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(input.id)) throw new Error('Invalid provider ID');
    const url = new URL(input.baseUrl);
    if (url.username || url.password)
      throw new Error('Provider endpoint cannot contain credentials');
    if (url.hash) throw new Error('Provider endpoint cannot contain a URL fragment');
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Provider endpoint must use HTTPS unless it is localhost');
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO provider_profiles(
          id, label, base_url, protocol, model, secret_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET label = excluded.label, base_url = excluded.base_url,
          protocol = excluded.protocol, model = excluded.model, secret_id = excluded.secret_id,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.label,
        url.toString(),
        input.protocol,
        input.model,
        input.secretId,
        now,
        now,
      );
    const profile = this.listProviderProfiles().find((item) => item.id === input.id);
    if (!profile) throw new Error('Provider profile was not saved');
    return profile;
  }

  listProviderProfiles(): ProviderProfile[] {
    const rows = this.database
      .prepare(
        `SELECT p.id, p.label, p.base_url, p.protocol, p.model, p.secret_id,
          p.created_at, p.updated_at, s.id IS NOT NULL AS has_secret
         FROM provider_profiles p LEFT JOIN secrets s ON s.id = p.secret_id
         ORDER BY p.label`,
      )
      .all() as Array<{
      id: string;
      label: string;
      base_url: string;
      protocol: ProviderProfile['protocol'];
      model: string;
      secret_id: string;
      created_at: string;
      updated_at: string;
      has_secret: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      baseUrl: row.base_url,
      protocol: row.protocol,
      model: row.model,
      secretId: row.secret_id,
      hasSecret: row.has_secret === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  rememberProject(path: string, title: string): RecentProject {
    const lastOpenedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO recent_projects(path, title, last_opened_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET title = excluded.title,
           last_opened_at = excluded.last_opened_at`,
      )
      .run(path, title, lastOpenedAt);
    return { path, title, lastOpenedAt };
  }

  listRecentProjects(): RecentProject[] {
    return (
      this.database
        .prepare(
          'SELECT path, title, last_opened_at FROM recent_projects ORDER BY last_opened_at DESC',
        )
        .all() as Array<{ path: string; title: string; last_opened_at: string }>
    ).map((row) => ({ path: row.path, title: row.title, lastOpenedAt: row.last_opened_at }));
  }

  forgetProject(path: string): boolean {
    return (
      this.database.prepare('DELETE FROM recent_projects WHERE path = ?').run(path).changes > 0
    );
  }

  close(): void {
    this.database.close();
  }

  private getMetadata(id: string): SecretMetadata {
    const row = this.database
      .prepare('SELECT id, label, created_at, updated_at FROM secrets WHERE id = ?')
      .get(id) as { id: string; label: string; created_at: string; updated_at: string } | undefined;
    if (!row) throw new Error(`Secret not found after write: ${id}`);
    return { id: row.id, label: row.label, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
