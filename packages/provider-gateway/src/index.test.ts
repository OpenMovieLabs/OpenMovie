import { describe, expect, it } from 'vitest';

import { FakeProvider, HttpVideoJobProvider, ProviderGateway } from './index.js';

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
    expect((await provider.collectVideo(job.id))[0]?.providerJobId).toBe('job_1');
    expect(calls).toHaveLength(3);
  });
});
