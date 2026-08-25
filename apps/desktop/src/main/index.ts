import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PROTOCOL_VERSION,
  branchRecordSchema,
  coreHealthSchema,
  fileDiffSchema,
  evaluationRecordSchema,
  harnessHealthSchema,
  initializeResultSchema,
  projectSummarySchema,
  revisionRecordSchema,
  revisionDiffSchema,
  taskSchema,
  taskEventSchema,
  takeRecordSchema,
} from '@openmovie/contracts';
import { movieEntitySchema } from '@openmovie/movie-ir';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';

import { CoreClient } from './core-client.js';
import { EncryptedSecretStore } from './secret-store.js';

let core: CoreClient | undefined;
let secrets: EncryptedSecretStore | undefined;

function supportedPlatform(): 'darwin' | 'win32' | 'linux' {
  if (
    process.platform === 'darwin' ||
    process.platform === 'win32' ||
    process.platform === 'linux'
  ) {
    return process.platform;
  }
  throw new Error(`Unsupported desktop platform: ${process.platform}`);
}

function coreEntry(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'core', 'main.cjs');
  return resolve(app.getAppPath(), '../core/dist/main.cjs');
}

function parseEntityCommit(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('entity' in value) ||
    !('revision' in value)
  ) {
    throw new Error('Core returned an invalid entity commit');
  }
  return {
    entity: movieEntitySchema.parse(value.entity),
    revision: revisionRecordSchema.parse(value.revision),
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: 'OpenMovie',
    backgroundColor: '#10100f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  return window;
}

