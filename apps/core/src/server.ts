import {
  CORE_API_VERSION,
  PROTOCOL_VERSION,
  assertProtocolCompatible,
  coreCommandSchema,
  type CoreCommand,
  type CoreResponse,
} from '@openmovie/contracts';
import { ProjectStore, ProjectStoreError } from '@openmovie/project-store';
import {
  FakeProvider,
  OpenAICompatibleProvider,
  ProviderGateway,
} from '@openmovie/provider-gateway';
import { ClaudeCodeDetector, CodexAppServerAdapter } from '@openmovie/agent-gateway';
import { TaskEngine, type TaskPersistence } from '@openmovie/task-engine';
import { movieEntitySchema } from '@openmovie/movie-ir';

const startedAt = new Date();
const coreVersion = '0.0.0';

function failure(id: string, code: string, message: string, retryable = false): CoreResponse {
  return { id, ok: false, error: { code, message, retryable } };
}

export class CoreServer {
  private project: ProjectStore | undefined;
  private tasks: TaskEngine;
  private readonly providers = new ProviderGateway();
  private readonly codex = new CodexAppServerAdapter();
  private readonly claude = new ClaudeCodeDetector();

  constructor() {
    const fake = new FakeProvider();
    this.providers.register(fake);
    this.tasks = this.createTaskEngine();
  }

  private createTaskEngine(persistence?: TaskPersistence): TaskEngine {
    const tasks = persistence ? new TaskEngine(persistence) : new TaskEngine();
    tasks.registerStep('text.generate', async (input, context) => {
      const providerId = typeof input.providerId === 'string' ? input.providerId : 'fake';
      const provider = this.providers.get(providerId);
      if (!provider.generateText) throw new Error(`Provider cannot generate text: ${providerId}`);
      return provider.generateText({
        model: typeof input.model === 'string' ? input.model : 'fake-text-v1',
        messages: [
          {
            role: 'system',
            content:
              'You are OpenMovie Direct Agent. Return a concise visual plan for the requested movie frame.',
          },
          { role: 'user', content: context.task.goal },
        ],
        signal: context.signal,
      });
    });
    tasks.registerStep('image.generate', async (input, context) => {
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
    return tasks;
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
    this.tasks = this.createTaskEngine();
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
              'revision.branch',
              'movie.entity',
              'object.import',
              'task.run',
              'task.approve',
              'task.events',
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
        this.tasks = this.createTaskEngine(this.project.taskPersistence);
        return { id: command.id, ok: true, result: await this.summary() };
      }
      case 'project.open': {
        await this.close();
        this.project = await ProjectStore.open(command.params.path, {
          takeoverStaleLock: command.params.takeoverStaleLock,
        });
        this.tasks = this.createTaskEngine(this.project.taskPersistence);
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
      case 'revision.branch_list':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().revisions.listBranches(),
        };
      case 'revision.branch_create':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().revisions.createBranch(command.params.name),
        };
      case 'revision.branch_switch':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().revisions.switchBranch(command.params.name),
        };
      case 'movie.entity_list':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.list(command.params.kind),
        };
      case 'movie.character_create':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.createCharacter(command.params),
        };
      case 'movie.scene_create':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.createScene(command.params),
        };
      case 'movie.shot_create':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.createShot(command.params),
        };
      case 'movie.entity_update':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.update({
            ...command.params,
            entity: movieEntitySchema.parse(command.params.entity),
          }),
        };
      case 'object.import': {
        const object = await this.requireProject().objects.importFile(command.params.path);
        return { id: command.id, ok: true, result: object };
      }
      case 'task.create': {
        this.requireProject();
        const task = this.tasks.create(
          command.params.goal,
          [
            {
              kind: 'text.generate',
              title: 'Plan the visual intent',
              input: {
                providerId: command.params.plannerProviderId,
                model: command.params.plannerModel,
              },
            },
            {
              kind: 'image.generate',
              title: 'Generate a visual fixture',
              input: { prompt: command.params.goal },
            },
          ],
          { requiresApproval: command.params.requiresApproval },
        );
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
      case 'task.approve':
        return {
          id: command.id,
          ok: true,
          result: await this.tasks.approve(command.params.taskId),
        };
      case 'task.events':
        return {
          id: command.id,
          ok: true,
          result: this.tasks.listEvents(command.params.taskId, command.params.afterSequence),
        };
      case 'provider.configure_openai_compatible':
        this.providers.upsert(
          new OpenAICompatibleProvider({
            id: command.params.id,
            baseUrl: command.params.baseUrl,
            apiKey: command.params.apiKey,
          }),
        );
        return { id: command.id, ok: true, result: { id: command.params.id } };
      case 'provider.list':
        return { id: command.id, ok: true, result: this.providers.list() };
      case 'harness.list': {
        const [codex, claude] = await Promise.all([this.codex.detect(), this.claude.detect()]);
        return {
          id: command.id,
          ok: true,
          result: [
            {
              id: 'direct',
              name: 'OpenMovie Direct Agent',
              available: true,
              capabilities: ['plan', 'tool_call', 'provider_gateway'],
            },
            {
              id: 'codex',
              name: 'Codex',
              ...codex,
              capabilities: ['app_server', 'streaming', 'approval', 'tools'],
            },
            {
              id: 'claude_code',
              name: 'Claude Code',
              ...claude,
              capabilities: claude.available ? ['cli_detected'] : [],
            },
          ],
        };
      }
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
      currentBranch: project.revisions.currentBranch(),
      delivery: {
        width: manifest.delivery.width,
        height: manifest.delivery.height,
        frameRate: manifest.delivery.frame_rate,
      },
    };
  }
}
