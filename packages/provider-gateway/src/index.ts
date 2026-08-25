import { createHash } from 'node:crypto';

export type ProviderCapability =
  | 'text.generate'
  | 'image.understand'
  | 'image.generate'
  | 'audio.transcribe'
  | 'video.analyze'
  | 'video.generate';

export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; url: string; mimeType?: string };

export type GenerateTextRequest = {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }>;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type GenerateTextResult = {
  text: string;
  model: string;
  finishReason: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsdMicros?: number };
  rawId?: string;
};

export type GenerateImageRequest = {
  model: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  signal?: AbortSignal;
};

export type GenerateImageResult = {
  bytes: Uint8Array;
  mimeType: string;
  model: string;
  seed?: number;
  requestHash: string;
};

export type UnderstandImageRequest = {
  model: string;
  prompt: string;
  imageUrl: string;
  mimeType?: string;
  signal?: AbortSignal;
};

export type UnderstandImageResult = GenerateTextResult & {
  evidence: Array<{ description: string; confidence?: number }>;
};

export type TranscribeAudioRequest = {
  model: string;
  bytes: Uint8Array;
  mimeType: string;
  language?: string;
  signal?: AbortSignal;
};

export type TranscribeAudioResult = {
  text: string;
  model: string;
  language?: string;
  segments: Array<{ startUs: number; endUs: number; text: string }>;
};

export type GenerateVideoRequest = {
  model: string;
  prompt: string;
  mode: 'text_to_video' | 'image_to_video' | 'video_to_video' | 'extend' | 'edit';
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  firstFrameUrl?: string;
  sourceVideoUrl?: string;
  seed?: number;
  signal?: AbortSignal;
  extensions?: Record<string, unknown>;
};

