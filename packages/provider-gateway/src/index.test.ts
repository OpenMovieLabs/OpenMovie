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
});
