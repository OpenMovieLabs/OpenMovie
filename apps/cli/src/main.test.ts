import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './main.js';

function capture(): { output: string[]; errors: string[]; io: Parameters<typeof runCli>[1] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    io: { stdout: (text) => output.push(text), stderr: (text) => errors.push(text) },
  };
}

describe('OpenMovie CLI', () => {
  it('creates, diagnoses, summarizes, and exports a portable project', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-cli-'));
    const project = join(parent, 'source');
    const destination = join(parent, 'exported');
    const created = capture();
    expect(await runCli(['create', project, '--title', 'CLI Movie', '--json'], created.io)).toBe(0);
    expect(JSON.parse(created.output[0] ?? '{}')).toMatchObject({ title: 'CLI Movie' });

    const diagnosed = capture();
    expect(await runCli(['doctor', project, '--deep', '--json'], diagnosed.io)).toBe(0);
    expect(JSON.parse(diagnosed.output[0] ?? '{}')).toMatchObject({ status: 'healthy' });

    const exported = capture();
    expect(await runCli(['export', project, destination, '--deep'], exported.io)).toBe(0);
    expect((await stat(join(destination, 'openmovie.yaml'))).isFile()).toBe(true);
  });

  it('returns a failing Doctor report for invalid Movie IR', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-cli-invalid-'));
    const project = join(parent, 'movie');
    expect(await runCli(['create', project, '--title', 'Broken'], capture().io)).toBe(0);
    await writeFile(join(project, 'shots', 'bad.yaml'), 'not: a-shot\n');
    const diagnosed = capture();
    expect(await runCli(['doctor', project, '--json'], diagnosed.io)).toBe(2);
    expect(JSON.parse(diagnosed.output[0] ?? '{}')).toMatchObject({ status: 'failed' });
  });

  it('creates a complete three-shot continuity example with comparison Takes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-cli-example-'));
    const project = join(parent, 'continuity');
    const created = capture();
    expect(await runCli(['example', project, '--json'], created.io)).toBe(0);
    expect(JSON.parse(created.output[0] ?? '{}')).toMatchObject({
      title: 'Three-Shot Continuity',
      counts: { characters: 1, scenes: 1, shots: 3, takes: 6 },
    });

    const diagnosed = capture();
    expect(await runCli(['doctor', project, '--deep', '--json'], diagnosed.io)).toBe(0);
    expect(JSON.parse(diagnosed.output[0] ?? '{}')).toMatchObject({ status: 'healthy' });

    const listed = capture();
    expect(await runCli(['revisions', project, '--json'], listed.io)).toBe(0);
    const revisions = JSON.parse(listed.output[0] ?? '[]') as Array<{ id: string }>;
    const currentRevision = revisions[0];
    const historicalRevision = revisions.at(-1);
    if (!currentRevision || !historicalRevision) throw new Error('Expected Revision history');

    const restored = capture();
    expect(await runCli(['restore', project, historicalRevision.id, '--json'], restored.io)).toBe(
      0,
    );
    expect(JSON.parse(restored.output[0] ?? '{}')).toMatchObject({
      parentId: currentRevision.id,
      authorId: 'cli_user',
    });
  }, 15_000);
});