export type ProviderJob = {
  id: string;
  providerId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type GeneratedMedia = {
  bytes: Uint8Array;
  mimeType: string;
  model: string;
  requestHash: string;
  providerJobId?: string;
};

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  generateText?(request: GenerateTextRequest): Promise<GenerateTextResult>;
  understandImage?(request: UnderstandImageRequest): Promise<UnderstandImageResult>;
  transcribeAudio?(request: TranscribeAudioRequest): Promise<TranscribeAudioResult>;
  generateImage?(request: GenerateImageRequest): Promise<GenerateImageResult>;
  submitVideo?(request: GenerateVideoRequest): Promise<ProviderJob>;
  getVideoJob?(jobId: string, signal?: AbortSignal): Promise<ProviderJob>;
  collectVideo?(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  cancelVideo?(jobId: string): Promise<ProviderJob>;
}

export class ProviderGateway {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    if (this.providers.has(provider.id))
      throw new Error(`Provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  upsert(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): ModelProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    return provider;
  }

  list(): Array<{ id: string; capabilities: ProviderCapability[] }> {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      capabilities: [...provider.capabilities],
    }));
  }
}

const fixturePng = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

export class FakeProvider implements ModelProvider {
  readonly id = 'fake';
  readonly capabilities = new Set<ProviderCapability>([
    'text.generate',
    'image.understand',
    'image.generate',
    'audio.transcribe',
    'video.analyze',
    'video.generate',
  ]);
  private readonly videoJobs = new Map<
    string,
    { job: ProviderJob; request: GenerateVideoRequest }
  >();

  generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const last = request.messages.at(-1)?.content;
    const text =
      typeof last === 'string' ? last : (last?.find((part) => part.type === 'text')?.text ?? '');
    return Promise.resolve({
      text: `Fake response: ${text}`,
      model: request.model,
      finishReason: 'stop',
    });
  }

  generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return Promise.resolve({
      bytes: fixturePng,
      mimeType: 'image/png',
      model: request.model,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      requestHash: createHash('sha256')
        .update(JSON.stringify(request, ['model', 'prompt', 'width', 'height', 'seed']))
        .digest('hex'),
    });
  }

  understandImage(request: UnderstandImageRequest): Promise<UnderstandImageResult> {
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return Promise.resolve({
      text: `Fake visual analysis: ${request.prompt}`,
      model: request.model,
      finishReason: 'stop',
      evidence: [{ description: 'Deterministic fixture image', confidence: 1 }],
    });
  }

  transcribeAudio(request: TranscribeAudioRequest): Promise<TranscribeAudioResult> {
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return Promise.resolve({
      text: 'Fake transcript: deterministic fixture audio.',
      model: request.model,
      ...(request.language ? { language: request.language } : {}),
      segments: [
        { startUs: 0, endUs: 1_000_000, text: 'Fake transcript: deterministic fixture audio.' },
      ],
    });
  }

  submitVideo(request: GenerateVideoRequest): Promise<ProviderJob> {
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const now = new Date().toISOString();
    const id = `fake_video_${createHash('sha256')
      .update(JSON.stringify({ model: request.model, prompt: request.prompt, mode: request.mode }))
      .digest('hex')
      .slice(0, 16)}`;
    const job: ProviderJob = {
      id,
      providerId: this.id,
      status: 'succeeded',
      progress: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.videoJobs.set(id, { job, request });
    return Promise.resolve(structuredClone(job));
  }

  getVideoJob(jobId: string, signal?: AbortSignal): Promise<ProviderJob> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const stored = this.videoJobs.get(jobId);
    if (!stored) throw new Error(`Fake video job not found: ${jobId}`);
    return Promise.resolve(structuredClone(stored.job));
  }

  collectVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia[]> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const stored = this.videoJobs.get(jobId);
    if (!stored) throw new Error(`Fake video job not found: ${jobId}`);
    if (stored.job.status !== 'succeeded')
      throw new Error(`Fake video job is ${stored.job.status}`);
    const bytes = Uint8Array.from(Buffer.from('AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t', 'base64'));
    return Promise.resolve([
      {
        bytes,
        mimeType: 'video/mp4',
        model: stored.request.model,
        providerJobId: jobId,
        requestHash: createHash('sha256')
          .update(JSON.stringify(stored.request, ['model', 'prompt', 'mode', 'durationSeconds']))
          .digest('hex'),
      },
    ]);
  }

  cancelVideo(jobId: string): Promise<ProviderJob> {
    const stored = this.videoJobs.get(jobId);
    if (!stored) throw new Error(`Fake video job not found: ${jobId}`);
    stored.job.status = 'cancelled';
    stored.job.updatedAt = new Date().toISOString();
    return Promise.resolve(structuredClone(stored.job));
  }
}

export type OpenAICompatibleOptions = {
  id: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  imageGeneration?: boolean;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly capabilities: ReadonlySet<ProviderCapability>;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.capabilities = new Set<ProviderCapability>([
      'text.generate',
      'image.understand',
      ...(options.imageGeneration ? (['image.generate'] as const) : []),
    ]);
  }

  get id(): string {
    return this.options.id;
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const url = new URL(
      'chat/completions',
      this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`,
    );
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Provider endpoint must use HTTPS unless it is localhost');
    }
    const response = await fetch(url, {
      method: 'POST',
      ...(request.signal ? { signal: request.signal } : {}),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content:
            typeof message.content === 'string'
              ? message.content
              : message.content.map((part) =>
                  part.type === 'text' ? part : { type: 'image_url', image_url: { url: part.url } },
                ),
        })),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      }),
    });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const value = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = value.choices?.[0];
    if (!choice?.message?.content) throw new Error('Provider response contains no assistant text');
    return {
      text: choice.message.content,
      model: value.model ?? request.model,
      finishReason: choice.finish_reason ?? 'unknown',
      ...(value.id ? { rawId: value.id } : {}),
      usage: {
        ...(value.usage?.prompt_tokens === undefined
          ? {}
          : { inputTokens: value.usage.prompt_tokens }),
        ...(value.usage?.completion_tokens === undefined
          ? {}
          : { outputTokens: value.usage.completion_tokens }),
      },
    };
  }

  async understandImage(request: UnderstandImageRequest): Promise<UnderstandImageResult> {
    const response = await this.generateText({
      model: request.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            {
              type: 'image_url',
              url: request.imageUrl,
              ...(request.mimeType ? { mimeType: request.mimeType } : {}),
            },
          ],
        },
      ],
      ...(request.signal ? { signal: request.signal } : {}),
    });
    return { ...response, evidence: [] };
  }

  async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
    if (!this.options.imageGeneration) {
      throw new Error(`Image generation is not enabled for Provider ${this.id}`);
    }
    const url = new URL(
      'images/generations',
      this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`,
    );
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Provider endpoint must use HTTPS unless it is localhost');
    }
    const response = await fetch(url, {
      method: 'POST',
      ...(request.signal ? { signal: request.signal } : {}),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        size: `${request.width}x${request.height}`,
        response_format: 'b64_json',
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      }),
    });
    if (!response.ok) throw new Error(`Provider image HTTP ${response.status}`);
    const value = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = value.data?.[0];
    let bytes: Uint8Array;
    if (item?.b64_json) {
      bytes = Uint8Array.from(Buffer.from(item.b64_json, 'base64'));
    } else if (item?.url) {
      const outputUrl = new URL(item.url);
      if (outputUrl.protocol !== 'https:') throw new Error('Provider image URL must use HTTPS');
      const output = await fetch(outputUrl, request.signal ? { signal: request.signal } : {});
      if (!output.ok) throw new Error(`Provider image download HTTP ${output.status}`);
      bytes = new Uint8Array(await output.arrayBuffer());
    } else {
      throw new Error('Provider image response contains no output');
    }
    return {
      bytes,
      mimeType: 'image/png',
      model: request.model,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      requestHash: createHash('sha256')
        .update(JSON.stringify(request, ['model', 'prompt', 'width', 'height', 'seed']))
        .digest('hex'),
    };
  }
}

export type OpenAIResponsesOptions = {
  id: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export class OpenAIResponsesProvider implements ModelProvider {
  readonly capabilities = new Set<ProviderCapability>(['text.generate', 'image.understand']);

  constructor(private readonly options: OpenAIResponsesOptions) {}

  get id(): string {
    return this.options.id;
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const url = new URL(
      'responses',
      this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`,
    );
    if (url.username || url.password || url.hash) {
      throw new Error('Provider endpoint cannot contain credentials or a URL fragment');
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Provider endpoint must use HTTPS unless it is localhost');
    }
    const instructions = request.messages
      .filter((message) => message.role === 'system')
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n'),
      )
      .filter(Boolean)
      .join('\n\n');
    const input = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? [{ type: 'input_text', text: message.content }]
            : message.content.map((part) =>
                part.type === 'text'
                  ? { type: 'input_text', text: part.text }
                  : { type: 'input_image', image_url: part.url },
              ),
      }));
    const response = await (this.options.fetch ?? fetch)(url, {
      method: 'POST',
      ...(request.signal ? { signal: request.signal } : {}),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: request.model,
        input,
        store: false,
        ...(instructions ? { instructions } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined
          ? {}
          : { max_output_tokens: request.maxOutputTokens }),
      }),
    });
    if (!response.ok) throw new Error(`Provider Responses HTTP ${response.status}`);
    const value = (await response.json()) as {
      id?: string;
      model?: string;
      status?: string;
      output_text?: string;
      incomplete_details?: { reason?: string } | null;
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text =
      value.output_text ??
      value.output
        ?.flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text')
        .map((part) => part.text ?? '')
        .join('');
    if (!text) throw new Error('Provider Responses output contains no assistant text');
    return {
      text,
      model: value.model ?? request.model,
      finishReason: value.incomplete_details?.reason ?? value.status ?? 'unknown',
      ...(value.id ? { rawId: value.id } : {}),
      usage: {
        ...(value.usage?.input_tokens === undefined
          ? {}
          : { inputTokens: value.usage.input_tokens }),
        ...(value.usage?.output_tokens === undefined
          ? {}
          : { outputTokens: value.usage.output_tokens }),
      },
    };
  }

  async understandImage(request: UnderstandImageRequest): Promise<UnderstandImageResult> {
    const response = await this.generateText({
      model: request.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            {
              type: 'image_url',
              url: request.imageUrl,
              ...(request.mimeType ? { mimeType: request.mimeType } : {}),
            },
          ],
        },
      ],
      ...(request.signal ? { signal: request.signal } : {}),
    });
    return { ...response, evidence: [] };
  }
}

