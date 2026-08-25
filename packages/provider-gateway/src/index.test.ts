import { describe, expect, it } from 'vitest';

import { FakeProvider, ProviderGateway } from './index.js';

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
  });
});
