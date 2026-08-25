import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/set-version.mjs <semver>');
}

for (const path of [
  'package.json',
  'apps/cli/package.json',
  'apps/core/package.json',
  'apps/desktop/package.json',
  'apps/mcp-server/package.json',
]) {
  const absolute = resolve(path);
  const packageJson = JSON.parse(await readFile(absolute, 'utf8'));
  packageJson.version = version;
  await writeFile(absolute, `${JSON.stringify(packageJson, null, 2)}\n`);
}

process.stdout.write(`[version] Set release packages to ${version}\n`);
