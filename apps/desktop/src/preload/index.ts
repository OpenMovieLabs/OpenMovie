import type {
  CoreHealth,
  HarnessHealth,
  InitializeResult,
  ProjectSummary,
  RevisionRecord,
  Task,
} from '@openmovie/contracts';
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
  runTask: (goal: string, plannerProviderId?: string) => Promise<TaskRunResult>;
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
  runTask: (goal, plannerProviderId) =>
    ipcRenderer.invoke('openmovie:task-run', goal, plannerProviderId) as Promise<TaskRunResult>,
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
