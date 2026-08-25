import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  coreResponseSchema,
  type CoreCommand,
  type CoreError,
  type CoreResponse,
} from '@openmovie/contracts';

type PendingRequest = {
  resolve: (response: CoreResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type CoreRequest = WithoutId<CoreCommand>;

export class CoreClient {
  private child: ChildProcess | undefined;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly entry: string,
    private readonly environment: NodeJS.ProcessEnv = {},
  ) {}

  async start(): Promise<void> {
    if (this.child) return;

    const child = fork(this.entry, [], {
      env: { ...process.env, ...this.environment, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [],
      silent: true,
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[core] ${chunk.toString()}`));
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[core] ${chunk.toString()}`));
    child.on('message', (message: unknown) => this.receive(message));
    child.on('exit', (code, signal) => {
      const reason = new Error(
        `OpenMovie Core exited (code=${String(code)}, signal=${signal ?? 'none'})`,
      );
      this.child = undefined;
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(reason);
      }
      this.pending.clear();
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  }

  async request(command: CoreRequest, timeoutMs = 10_000): Promise<unknown> {
    if (!this.child?.connected) throw new Error('OpenMovie Core is not connected');

    const id = randomUUID();
    const response = await new Promise<CoreResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Core request timed out: ${command.method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.child?.send({ ...command, id });
    });

    if (!response.ok) throw this.toError(response.error);
    return response.result;
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
  }

  private receive(message: unknown): void {
    const parsed = coreResponseSchema.safeParse(message);
    if (!parsed.success) {
      process.stderr.write(`[core] Invalid response: ${parsed.error.message}\n`);
      return;
    }

    const request = this.pending.get(parsed.data.id);
    if (!request) return;
    clearTimeout(request.timeout);
    this.pending.delete(parsed.data.id);
    request.resolve(parsed.data);
  }

  private toError(error: CoreError): Error {
    return Object.assign(new Error(error.message), {
      code: error.code,
      retryable: error.retryable,
    });
  }
}
