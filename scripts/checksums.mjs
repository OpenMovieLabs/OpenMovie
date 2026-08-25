import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const directory = resolve(process.argv[2] ?? '.');
const output = resolve(process.argv[3] ?? resolve(directory, 'SHA256SUMS.txt'));
const files = (await listFiles(directory)).filter((path) => path !== output).sort();
const entries = [];
for (const path of files) {
  const digest = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  entries.push(`${digest}  ${relative(directory, path).split(sep).join('/')}`);
}
await writeFile(output, `${entries.join('\n')}\n`, 'utf8');
process.stdout.write(`Wrote ${entries.length} SHA-256 checksums to ${output}\n`);

async function listFiles(path) {
  if ((await stat(path)).isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}
