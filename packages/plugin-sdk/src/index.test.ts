import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDevelopmentPlugin } from './index.js';

describe('development plugin host', () => {
  it('runs a manifest-validated text Provider in a separate process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-plugin-'));
    await writeFile(
      join(root, 'plugin.mjs'),
      `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{text:'Plugin: '+r.params.messages[0].content,model:r.params.model,finishReason:'stop'}})+'\\n')})`,
    );
    const manifestPath = join(root, 'openmovie.plugin.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        id: 'plugin.fixture',
        name: 'Fixture Plugin',
        apiVersion: '0.1.0',
        entry: 'plugin.mjs',
        capabilities: ['text.generate'],
      }),
    );
    const loaded = await loadDevelopmentPlugin(manifestPath);
    const result = await loaded.provider.generateText?.({
      model: 'fixture-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toMatchObject({ text: 'Plugin: hello', model: 'fixture-model' });
  });

  it('rejects entries outside the manifest directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmovie-plugin-invalid-'));
    const manifestPath = join(root, 'openmovie.plugin.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        id: 'plugin.invalid',
        name: 'Invalid Plugin',
        apiVersion: '0.1.0',
        entry: '../outside.mjs',
        capabilities: ['text.generate'],
      }),
    );
    await expect(loadDevelopmentPlugin(manifestPath)).rejects.toThrow(/inside/);
  });
});
