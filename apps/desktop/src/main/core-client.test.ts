import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreClient } from './core-client.js';

async function createCoreFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openmovie-core-client-'));
  const entry = join(directory, 'fixture.cjs');
  await writeFile(
    entry,
    [
      "process.on('message', (message) => {",
      "  if (message.method === 'provider.list') return;",
      "  if (message.method === 'task.list') { process.exit(7); return; }",
      "  if (message.method === 'project.get_summary') {",
      "    process.send({ id: message.id, ok: false, error: { code: 'PROJECT_NOT_OPEN', message: 'No project is open', retryable: false } });",
      '    return;',
      '  }',
      "  if (message.method === 'harness.list') process.send({ invalid: true });",
      '  process.send({ id: message.id, ok: true, result: { method: message.method, electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE } });',
      '});',
    ].join('\n'),
  );
  return entry;
}

describe('CoreClient', () => {
  let entry: string;

  beforeEach(async () => {
    entry = await createCoreFixture();
  });

  it('starts once, correlates responses, and forwards the Core environment', async () => {
    const client = new CoreClient(entry, { OPENMOVIE_FIXTURE: 'enabled' });
    await expect(client.request({ method: 'core.health', params: {} })).rejects.toThrow(
      /not connected/,
    );

    await client.start();
    await client.start();
    await expect(client.request({ method: 'core.health', params: {} })).resolves.toEqual({
      method: 'core.health',
      electronRunAsNode: '1',
    });
    client.stop();
  });

  it('turns typed Core failures into errors with machine-readable metadata', async () => {
    const client = new CoreClient(entry);
    await client.start();

    await expect(
      client.request({ method: 'project.get_summary', params: {} }),
    ).rejects.toMatchObject({
      message: 'No project is open',
      code: 'PROJECT_NOT_OPEN',
      retryable: false,
    });
    client.stop();
  });

  it('ignores malformed and uncorrelated messages before accepting a valid response', async () => {
    const client = new CoreClient(entry);
    const diagnostics = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await client.start();

    await expect(client.request({ method: 'harness.list', params: {} })).resolves.toMatchObject({
      method: 'harness.list',
    });
    expect(diagnostics).toHaveBeenCalledWith(expect.stringContaining('Invalid response'));
    diagnostics.mockRestore();
    client.stop();
  });

  it('times out unanswered requests and rejects pending work when Core exits', async () => {
    const client = new CoreClient(entry);
    await client.start();
    await expect(client.request({ method: 'provider.list', params: {} }, 10)).rejects.toThrow(
      /timed out: provider.list/,
    );

    await expect(client.request({ method: 'task.list', params: {} }, 1_000)).rejects.toThrow(
      /Core exited.*code=7/,
    );
    client.stop();
  });
});
