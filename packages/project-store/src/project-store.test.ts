import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { TaskEngine } from '@openmovie/task-engine';
import { stringifyYaml } from '@openmovie/movie-ir';

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

  it('persists task state and event history inside the movie project', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-tasks-'));
    const root = join(parent, 'movie');
    const project = await ProjectStore.create(root, { title: 'Persistent Tasks' });
    const engine = new TaskEngine(project.taskPersistence);
    engine.registerStep('plan', () => Promise.resolve({ scenes: 3 }));
    const task = engine.create('Plan three scenes', [
      { kind: 'plan', title: 'Plan', input: { count: 3 } },
    ]);
    expect((await engine.run(task.id)).status).toBe('succeeded');
    const eventCount = engine.listEvents(task.id).length;
    await project.close();

    const reopened = await ProjectStore.open(root);
    const restoredEngine = new TaskEngine(reopened.taskPersistence);
    expect(restoredEngine.get(task.id).steps[0]?.output).toEqual({ scenes: 3 });
    expect(restoredEngine.listEvents(task.id)).toHaveLength(eventCount);
    await reopened.close();
  });

  it('commits scene and shot files atomically in a full project snapshot', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-entities-'));
    const project = await ProjectStore.create(join(parent, 'movie'), { title: 'Entities' });
    const sceneResult = await project.movies.createScene({
      title: 'Arrival',
      storyGoal: 'The protagonist reaches the city',
      expectedRevisionId: project.revisions.currentRevisionId(),
      authorId: 'user_local',
    });
    const shotResult = await project.movies.createShot({
      sceneId: sceneResult.entity.id,
      durationUs: 4_000_000,
      framing: 'wide',
      movement: 'slow_push',
      expectedRevisionId: sceneResult.revision.id,
      authorId: 'user_local',
    });

    expect(shotResult.revision.changedPaths).toEqual([
      'openmovie.yaml',
      `scenes/${sceneResult.entity.id}.yaml`,
      `shots/${shotResult.entity.id}.yaml`,
    ]);
    const scene = await project.movies.read('scene', sceneResult.entity.id);
    expect(scene.type === 'scene' && scene.shots).toContain(shotResult.entity.id);
    expect(project.revisions.list()[0]?.manifestHash).toHaveLength(64);
    const diff = project.revisions.diff(shotResult.revision.id);
    expect(diff.files.find((file) => file.path.startsWith('shots/'))?.status).toBe('added');
    expect(
      diff.files
        .find((file) => file.path.startsWith('scenes/'))
        ?.changes.some((change) => change.pointer === '/shots/0'),
    ).toBe(true);

    if (scene.type !== 'scene') throw new Error('Expected a scene');
    await writeFile(
      join(project.root, 'scenes', `${scene.id}.yaml`),
      stringifyYaml({ ...scene, title: 'Externally edited title' }),
    );
    const working = await project.revisions.workingChanges();
    expect(
      working
        .find((file) => file.path === `scenes/${scene.id}.yaml`)
        ?.changes.some((change) => change.pointer === '/title'),
    ).toBe(true);
    await project.close();
  });

  it('creates and switches isolated movie branches', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openmovie-branches-'));
    const root = join(parent, 'movie');
    const project = await ProjectStore.create(root, { title: 'Branches' });
    project.revisions.createBranch('visual-experiment');
    await project.revisions.switchBranch('visual-experiment');
    const created = await project.movies.createScene({
      title: 'Alternate opening',
      expectedRevisionId: project.revisions.currentRevisionId(),
      authorId: 'user_local',
    });
    expect(await project.movies.list('scene')).toHaveLength(1);

    await project.revisions.switchBranch('main');
    expect(await project.movies.list('scene')).toHaveLength(0);
    await project.revisions.switchBranch('visual-experiment');
    expect((await project.movies.read('scene', created.entity.id)).id).toBe(created.entity.id);
    expect(project.revisions.listBranches().find((branch) => branch.current)?.name).toBe(
      'visual-experiment',
    );
    await project.close();
  });
});
