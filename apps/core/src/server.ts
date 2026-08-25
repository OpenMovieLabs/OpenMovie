import {
  CORE_API_VERSION,
  PROTOCOL_VERSION,
  assertProtocolCompatible,
  coreCommandSchema,
  type CoreCommand,
  type CoreResponse,
} from '@openmovie/contracts';
import { ProjectStore, ProjectStoreError } from '@openmovie/project-store';
import { FakeProvider, ProviderGateway } from '@openmovie/provider-gateway';
import { TaskEngine } from '@openmovie/task-engine';

const startedAt = new Date();
const coreVersion = '0.0.0';

function failure(id: string, code: string, message: string, retryable = false): CoreResponse {
  return { id, ok: false, error: { code, message, retryable } };
}

export class CoreServer {
  private project: ProjectStore | undefined;
  private readonly tasks = new TaskEngine();
  private readonly providers = new ProviderGateway();

  constructor() {
    const fake = new FakeProvider();
    this.providers.register(fake);
    this.tasks.registerStep('image.generate', async (input, context) => {
      const project = this.requireProject();
      const provider = this.providers.get('fake');
      if (!provider.generateImage) throw new Error('Fake provider cannot generate images');
      const generated = await provider.generateImage({
        model: 'fake-image-v1',
        prompt: typeof input.prompt === 'string' ? input.prompt : context.task.goal,
        width: 1,
        height: 1,
        signal: context.signal,
      });
      const object = await project.objects.importBytes(generated.bytes, 'generated.png');
      await project.revisions.commit({
        expectedRevisionId: project.revisions.currentRevisionId(),
        authorType: 'agent',
        authorId: 'direct_agent',
        message: 'Generate image fixture',
        patch: [
          {
            op: 'add',
            path: '/extensions/last_generated_object',
            value: {
              uri: object.uri,
              mime_type: object.mimeType,
              request_hash: generated.requestHash,
            },
          },
        ],
      });
      return object;
    });
  }

  async handle(input: unknown): Promise<CoreResponse> {
    const parsed = coreCommandSchema.safeParse(input);
    if (!parsed.success) {
      const id =
        typeof input === 'object' && input !== null && 'id' in input && typeof input.id === 'string'
          ? input.id
          : 'unknown';
      return failure(id, 'INVALID_COMMAND', parsed.error.message);
    }

    try {
      return await this.dispatch(parsed.data);
    } catch (error) {
      if (error instanceof ProjectStoreError) {
        return failure(parsed.data.id, error.code, error.message, error.retryable);
      }
      return failure(
        parsed.data.id,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async close(): Promise<void> {
    await this.project?.close();
    this.project = undefined;
  }

  private async dispatch(command: CoreCommand): Promise<CoreResponse> {
    switch (command.method) {
      case 'initialize': {
        try {
          assertProtocolCompatible(command.params.protocolVersion);
        } catch (error) {
          return failure(
            command.id,
            'PROTOCOL_INCOMPATIBLE',
            error instanceof Error ? error.message : 'Protocol is incompatible',
          );
        }

        return {
          id: command.id,
          ok: true,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            coreApiVersion: CORE_API_VERSION,
            server: { name: 'openmovie-core', version: coreVersion },
            capabilities: [
              'core.health',
              'project.create',
              'project.open',
              'revision.commit',
              'object.import',
              'task.run',
            ],
          },
        };
      }
      case 'core.health':
        return {
          id: command.id,
          ok: true,
          result: {
            status: 'ok',
            startedAt: startedAt.toISOString(),
            uptimeMs: Date.now() - startedAt.getTime(),
          },
        };
      case 'project.create': {
        await this.close();
        this.project = await ProjectStore.create(command.params.path, {
          title: command.params.title,
          ...(command.params.locale ? { locale: command.params.locale } : {}),
        });
        return { id: command.id, ok: true, result: await this.summary() };
      }
      case 'project.open': {
        await this.close();
        this.project = await ProjectStore.open(command.params.path, {
          takeoverStaleLock: command.params.takeoverStaleLock,
        });
        return { id: command.id, ok: true, result: await this.summary() };
      }
      case 'project.close':
        await this.close();
        return { id: command.id, ok: true, result: null };
      case 'project.get_summary':
        return { id: command.id, ok: true, result: await this.summary() };
      case 'revision.commit': {
        const project = this.requireProject();
        const revision = await project.revisions.commit(command.params);
        return { id: command.id, ok: true, result: revision };
      }
      case 'revision.list':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().revisions.list(command.params.limit),
        };
      case 'revision.restore': {
        const revision = await this.requireProject().revisions.restore(
          command.params.revisionId,
          command.params.expectedRevisionId,
          command.params.authorId,
        );
        return { id: command.id, ok: true, result: revision };
      }
      case 'object.import': {
        const object = await this.requireProject().objects.importFile(command.params.path);
        return { id: command.id, ok: true, result: object };
      }
      case 'task.create': {
        this.requireProject();
        const task = this.tasks.create(command.params.goal, [
          {
            kind: 'image.generate',
            title: 'Generate a visual fixture',
            input: { prompt: command.params.goal },
          },
        ]);
        return { id: command.id, ok: true, result: task };
      }
      case 'task.run': {
        const task = await this.tasks.run(command.params.taskId);
        return { id: command.id, ok: true, result: task };
      }
      case 'task.list':
        return { id: command.id, ok: true, result: this.tasks.list() };
      case 'task.cancel':
        return { id: command.id, ok: true, result: this.tasks.cancel(command.params.taskId) };
    }
  }

  private requireProject(): ProjectStore {
    if (!this.project) throw new ProjectStoreError('PROJECT_NOT_OPEN', 'No project is open');
    return this.project;
  }

  private async summary(): Promise<unknown> {
    const project = this.requireProject();
    const manifest = await project.readManifest();
    return {
      id: manifest.project.id,
      title: manifest.project.title,
      root: project.root,
      locale: manifest.project.default_locale,
      currentRevisionId: project.revisions.currentRevisionId(),
      delivery: {
        width: manifest.delivery.width,
        height: manifest.delivery.height,
        frameRate: manifest.delivery.frame_rate,
      },
    };
  }
}
