import { createRequire } from 'node:module';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const entry = require.resolve('better-sqlite3');
const packageRoot = resolve(dirname(entry), '..');
const candidates = [
  join(packageRoot, 'build', 'Release', 'better_sqlite3.node'),
  join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}.node`),
];
let source;
for (const candidate of candidates) {
  try {
    await access(candidate);
    source = candidate;
    break;
  } catch {
    // Try the next supported better-sqlite3 layout.
  }
}
if (!source)
  throw new Error(`No better-sqlite3 binding found for ${process.platform}-${process.arch}`);
const outputRoot = resolve(process.cwd(), process.argv[2] ?? 'dist');
const targetDirectory = join(dirname(outputRoot), 'build', 'Release');
await mkdir(targetDirectory, { recursive: true });
await copyFile(source, join(targetDirectory, 'better_sqlite3.node'));
