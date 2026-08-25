import type {
  CoreHealth,
  BranchRecord,
  HarnessHealth,
  InitializeResult,
  ProjectSummary,
  RevisionRecord,
  Task,
  TaskEvent,
} from '@openmovie/contracts';
import type { Character, MovieEntity, Scene, Shot } from '@openmovie/movie-ir';
import { contextBridge, ipcRenderer } from 'electron';

export type OpenMovieDesktopApi = {
  initialize: () => Promise<InitializeResult>;
  coreHealth: () => Promise<CoreHealth>;
  reportReady: () => void;
  createProject: (title: string) => Promise<ProjectSummary | null>;
  openProject: () => Promise<ProjectSummary | null>;
  getProjectSummary: () => Promise<ProjectSummary>;
  renameProject: (title: string) => Promise<ProjectSummary>;
  listRevisions: () => Promise<RevisionRecord[]>;
  restoreRevision: (revisionId: string) => Promise<ProjectSummary>;
  listBranches: () => Promise<BranchRecord[]>;
  createBranch: (name: string) => Promise<BranchRecord>;
  switchBranch: (name: string) => Promise<BranchSwitchResult>;
  listEntities: (kind: 'character' | 'scene' | 'shot') => Promise<MovieEntity[]>;
  createCharacter: (name: string, appearance?: string) => Promise<EntityCommitResult<Character>>;
  createScene: (title: string, storyGoal?: string) => Promise<EntityCommitResult<Scene>>;
  createShot: (
    sceneId: string,
    durationUs: number,
    framing?: string,
    movement?: string,
  ) => Promise<EntityCommitResult<Shot>>;
  runTask: (
    goal: string,
    plannerProviderId?: string,
    requiresApproval?: boolean,
  ) => Promise<TaskRunResult>;
  listTasks: () => Promise<Task[]>;
  approveTask: (taskId: string) => Promise<TaskRunResult>;
  listTaskEvents: (taskId: string, afterSequence?: number) => Promise<TaskEvent[]>;
  listSecrets: () => Promise<SecretMetadata[]>;
  setSecret: (id: string, label: string, value: string) => Promise<SecretMetadata>;
  deleteSecret: (id: string) => Promise<boolean>;
  listHarnesses: () => Promise<HarnessHealth[]>;
  listProviders: () => Promise<ProviderProfile[]>;
  saveProvider: (input: SaveProviderInput) => Promise<ProviderProfile>;
};

export type TaskRunResult = {
  task: Task;
  project: ProjectSummary;
  revisions: RevisionRecord[];
};

export type EntityCommitResult<T extends MovieEntity> = {
  entity: T;
  revision: RevisionRecord;
};

export type BranchSwitchResult = {
  branch: BranchRecord;
  project: ProjectSummary;
  revisions: RevisionRecord[];
};

export type SecretMetadata = {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderProfile = {
  id: string;
  label: string;
  baseUrl: string;
  protocol: 'openai_chat' | 'openai_responses' | 'custom';
  model: string;
  secretId: string;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SaveProviderInput = Pick<
  ProviderProfile,
  'id' | 'label' | 'baseUrl' | 'protocol' | 'model'
> & { apiKey: string };

const api: OpenMovieDesktopApi = {
  initialize: () => ipcRenderer.invoke('openmovie:initialize') as Promise<InitializeResult>,
  coreHealth: () => ipcRenderer.invoke('openmovie:core-health') as Promise<CoreHealth>,
  reportReady: () => ipcRenderer.send('openmovie:renderer-ready'),
  createProject: (title) =>
    ipcRenderer.invoke('openmovie:project-create', title) as Promise<ProjectSummary | null>,
  openProject: () => ipcRenderer.invoke('openmovie:project-open') as Promise<ProjectSummary | null>,
  getProjectSummary: () =>
    ipcRenderer.invoke('openmovie:project-summary') as Promise<ProjectSummary>,
  renameProject: (title) =>
    ipcRenderer.invoke('openmovie:project-rename', title) as Promise<ProjectSummary>,
  listRevisions: () => ipcRenderer.invoke('openmovie:revision-list') as Promise<RevisionRecord[]>,
  restoreRevision: (revisionId) =>
    ipcRenderer.invoke('openmovie:revision-restore', revisionId) as Promise<ProjectSummary>,
  listBranches: () => ipcRenderer.invoke('openmovie:branch-list') as Promise<BranchRecord[]>,
  createBranch: (name) =>
    ipcRenderer.invoke('openmovie:branch-create', name) as Promise<BranchRecord>,
  switchBranch: (name) =>
    ipcRenderer.invoke('openmovie:branch-switch', name) as Promise<BranchSwitchResult>,
  listEntities: (kind) =>
    ipcRenderer.invoke('openmovie:entity-list', kind) as Promise<MovieEntity[]>,
  createCharacter: (name, appearance) =>
    ipcRenderer.invoke('openmovie:character-create', name, appearance) as Promise<
      EntityCommitResult<Character>
    >,
  createScene: (title, storyGoal) =>
    ipcRenderer.invoke('openmovie:scene-create', title, storyGoal) as Promise<
      EntityCommitResult<Scene>
    >,
  createShot: (sceneId, durationUs, framing, movement) =>
    ipcRenderer.invoke('openmovie:shot-create', sceneId, durationUs, framing, movement) as Promise<
      EntityCommitResult<Shot>
    >,
  runTask: (goal, plannerProviderId, requiresApproval) =>
    ipcRenderer.invoke(
      'openmovie:task-run',
      goal,
      plannerProviderId,
      requiresApproval,
    ) as Promise<TaskRunResult>,
  listTasks: () => ipcRenderer.invoke('openmovie:task-list') as Promise<Task[]>,
  approveTask: (taskId) =>
    ipcRenderer.invoke('openmovie:task-approve', taskId) as Promise<TaskRunResult>,
  listTaskEvents: (taskId, afterSequence) =>
    ipcRenderer.invoke('openmovie:task-events', taskId, afterSequence) as Promise<TaskEvent[]>,
  listSecrets: () => ipcRenderer.invoke('openmovie:secret-list') as Promise<SecretMetadata[]>,
  setSecret: (id, label, value) =>
    ipcRenderer.invoke('openmovie:secret-set', id, label, value) as Promise<SecretMetadata>,
  deleteSecret: (id) => ipcRenderer.invoke('openmovie:secret-delete', id) as Promise<boolean>,
  listHarnesses: () => ipcRenderer.invoke('openmovie:harness-list') as Promise<HarnessHealth[]>,
  listProviders: () => ipcRenderer.invoke('openmovie:provider-list') as Promise<ProviderProfile[]>,
  saveProvider: (input) =>
    ipcRenderer.invoke('openmovie:provider-save', input) as Promise<ProviderProfile>,
};

contextBridge.exposeInMainWorld('openMovie', api);