void app
  .whenReady()
  .then(async () => {
    core = new CoreClient(coreEntry());
    await core.start();
    secrets = new EncryptedSecretStore(join(app.getPath('userData'), 'settings.sqlite'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plaintext) => safeStorage.encryptStringAsync(plaintext),
      decrypt: async (ciphertext) => {
        const decrypted = await safeStorage.decryptStringAsync(ciphertext);
        return {
          plaintext: decrypted.result,
          shouldReEncrypt: decrypted.shouldReEncrypt,
        };
      },
    });

    const initialize = async () =>
      initializeResultSchema.parse(
        await core?.request({
          method: 'initialize',
          params: {
            protocolVersion: PROTOCOL_VERSION,
            client: {
              name: 'openmovie-desktop',
              version: app.getVersion(),
              platform: supportedPlatform(),
            },
          },
        }),
      );

    ipcMain.handle('openmovie:initialize', initialize);
    ipcMain.handle('openmovie:core-health', async () =>
      coreHealthSchema.parse(await core?.request({ method: 'core.health', params: {} })),
    );
    ipcMain.handle('openmovie:harness-list', async () =>
      harnessHealthSchema
        .array()
        .parse(await core?.request({ method: 'harness.list', params: {} })),
    );
    ipcMain.handle('openmovie:project-create', async (_event, title: unknown) => {
      if (typeof title !== 'string' || title.trim().length === 0)
        throw new Error('Title is required');
      const selection = await dialog.showSaveDialog({
        title: 'Create OpenMovie Project',
        defaultPath: title.trim().replaceAll(/[^a-zA-Z0-9\p{L}\p{N} _-]/gu, ''),
        buttonLabel: 'Create project',
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (selection.canceled || !selection.filePath) return null;
      return projectSummarySchema.parse(
        await core?.request({
          method: 'project.create',
          params: { path: selection.filePath, title: title.trim() },
        }),
      );
    });
    ipcMain.handle('openmovie:project-open', async () => {
      const selection = await dialog.showOpenDialog({
        title: 'Open OpenMovie Project',
        properties: ['openDirectory'],
      });
      const path = selection.filePaths[0];
      if (selection.canceled || !path) return null;
      return projectSummarySchema.parse(
        await core?.request({ method: 'project.open', params: { path, takeoverStaleLock: false } }),
      );
    });
    ipcMain.handle('openmovie:project-summary', async () =>
      projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      ),
    );
    ipcMain.handle('openmovie:project-rename', async (_event, title: unknown) => {
      if (typeof title !== 'string' || title.trim().length === 0)
        throw new Error('Title is required');
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      revisionRecordSchema.parse(
        await core?.request({
          method: 'revision.commit',
          params: {
            expectedRevisionId: summary.currentRevisionId,
            authorType: 'user',
            authorId: 'user_local',
            message: 'Rename movie',
            patch: [{ op: 'replace', path: '/project/title', value: title.trim() }],
          },
        }),
      );
      return projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
    });
    ipcMain.handle('openmovie:revision-list', async () =>
      revisionRecordSchema
        .array()
        .parse(await core?.request({ method: 'revision.list', params: { limit: 100 } })),
    );
    ipcMain.handle('openmovie:revision-restore', async (_event, revisionId: unknown) => {
      if (typeof revisionId !== 'string') throw new Error('Revision ID is required');
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      revisionRecordSchema.parse(
        await core?.request({
          method: 'revision.restore',
          params: {
            revisionId,
            expectedRevisionId: summary.currentRevisionId,
            authorId: 'user_local',
          },
        }),
      );
      return projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
    });
    ipcMain.handle('openmovie:revision-diff', async (_event, revisionId: unknown) => {
      if (typeof revisionId !== 'string') throw new Error('Revision ID is required');
      return revisionDiffSchema.parse(
        await core?.request({ method: 'revision.diff', params: { revisionId } }),
      );
    });
    ipcMain.handle('openmovie:working-changes', async () =>
      fileDiffSchema
        .array()
        .parse(await core?.request({ method: 'revision.working_changes', params: {} })),
    );
    ipcMain.handle('openmovie:branch-list', async () =>
      branchRecordSchema
        .array()
        .parse(await core?.request({ method: 'revision.branch_list', params: {} })),
    );
    ipcMain.handle('openmovie:branch-create', async (_event, name: unknown) => {
      if (typeof name !== 'string' || name.trim().length === 0)
        throw new Error('Branch name is required');
      return branchRecordSchema.parse(
        await core?.request({ method: 'revision.branch_create', params: { name: name.trim() } }),
      );
    });
    ipcMain.handle('openmovie:branch-switch', async (_event, name: unknown) => {
      if (typeof name !== 'string') throw new Error('Branch name is required');
      const branch = branchRecordSchema.parse(
        await core?.request({ method: 'revision.branch_switch', params: { name } }),
      );
      return {
        branch,
        project: projectSummarySchema.parse(
          await core?.request({ method: 'project.get_summary', params: {} }),
        ),
        revisions: revisionRecordSchema
          .array()
          .parse(await core?.request({ method: 'revision.list', params: { limit: 100 } })),
      };
    });
    ipcMain.handle('openmovie:entity-list', async (_event, kind: unknown) => {
      if (kind !== 'character' && kind !== 'scene' && kind !== 'shot') {
        throw new Error('Invalid entity kind');
      }
      return movieEntitySchema
        .array()
        .parse(await core?.request({ method: 'movie.entity_list', params: { kind } }));
    });
    ipcMain.handle(
      'openmovie:character-create',
      async (_event, name: unknown, appearance: unknown) => {
        if (typeof name !== 'string' || name.trim().length === 0)
          throw new Error('Character name is required');
        const summary = projectSummarySchema.parse(
          await core?.request({ method: 'project.get_summary', params: {} }),
        );
        return parseEntityCommit(
          await core?.request({
            method: 'movie.character_create',
            params: {
              name: name.trim(),
              expectedRevisionId: summary.currentRevisionId,
              authorId: 'user_local',
              ...(typeof appearance === 'string' && appearance.trim()
                ? { appearance: appearance.trim() }
                : {}),
            },
          }),
        );
      },
    );
    ipcMain.handle('openmovie:scene-create', async (_event, title: unknown, storyGoal: unknown) => {
      if (typeof title !== 'string' || title.trim().length === 0)
        throw new Error('Scene title is required');
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      return parseEntityCommit(
        await core?.request({
          method: 'movie.scene_create',
          params: {
            title: title.trim(),
            expectedRevisionId: summary.currentRevisionId,
            authorId: 'user_local',
            ...(typeof storyGoal === 'string' && storyGoal.trim()
              ? { storyGoal: storyGoal.trim() }
              : {}),
          },
        }),
      );
    });
    ipcMain.handle(
      'openmovie:shot-create',
      async (
        _event,
        sceneId: unknown,
        durationUs: unknown,
        framing: unknown,
        movement: unknown,
      ) => {
        if (typeof sceneId !== 'string' || typeof durationUs !== 'number')
          throw new Error('Scene and duration are required');
        const summary = projectSummarySchema.parse(
          await core?.request({ method: 'project.get_summary', params: {} }),
        );
        return parseEntityCommit(
          await core?.request({
            method: 'movie.shot_create',
            params: {
              sceneId,
              durationUs,
              expectedRevisionId: summary.currentRevisionId,
              authorId: 'user_local',
              ...(typeof framing === 'string' && framing.trim() ? { framing: framing.trim() } : {}),
              ...(typeof movement === 'string' && movement.trim()
                ? { movement: movement.trim() }
                : {}),
            },
          }),
        );
      },
    );
    ipcMain.handle(
      'openmovie:task-run',
      async (
        _event,
        goal: unknown,
        plannerProviderId: unknown,
        requiresApproval: unknown,
        targetShotId: unknown,
        mediaKind: unknown,
      ) => {
        if (typeof goal !== 'string' || goal.trim().length === 0)
          throw new Error('Task goal is required');
        let providerId = 'fake';
        let model = 'fake-text-v1';
        if (plannerProviderId === 'harness:codex') {
          providerId = 'harness:codex';
          model = 'codex-local';
        } else if (typeof plannerProviderId === 'string' && plannerProviderId !== 'fake') {
          if (!secrets) throw new Error('Secret Store is unavailable');
          const profile = secrets
            .listProviderProfiles()
            .find((item) => item.id === plannerProviderId);
          if (!profile) throw new Error(`Provider profile not found: ${plannerProviderId}`);
          if (profile.protocol !== 'openai_chat') {
            throw new Error('This Direct Agent slice currently supports OpenAI Chat profiles');
          }
          const apiKey = await secrets.get(profile.secretId);
          await core?.request({
            method: 'provider.configure_openai_compatible',
            params: { id: profile.id, baseUrl: profile.baseUrl, apiKey },
          });
          providerId = profile.id;
          model = profile.model;
        }
        const created = taskSchema.parse(
          await core?.request({
            method: 'task.create',
            params: {
              goal: goal.trim(),
              plannerProviderId: providerId,
              plannerModel: model,
              requiresApproval: requiresApproval === true,
              mediaKind: mediaKind === 'video' ? 'video' : 'image',
              ...(typeof targetShotId === 'string' && targetShotId ? { targetShotId } : {}),
            },
          }),
        );
        const task = taskSchema.parse(
          await core?.request({ method: 'task.run', params: { taskId: created.id } }, 60_000),
        );
        return {
          task,
          project: projectSummarySchema.parse(
            await core?.request({ method: 'project.get_summary', params: {} }),
          ),
          revisions: revisionRecordSchema
            .array()
            .parse(await core?.request({ method: 'revision.list', params: { limit: 100 } })),
        };
      },
    );
    ipcMain.handle('openmovie:take-list', async (_event, shotId: unknown) => {
      if (typeof shotId !== 'string') throw new Error('Shot ID is required');
      return takeRecordSchema
        .array()
        .parse(await core?.request({ method: 'take.list', params: { shotId } }));
    });
    ipcMain.handle('openmovie:take-select', async (_event, takeId: unknown) => {
      if (typeof takeId !== 'string') throw new Error('Take ID is required');
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      const selected = await core?.request({
        method: 'take.select',
        params: {
          takeId,
          expectedRevisionId: summary.currentRevisionId,
          authorId: 'user_local',
        },
      });
      if (typeof selected !== 'object' || selected === null || !('shot' in selected)) {
        throw new Error('Core returned an invalid Take selection');
      }
      return {
        shot: movieEntitySchema.parse(selected.shot),
        revisionId: String('revisionId' in selected ? selected.revisionId : ''),
        project: projectSummarySchema.parse(
          await core?.request({ method: 'project.get_summary', params: {} }),
        ),
        revisions: revisionRecordSchema
          .array()
          .parse(await core?.request({ method: 'revision.list', params: { limit: 100 } })),
      };
    });
    ipcMain.handle('openmovie:evaluation-list', async (_event, takeId: unknown) => {
      if (typeof takeId !== 'string') throw new Error('Take ID is required');
      return evaluationRecordSchema
        .array()
        .parse(await core?.request({ method: 'evaluation.list', params: { takeId } }));
    });
    ipcMain.handle('openmovie:task-list', async () =>
      taskSchema.array().parse(await core?.request({ method: 'task.list', params: {} })),
    );
    ipcMain.handle('openmovie:task-approve', async (_event, taskId: unknown) => {
      if (typeof taskId !== 'string') throw new Error('Task ID is required');
      const task = taskSchema.parse(
        await core?.request({ method: 'task.approve', params: { taskId } }, 60_000),
      );
      return {
        task,
        project: projectSummarySchema.parse(
          await core?.request({ method: 'project.get_summary', params: {} }),
        ),
        revisions: revisionRecordSchema
          .array()
          .parse(await core?.request({ method: 'revision.list', params: { limit: 100 } })),
      };
    });
    ipcMain.handle(
      'openmovie:task-events',
      async (_event, taskId: unknown, afterSequence: unknown) => {
        if (typeof taskId !== 'string') throw new Error('Task ID is required');
        const sequence = typeof afterSequence === 'number' ? afterSequence : 0;
        return taskEventSchema.array().parse(
          await core?.request({
            method: 'task.events',
            params: { taskId, afterSequence: sequence },
          }),
        );
      },
    );
    ipcMain.handle('openmovie:secret-list', () => secrets?.list() ?? []);
    ipcMain.handle(
      'openmovie:secret-set',
      async (_event, id: unknown, label: unknown, value: unknown) => {
        if (typeof id !== 'string' || typeof label !== 'string' || typeof value !== 'string') {
          throw new Error('Invalid secret input');
        }
        if (!secrets) throw new Error('Secret Store is unavailable');
        return secrets.set(id, label, value);
      },
    );
    ipcMain.handle('openmovie:secret-delete', (_event, id: unknown) => {
      if (typeof id !== 'string') throw new Error('Invalid secret ID');
      return secrets?.delete(id) ?? false;
    });
    ipcMain.handle('openmovie:provider-list', () => secrets?.listProviderProfiles() ?? []);
    ipcMain.handle('openmovie:provider-save', async (_event, value: unknown) => {
      if (typeof value !== 'object' || value === null) throw new Error('Invalid provider profile');
      const input = value as Record<string, unknown>;
      const required = ['id', 'label', 'baseUrl', 'protocol', 'model', 'apiKey'] as const;
      if (required.some((key) => typeof input[key] !== 'string')) {
        throw new Error('Provider profile fields must be strings');
      }
      if (!secrets) throw new Error('Secret Store is unavailable');
      const id = String(input.id);
      const secretId = `provider.${id}`;
      if (String(input.apiKey))
        await secrets.set(secretId, String(input.label), String(input.apiKey));
      const protocol = String(input.protocol);
      if (protocol !== 'openai_chat' && protocol !== 'openai_responses' && protocol !== 'custom') {
        throw new Error('Unsupported provider protocol');
      }
      return secrets.setProviderProfile({
        id,
        label: String(input.label),
        baseUrl: String(input.baseUrl),
        protocol,
        model: String(input.model),
        secretId,
      });
    });

    await initialize();
    if (process.env.OPENMOVIE_SMOKE_TEST === '1') {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'openmovie-desktop-smoke-'));
      const projectRoot = join(temporaryRoot, 'movie');
      try {
        const created = projectSummarySchema.parse(
          await core.request({
            method: 'project.create',
            params: { path: projectRoot, title: 'Desktop Smoke Test' },
          }),
        );
        revisionRecordSchema.parse(
          await core.request({
            method: 'revision.commit',
            params: {
              expectedRevisionId: created.currentRevisionId,
              authorType: 'system',
              authorId: 'smoke_test',
              message: 'Verify project workflow',
              patch: [{ op: 'replace', path: '/project/title', value: 'Smoke Test Passed' }],
            },
          }),
        );
        const afterRename = projectSummarySchema.parse(
          await core.request({ method: 'project.get_summary', params: {} }),
        );
        const sceneCommit = parseEntityCommit(
          await core.request({
            method: 'movie.scene_create',
            params: {
              title: 'Opening',
              expectedRevisionId: afterRename.currentRevisionId,
              authorId: 'smoke_test',
            },
          }),
        ) as { entity: { id: string }; revision: { id: string } };
        const shotCommit = parseEntityCommit(
          await core.request({
            method: 'movie.shot_create',
            params: {
              sceneId: sceneCommit.entity.id,
              durationUs: 1_000_000,
              expectedRevisionId: sceneCommit.revision.id,
              authorId: 'smoke_test',
            },
          }),
        ) as { entity: { id: string }; revision: { id: string } };
        const smokeTask = taskSchema.parse(
          await core.request({
            method: 'task.create',
            params: {
              goal: 'Generate the opening frame',
              plannerProviderId: 'fake',
              plannerModel: 'fake-text-v1',
              requiresApproval: false,
              mediaKind: 'image',
              targetShotId: shotCommit.entity.id,
            },
          }),
        );
        const completedTask = taskSchema.parse(
          await core.request({ method: 'task.run', params: { taskId: smokeTask.id } }),
        );
        if (completedTask.status !== 'succeeded') {
          throw new Error(`Smoke task did not succeed: ${completedTask.status}`);
        }
        const takes = takeRecordSchema
          .array()
          .parse(
            await core.request({ method: 'take.list', params: { shotId: shotCommit.entity.id } }),
          );
        const firstTake = takes[0];
        if (!firstTake) throw new Error('Smoke task did not create a Take');
        evaluationRecordSchema
          .array()
          .parse(
            await core.request({ method: 'evaluation.list', params: { takeId: firstTake.id } }),
          );
        await core.request({ method: 'project.close', params: {} });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
    createWindow();
    if (process.env.OPENMOVIE_SMOKE_TEST === '1') {
      const timeout = setTimeout(() => {
        process.stderr.write('[desktop] Smoke test failed: renderer bridge timed out\n');
        process.exitCode = 1;
        app.quit();
      }, 10_000);
      ipcMain.once('openmovie:renderer-ready', () => {
        clearTimeout(timeout);
        process.stdout.write('[desktop] Smoke test passed\n');
        app.quit();
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `[desktop] Startup failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  secrets?.close();
  secrets = undefined;
  core?.stop();
});
