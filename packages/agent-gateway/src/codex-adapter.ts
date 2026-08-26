import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

import { JsonLineRpcPeer } from './json-rpc.js';

const execFileAsync = promisify(execFile);

export type HarnessHealth = { available: boolean; version?: string; error?: string };
export type AgentEvent = { method: string; params: unknown };
export type CodexTurnResult = {
  threadId: string;
  turnId: string;
  status: 'completed' | 'interrupted' | 'failed';
  text: string;
};
export type DynamicToolSpec = {
  type: 'function';
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type DynamicToolHandler = (tool: string, argumentsValue: unknown) => Promise<unknown>;

export type ClaudeTurnResult = {
  text: string;
  sessionId?: string;
  costUsd?: number;
};

export class CodexAppServerAdapter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private peer: JsonLineRpcPeer | undefined;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly dynamicToolHandlers = new Map<string, DynamicToolHandler>();

  constructor(
    private readonly command = 'codex',
    private readonly argumentPrefix: string[] = [],
  ) {}

  async detect(): Promise<HarnessHealth> {
    try {
      const result = await execFileAsync(this.command, [...this.argumentPrefix, '--version'], {
        timeout: 5_000,
      });
      return { available: true, version: result.stdout.trim() };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.command, [...this.argumentPrefix, 'app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[codex] ${chunk.toString()}`));
    const peer = new JsonLineRpcPeer(child.stdout, child.stdin);
    this.peer = peer;
    peer.onNotification((method, params) => {
      for (const listener of this.listeners) listener({ method, params });
    });
    peer.onRequest(async (method, params) => {
      if (method === 'item/tool/call') {
        if (typeof params !== 'object' || params === null) {
          throw new Error('Codex sent invalid dynamic tool parameters');
        }
        const request = params as Record<string, unknown>;
        if (typeof request.threadId !== 'string' || typeof request.tool !== 'string') {
          throw new Error('Codex dynamic tool request is missing threadId or tool');
        }
        const handler = this.dynamicToolHandlers.get(request.threadId);
        if (!handler) throw new Error(`No dynamic tool handler for ${request.threadId}`);
        try {
          const output = await handler(request.tool, request.arguments);
          return {
            contentItems: [{ type: 'inputText', text: JSON.stringify(output) }],
            success: true,
          };
        } catch (error) {
          return {
            contentItems: [
              {
                type: 'inputText',
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            success: false,
          };
        }
      }
      if (method.endsWith('/requestApproval')) return Promise.resolve({ decision: 'decline' });
      throw new Error(`OpenMovie cannot resolve Codex request: ${method}`);
    });
    child.once('exit', (code) => {
      peer.close(new Error(`Codex app-server exited with code ${String(code)}`));
      this.child = undefined;
      this.peer = undefined;
    });
    await peer.request('initialize', {
      clientInfo: { name: 'openmovie', title: 'OpenMovie', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    peer.notify('initialized', {});
  }

  async startThread(
    cwd: string,
    model?: string,
    dynamicTools?: DynamicToolSpec[],
  ): Promise<string> {
    const result = (await this.requirePeer().request('thread/start', {
      cwd,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      serviceName: 'openmovie',
      ...(model ? { model } : {}),
      ...(dynamicTools ? { dynamicTools } : {}),
    })) as {
      thread?: { id?: string };
    };
    if (!result.thread?.id) throw new Error('Codex did not return a thread ID');
    return result.thread.id;
  }

  async startTurn(
    threadId: string,
    text: string,
    outputSchema?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.requirePeer().request('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
      ...(outputSchema ? { outputSchema } : {}),
    });
  }

  async runTurn(input: {
    cwd: string;
    text: string;
    model?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    dynamicTools?: DynamicToolSpec[];
    onToolCall?: DynamicToolHandler;
    outputSchema?: Record<string, unknown>;
  }): Promise<CodexTurnResult> {
    await this.start();
    const threadId = await this.startThread(input.cwd, input.model, input.dynamicTools);
    if (input.onToolCall) this.dynamicToolHandlers.set(threadId, input.onToolCall);
    let turnId: string | undefined;
    const messages: string[] = [];
    const timeoutMs = input.timeoutMs ?? 10 * 60_000;
    return new Promise<CodexTurnResult>((resolve, reject) => {
      let settled = false;
      const finish = (work: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        this.dynamicToolHandlers.delete(threadId);
        input.signal?.removeEventListener('abort', abort);
        work();
      };
      const abort = (): void => {
        if (turnId) void this.interrupt(threadId, turnId).catch(() => undefined);
        finish(() => reject(new DOMException('Codex turn cancelled', 'AbortError')));
      };
      const unsubscribe = this.onEvent((event) => {
        if (typeof event.params !== 'object' || event.params === null) return;
        const params = event.params as Record<string, unknown>;
        if (params.threadId !== threadId) return;
        if (event.method === 'item/completed') {
          const item = params.item;
          if (typeof item === 'object' && item !== null) {
            const record = item as Record<string, unknown>;
            if (record.type === 'agentMessage' && typeof record.text === 'string') {
              messages.push(record.text);
            }
          }
          return;
        }
        if (event.method !== 'turn/completed') return;
        const turn = params.turn;
        if (typeof turn !== 'object' || turn === null) return;
        const record = turn as Record<string, unknown>;
        if (typeof record.id !== 'string' || (turnId && record.id !== turnId)) return;
        const status =
          record.status === 'completed' ||
          record.status === 'interrupted' ||
          record.status === 'failed'
            ? record.status
            : 'failed';
        const error = record.error;
        if (status === 'failed') {
          const message =
            typeof error === 'object' && error !== null && 'message' in error
              ? String(error.message)
              : 'Codex turn failed';
          finish(() => reject(new Error(message)));
        } else {
          finish(() =>
            resolve({ threadId, turnId: record.id as string, status, text: messages.join('\n\n') }),
          );
        }
      });
      const timeout = setTimeout(() => {
        if (turnId) void this.interrupt(threadId, turnId).catch(() => undefined);
        finish(() => reject(new Error(`Codex turn timed out after ${String(timeoutMs)}ms`)));
      }, timeoutMs);
      input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) {
        abort();
        return;
      }
      void this.startTurn(threadId, input.text, input.outputSchema).then(
        (result) => {
          if (typeof result !== 'object' || result === null || !('turn' in result)) {
            finish(() => reject(new Error('Codex did not return a turn')));
            return;
          }
          const turn = result.turn;
          if (typeof turn !== 'object' || turn === null || !('id' in turn)) {
            finish(() => reject(new Error('Codex did not return a turn ID')));
            return;
          }
          turnId = String(turn.id);
        },
        (error: unknown) =>
          finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
      );
    });
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.requirePeer().request('turn/interrupt', { threadId, turnId });
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.peer?.close();
    this.child?.kill();
    this.peer = undefined;
    this.child = undefined;
  }

  private requirePeer(): JsonLineRpcPeer {
    if (!this.peer) throw new Error('Codex app-server is not running');
    return this.peer;
  }
}

export class ClaudeCodeDetector {
  constructor(
    private readonly command = 'claude',
    private readonly argumentPrefix: string[] = [],
  ) {}

  async detect(): Promise<HarnessHealth> {
    try {
      const result = await execFileAsync(this.command, [...this.argumentPrefix, '--version'], {
        timeout: 5_000,
      });
      return { available: true, version: result.stdout.trim() || result.stderr.trim() };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  runTurn(input: {
    cwd: string;
    text: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<ClaudeTurnResult> {
    if (input.signal?.aborted) {
      return Promise.reject(new DOMException('Claude Code turn cancelled', 'AbortError'));
    }
    const child = spawn(this.command, [...this.argumentPrefix, ...claudePlanningArguments()], {
      cwd: input.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnvironment(process.env),
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const timeoutMs = input.timeoutMs ?? 10 * 60_000;
    let stdout = '';
    let stderrBytes = 0;
    return new Promise((resolve, reject) => {
      let settled = false;
      let forceKill: NodeJS.Timeout | undefined;
      const finish = (work: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', abort);
        work();
      };
      const terminate = (): void => {
        if (forceKill) return;
        terminateProcessTree(child, false);
        forceKill = setTimeout(() => terminateProcessTree(child, true), 2_000);
        forceKill.unref();
      };
      const abort = (): void => {
        terminate();
        finish(() => reject(new DOMException('Claude Code turn cancelled', 'AbortError')));
      };
      const timeout = setTimeout(() => {
        terminate();
        finish(() => reject(new Error(`Claude Code turn timed out after ${String(timeoutMs)}ms`)));
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout) > 10 * 1024 * 1024) {
          terminate();
          finish(() => reject(new Error('Claude Code output exceeded the 10 MiB limit')));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > 1024 * 1024) {
          terminate();
          finish(() => reject(new Error('Claude Code diagnostics exceeded the 1 MiB limit')));
        }
      });
      child.once('error', (error) => finish(() => reject(error)));
      child.once('exit', (code, signal) => {
        if (code !== 0) {
          finish(() =>
            reject(
              new Error(
                `Claude Code exited unsuccessfully (${signal ? `signal ${signal}` : `code ${String(code)}`})`,
              ),
            ),
          );
          return;
        }
        try {
          const result = parseClaudeJsonOutput(stdout);
          finish(() => resolve(result));
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
      });
      input.signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end(input.text, 'utf8');
    });
  }
}

export function parseClaudeJsonOutput(output: string): ClaudeTurnResult {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error('Claude Code returned invalid JSON output');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude Code returned an invalid result envelope');
  }
  const record = value as Record<string, unknown>;
  if (record.is_error === true) throw new Error('Claude Code reported an unsuccessful result');
  const text =
    typeof record.structured_output === 'object' && record.structured_output !== null
      ? JSON.stringify(record.structured_output)
      : typeof record.result === 'string'
        ? record.result
        : '';
  if (!text) throw new Error('Claude Code result contains no structured output');
  return {
    text,
    ...(typeof record.session_id === 'string' ? { sessionId: record.session_id } : {}),
    ...(typeof record.total_cost_usd === 'number' ? { costUsd: record.total_cost_usd } : {}),
  };
}

export function claudePlanningArguments(): string[] {
  return [
    '-p',
    '--bare',
    '--output-format',
    'json',
    '--permission-mode',
    'plan',
    '--tools',
    'Read,Glob,Grep',
    '--disallowedTools',
    'mcp__*',
    '--max-turns',
    '3',
    '--no-session-persistence',
    '--no-chrome',
    '--json-schema',
    JSON.stringify(claudeAgentPlanJsonSchema),
  ];
}

const claudeAgentPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 500 },
    actions: {
      type: 'array',
      maxItems: 50,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { const: 'story.update' },
              premise: { type: 'string' },
              themes: { type: 'array', items: { type: 'string' } },
              world: { type: 'string' },
              rules: { type: 'array', items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'title'],
            properties: {
              type: { const: 'scene.create' },
              title: { type: 'string' },
              story_goal: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'scene_id', 'duration_us'],
            properties: {
              type: { const: 'shot.create' },
              scene_id: { type: 'string' },
              duration_us: { type: 'integer', minimum: 1 },
              framing: { type: 'string' },
              movement: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'shot_id'],
            properties: {
              type: { const: 'shot.update' },
              shot_id: { type: 'string' },
              duration_us: { type: 'integer', minimum: 1 },
              framing: { type: 'string' },
              movement: { type: 'string' },
              performance_emotion: { type: 'string' },
            },
          },
        ],
      },
    },
  },
} as const;

function claudeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'XDG_CONFIG_HOME',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CONFIG_DIR',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'SystemRoot',
    'ComSpec',
    'TEMP',
    'TMP',
  ] as const;
  return Object.fromEntries(
    names.flatMap((name) => (source[name] === undefined ? [] : [[name, source[name]]])),
  );
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, force: boolean): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const terminator = spawn(
      'taskkill',
      ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])],
      { stdio: 'ignore', windowsHide: true },
    );
    terminator.on('error', () => child.kill(force ? 'SIGKILL' : undefined));
    terminator.unref();
    return;
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    child.kill(force ? 'SIGKILL' : undefined);
  }
}
