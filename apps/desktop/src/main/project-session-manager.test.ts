import { describe, expect, it, vi } from 'vitest';

import type { CoreRequest } from './core-client.js';
import { ProjectSessionManager, type ProjectCoreClient } from './project-session-manager.js';

type FakeClient = ProjectCoreClient & {
  id: number;
  requests: CoreRequest[];
  stopped: boolean;
};

function fixture() {
  const clients: FakeClient[] = [];
  const createClient = (): FakeClient => {
    const id = clients.length + 1;
    const client: FakeClient = {
      id,
      requests: [],
      stopped: false,
      start: vi.fn(() => Promise.resolve()),
      request: vi.fn((command: CoreRequest) => {
        client.requests.push(command);
        if (command.method === 'project.get_summary') {
          return Promise.resolve({ root: `/movies/${id}`, title: `Movie ${id}` });
        }
        const path = 'path' in command.params ? command.params.path : `/movies/${id}`;
        return Promise.resolve({ root: path, title: `Movie ${id}` });
      }),
      stop: vi.fn(() => {
        client.stopped = true;
      }),
    };
    clients.push(client);
    return client;
  };
  const initializeClient = vi.fn(() => Promise.resolve());
  const manager = new ProjectSessionManager(createClient, initializeClient, (path) => path);
  return { manager, clients, initializeClient };
}

describe('ProjectSessionManager', () => {
  it('keeps one independent Core client per open project and reuses it when switching back', async () => {
    const { manager, clients, initializeClient } = fixture();
    const first = await manager.open('/movies/a', false);
    const second = await manager.open('/movies/b', false);
    const firstAgain = await manager.open('/movies/a', false);

    expect(clients).toHaveLength(2);
    expect(first.client).not.toBe(second.client);
    expect(firstAgain.client).toBe(first.client);
    expect(firstAgain.reused).toBe(true);
    expect(initializeClient).toHaveBeenCalledTimes(2);
    expect((first.client as FakeClient).requests.at(-1)).toEqual({
      method: 'project.get_summary',
      params: {},
    });
  });

  it('does not stop another project session when a new project is activated', async () => {
    const { manager, clients } = fixture();
    await manager.open('/movies/a', false);
    await manager.open('/movies/b', false);
    expect(clients.map((client) => client.stopped)).toEqual([false, false]);
  });

  it('stops every unique project Core during shutdown', async () => {
    const { manager, clients } = fixture();
    await manager.open('/movies/a', false);
    await manager.open('/movies/a', false);
    await manager.create('/movies/b', 'Movie B');
    manager.stopAll();
    expect(clients).toHaveLength(2);
    expect(clients.every((client) => client.stopped)).toBe(true);
  });

  it('stops a new Core when opening the project fails', async () => {
    const failed: FakeClient = {
      id: 1,
      requests: [],
      stopped: false,
      start: vi.fn(() => Promise.resolve()),
      request: vi.fn(() => Promise.reject(new Error('locked'))),
      stop: vi.fn(() => {
        failed.stopped = true;
      }),
    };
    const manager = new ProjectSessionManager(
      () => failed,
      () => Promise.resolve(),
      (path) => path,
    );
    await expect(manager.open('/movies/a', false)).rejects.toThrow('locked');
    expect(failed.stopped).toBe(true);
  });
});
