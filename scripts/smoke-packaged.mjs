import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'release');
const candidates = [];

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const item = join(path, entry.name);
    if (entry.isDirectory()) await walk(item);
    else candidates.push(item);
  }
}

await walk(root);
const executable =
  process.platform === 'darwin'
    ? candidates.find((path) => path.endsWith('.app/Contents/MacOS/OpenMovie'))
    : process.platform === 'win32'
      ? candidates.find((path) => basename(path).toLowerCase() === 'openmovie.exe')
      : undefined;

if (!executable) throw new Error(`Packaged OpenMovie executable not found under ${root}`);

await new Promise((resolveRun, reject) => {
  const child = spawn(executable, [], {
    stdio: 'inherit',
    env: { ...process.env, OPENMOVIE_SMOKE_TEST: '1' },
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('Packaged desktop smoke test timed out'));
  }, 120_000);
  child.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    if (code === 0) resolveRun();
    else reject(new Error(`Packaged desktop exited (${code ?? signal ?? 'unknown'})`));
  });
});
