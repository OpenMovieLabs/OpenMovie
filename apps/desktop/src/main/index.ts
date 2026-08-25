import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PROTOCOL_VERSION,
  analysisRecordSchema,
  branchRecordSchema,
  coreHealthSchema,
  doctorReportSchema,
  fileDiffSchema,
  feedbackRecordSchema,
  evaluationRecordSchema,
  harnessHealthSchema,
  initializeResultSchema,
  projectSummarySchema,
  revisionRecordSchema,
  revisionDiffSchema,
  revisionProposalRecordSchema,
  taskSchema,
  taskEventSchema,
  takeRecordSchema,
  timelineRenderRecordSchema,
} from '@openmovie/contracts';
import {
  briefSchema,
  movieEntitySchema,
  screenplaySchema,
  storyBibleSchema,
  timelineSchema,
} from '@openmovie/movie-ir';
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';

import { CoreClient } from './core-client.js';
import { probeProvider } from './provider-probe.js';
import { EncryptedSecretStore } from './secret-store.js';

let core: CoreClient | undefined;
let secrets: EncryptedSecretStore | undefined;
let activeProjectRoot: string | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'openmovie-artifact',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

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
    protocol.handle('openmovie-artifact', (request) => {
      if (!activeProjectRoot) return new Response('No project is open', { status: 404 });
      const url = new URL(request.url);
      const digest = url.hostname === 'sha256' ? url.pathname.slice(1) : '';
      if (!/^[a-f0-9]{64}$/.test(digest)) {
        return new Response('Invalid artifact URI', { status: 400 });
      }
      const path = join(
        activeProjectRoot,
        '.openmovie',
        'objects',
        'sha256',
        digest.slice(0, 2),
        digest,
      );
      return net.fetch(pathToFileURL(path).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true,
      });
    });
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
      const created = projectSummarySchema.parse(
        await core?.request({
          method: 'project.create',
          params: { path: selection.filePath, title: title.trim() },
        }),
      );
      activeProjectRoot = created.root;
      secrets?.rememberProject(created.root, created.title);
      return created;
    });
    ipcMain.handle('openmovie:project-open', async () => {
      const selection = await dialog.showOpenDialog({
        title: 'Open OpenMovie Project',
        properties: ['openDirectory'],
      });
      const path = selection.filePaths[0];
      if (selection.canceled || !path) return null;
      const opened = projectSummarySchema.parse(
        await core?.request({ method: 'project.open', params: { path, takeoverStaleLock: false } }),
      );
      activeProjectRoot = opened.root;
      secrets?.rememberProject(opened.root, opened.title);
      return opened;
    });
    ipcMain.handle('openmovie:project-recent-list', () => secrets?.listRecentProjects() ?? []);
    ipcMain.handle('openmovie:project-open-recent', async (_event, path: unknown) => {
      if (typeof path !== 'string') throw new Error('Project path is required');
      if (!secrets?.listRecentProjects().some((item) => item.path === path)) {
        throw new Error('Project is not in Recent Projects');
      }
      try {
        const opened = projectSummarySchema.parse(
          await core?.request({
            method: 'project.open',
            params: { path, takeoverStaleLock: false },
          }),
        );
        activeProjectRoot = opened.root;
        secrets.rememberProject(opened.root, opened.title);
        return opened;
      } catch (error) {
        secrets.forgetProject(path);
        throw error;
      }
    });
    ipcMain.handle('openmovie:project-summary', async () =>
      projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      ),
    );
    ipcMain.handle('openmovie:project-doctor', async (_event, deep: unknown) =>
      doctorReportSchema.parse(
        await core?.request({ method: 'project.doctor', params: { deep: deep === true } }),
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
      const renamed = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      secrets?.rememberProject(renamed.root, renamed.title);
      return renamed;
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
    ipcMain.handle('openmovie:story-get', async () => {
      const value = await core?.request({ method: 'story.get', params: {} });
      if (typeof value !== 'object' || value === null) throw new Error('Invalid Story response');
      return {
        brief: briefSchema.parse('brief' in value ? value.brief : undefined),
        bible: storyBibleSchema.parse('bible' in value ? value.bible : undefined),
        screenplay: screenplaySchema.parse('screenplay' in value ? value.screenplay : undefined),
      };
    });
    ipcMain.handle('openmovie:story-update', async (_event, raw: unknown) => {
      if (typeof raw !== 'object' || raw === null) throw new Error('Invalid Story update');
      const input = raw as Record<string, unknown>;
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      const value = await core?.request({
        method: 'story.update',
        params: {
          premise: typeof input.premise === 'string' ? input.premise : '',
          themes: Array.isArray(input.themes)
            ? input.themes.filter((item): item is string => typeof item === 'string')
            : [],
          world: typeof input.world === 'string' ? input.world : '',
          rules: Array.isArray(input.rules)
            ? input.rules.filter((item): item is string => typeof item === 'string')
            : [],
          expectedRevisionId: summary.currentRevisionId,
          authorId: 'user_local',
        },
      });
      if (typeof value !== 'object' || value === null) throw new Error('Invalid Story response');
      return {
        brief: briefSchema.parse('brief' in value ? value.brief : undefined),
        bible: storyBibleSchema.parse('bible' in value ? value.bible : undefined),
        revision: revisionRecordSchema.parse('revision' in value ? value.revision : undefined),
      };
    });
    ipcMain.handle('openmovie:timeline-get', async () =>
      timelineSchema.parse(await core?.request({ method: 'timeline.get', params: {} })),
    );
    ipcMain.handle('openmovie:timeline-assemble', async () => {
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      const value = await core?.request({
        method: 'timeline.assemble',
        params: { expectedRevisionId: summary.currentRevisionId, authorId: 'user_local' },
      });
      if (typeof value !== 'object' || value === null) throw new Error('Invalid Timeline response');
      return {
        timeline: timelineSchema.parse('timeline' in value ? value.timeline : undefined),
        revision: revisionRecordSchema.parse('revision' in value ? value.revision : undefined),
      };
    });
    ipcMain.handle('openmovie:timeline-render-list', async () =>
      timelineRenderRecordSchema
        .array()
        .parse(await core?.request({ method: 'timeline.render_list', params: {} })),
    );
    ipcMain.handle('openmovie:timeline-render', async () => {
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      if (!summary.currentRevisionId) throw new Error('Project has no current Revision');
      const task = taskSchema.parse(
        await core?.request({
          method: 'timeline.render_create_task',
          params: { sourceRevisionId: summary.currentRevisionId },
        }),
      );
      void core
        ?.request({ method: 'task.run', params: { taskId: task.id } }, 60 * 60_000)
        .catch((error: unknown) => {
          process.stderr.write(
            `[render] Background render failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        });
      return task;
    });
    ipcMain.handle(
      'openmovie:task-run',
      async (
        _event,
        goal: unknown,
        plannerProviderId: unknown,
        requiresApproval: unknown,
        targetShotId: unknown,
        mediaKind: unknown,
        mediaProviderId: unknown,
        feedbackId: unknown,
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
            params: {
              id: profile.id,
              baseUrl: profile.baseUrl,
              apiKey,
              imageGeneration: false,
            },
          });
          providerId = profile.id;
          model = profile.model;
        }
        let selectedMediaProviderId = 'fake';
        let selectedMediaModel = mediaKind === 'video' ? 'fake-video-v1' : 'fake-image-v1';
        if (typeof mediaProviderId === 'string' && mediaProviderId !== 'fake') {
          if (!secrets) throw new Error('Secret Store is unavailable');
          const profile = secrets
            .listProviderProfiles()
            .find((item) => item.id === mediaProviderId);
          if (!profile) throw new Error(`Media Provider profile not found: ${mediaProviderId}`);
          const apiKey = await secrets.get(profile.secretId);
          if (mediaKind === 'video') {
            if (profile.protocol !== 'http_video_jobs') {
              throw new Error('Selected Provider does not support asynchronous video jobs');
            }
            await core?.request({
              method: 'provider.configure_http_video',
              params: { id: profile.id, baseUrl: profile.baseUrl, apiKey, path: 'videos' },
            });
          } else {
            if (profile.protocol !== 'openai_images') {
              throw new Error(
                'Selected Provider does not support OpenAI-compatible image generation',
              );
            }
            await core?.request({
              method: 'provider.configure_openai_compatible',
              params: {
                id: profile.id,
                baseUrl: profile.baseUrl,
                apiKey,
                imageGeneration: true,
              },
            });
          }
          selectedMediaProviderId = profile.id;
          selectedMediaModel = profile.model;
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
              mediaProviderId: selectedMediaProviderId,
              mediaModel: selectedMediaModel,
              ...(typeof targetShotId === 'string' && targetShotId ? { targetShotId } : {}),
              ...(typeof feedbackId === 'string' && feedbackId ? { feedbackId } : {}),
            },
          }),
        );
        void core
          ?.request({ method: 'task.run', params: { taskId: created.id } }, 15 * 60_000)
          .catch((error: unknown) => {
            process.stderr.write(
              `[task] Background task failed: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          });
        return {
          task: created,
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
    ipcMain.handle(
      'openmovie:feedback-list',
      async (_event, targetType: unknown, targetId: unknown, status: unknown) => {
        if (
          !['project', 'scene', 'shot', 'take', 'revision'].includes(String(targetType)) ||
          typeof targetId !== 'string'
        ) {
          throw new Error('Invalid Feedback target');
        }
        if (status !== undefined && status !== 'open' && status !== 'resolved') {
          throw new Error('Invalid Feedback status');
        }
        return feedbackRecordSchema.array().parse(
          await core?.request({
            method: 'feedback.list',
            params: {
              targetType: targetType as 'project' | 'scene' | 'shot' | 'take' | 'revision',
              targetId,
              ...(status ? { status } : {}),
            },
          }),
        );
      },
    );
    ipcMain.handle(
      'openmovie:feedback-create',
      async (_event, targetType: unknown, targetId: unknown, body: unknown) => {
        if (
          !['project', 'scene', 'shot', 'take', 'revision'].includes(String(targetType)) ||
          typeof targetId !== 'string' ||
          typeof body !== 'string' ||
          !body.trim()
        ) {
          throw new Error('Invalid Feedback input');
        }
        return feedbackRecordSchema.parse(
          await core?.request({
            method: 'feedback.create',
            params: {
              targetType: targetType as 'project' | 'scene' | 'shot' | 'take' | 'revision',
              targetId,
              body: body.trim(),
              authorId: 'user_local',
            },
          }),
        );
      },
    );
    ipcMain.handle('openmovie:analysis-list', async (_event, takeId: unknown) => {
      if (typeof takeId !== 'string') throw new Error('Take ID is required');
      return analysisRecordSchema
        .array()
        .parse(await core?.request({ method: 'analysis.list', params: { takeId } }));
    });
    ipcMain.handle(
      'openmovie:analysis-run',
      async (_event, takeId: unknown, providerProfileId: unknown, prompt: unknown) => {
        if (typeof takeId !== 'string' || typeof prompt !== 'string' || !prompt.trim()) {
          throw new Error('Take and analysis prompt are required');
        }
        let providerId = 'fake';
        let model = 'fake-vision-v1';
        if (typeof providerProfileId === 'string' && providerProfileId !== 'fake') {
          if (!secrets) throw new Error('Secret Store is unavailable');
          const profile = secrets
            .listProviderProfiles()
            .find((item) => item.id === providerProfileId);
          if (!profile || profile.protocol !== 'openai_chat') {
            throw new Error('Analysis requires an OpenAI-compatible Chat / Vision Provider');
          }
          const apiKey = await secrets.get(profile.secretId);
          await core?.request({
            method: 'provider.configure_openai_compatible',
            params: {
              id: profile.id,
              baseUrl: profile.baseUrl,
              apiKey,
              imageGeneration: false,
            },
          });
          providerId = profile.id;
          model = profile.model;
        }
        const task = taskSchema.parse(
          await core?.request({
            method: 'analysis.create_task',
            params: { takeId, providerId, model, prompt: prompt.trim() },
          }),
        );
        void core
          ?.request({ method: 'task.run', params: { taskId: task.id } }, 15 * 60_000)
          .catch((error: unknown) => {
            process.stderr.write(
              `[analysis] Background analysis failed: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          });
        return task;
      },
    );
    ipcMain.handle('openmovie:proposal-list', async () =>
      revisionProposalRecordSchema
        .array()
        .parse(await core?.request({ method: 'proposal.list', params: {} })),
    );
    ipcMain.handle('openmovie:proposal-accept', async (_event, proposalId: unknown) => {
      if (typeof proposalId !== 'string') throw new Error('Proposal ID is required');
      const summary = projectSummarySchema.parse(
        await core?.request({ method: 'project.get_summary', params: {} }),
      );
      if (!summary.currentRevisionId) throw new Error('Project has no current Revision');
      return revisionProposalRecordSchema.parse(
        await core?.request({
          method: 'proposal.accept',
          params: { proposalId, expectedRevisionId: summary.currentRevisionId },
        }),
      );
    });
    ipcMain.handle('openmovie:proposal-reject', async (_event, proposalId: unknown) => {
      if (typeof proposalId !== 'string') throw new Error('Proposal ID is required');
      return revisionProposalRecordSchema.parse(
        await core?.request({ method: 'proposal.reject', params: { proposalId } }),
      );
    });
    ipcMain.handle('openmovie:task-list', async () =>
      taskSchema.array().parse(await core?.request({ method: 'task.list', params: {} })),
    );
    ipcMain.handle('openmovie:task-cancel', async (_event, taskId: unknown) => {
      if (typeof taskId !== 'string') throw new Error('Task ID is required');
      return taskSchema.parse(await core?.request({ method: 'task.cancel', params: { taskId } }));
    });
    ipcMain.handle('openmovie:task-approve', async (_event, taskId: unknown) => {
      if (typeof taskId !== 'string') throw new Error('Task ID is required');
      void core
        ?.request({ method: 'task.approve', params: { taskId } }, 15 * 60_000)
        .catch((error: unknown) => {
          process.stderr.write(
            `[task] Background approved task failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        });
      const task = taskSchema.parse(
        ((await core?.request({ method: 'task.list', params: {} })) as unknown[]).find(
          (item) => typeof item === 'object' && item !== null && 'id' in item && item.id === taskId,
        ),
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
      if (
        protocol !== 'openai_chat' &&
        protocol !== 'openai_responses' &&
        protocol !== 'openai_images' &&
        protocol !== 'http_video_jobs' &&
        protocol !== 'custom'
      ) {
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
    ipcMain.handle('openmovie:provider-test', async (_event, providerId: unknown) => {
      if (typeof providerId !== 'string') throw new Error('Provider ID is required');
      if (!secrets) throw new Error('Secret Store is unavailable');
      const profile = secrets.listProviderProfiles().find((item) => item.id === providerId);
      if (!profile) throw new Error('Provider profile not found');
      const apiKey = await secrets.get(profile.secretId);
      return probeProvider(profile, apiKey, (input, init) => net.fetch(input, init));
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
        activeProjectRoot = created.root;
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
              mediaProviderId: 'fake',
              mediaModel: 'fake-image-v1',
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
        const analysisTask = taskSchema.parse(
          await core.request({
            method: 'analysis.create_task',
            params: {
              takeId: firstTake.id,
              providerId: 'fake',
              model: 'fake-vision-v1',
              prompt: 'Verify the opening frame',
            },
          }),
        );
        const completedAnalysis = taskSchema.parse(
          await core.request({ method: 'task.run', params: { taskId: analysisTask.id } }),
        );
        if (completedAnalysis.status !== 'succeeded') {
          throw new Error(`Smoke analysis did not succeed: ${completedAnalysis.status}`);
        }
        analysisRecordSchema
          .array()
          .parse(await core.request({ method: 'analysis.list', params: { takeId: firstTake.id } }));
        const beforeSelection = projectSummarySchema.parse(
          await core.request({ method: 'project.get_summary', params: {} }),
        );
        await core.request({
          method: 'take.select',
          params: {
            takeId: firstTake.id,
            expectedRevisionId: beforeSelection.currentRevisionId,
            authorId: 'smoke_test',
          },
        });
        const beforeTimeline = projectSummarySchema.parse(
          await core.request({ method: 'project.get_summary', params: {} }),
        );
        await core.request({
          method: 'timeline.assemble',
          params: {
            expectedRevisionId: beforeTimeline.currentRevisionId,
            authorId: 'smoke_test',
          },
        });
        timelineRenderRecordSchema
          .array()
          .parse(await core.request({ method: 'timeline.render_list', params: {} }));
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
  activeProjectRoot = undefined;
  secrets?.close();
  secrets = undefined;
  core?.stop();
});
