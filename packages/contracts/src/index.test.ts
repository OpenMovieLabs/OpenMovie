import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, assertProtocolCompatible, coreCommandSchema } from './index.js';

describe('core contracts', () => {
  it('parses initialize', () => {
    const command = coreCommandSchema.parse({
      id: 'command-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        client: { name: 'test', version: '0.0.0', platform: 'darwin' },
      },
    });

    expect(command.method).toBe('initialize');
  });

  it('rejects incompatible major versions', () => {
    expect(() => assertProtocolCompatible('1.0.0')).toThrow(/major mismatch/);
  });

  it('reserves local Provider namespaces from remote profiles', () => {
    expect(() =>
      coreCommandSchema.parse({
        id: 'provider-1',
        method: 'provider.configure_openai_compatible',
        params: {
          id: 'plugin.remote-disguise',
          baseUrl: 'https://provider.example/v1/',
          apiKey: 'test',
          imageGeneration: false,
        },
      }),
    ).toThrow(/reserved local namespace/);
  });
});
