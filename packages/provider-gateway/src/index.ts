import { createHash } from 'node:crypto';

export type ProviderCapability =
  'text.generate' | 'image.understand' | 'image.generate' | 'video.analyze' | 'video.generate';

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

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  generateText?(request: GenerateTextRequest): Promise<GenerateTextResult>;
  generateImage?(request: GenerateImageRequest): Promise<GenerateImageResult>;
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
  readonly capabilities = new Set<ProviderCapability>(['text.generate', 'image.generate']);

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
}

export type OpenAICompatibleOptions = {
  id: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly capabilities = new Set<ProviderCapability>(['text.generate']);

  constructor(private readonly options: OpenAICompatibleOptions) {}

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
        messages: request.messages,
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
}
