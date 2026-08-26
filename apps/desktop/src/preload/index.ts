import type {
  CoreHealth,
  AnalysisRecord,
  DoctorReport,
  FileDiff,
  HarnessHealth,
  InitializeResult,
  ProjectSummary,
  ProviderUsageSummary,
  StorageReport,
  RevisionRecord,
  RevisionProposalRecord,
  RevisionDiff,
  Task,
  TaskEvent,
  TakeRecord,
  EvaluationRecord,
  FeedbackRecord,
  TimelineRenderRecord,
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
  getUpdateStatus: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<boolean>;
  reportReady: () => void;
  createProject: (title: string) => Promise<ProjectSummary | null>;
  openProject: () => Promise<ProjectSummary | null>;
  openRecentProject: (path: string) => Promise<ProjectSummary>;
  listRecentProjects: () => Promise<RecentProject[]>;
  getProjectSummary: () => Promise<ProjectSummary>;
  runDoctor: (deep?: boolean) => Promise<DoctorReport>;
  getStorageReport: () => Promise<StorageReport>;
  cleanProjectCache: () => Promise<StorageReport>;
  updateProjectPolicies: (
    monthlyBudgetUsdMicros: number | null,
    remoteMediaPolicy: 'allow' | 'confirm' | 'deny',
  ) => Promise<ProjectSummary>;
  renameProject: (title: string) => Promise<ProjectSummary>;
  listRevisions: () => Promise<RevisionRecord[]>;
  restoreRevision: (revisionId: string) => Promise<ProjectSummary>;
  getRevisionDiff: (revisionId: string) => Promise<RevisionDiff>;
  getWorkingChanges: () => Promise<FileDiff[]>;
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
  renderTimeline: () => Promise<Task>;
  listTimelineRenders: () => Promise<TimelineRenderRecord[]>;
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
    timeRangeUs?: { startUs: number; endUs: number },
  ) => Promise<FeedbackRecord>;
  listAnalyses: (takeId: string) => Promise<AnalysisRecord[]>;
  analyzeTake: (takeId: string, providerId: string, prompt: string) => Promise<Task>;
  listProposals: () => Promise<RevisionProposalRecord[]>;
  acceptProposal: (proposalId: string) => Promise<RevisionProposalRecord>;
  rejectProposal: (proposalId: string) => Promise<RevisionProposalRecord>;
  runTask: (
    goal: string,
    plannerProviderId?: string,
    requiresApproval?: boolean,
    targetShotId?: string,
    mediaKind?: 'image' | 'video',
    mediaProviderId?: string,
    feedbackId?: string,
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
  getProviderUsage: () => Promise<ProviderUsageSummary>;
  saveProvider: (input: SaveProviderInput) => Promise<ProviderProfile>;
  testProvider: (providerId: string) => Promise<ProviderProbe>;
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
  protocol:
    'openai_chat' | 'openai_responses' | 'openai_images' | 'http_video_jobs' | 'custom' | 'plugin';
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

export type ProviderProbe = {
  profileId: string;
  status: 'ready' | 'error';
  latencyMs: number;
  checkedAt: string;
  message: string;
  capabilities: string[];
  modelVisible?: boolean;
};

export type DesktopUpdateState = {
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'not_available'
    | 'error';
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  checkedAt?: string;
  message: string;
};

const api: OpenMovieDesktopApi = {
  initialize: () => ipcRenderer.invoke('openmovie:initialize') as Promise<InitializeResult>,
  coreHealth: () => ipcRenderer.invoke('openmovie:core-health') as Promise<CoreHealth>,
  getUpdateStatus: () =>
    ipcRenderer.invoke('openmovie:update-status') as Promise<DesktopUpdateState>,
  checkForUpdates: () =>
    ipcRenderer.invoke('openmovie:update-check') as Promise<DesktopUpdateState>,
  installUpdate: () => ipcRenderer.invoke('openmovie:update-install') as Promise<boolean>,
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
  getStorageReport: () =>
    ipcRenderer.invoke('openmovie:project-storage-report') as Promise<StorageReport>,
  cleanProjectCache: () =>
    ipcRenderer.invoke('openmovie:project-storage-clean') as Promise<StorageReport>,
  updateProjectPolicies: (monthlyBudgetUsdMicros, remoteMediaPolicy) =>
    ipcRenderer.invoke(
      'openmovie:project-policy-update',
      monthlyBudgetUsdMicros,
      remoteMediaPolicy,
    ) as Promise<ProjectSummary>,
  renameProject: (title) =>
    ipcRenderer.invoke('openmovie:project-rename', title) as Promise<ProjectSummary>,
  listRevisions: () => ipcRenderer.invoke('openmovie:revision-list') as Promise<RevisionRecord[]>,
  restoreRevision: (revisionId) =>
    ipcRenderer.invoke('openmovie:revision-restore', revisionId) as Promise<ProjectSummary>,
  getRevisionDiff: (revisionId) =>
    ipcRenderer.invoke('openmovie:revision-diff', revisionId) as Promise<RevisionDiff>,
  getWorkingChanges: () => ipcRenderer.invoke('openmovie:working-changes') as Promise<FileDiff[]>,
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
  renderTimeline: () => ipcRenderer.invoke('openmovie:timeline-render') as Promise<Task>,
  listTimelineRenders: () =>
    ipcRenderer.invoke('openmovie:timeline-render-list') as Promise<TimelineRenderRecord[]>,
  listTakes: (shotId) => ipcRenderer.invoke('openmovie:take-list', shotId) as Promise<TakeRecord[]>,
  selectTake: (takeId) =>
    ipcRenderer.invoke('openmovie:take-select', takeId) as Promise<TakeSelectionResult>,
  listEvaluations: (takeId) =>
    ipcRenderer.invoke('openmovie:evaluation-list', takeId) as Promise<EvaluationRecord[]>,
  listFeedback: (targetType, targetId, status) =>
    ipcRenderer.invoke('openmovie:feedback-list', targetType, targetId, status) as Promise<
      FeedbackRecord[]
    >,
  createFeedback: (targetType, targetId, body, timeRangeUs) =>
    ipcRenderer.invoke(
      'openmovie:feedback-create',
      targetType,
      targetId,
      body,
      timeRangeUs,
    ) as Promise<FeedbackRecord>,
  listAnalyses: (takeId) =>
    ipcRenderer.invoke('openmovie:analysis-list', takeId) as Promise<AnalysisRecord[]>,
  analyzeTake: (takeId, providerId, prompt) =>
    ipcRenderer.invoke('openmovie:analysis-run', takeId, providerId, prompt) as Promise<Task>,
  listProposals: () =>
    ipcRenderer.invoke('openmovie:proposal-list') as Promise<RevisionProposalRecord[]>,
  acceptProposal: (proposalId) =>
    ipcRenderer.invoke('openmovie:proposal-accept', proposalId) as Promise<RevisionProposalRecord>,
  rejectProposal: (proposalId) =>
    ipcRenderer.invoke('openmovie:proposal-reject', proposalId) as Promise<RevisionProposalRecord>,
  runTask: (
    goal,
    plannerProviderId,
    requiresApproval,
    targetShotId,
    mediaKind,
    mediaProviderId,
    feedbackId,
  ) =>
    ipcRenderer.invoke(
      'openmovie:task-run',
      goal,
      plannerProviderId,
      requiresApproval,
      targetShotId,
      mediaKind,
      mediaProviderId,
      feedbackId,
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
  getProviderUsage: () =>
    ipcRenderer.invoke('openmovie:provider-usage-summary') as Promise<ProviderUsageSummary>,
  saveProvider: (input) =>
    ipcRenderer.invoke('openmovie:provider-save', input) as Promise<ProviderProfile>,
  testProvider: (providerId) =>
    ipcRenderer.invoke('openmovie:provider-test', providerId) as Promise<ProviderProbe>,
};

contextBridge.exposeInMainWorld('openMovie', api);
