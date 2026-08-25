import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export type StoredObject = {
  digest: string;
  uri: string;
  byteSize: number;
  mimeType: string;
  path: string;
};

function detectMimeType(header: Uint8Array, name: string): string {
  const signature = Buffer.from(header);
  if (signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (
    signature.subarray(0, 4).toString('ascii') === 'RIFF' &&
    signature.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  if (signature.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (
    signature.subarray(0, 4).toString('ascii') === 'RIFF' &&
    signature.subarray(8, 12).toString('ascii') === 'WAVE'
  )
    return 'audio/wav';
  if (name.toLowerCase().endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

export class ObjectStore {
  private readonly objectsRoot: string;
  private readonly temporaryRoot: string;

  constructor(private readonly metadataRoot: string) {
    this.objectsRoot = join(metadataRoot, 'objects', 'sha256');
    this.temporaryRoot = join(metadataRoot, 'temp');
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.objectsRoot, { recursive: true }),
      mkdir(this.temporaryRoot, { recursive: true }),
    ]);
  }

  async importFile(sourcePath: string): Promise<StoredObject> {
    await this.initialize();
    const temporaryPath = join(this.temporaryRoot, `object-${randomUUID()}.tmp`);
    const source = await open(sourcePath, 'r');
    const target = await open(temporaryPath, 'wx', 0o600);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const header = Buffer.alloc(16);
    let headerBytes = 0;
    let byteSize = 0;

    try {
      while (true) {
        const read = await source.read(buffer, 0, buffer.length, null);
        if (read.bytesRead === 0) break;
        const chunk = buffer.subarray(0, read.bytesRead);
        if (headerBytes < header.length) {
          const count = Math.min(header.length - headerBytes, chunk.length);
          chunk.copy(header, headerBytes, 0, count);
          headerBytes += count;
        }
        hash.update(chunk);
        await target.write(chunk);
        byteSize += read.bytesRead;
      }
      await target.sync();
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    } finally {
      await Promise.all([source.close(), target.close()]);
    }

    const digest = hash.digest('hex');
    const finalDirectory = join(this.objectsRoot, digest.slice(0, 2));
    const finalPath = join(finalDirectory, digest);
    await mkdir(finalDirectory, { recursive: true });
    try {
      await stat(finalPath);
      await unlink(temporaryPath);
    } catch {
      await rename(temporaryPath, finalPath);
    }

    return {
      digest,
      uri: `om://object/sha256/${digest}`,
      byteSize,
      mimeType: detectMimeType(header.subarray(0, headerBytes), basename(sourcePath)),
      path: finalPath,
    };
  }

  async importBytes(bytes: Uint8Array, suggestedName: string): Promise<StoredObject> {
    await this.initialize();
    const safeName = basename(suggestedName).replaceAll(/[^a-zA-Z0-9._-]/g, '_');
    const sourcePath = join(this.temporaryRoot, `incoming-${randomUUID()}-${safeName}`);
    await writeFile(sourcePath, bytes, { mode: 0o600, flag: 'wx' });
    try {
      return await this.importFile(sourcePath);
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  }

  resolveUri(uri: string): string {
    const match = /^om:\/\/object\/sha256\/([a-f0-9]{64})$/.exec(uri);
    if (!match?.[1]) throw new Error(`Invalid OpenMovie object URI: ${uri}`);
    return join(this.objectsRoot, match[1].slice(0, 2), match[1]);
  }
}
