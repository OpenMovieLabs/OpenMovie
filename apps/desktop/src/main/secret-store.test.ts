import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EncryptedSecretStore } from './secret-store.js';

describe('EncryptedSecretStore', () => {
  it('stores ciphertext and never lists plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-secrets-'));
    const path = join(root, 'settings.sqlite');
    const store = new EncryptedSecretStore(path, {
      isAvailable: () => true,
      encrypt: (value) =>
        Promise.resolve(Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xaa))),
      decrypt: (value) =>
        Promise.resolve({
          plaintext: Buffer.from(value)
            .map((byte) => byte ^ 0xaa)
            .toString(),
          shouldReEncrypt: false,
        }),
    });
    const canary = 'sk-secret-canary-never-log';
    await store.set('provider.openrouter', 'OpenRouter', canary);
    const profile = store.setProviderProfile({
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      protocol: 'openai_chat',
      model: 'test/model',
      secretId: 'provider.openrouter',
    });
    expect(profile.hasSecret).toBe(true);
    expect(store.list()[0]).not.toHaveProperty('value');
    expect(await store.get('provider.openrouter')).toBe(canary);
    store.close();
    expect((await readFile(path)).includes(Buffer.from(canary))).toBe(false);
  });
});
