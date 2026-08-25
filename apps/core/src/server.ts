import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

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
  HttpVideoJobProvider,
  OpenAICompatibleProvider,
  ProviderGateway,
  type ProviderJob,
} from '@openmovie/provider-gateway';
import {
  ClaudeCodeDetector,
  CodexAppServerAdapter,
  type DynamicToolSpec,
} from '@openmovie/agent-gateway';
import { TaskEngine, type TaskPersistence } from '@openmovie/task-engine';
import { movieEntitySchema } from '@openmovie/movie-ir';
import { BuiltInTakeEvaluator, EvaluationEngine } from '@openmovie/eval-engine';
import { FfmpegFrameExtractor } from '@openmovie/media-engine';
import type { StoredObject, TakeRecord } from '@openmovie/project-store';
import packageMetadata from '../package.json' with { type: 'json' };

const startedAt = new Date();
const coreVersion = packageMetadata.version;

function failure(id: string, code: string, message: string, retryable = false): CoreResponse {
  return { id, ok: false, error: { code, message, retryable } };
}

export class CoreServer {
  private project: ProjectStore | undefined;
  private tasks: TaskEngine;
  private readonly providers = new ProviderGateway();
  private readonly codex = new CodexAppServerAdapter();
  private readonly claude = new ClaudeCodeDetector();
  private readonly evaluations = new EvaluationEngine();
  private readonly frames = new FfmpegFrameExtractor();

  constructor() {
    const fake = new FakeProvider();
    this.providers.register(fake);
    this.evaluations.register(new BuiltInTakeEvaluator());
    this.tasks = this.createTaskEngine();
  }

