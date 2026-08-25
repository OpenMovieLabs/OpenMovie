import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@openmovie/contracts';

import { CoreServer } from './server.js';

describe('CoreServer', () => {
  it('initializes a compatible client', async () => {
    const response = await new CoreServer().handle({
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        client: { name: 'test', version: '0.0.0', platform: 'linux' },
      },
    });

    expect(response.ok).toBe(true);
  });

  it('returns typed failures for invalid commands', async () => {
    const response = await new CoreServer().handle({ id: 'bad', method: 'unknown' });
    expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });
});
