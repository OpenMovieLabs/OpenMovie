import { describe, expect, it, vi } from 'vitest';

import { probeProvider } from './provider-probe.js';
import type { ProviderProfile } from './secret-store.js';

const profile: ProviderProfile = {
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1/',
  protocol: 'openai_chat',
  model: 'test/model',
  secretId: 'provider.openrouter',
  hasSecret: true,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

describe('probeProvider', () => {
  it('checks the standard model endpoint without exposing the credential', async () => {
    const fetcher = vi.fn((input: string, init: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'test/model' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const result = await probeProvider(profile, 'sk-secret-canary', fetcher);
    expect(result).toMatchObject({ status: 'ready', modelVisible: true });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/models');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: 'Bearer sk-secret-canary',
    });
    expect(JSON.stringify(result)).not.toContain('sk-secret-canary');
  });

  it('returns a stable redacted error', async () => {
    const result = await probeProvider(profile, 'sk-secret-canary', () =>
      Promise.reject(new Error('request failed with sk-secret-canary')),
    );
    expect(result).toMatchObject({ status: 'error', message: 'Connection failed or timed out.' });
    expect(JSON.stringify(result)).not.toContain('sk-secret-canary');
  });
});
