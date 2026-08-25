import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

import { JsonLineRpcPeer } from './json-rpc.js';

const execFileAsync = promisify(execFile);

export type HarnessHealth = { available: boolean; version?: string; error?: string };
export type AgentEvent = { method: string; params: unknown };

export class CodexAppServerAdapter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private peer: JsonLineRpcPeer | undefined;
  private readonly listeners = new Set<(event: AgentEvent) => void>();

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
    child.once('exit', (code) => {
      peer.close(new Error(`Codex app-server exited with code ${String(code)}`));
      this.child = undefined;
      this.peer = undefined;
    });
    await peer.request('initialize', {
      clientInfo: { name: 'openmovie', title: 'OpenMovie', version: '0.0.0' },
    });
    peer.notify('initialized', {});
  }

  async startThread(model: string, cwd: string): Promise<string> {
    const result = (await this.requirePeer().request('thread/start', { model, cwd })) as {
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
