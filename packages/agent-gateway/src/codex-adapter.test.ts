import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodexAppServerAdapter } from './codex-adapter.js';

async function createAppServerFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openmovie-codex-adapter-'));
  const entry = join(directory, 'fixture.mjs');
  await writeFile(
    entry,
    `import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) {
  process.stdout.write('codex-fixture 1.0.0\\n');
  process.exit(0);
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let dynamic = false;
let active = { threadId: 'thread_fixture', turnId: 'turn_fixture' };
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const complete = (text, status = 'completed', error) => {
  if (text) send({ method: 'item/completed', params: { threadId: active.threadId, item: { type: 'agentMessage', text } } });
  send({ method: 'turn/completed', params: { threadId: active.threadId, turn: { id: active.turnId, status, ...(error ? { error: { message: error } } : {}) } } });
};
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') return send({ id: message.id, result: { userAgent: 'fixture' } });
  if (message.method === 'initialized') return;
  if (message.method === 'thread/start') {
    if (message.params.sandbox !== 'read-only') return send({ id: message.id, error: { code: -32602, message: 'sandbox must be read-only' } });
    dynamic = Array.isArray(message.params.dynamicTools) && message.params.dynamicTools.length > 0;
    return send({ id: message.id, result: { thread: { id: active.threadId } } });
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: active.turnId } } });
    const text = message.params.input?.[0]?.text ?? '';
    if (text.includes('require schema') && message.params.outputSchema?.properties?.summary?.type !== 'string') return setTimeout(() => complete('', 'failed', 'missing output schema'), 5);
    if (text.includes('wait forever')) return;
    if (text.includes('fail this turn')) return setTimeout(() => complete('', 'failed', 'fixture failure'), 5);
    if (dynamic) return setTimeout(() => send({ id: 99, method: 'item/tool/call', params: { threadId: active.threadId, tool: 'openmovie_project_summary', arguments: { compact: true } } }), 5);
    return setTimeout(() => complete('Fixture completed'), 5);
  }
  if (message.method === 'turn/interrupt') return send({ id: message.id, result: {} });
  if (message.id === 99) {
    const output = message.result?.contentItems?.[0]?.text ?? 'missing tool output';
    return setTimeout(() => complete('Tool result: ' + output), 5);
  }
});
`,
  );
  return entry;
}

describe('CodexAppServerAdapter', () => {
  let adapter: CodexAppServerAdapter;
  let fixture: string;

  beforeEach(async () => {
    fixture = await createAppServerFixture();
    adapter = new CodexAppServerAdapter(process.execPath, [fixture]);
  });

  afterEach(() => adapter.stop());

  it('detects the configured Codex executable and starts read-only threads', async () => {
    await expect(adapter.detect()).resolves.toEqual({
      available: true,
      version: 'codex-fixture 1.0.0',
    });
    await expect(adapter.startThread(process.cwd())).rejects.toThrow(/not running/);

    await adapter.start();
    await adapter.start();
    await expect(adapter.startThread(process.cwd(), 'fixture-model')).resolves.toBe(
      'thread_fixture',
    );
  });

  it('collects agent messages and resolves completed turns', async () => {
    await expect(
      adapter.runTurn({ cwd: process.cwd(), text: 'Plan a quiet opening', timeoutMs: 1_000 }),
    ).resolves.toEqual({
      threadId: 'thread_fixture',
      turnId: 'turn_fixture',
      status: 'completed',
      text: 'Fixture completed',
    });
  });

  it('sends a structured output schema with a turn', async () => {
    await expect(
      adapter.runTurn({
        cwd: process.cwd(),
        text: 'require schema',
        outputSchema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
        },
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('routes dynamic tool calls through the thread handler', async () => {
    const result = await adapter.runTurn({
      cwd: process.cwd(),
      text: 'Inspect the project',
      timeoutMs: 1_000,
      dynamicTools: [
        {
          type: 'function',
          name: 'openmovie_project_summary',
          description: 'Read project summary',
          inputSchema: { type: 'object' },
        },
      ],
      onToolCall: (tool, input) => Promise.resolve({ tool, input }),
    });
    expect(result.status).toBe('completed');
    expect(result.text).toContain('openmovie_project_summary');
  });

  it('surfaces failed, aborted, and timed-out turns', async () => {
    await expect(
      adapter.runTurn({ cwd: process.cwd(), text: 'fail this turn', timeoutMs: 1_000 }),
    ).rejects.toThrow('fixture failure');

    const controller = new AbortController();
    const aborted = adapter.runTurn({
      cwd: process.cwd(),
      text: 'wait forever',
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    await expect(
      adapter.runTurn({ cwd: process.cwd(), text: 'wait forever', timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/);
  });
});
