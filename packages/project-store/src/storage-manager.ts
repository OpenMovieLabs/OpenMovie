import { lstat, mkdir, readdir, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';

export type StorageCategory = 'objects' | 'cache' | 'previews' | 'temp' | 'database' | 'sources';
export type CleanableStorageCategory = Extract<StorageCategory, 'cache' | 'previews' | 'temp'>;

export type StorageReport = {
  measuredAt: string;
  totalBytes: number;
  reclaimableBytes: number;
  categories: Record<StorageCategory, number>;
  disk: {
    totalBytes: number;
    freeBytes: number;
    lowSpace: boolean;
  };
};

async function pathSize(path: string): Promise<number> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
  if (entry.isSymbolicLink()) return 0;
  if (!entry.isDirectory()) return entry.size;
  const children = await readdir(path);
  const sizes = await Promise.all(children.map((name) => pathSize(join(path, name))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export class StorageManager {
  private readonly categoryPaths: Record<StorageCategory, string>;

  constructor(
    private readonly projectRoot: string,
    private readonly metadataRoot: string,
  ) {
    this.categoryPaths = {
      objects: join(metadataRoot, 'objects'),
      cache: join(metadataRoot, 'cache'),
      previews: join(metadataRoot, 'previews'),
      temp: join(metadataRoot, 'temp'),
      database: join(metadataRoot, 'state.sqlite'),
      sources: projectRoot,
    };
  }

  async report(): Promise<StorageReport> {
    const [objects, cache, previews, temp, database, wholeProject, filesystem] = await Promise.all([
      pathSize(this.categoryPaths.objects),
      pathSize(this.categoryPaths.cache),
      pathSize(this.categoryPaths.previews),
      pathSize(this.categoryPaths.temp),
      pathSize(this.categoryPaths.database),
      pathSize(this.projectRoot),
      statfs(this.projectRoot),
    ]);
    const metadataKnown = objects + cache + previews + temp + database;
    const sources = Math.max(0, wholeProject - metadataKnown);
    const totalBytes = objects + cache + previews + temp + database + sources;
    const totalDiskBytes = filesystem.blocks * filesystem.bsize;
    const freeBytes = filesystem.bavail * filesystem.bsize;
    return {
      measuredAt: new Date().toISOString(),
      totalBytes,
      reclaimableBytes: cache + previews + temp,
      categories: { objects, cache, previews, temp, database, sources },
      disk: {
        totalBytes: totalDiskBytes,
        freeBytes,
        lowSpace: freeBytes < Math.min(10 * 1024 ** 3, totalDiskBytes * 0.05),
      },
    };
  }

  async clean(categories: CleanableStorageCategory[]): Promise<StorageReport> {
    const unique = [...new Set(categories)];
    await Promise.all(
      unique.map(async (category) => {
        const path = this.categoryPaths[category];
        await rm(path, { recursive: true, force: true });
        await mkdir(path, { recursive: true });
      }),
    );
    return this.report();
  }
}
