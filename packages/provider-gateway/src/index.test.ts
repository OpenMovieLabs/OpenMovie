import { describe, expect, it } from 'vitest';

import {
  FakeProvider,
  HttpVideoJobProvider,
  OpenAICompatibleProvider,
  OpenAIResponsesProvider,
  ProviderGateway,
} from './index.js';

describe('ProviderGateway', () => {
  it('registers capabilities and runs deterministic fake providers', async () => {
    const gateway = new ProviderGateway();
    const fake = new FakeProvider();
    gateway.register(fake);
    expect(gateway.list()).toEqual([
      {
        id: 'fake',
        capabilities: expect.arrayContaining(['text.generate', 'image.generate']) as string[],
      },
    ]);
    const text = await fake.generateText({
      model: 'fake-text',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(text.text).toBe('Fake response: hello');
    const image = await fake.generateImage({
      model: 'fake-image',
      prompt: 'frame',
      width: 1,
      height: 1,
    });
    expect(image.mimeType).toBe('image/png');
    expect(image.bytes.byteLength).toBeGreaterThan(20);
    expect(
      await fake.transcribeAudio({
        model: 'fake-transcription',
        bytes: new Uint8Array([0, 0]),
        mimeType: 'audio/wav',
      }),
    ).toMatchObject({
      model: 'fake-transcription',
      segments: [{ startUs: 0, endUs: 1_000_000 }],
    });
    const videoJob = await fake.submitVideo({
      model: 'fake-video',
      prompt: 'moving frame',
      mode: 'text_to_video',
    });
    expect(videoJob.status).toBe('succeeded');
    const video = await fake.collectVideo(videoJob.id);
    expect(video[0]?.mimeType).toBe('video/mp4');
    expect(
      Buffer.from(video[0]?.bytes ?? [])
        .subarray(4, 8)
        .toString('ascii'),
    ).toBe('ftyp');
  });

  it('rejects duplicate and missing Providers while allowing explicit replacement', () => {
    const gateway = new ProviderGateway();
    const first = new FakeProvider();
    gateway.register(first);
    expect(() => gateway.register(new FakeProvider())).toThrow(/already registered/);
    expect(() => gateway.get('missing')).toThrow(/Provider not found/);
    const replacement = new FakeProvider();
    gateway.upsert(replacement);
    expect(gateway.get('fake')).toBe(replacement);
  });

  it('supports deterministic fake visual analysis and full video job cancellation', async () => {
    const fake = new FakeProvider();
    await expect(
      fake.understandImage({
        model: 'fake-vision',
        prompt: 'Describe the frame',
        imageUrl: 'data:image/png;base64,AAAA',
      }),
    ).resolves.toMatchObject({
      text: 'Fake visual analysis: Describe the frame',
      evidence: [{ confidence: 1 }],
    });
    const job = await fake.submitVideo({
      model: 'fake-video',
      prompt: 'A moving frame',
      mode: 'text_to_video',
    });
    expect(await fake.getVideoJob(job.id)).toMatchObject({ status: 'succeeded' });
    expect(await fake.cancelVideo(job.id)).toMatchObject({ status: 'cancelled' });
    await expect(fake.collectVideo(job.id)).rejects.toThrow(/cancelled/);
    await expect(fake.getVideoJob('missing')).rejects.toThrow(/not found/);

    const controller = new AbortController();
    controller.abort();
    await expect(
      fake.generateText({
        model: 'fake-text',
        messages: [{ role: 'user', content: 'cancelled' }],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('normalizes asynchronous HTTP video job protocols', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.endsWith('/videos')) {
        return Promise.resolve(Response.json({ id: 'job_1', status: 'queued' }));
      }
      return Promise.resolve(
        Response.json({
          id: 'job_1',
          status: 'completed',
          model: 'video-v1',
          b64_json: 'AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t',
          usage: { input_tokens: 8, output_tokens: 2, cost_usd_micros: 75_000 },
        }),
      );
    };
    const provider = new HttpVideoJobProvider({
      id: 'video-test',
      baseUrl: 'https://video.example/v1/',
      apiKey: 'test-key',
      fetch: fetcher,
    });
    const job = await provider.submitVideo({
      model: 'video-v1',
      prompt: 'ocean at night',
      mode: 'text_to_video',
    });
    expect(job).toMatchObject({ id: 'job_1', status: 'queued' });
    expect((await provider.getVideoJob(job.id)).status).toBe('succeeded');
    expect((await provider.collectVideo(job.id))[0]).toMatchObject({
      providerJobId: 'job_1',
      usage: { inputTokens: 8, outputTokens: 2, costUsdMicros: 75_000 },
    });
    expect(calls).toHaveLength(3);
  });

  it('preserves explicit image Provider usage and cost', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'image-test',
      baseUrl: 'https://images.example/v1/',
      apiKey: 'test-key',
      imageGeneration: true,
      fetch: () =>
        Promise.resolve(
          Response.json({
            data: [{ b64_json: 'iVBORw0KGgo=' }],
            usage: { input_tokens: 5, output_tokens: 1, cost_usd_micros: 20_000 },
          }),
        ),
    });
    expect(
      await provider.generateImage({
        model: 'image-v1',
        prompt: 'A test frame',
        width: 1024,
        height: 1024,
      }),
    ).toMatchObject({
      model: 'image-v1',
      usage: { inputTokens: 5, outputTokens: 1, costUsdMicros: 20_000 },
    });
  });

  it('normalizes OpenAI-compatible chat requests, multimodal parts, and usage', async () => {
    let requestBody: Record<string, unknown> = {};
    const provider = new OpenAICompatibleProvider({
      id: 'chat-test',
      baseUrl: 'https://chat.example/v1',
      apiKey: 'test-key',
      headers: { 'x-fixture': 'enabled' },
      fetch: (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          Response.json({
            id: 'chat_1',
            model: 'chat-model-v2',
            choices: [{ message: { content: 'A figure enters.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 9, completion_tokens: 4, cost_usd_micros: 300 },
          }),
        );
      },
    });
    await expect(
      provider.generateText({
        model: 'chat-model',
        temperature: 0.2,
        maxOutputTokens: 200,
        messages: [
          { role: 'system', content: 'Be concise.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this frame' },
              { type: 'image_url', url: 'data:image/png;base64,AAAA' },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({
      text: 'A figure enters.',
      model: 'chat-model-v2',
      rawId: 'chat_1',
      usage: { inputTokens: 9, outputTokens: 4, costUsdMicros: 300 },
    });
    expect(requestBody).toMatchObject({
      model: 'chat-model',
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        { role: 'system', content: 'Be concise.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this frame' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    });
  });

  it('enforces Provider endpoint, response, output URL, and usage safety', async () => {
    const insecure = new OpenAICompatibleProvider({
      id: 'insecure',
      baseUrl: 'http://remote.example/v1/',
      apiKey: 'test-key',
      fetch,
    });
    await expect(
      insecure.generateText({ model: 'test', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/must use HTTPS/);

    const missingText = new OpenAICompatibleProvider({
      id: 'missing-text',
      baseUrl: 'https://api.example/v1/',
      apiKey: 'test-key',
      fetch: () => Promise.resolve(Response.json({ choices: [] })),
    });
    await expect(
      missingText.generateText({ model: 'test', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/no assistant text/);

    const invalidUsage = new OpenAICompatibleProvider({
      id: 'invalid-usage',
      baseUrl: 'https://api.example/v1/',
      apiKey: 'test-key',
      fetch: () =>
        Promise.resolve(
          Response.json({
            choices: [{ message: { content: 'hello' } }],
            usage: { prompt_tokens: -1 },
          }),
        ),
    });
    await expect(
      invalidUsage.generateText({ model: 'test', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/invalid inputTokens/);

    const disabledImages = new OpenAICompatibleProvider({
      id: 'disabled-images',
      baseUrl: 'https://api.example/v1/',
      apiKey: 'test-key',
    });
    await expect(
      disabledImages.generateImage({ model: 'image', prompt: 'frame', width: 32, height: 32 }),
    ).rejects.toThrow(/not enabled/);

    const unsafeImage = new OpenAICompatibleProvider({
      id: 'unsafe-image',
      baseUrl: 'https://api.example/v1/',
      apiKey: 'test-key',
      imageGeneration: true,
      fetch: () =>
        Promise.resolve(Response.json({ data: [{ url: 'http://unsafe.example/a.png' }] })),
    });
    await expect(
      unsafeImage.generateImage({ model: 'image', prompt: 'frame', width: 32, height: 32 }),
    ).rejects.toThrow(/image URL must use HTTPS/);
  });

  it('normalizes text and image inputs through the OpenAI Responses protocol', async () => {
    let requestBody: Record<string, unknown> = {};
    const provider = new OpenAIResponsesProvider({
      id: 'responses-test',
      baseUrl: 'https://api.example/v1/',
      apiKey: 'test-key',
      fetch: (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          Response.json({
            id: 'resp_test',
            model: 'vision-model',
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'A figure crosses the frame.' }],
              },
            ],
            usage: { input_tokens: 12, output_tokens: 7, cost_usd_micros: 2_500 },
          }),
        );
      },
    });
    const result = await provider.understandImage({
      model: 'vision-model',
      prompt: 'Describe the shot',
      imageUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
    });

    expect(result).toMatchObject({
      text: 'A figure crosses the frame.',
      model: 'vision-model',
      finishReason: 'completed',
      usage: { inputTokens: 12, outputTokens: 7, costUsdMicros: 2_500 },
    });
    expect(requestBody).toMatchObject({
      model: 'vision-model',
      store: false,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe the shot' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
          ],
        },
      ],
    });
  });

  it('normalizes video status, errors, cancellation, and remote output downloads', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let pollCount = 0;
    const provider = new HttpVideoJobProvider({
      id: 'video-lifecycle',
      baseUrl: 'https://video.example/v1/',
      apiKey: 'test-key',
      path: 'jobs',
      fetch: (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url, method: init?.method ?? 'GET' });
        if (url.endsWith('/cancel')) return Promise.resolve(Response.json({ ok: true }));
        if (url === 'https://cdn.example/movie.mp4') {
          return Promise.resolve(new Response(Uint8Array.from([0, 1, 2, 3])));
        }
        if ((init?.method ?? 'GET') === 'POST') {
          return Promise.resolve(Response.json({ job_id: 'job_remote', status: 'pending' }));
        }
        pollCount += 1;
        return Promise.resolve(
          Response.json(
            pollCount === 1
              ? { status: 'processing', progress: 0.5 }
              : {
                  status: 'ready',
                  model: 'video-v2',
                  output: { url: 'https://cdn.example/movie.mp4', mime_type: 'video/webm' },
                },
          ),
        );
      },
    });
    const job = await provider.submitVideo({
      model: 'video-v2',
      prompt: 'Night city',
      mode: 'text_to_video',
      durationSeconds: 4,
      aspectRatio: '16:9',
      resolution: '1080p',
      seed: 42,
    });
    expect(job.status).toBe('queued');
    expect(await provider.getVideoJob(job.id)).toMatchObject({ status: 'running', progress: 0.5 });
    expect((await provider.collectVideo(job.id))[0]).toMatchObject({
      mimeType: 'video/webm',
      model: 'video-v2',
    });
    expect(await provider.cancelVideo(job.id)).toMatchObject({ status: 'cancelled' });
    expect(calls.some((call) => call.url === 'https://cdn.example/movie.mp4')).toBe(true);
  });
});