  private createTaskEngine(persistence?: TaskPersistence): TaskEngine {
    const tasks = persistence ? new TaskEngine(persistence) : new TaskEngine();
    tasks.registerStep('text.generate', async (input, context) => {
      const providerId = typeof input.providerId === 'string' ? input.providerId : 'fake';
      if (providerId === 'harness:codex') {
        const project = this.requireProject();
        return this.codex.runTurn({
          cwd: project.root,
          text: [
            'You are the planning harness inside OpenMovie.',
            'Read the Movie IR YAML files in this project when useful, but do not modify files.',
            'Return a concise, actionable visual plan for this user goal:',
            context.task.goal,
          ].join('\n\n'),
          signal: context.signal,
          dynamicTools: this.codexDynamicTools(),
          onToolCall: (tool, argumentsValue) => this.handleCodexTool(tool, argumentsValue),
        });
      }
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
      const providerId = typeof input.providerId === 'string' ? input.providerId : 'fake';
      const provider = this.providers.get(providerId);
      if (!provider.generateImage)
        throw new Error(`Provider cannot generate images: ${providerId}`);
      const generated = await provider.generateImage({
        model: typeof input.model === 'string' ? input.model : 'fake-image-v1',
        prompt: typeof input.prompt === 'string' ? input.prompt : context.task.goal,
        width: typeof input.width === 'number' ? input.width : 1024,
        height: typeof input.height === 'number' ? input.height : 1024,
        signal: context.signal,
      });
      const object = await project.objects.importBytes(generated.bytes, 'generated.png');
      if (typeof input.shotId === 'string') {
        const take = await project.media.createTake({
          shotId: input.shotId,
          object,
          runId: context.task.id,
          provider: { providerId, model: generated.model },
          generation: { requestHash: generated.requestHash, prompt: context.task.goal },
        });
        return {
          object,
          take,
          evaluation: await this.evaluateTake(project, input.shotId, take, object),
        };
      }
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
    tasks.registerStep('video.generate', async (input, context) => {
      const project = this.requireProject();
      const providerId = typeof input.providerId === 'string' ? input.providerId : 'fake';
      const provider = this.providers.get(providerId);
      if (!provider.submitVideo || !provider.getVideoJob || !provider.collectVideo) {
        throw new Error(`Provider cannot generate videos: ${providerId}`);
      }
      const checkpoint =
        typeof context.step.output === 'object' &&
        context.step.output !== null &&
        'providerJobId' in context.step.output &&
        typeof context.step.output.providerJobId === 'string'
          ? context.step.output.providerJobId
          : undefined;
      let job: ProviderJob | undefined;
      if (checkpoint) {
        try {
          job = await provider.getVideoJob(checkpoint, context.signal);
        } catch {
          job = undefined;
        }
      }
      if (!job) {
        job = await provider.submitVideo({
          model: typeof input.model === 'string' ? input.model : 'fake-video-v1',
          prompt: typeof input.prompt === 'string' ? input.prompt : context.task.goal,
          mode: 'text_to_video',
          durationSeconds: typeof input.durationSeconds === 'number' ? input.durationSeconds : 4,
          signal: context.signal,
        });
        context.checkpoint({ providerJobId: job.id, providerId });
      }
      try {
        for (let attempt = 0; ['queued', 'running'].includes(job.status); attempt += 1) {
          if (attempt >= 600) throw new Error(`Video job timed out: ${job.id}`);
          await this.waitForPoll(context.signal);
          job = await provider.getVideoJob(job.id, context.signal);
        }
      } catch (error) {
        if (context.signal.aborted && provider.cancelVideo) {
          await provider.cancelVideo(job.id).catch(() => undefined);
        }
        throw error;
      }
      if (job.status !== 'succeeded') throw new Error(job.error ?? `Video job ${job.status}`);
      const generated = (await provider.collectVideo(job.id, context.signal))[0];
      if (!generated) throw new Error('Video Provider returned no artifact');
      const object = await project.objects.importBytes(generated.bytes, 'generated.mp4');
      if (typeof input.shotId !== 'string') return { object, job };
      const take = await project.media.createTake({
        shotId: input.shotId,
        object,
        runId: context.task.id,
        provider: { providerId, model: generated.model, jobId: job.id },
        generation: { requestHash: generated.requestHash, prompt: context.task.goal },
      });
      return {
        object,
        job,
        take,
        evaluation: await this.evaluateTake(project, input.shotId, take, object),
      };
    });
    tasks.registerStep('media.analyze', async (input, context) => {
      const project = this.requireProject();
      if (typeof input.takeId !== 'string') throw new Error('Take ID is required');
      const providerId = typeof input.providerId === 'string' ? input.providerId : 'fake';
      const model = typeof input.model === 'string' ? input.model : 'fake-vision-v1';
      const prompt = typeof input.prompt === 'string' ? input.prompt : context.task.goal;
      const take = project.media.getTake(input.takeId);
      const provider = this.providers.get(providerId);
      if (!provider.understandImage) {
        throw new Error(`Provider cannot understand images: ${providerId}`);
      }
      const objectPath = project.objects.resolveUri(take.artifact.objectUri);
      if (take.artifact.mimeType.startsWith('image/')) {
        if (take.artifact.byteSize > 25 * 1024 * 1024) {
          throw new Error('Image analysis input exceeds the 25 MiB local limit');
        }
        const bytes = await readFile(objectPath);
        const result = await provider.understandImage({
          model,
          prompt,
          imageUrl: `data:${take.artifact.mimeType};base64,${bytes.toString('base64')}`,
          mimeType: take.artifact.mimeType,
          signal: context.signal,
        });
        return project.media.recordAnalysis({
          takeId: take.id,
          kind: 'image',
          providerId,
          modelId: result.model,
          summary: result.text,
          evidence: result.evidence,
          provenance: { frameCount: 1, finishReason: result.finishReason },
        });
      }
      if (!take.artifact.mimeType.startsWith('video/')) {
        throw new Error(`Unsupported analysis MIME type: ${take.artifact.mimeType}`);
      }
      const availability = await this.frames.detect();
      if (!availability.available) {
        throw new Error(
          'Video analysis requires FFmpeg. Install ffmpeg or set OPENMOVIE_FFMPEG_PATH.',
        );
      }
      const shot = movieEntitySchema.parse(await project.movies.read('shot', take.shotId));
      if (shot.type !== 'shot') throw new Error('Take target is not a Shot');
      const temporary = await mkdtemp(join(project.metadataRoot, 'temp', 'analysis-'));
      try {
        const frames = await this.frames.extract(
          objectPath,
          temporary,
          shot.duration_us,
          context.signal,
        );
        const evidence: Array<Record<string, unknown>> = [];
        const summaries: string[] = [];
        for (const frame of frames) {
          const bytes = await readFile(frame.path);
          const result = await provider.understandImage({
            model,
            prompt: `${prompt}\nFrame timecode: ${(frame.timeUs / 1_000_000).toFixed(3)} seconds.`,
            imageUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
            mimeType: 'image/jpeg',
            signal: context.signal,
          });
          summaries.push(`${(frame.timeUs / 1_000_000).toFixed(3)}s: ${result.text}`);
          evidence.push({ timeUs: frame.timeUs, summary: result.text });
        }
        return project.media.recordAnalysis({
          takeId: take.id,
          kind: 'video',
          providerId,
          modelId: model,
          summary: summaries.join('\n'),
          evidence,
          provenance: {
            frameCount: frames.length,
            ffmpegVersion: availability.version ?? 'unknown',
            sampling: 'deterministic-even-v1',
          },
        });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
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
    this.codex.stop();
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
              'project.doctor',
              'revision.commit',
              'revision.branch',
              'movie.entity',
              'story.edit',
              'timeline.assemble',
              'object.import',
              'take.manage',
              'evaluation.read',
              'feedback.manage',
              'media.analyze',
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
      case 'project.doctor':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().doctor.run({ deep: command.params.deep }),
        };
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
      case 'revision.diff':
        return {
          id: command.id,
          ok: true,
          result:
            command.params.baseRevisionId === undefined
              ? this.requireProject().revisions.diff(command.params.revisionId)
              : this.requireProject().revisions.diff(
                  command.params.revisionId,
                  command.params.baseRevisionId,
                ),
        };
      case 'revision.working_changes':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().revisions.workingChanges(),
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
      case 'story.get':
        return { id: command.id, ok: true, result: await this.requireProject().movies.getStory() };
      case 'story.update':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.updateStory(command.params),
        };
      case 'timeline.get':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.readTimeline(),
        };
      case 'timeline.assemble':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().movies.assembleTimeline(command.params),
        };
      case 'object.import': {
        const object = await this.requireProject().objects.importFile(command.params.path);
        return { id: command.id, ok: true, result: object };
      }
      case 'take.list':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().media.listTakes(command.params.shotId),
        };
      case 'take.select':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().media.selectTake(command.params),
        };
      case 'evaluation.list':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().media.listEvaluations(command.params.takeId),
        };
      case 'feedback.create':
        return {
          id: command.id,
          ok: true,
          result: await this.requireProject().feedback.create(command.params),
        };
      case 'feedback.list':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().feedback.list(command.params),
        };
      case 'feedback.resolve':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().feedback.resolve(
            command.params.feedbackId,
            command.params.revisionId,
          ),
        };
      case 'analysis.create_task': {
        this.requireProject().media.getTake(command.params.takeId);
        const task = this.tasks.create(`Analyze Take ${command.params.takeId}`, [
          {
            kind: 'media.analyze',
            title: 'Analyze media with timecoded evidence',
            input: command.params,
          },
        ]);
        return { id: command.id, ok: true, result: task };
      }
      case 'analysis.list':
        return {
          id: command.id,
          ok: true,
          result: this.requireProject().media.listAnalyses(command.params.takeId),
        };
      case 'task.create': {
        const project = this.requireProject();
        let durationSeconds = 4;
        if (command.params.targetShotId) {
          const target = movieEntitySchema.parse(
            await project.movies.read('shot', command.params.targetShotId),
          );
          if (target.type !== 'shot') throw new Error('Task target must be a shot');
          durationSeconds = target.duration_us / 1_000_000;
        }
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
              kind: command.params.mediaKind === 'video' ? 'video.generate' : 'image.generate',
              title:
                command.params.mediaKind === 'video'
                  ? 'Generate a video Take'
                  : 'Generate an image Take',
              input: {
                prompt: command.params.goal,
                providerId: command.params.mediaProviderId,
                model: command.params.mediaModel,
                durationSeconds,
                width: 1024,
                height: 1024,
                ...(command.params.targetShotId ? { shotId: command.params.targetShotId } : {}),
              },
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
            imageGeneration: command.params.imageGeneration,
          }),
        );
        return { id: command.id, ok: true, result: { id: command.params.id } };
      case 'provider.configure_http_video':
        this.providers.upsert(
          new HttpVideoJobProvider({
            id: command.params.id,
            baseUrl: command.params.baseUrl,
            apiKey: command.params.apiKey,
            path: command.params.path,
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

  private async evaluateTake(
    project: ProjectStore,
    shotId: string,
    take: TakeRecord,
    object: StoredObject,
  ): Promise<unknown> {
    const shot = movieEntitySchema.parse(await project.movies.read('shot', shotId));
    if (shot.type !== 'shot') throw new Error(`Entity is not a shot: ${shotId}`);
    const evaluation = await this.evaluations.run({
      shot,
      take: {
        id: take.id,
        mimeType: object.mimeType,
        byteSize: object.byteSize,
        provider: take.provider,
        generation: take.generation,
      },
    });
    return project.media.recordEvaluation({
      takeId: take.id,
      evaluator: 'openmovie.aggregate.v1',
      status: evaluation.status,
      score: evaluation.score,
      findings: evaluation.results.flatMap((result) =>
        result.findings.map((finding) => ({ ...finding, evaluator: result.evaluator })),
      ),
      provenance: { deterministic: true, evaluatorCount: evaluation.results.length },
    });
  }

  private waitForPoll(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 1_000);
      const abort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private codexDynamicTools(): DynamicToolSpec[] {
    const object = (properties: Record<string, unknown>, required: string[] = []) => ({
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    });
    return [
      {
        type: 'function',
        name: 'openmovie_project_summary',
        description: 'Read the current OpenMovie project, branch, and Revision ID.',
        inputSchema: object({}),
      },
      {
        type: 'function',
        name: 'openmovie_entity_list',
        description: 'List structured characters, scenes, or shots.',
        inputSchema: object({ kind: { type: 'string', enum: ['character', 'scene', 'shot'] } }, [
          'kind',
        ]),
      },
      {
        type: 'function',
        name: 'openmovie_scene_create',
        description: 'Create a scene through an atomic Movie Revision.',
        inputSchema: object(
          {
            title: { type: 'string' },
            storyGoal: { type: 'string' },
            expectedRevisionId: { type: 'string' },
          },
          ['title', 'expectedRevisionId'],
        ),
      },
      {
        type: 'function',
        name: 'openmovie_shot_create',
        description: 'Create a shot and update its parent scene in one Movie Revision.',
        inputSchema: object(
          {
            sceneId: { type: 'string' },
            durationUs: { type: 'integer', minimum: 1 },
            framing: { type: 'string' },
            movement: { type: 'string' },
            expectedRevisionId: { type: 'string' },
          },
          ['sceneId', 'durationUs', 'expectedRevisionId'],
        ),
      },
    ];
  }

  private async handleCodexTool(tool: string, argumentsValue: unknown): Promise<unknown> {
    if (
      typeof argumentsValue !== 'object' ||
      argumentsValue === null ||
      Array.isArray(argumentsValue)
    ) {
      throw new Error(`Invalid arguments for ${tool}`);
    }
    const input = argumentsValue as Record<string, unknown>;
    const project = this.requireProject();
    if (tool === 'openmovie_project_summary') return this.summary();
    if (tool === 'openmovie_entity_list') {
      const kind = input.kind;
      if (kind !== 'character' && kind !== 'scene' && kind !== 'shot') {
        throw new Error('kind must be character, scene, or shot');
      }
      return { entities: await project.movies.list(kind) };
    }
    const expectedRevisionId = input.expectedRevisionId;
    if (typeof expectedRevisionId !== 'string') throw new Error('expectedRevisionId is required');
    if (tool === 'openmovie_scene_create') {
      if (typeof input.title !== 'string') throw new Error('title is required');
      return project.movies.createScene({
        title: input.title,
        expectedRevisionId,
        authorId: 'codex_harness',
        ...(typeof input.storyGoal === 'string' ? { storyGoal: input.storyGoal } : {}),
      });
    }
    if (tool === 'openmovie_shot_create') {
      if (typeof input.sceneId !== 'string' || typeof input.durationUs !== 'number') {
        throw new Error('sceneId and durationUs are required');
      }
      return project.movies.createShot({
        sceneId: input.sceneId,
        durationUs: input.durationUs,
        expectedRevisionId,
        authorId: 'codex_harness',
        ...(typeof input.framing === 'string' ? { framing: input.framing } : {}),
        ...(typeof input.movement === 'string' ? { movement: input.movement } : {}),
      });
    }
    throw new Error(`Unknown OpenMovie dynamic tool: ${tool}`);
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
