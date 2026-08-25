import { randomUUID } from 'node:crypto';
import { open, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

export function resolveProjectPath(projectRoot: string, projectRelativePath: string): string {
  const root = resolve(projectRoot);
  const target = resolve(root, projectRelativePath);
  const relation = relative(root, target);
  if (relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Path escapes project root: ${projectRelativePath}`);
  }
  return target;
}

export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
