import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { JsonLineRpcPeer } from './json-rpc.js';

describe('JsonLineRpcPeer', () => {
  it('correlates JSONL responses and streams notifications', async () => {
    const serverToClient = new PassThrough();
    const clientToServer = new PassThrough();
    const peer = new JsonLineRpcPeer(serverToClient, clientToServer);
    const notifications: string[] = [];
    peer.onNotification((method) => notifications.push(method));
    const request = peer.request('initialize', { clientInfo: { name: 'test' } });
    const line = await new Promise<string>((resolve) =>
      clientToServer.once('data', (data: Buffer) => resolve(data.toString())),
    );
    const sent = JSON.parse(line) as { id: number };
    serverToClient.write(`${JSON.stringify({ id: sent.id, result: { ok: true } })}\n`);
    serverToClient.write(`${JSON.stringify({ method: 'turn/completed', params: {} })}\n`);
    await expect(request).resolves.toEqual({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(notifications).toEqual(['turn/completed']);
    peer.close();
  });
});
