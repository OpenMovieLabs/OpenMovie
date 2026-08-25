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
});