export type HttpVideoJobProviderOptions = {
  id: string;
  baseUrl: string;
  apiKey: string;
  path?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export class HttpVideoJobProvider implements ModelProvider {
  readonly capabilities = new Set<ProviderCapability>(['video.generate']);
  private readonly jobs = new Map<string, ProviderJob>();

  constructor(private readonly options: HttpVideoJobProviderOptions) {}

  get id(): string {
    return this.options.id;
  }

  async submitVideo(request: GenerateVideoRequest): Promise<ProviderJob> {
    const response = await this.request(this.options.path ?? 'videos', {
      method: 'POST',
      ...(request.signal ? { signal: request.signal } : {}),
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        mode: request.mode,
        ...(request.durationSeconds === undefined ? {} : { duration: request.durationSeconds }),
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
        ...(request.firstFrameUrl ? { first_frame: request.firstFrameUrl } : {}),
        ...(request.sourceVideoUrl ? { source_video: request.sourceVideoUrl } : {}),
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.extensions ?? {}),
      }),
    });
    const value = (await response.json()) as { id?: string; job_id?: string; status?: string };
    const id = value.id ?? value.job_id;
    if (!id) throw new Error('Video Provider returned no job ID');
    const now = new Date().toISOString();
    const job: ProviderJob = {
      id,
      providerId: this.id,
      status: this.normalizeStatus(value.status ?? 'queued'),
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    return structuredClone(job);
  }

  async getVideoJob(jobId: string, signal?: AbortSignal): Promise<ProviderJob> {
    const response = await this.request(
      `${this.options.path ?? 'videos'}/${encodeURIComponent(jobId)}`,
      {
        method: 'GET',
        ...(signal ? { signal } : {}),
      },
    );
    const value = (await response.json()) as {
      status?: string;
      progress?: number;
      error?: { message?: string } | string;
    };
    const previous = this.jobs.get(jobId);
    const job: ProviderJob = {
      id: jobId,
      providerId: this.id,
      status: this.normalizeStatus(value.status ?? previous?.status ?? 'running'),
      ...(typeof value.progress === 'number' ? { progress: value.progress } : {}),
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(value.error
        ? {
            error:
              typeof value.error === 'string'
                ? value.error
                : (value.error.message ?? 'Video Provider job failed'),
          }
        : {}),
    };
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  async collectVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia[]> {
    const response = await this.request(
      `${this.options.path ?? 'videos'}/${encodeURIComponent(jobId)}`,
      {
        method: 'GET',
        ...(signal ? { signal } : {}),
      },
    );
    const value = (await response.json()) as {
      status?: string;
      model?: string;
      output?: { url?: string; b64_json?: string; mime_type?: string };
      url?: string;
      b64_json?: string;
    };
    if (this.normalizeStatus(value.status ?? 'succeeded') !== 'succeeded') {
      throw new Error(`Video Provider job is ${value.status ?? 'not complete'}`);
    }
    const encoded = value.output?.b64_json ?? value.b64_json;
    const remoteUrl = value.output?.url ?? value.url;
    let bytes: Uint8Array;
    if (encoded) {
      bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
    } else if (remoteUrl) {
      const url = new URL(remoteUrl);
      if (url.protocol !== 'https:') throw new Error('Video output URL must use HTTPS');
      const output = await (this.options.fetch ?? fetch)(url, signal ? { signal } : {});
      if (!output.ok) throw new Error(`Video download HTTP ${output.status}`);
      bytes = new Uint8Array(await output.arrayBuffer());
    } else {
      throw new Error('Video Provider returned no output media');
    }
    return [
      {
        bytes,
        mimeType: value.output?.mime_type ?? 'video/mp4',
        model: value.model ?? 'unknown',
        providerJobId: jobId,
        requestHash: createHash('sha256').update(bytes).digest('hex'),
      },
    ];
  }

  async cancelVideo(jobId: string): Promise<ProviderJob> {
    await this.request(`${this.options.path ?? 'videos'}/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
    const previous = this.jobs.get(jobId);
    const now = new Date().toISOString();
    const job: ProviderJob = {
      id: jobId,
      providerId: this.id,
      status: 'cancelled',
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = new URL(
      path,
      this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`,
    );
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Provider endpoint must use HTTPS unless it is localhost');
    }
    const response = await (this.options.fetch ?? fetch)(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Video Provider HTTP ${response.status}`);
    return response;
  }

  private normalizeStatus(status: string): ProviderJob['status'] {
    if (['completed', 'succeeded', 'ready'].includes(status)) return 'succeeded';
    if (['failed', 'error'].includes(status)) return 'failed';
    if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
    if (['queued', 'pending'].includes(status)) return 'queued';
    return 'running';
  }
}
