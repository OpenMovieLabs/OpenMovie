import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(command, ['--filter', '@openmovie/desktop', 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, OPENMOVIE_SMOKE_TEST: '1' },
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) console.error(`Desktop smoke test terminated by ${signal}`);
  process.exitCode = code ?? 1;
});
