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
