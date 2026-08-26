import { resolve } from 'node:path';

import type { CoreRequest } from './core-client.js';

export type ProjectCoreClient = {
  start(): Promise<void>;
  request(command: CoreRequest, timeoutMs?: number): Promise<unknown>;
  stop(): void;
};

type ProjectSession = {
  client: ProjectCoreClient;
  root: string;
};

function projectRoot(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('root' in value) ||
    typeof value.root !== 'string'
  ) {
    throw new Error('Core returned a project without a root path');
  }
  return value.root;
}

export class ProjectSessionManager {
  private readonly sessions = new Map<string, ProjectSession>();

  constructor(
    private readonly createClient: () => ProjectCoreClient,
    private readonly initializeClient: (client: ProjectCoreClient) => Promise<unknown>,
    private readonly normalizePath: (path: string) => string = resolve,
  ) {}

  async create(
    path: string,
    title: string,
  ): Promise<{ client: ProjectCoreClient; result: unknown }> {
    return this.startProject(path, {
      method: 'project.create',
      params: { path, title },
    });
  }

  async open(
    path: string,
    takeoverStaleLock: boolean,
  ): Promise<{ client: ProjectCoreClient; result: unknown; reused: boolean }> {
    const existing = this.sessions.get(this.normalizePath(path));
    if (existing) {
      return {
        client: existing.client,
        result: await existing.client.request({ method: 'project.get_summary', params: {} }),
        reused: true,
      };
    }
    const started = await this.startProject(path, {
      method: 'project.open',
      params: { path, takeoverStaleLock },
    });
    return { ...started, reused: false };
  }

  stopAll(): void {
    const clients = new Set([...this.sessions.values()].map((session) => session.client));
    this.sessions.clear();
    for (const client of clients) client.stop();
  }

  private async startProject(
    requestedPath: string,
    command: CoreRequest,
  ): Promise<{ client: ProjectCoreClient; result: unknown }> {
    const client = this.createClient();
    try {
      await client.start();
      await this.initializeClient(client);
      const result = await client.request(command);
      const root = projectRoot(result);
      const session = { client, root };
      this.sessions.set(this.normalizePath(requestedPath), session);
      this.sessions.set(this.normalizePath(root), session);
      return { client, result };
    } catch (error) {
      client.stop();
      throw error;
    }
  }
}
