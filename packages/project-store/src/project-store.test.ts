import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProjectStore, ProjectStoreError } from './index.js';

describe('ProjectStore', () => {
  it('creates, reopens, and locks a portable project', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-project-'));
    const root = join(parent, 'movie');
    const first = await ProjectStore.create(root, { title: 'Test Movie', locale: 'zh-CN' });
    expect((await first.readManifest()).project.title).toBe('Test Movie');

    await expect(ProjectStore.open(root)).rejects.toBeInstanceOf(ProjectStoreError);
    await first.close();

    const reopened = await ProjectStore.open(root);
    expect(reopened.revisions.list()).toHaveLength(1);
    await reopened.close();
  });

  it('deduplicates objects by SHA-256', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-objects-'));
    const source = join(parent, 'frame.png');
    await writeFile(
      source,
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('fixture')]),
    );
    const project = await ProjectStore.create(join(parent, 'movie'), { title: 'Objects' });
    const first = await project.objects.importFile(source);
    const second = await project.objects.importFile(source);

    expect(second.uri).toBe(first.uri);
    expect(first.mimeType).toBe('image/png');
    expect(await readFile(first.path)).toEqual(await readFile(second.path));
    await project.close();
  });

  it('commits and restores revisions with optimistic concurrency', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-revision-'));
    const project = await ProjectStore.create(join(parent, 'movie'), { title: 'Original' });
    const initial = project.revisions.currentRevisionId();
    const changed = await project.revisions.commit({
      expectedRevisionId: initial,
      authorType: 'user',
      authorId: 'user_local',
      message: 'Rename movie',
      patch: [{ op: 'replace', path: '/project/title', value: 'Changed' }],
    });
    expect((await project.readManifest()).project.title).toBe('Changed');

    await expect(
      project.revisions.commit({
        expectedRevisionId: initial,
        authorType: 'agent',
        authorId: 'agent_test',
        message: 'Stale write',
        patch: [{ op: 'replace', path: '/project/title', value: 'Wrong' }],
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });

    const restored = await project.revisions.restore(initial!, changed.id, 'user_local');
    expect(restored.parentId).toBe(changed.id);
    expect((await project.readManifest()).project.title).toBe('Original');
    await project.close();
  });
});
