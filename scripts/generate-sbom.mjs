import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(process.argv[2] ?? resolve(root, 'artifacts/openmovie-sbom.cdx.json'));
const [lockText, packageText] = await Promise.all([
  readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'),
  readFile(resolve(root, 'package.json'), 'utf8'),
]);
const packageMetadata = JSON.parse(packageText);
const components = parsePackages(lockText).map(({ name, version }) => {
  const purl = `pkg:npm/${purlName(name)}@${encodeURIComponent(version)}`;
  return { type: 'library', 'bom-ref': purl, name, version, purl };
});
const lockDigest = createHash('sha256').update(lockText).digest('hex');
const uuid = `${lockDigest.slice(0, 8)}-${lockDigest.slice(8, 12)}-5${lockDigest.slice(13, 16)}-a${lockDigest.slice(17, 20)}-${lockDigest.slice(20, 32)}`;
const version = String(process.env.OPENMOVIE_VERSION ?? packageMetadata.version ?? '0.0.0').replace(
  /^v/,
  '',
);
const applicationPurl = `pkg:npm/openmovie@${encodeURIComponent(version)}`;
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${uuid}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      'bom-ref': applicationPurl,
      name: 'openmovie',
      version,
      purl: applicationPurl,
      licenses: [{ license: { id: '0BSD' } }],
    },
    properties: [
      { name: 'openmovie:packageManager', value: String(packageMetadata.packageManager ?? '') },
      { name: 'openmovie:lockfileSha256', value: lockDigest },
    ],
  },
  components,
};

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
process.stdout.write(
  `Wrote CycloneDX SBOM with ${components.length} components to ${destination}\n`,
);

function parsePackages(lockfile) {
  const lines = lockfile.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'packages:');
  const end = lines.findIndex((line, index) => index > start && line === 'snapshots:');
  if (start < 0 || end < 0) throw new Error('Unsupported pnpm lockfile structure');
  const packages = new Map();
  for (const line of lines.slice(start + 1, end)) {
    const match = /^ {2}(.+):$/.exec(line);
    if (!match?.[1]) continue;
    const key = unquote(match[1]).replace(/\(.+$/, '');
    const separator = key.lastIndexOf('@');
    if (separator <= 0) continue;
    const name = key.slice(0, separator);
    const version = key.slice(separator + 1);
    if (!name || !version || version.startsWith('link:') || version.startsWith('file:')) continue;
    packages.set(`${name}@${version}`, { name, version });
  }
  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  return value;
}

function purlName(name) {
  if (!name.startsWith('@')) return encodeURIComponent(name);
  const separator = name.indexOf('/');
  if (separator < 0) return encodeURIComponent(name);
  return `%40${encodeURIComponent(name.slice(1, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
}
