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

export class CodexAppServerAdapter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private peer: JsonLineRpcPeer | undefined;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly dynamicToolHandlers = new Map<string, DynamicToolHandler>();

  async detect(): Promise<HarnessHealth> {
    try {
      const result = await execFileAsync('codex', ['--version'], { timeout: 5_000 });
      return { available: true, version: result.stdout.trim() };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn('codex', ['app-server', '--stdio'], {
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
      sandbox: 'readOnly',
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

  async startTurn(threadId: string, text: string): Promise<unknown> {
    return this.requirePeer().request('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
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
      void this.startTurn(threadId, input.text).then(
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
  async detect(): Promise<HarnessHealth> {
    try {
      const result = await execFileAsync('claude', ['--version'], { timeout: 5_000 });
      return { available: true, version: result.stdout.trim() || result.stderr.trim() };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
