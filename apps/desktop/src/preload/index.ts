import type {
  CoreHealth,
  AnalysisRecord,
  DoctorReport,
  BranchRecord,
  FileDiff,
  HarnessHealth,
  InitializeResult,
  ProjectSummary,
  RevisionRecord,
  RevisionDiff,
  Task,
  TaskEvent,
  TakeRecord,
  EvaluationRecord,
  FeedbackRecord,
} from '@openmovie/contracts';
import type {
  Brief,
  Character,
  MovieEntity,
  Scene,
  Screenplay,
  Shot,
  StoryBible,
  Timeline,
} from '@openmovie/movie-ir';
import { contextBridge, ipcRenderer } from 'electron';

export type OpenMovieDesktopApi = {
  initialize: () => Promise<InitializeResult>;
  coreHealth: () => Promise<CoreHealth>;
  reportReady: () => void;
  createProject: (title: string) => Promise<ProjectSummary | null>;
  openProject: () => Promise<ProjectSummary | null>;
  openRecentProject: (path: string) => Promise<ProjectSummary>;
  listRecentProjects: () => Promise<RecentProject[]>;
  getProjectSummary: () => Promise<ProjectSummary>;
  runDoctor: (deep?: boolean) => Promise<DoctorReport>;
  renameProject: (title: string) => Promise<ProjectSummary>;
  listRevisions: () => Promise<RevisionRecord[]>;
  restoreRevision: (revisionId: string) => Promise<ProjectSummary>;
  getRevisionDiff: (revisionId: string) => Promise<RevisionDiff>;
  getWorkingChanges: () => Promise<FileDiff[]>;
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
  getStory: () => Promise<StoryDocuments>;
  updateStory: (input: StoryUpdateInput) => Promise<StoryUpdateResult>;
  getTimeline: () => Promise<Timeline>;
  assembleTimeline: () => Promise<TimelineUpdateResult>;
  listTakes: (shotId: string) => Promise<TakeRecord[]>;
  selectTake: (takeId: string) => Promise<TakeSelectionResult>;
  listEvaluations: (takeId: string) => Promise<EvaluationRecord[]>;
  listFeedback: (
    targetType: FeedbackRecord['targetType'],
    targetId: string,
    status?: FeedbackRecord['status'],
  ) => Promise<FeedbackRecord[]>;
  createFeedback: (
    targetType: FeedbackRecord['targetType'],
    targetId: string,
    body: string,
  ) => Promise<FeedbackRecord>;
  listAnalyses: (takeId: string) => Promise<AnalysisRecord[]>;
  analyzeTake: (takeId: string, providerId: string, prompt: string) => Promise<Task>;
  runTask: (
    goal: string,
    plannerProviderId?: string,
    requiresApproval?: boolean,
    targetShotId?: string,
    mediaKind?: 'image' | 'video',
    mediaProviderId?: string,
  ) => Promise<TaskRunResult>;
  listTasks: () => Promise<Task[]>;
  cancelTask: (taskId: string) => Promise<Task>;
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

export type TakeSelectionResult = {
  shot: Shot;
  revisionId: string;
  project: ProjectSummary;
  revisions: RevisionRecord[];
};

export type StoryDocuments = { brief: Brief; bible: StoryBible; screenplay: Screenplay };
export type StoryUpdateInput = Pick<Brief, 'premise'> &
  Pick<StoryBible, 'themes' | 'world' | 'rules'>;
export type StoryUpdateResult = Pick<StoryDocuments, 'brief' | 'bible'> & {
  revision: RevisionRecord;
};
export type TimelineUpdateResult = { timeline: Timeline; revision: RevisionRecord };

export type SecretMetadata = {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type RecentProject = { path: string; title: string; lastOpenedAt: string };

export type ProviderProfile = {
  id: string;
  label: string;
  baseUrl: string;
  protocol: 'openai_chat' | 'openai_responses' | 'openai_images' | 'http_video_jobs' | 'custom';
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
  openRecentProject: (path) =>
    ipcRenderer.invoke('openmovie:project-open-recent', path) as Promise<ProjectSummary>,
  listRecentProjects: () =>
    ipcRenderer.invoke('openmovie:project-recent-list') as Promise<RecentProject[]>,
  getProjectSummary: () =>
    ipcRenderer.invoke('openmovie:project-summary') as Promise<ProjectSummary>,
  runDoctor: (deep) =>
    ipcRenderer.invoke('openmovie:project-doctor', deep) as Promise<DoctorReport>,
  renameProject: (title) =>
    ipcRenderer.invoke('openmovie:project-rename', title) as Promise<ProjectSummary>,
  listRevisions: () => ipcRenderer.invoke('openmovie:revision-list') as Promise<RevisionRecord[]>,
  restoreRevision: (revisionId) =>
    ipcRenderer.invoke('openmovie:revision-restore', revisionId) as Promise<ProjectSummary>,
  getRevisionDiff: (revisionId) =>
    ipcRenderer.invoke('openmovie:revision-diff', revisionId) as Promise<RevisionDiff>,
  getWorkingChanges: () => ipcRenderer.invoke('openmovie:working-changes') as Promise<FileDiff[]>,
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
  getStory: () => ipcRenderer.invoke('openmovie:story-get') as Promise<StoryDocuments>,
  updateStory: (input) =>
    ipcRenderer.invoke('openmovie:story-update', input) as Promise<StoryUpdateResult>,
  getTimeline: () => ipcRenderer.invoke('openmovie:timeline-get') as Promise<Timeline>,
  assembleTimeline: () =>
    ipcRenderer.invoke('openmovie:timeline-assemble') as Promise<TimelineUpdateResult>,
  listTakes: (shotId) => ipcRenderer.invoke('openmovie:take-list', shotId) as Promise<TakeRecord[]>,
  selectTake: (takeId) =>
    ipcRenderer.invoke('openmovie:take-select', takeId) as Promise<TakeSelectionResult>,
  listEvaluations: (takeId) =>
    ipcRenderer.invoke('openmovie:evaluation-list', takeId) as Promise<EvaluationRecord[]>,
  listFeedback: (targetType, targetId, status) =>
    ipcRenderer.invoke('openmovie:feedback-list', targetType, targetId, status) as Promise<
      FeedbackRecord[]
    >,
  createFeedback: (targetType, targetId, body) =>
    ipcRenderer.invoke(
      'openmovie:feedback-create',
      targetType,
      targetId,
      body,
    ) as Promise<FeedbackRecord>,
  listAnalyses: (takeId) =>
    ipcRenderer.invoke('openmovie:analysis-list', takeId) as Promise<AnalysisRecord[]>,
  analyzeTake: (takeId, providerId, prompt) =>
    ipcRenderer.invoke('openmovie:analysis-run', takeId, providerId, prompt) as Promise<Task>,
  runTask: (goal, plannerProviderId, requiresApproval, targetShotId, mediaKind, mediaProviderId) =>
    ipcRenderer.invoke(
      'openmovie:task-run',
      goal,
      plannerProviderId,
      requiresApproval,
      targetShotId,
      mediaKind,
      mediaProviderId,
    ) as Promise<TaskRunResult>,
  listTasks: () => ipcRenderer.invoke('openmovie:task-list') as Promise<Task[]>,
  cancelTask: (taskId) => ipcRenderer.invoke('openmovie:task-cancel', taskId) as Promise<Task>,
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
