import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

type RpcId = number;
type RpcMessage = {
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};
type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class JsonLineRpcPeer {
  private nextId = 0;
  private readonly pending = new Map<RpcId, Pending>();
  private readonly notificationListeners = new Set<(method: string, params: unknown) => void>();
  private requestHandler: RequestHandler | undefined;
  private closed = false;

  constructor(
    readable: Readable,
    private readonly writable: Writable,
  ) {
    const lines = createInterface({ input: readable, crlfDelay: Infinity });
    lines.on('line', (line) => this.receiveLine(line));
    lines.on('close', () => this.close(new Error('JSON-RPC transport closed')));
  }

  request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('JSON-RPC peer is closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (this.closed) throw new Error('JSON-RPC peer is closed');
    this.send({ method, params });
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  close(error = new Error('JSON-RPC peer closed')): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private send(message: RpcMessage): void {
    this.writable.write(`${JSON.stringify(message)}\n`);
  }

  private receiveLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(`JSON-RPC ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) {
      const requestId = message.id;
      const handler = this.requestHandler;
      if (!handler) {
        this.send({
          id: requestId,
          error: { code: -32_601, message: `Unsupported server request: ${message.method}` },
        });
        return;
      }
      void handler(message.method, message.params).then(
        (result) => this.send({ id: requestId, result }),
        (error: unknown) =>
          this.send({
            id: requestId,
            error: {
              code: -32_603,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      );
      return;
    }
    if (message.method && message.id === undefined) {
      for (const listener of this.notificationListeners) listener(message.method, message.params);
    }
  }
}
