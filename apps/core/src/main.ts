import { createInterface } from 'node:readline';

import { CoreServer } from './server.js';

const server = new CoreServer();

function send(response: unknown): void {
  if (process.send) {
    process.send(response);
    return;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

process.on('message', (message: unknown) => {
  void server.handle(message).then(send);
});

if (!process.send) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    if (line.trim().length === 0) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      send({
        id: 'unknown',
        ok: false,
        error: { code: 'INVALID_JSON', message: 'Input is not valid JSON', retryable: false },
      });
      return;
    }
    void server.handle(value).then(send);
  });
}

const shutdown = (): void => {
  void server.close().finally(() => process.exit());
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
