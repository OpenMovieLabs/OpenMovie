import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Clapperboard,
  Clock3,
  FolderOpen,
  GitBranch,
  History,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';

import type {
  AnalysisRecord,
  BranchRecord,
  CoreHealth,
  DoctorReport,
  FeedbackRecord,
  FileDiff,
  HarnessHealth,
  InitializeResult,
  ProjectSummary,
  RevisionRecord,
  RevisionProposalRecord,
  RevisionDiff,
  StorageReport,
  Task,
  TakeRecord,
  EvaluationRecord,
  TimelineRenderRecord,
} from '@openmovie/contracts';
import type { Character, Scene, Shot, Timeline } from '@openmovie/movie-ir';
import type {
  DesktopUpdateState,
  ProviderProbe,
  ProviderProfile,
  RecentProject,
  StoryDocuments,
} from '../../preload/index.js';
import { detectUiLocale, translate, type TranslationKey, type UiLocale } from './i18n.js';

type RuntimeState =
  | { kind: 'loading' }
  | { kind: 'ready'; initialize: InitializeResult; health: CoreHealth }
  | { kind: 'error'; message: string };

type ProjectSection =
  'Overview' | 'Story' | 'Characters' | 'Scenes' | 'Shots' | 'Timeline' | 'Tests';

const sectionTranslation: Record<ProjectSection, TranslationKey> = {
  Overview: 'overview',
  Story: 'story',
  Characters: 'characters',
  Scenes: 'scenes',
  Shots: 'shots',
  Timeline: 'timeline',
  Tests: 'tests',
};

function artifactUrl(uri: string): string | undefined {
  const match = /^om:\/\/object\/sha256\/([a-f0-9]{64})$/.exec(uri);
  return match?.[1] ? `openmovie-artifact://sha256/${match[1]}` : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

export function App(): React.JSX.Element {
  const initialized = useRef(false);
  const [runtime, setRuntime] = useState<RuntimeState>({ kind: 'loading' });
  const [harnesses, setHarnesses] = useState<HarnessHealth[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);
  const [workingChanges, setWorkingChanges] = useState<FileDiff[]>([]);
  const [selectedDiff, setSelectedDiff] = useState<RevisionDiff | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [story, setStory] = useState<StoryDocuments | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [timelineRenders, setTimelineRenders] = useState<TimelineRenderRecord[]>([]);
  const [proposals, setProposals] = useState<RevisionProposalRecord[]>([]);
  const [takesByShot, setTakesByShot] = useState<Record<string, TakeRecord[]>>({});
  const [evaluationsByTake, setEvaluationsByTake] = useState<Record<string, EvaluationRecord[]>>(
    {},
  );
  const [feedbackByTake, setFeedbackByTake] = useState<Record<string, FeedbackRecord[]>>({});
  const [analysesByTake, setAnalysesByTake] = useState<Record<string, AnalysisRecord[]>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [feedbackRangeDrafts, setFeedbackRangeDrafts] = useState<
    Record<string, { start: string; end: string }>
  >({});
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null);
  const [storageReport, setStorageReport] = useState<StorageReport | null>(null);
  const [section, setSection] = useState<ProjectSection>('Overview');
  const [showCreate, setShowCreate] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [providerProbes, setProviderProbes] = useState<Record<string, ProviderProbe>>({});
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [providerForm, setProviderForm] = useState({
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    protocol: 'openai_chat' as ProviderProfile['protocol'],
    model: '',
    apiKey: '',
  });
  const [plannerProviderId, setPlannerProviderId] = useState('fake');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [taskShotId, setTaskShotId] = useState('');
  const [taskFeedbackId, setTaskFeedbackId] = useState<string | undefined>();
  const [taskMediaKind, setTaskMediaKind] = useState<'image' | 'video'>('image');
  const [mediaProviderId, setMediaProviderId] = useState('fake');
  const [analysisProviderId, setAnalysisProviderId] = useState('fake');
  const [analysisPrompt, setAnalysisPrompt] = useState(
    'Describe composition, characters, motion, continuity risks, and visible defects.',
  );
  const [branchName, setBranchName] = useState('visual-experiment');
  const [characterName, setCharacterName] = useState('');
  const [characterAppearance, setCharacterAppearance] = useState('');
  const [sceneTitle, setSceneTitle] = useState('');
  const [sceneGoal, setSceneGoal] = useState('');
  const [shotSceneId, setShotSceneId] = useState('');
  const [shotDuration, setShotDuration] = useState('4');
  const [shotFraming, setShotFraming] = useState('wide');
  const [shotMovement, setShotMovement] = useState('');
  const [storyPremise, setStoryPremise] = useState('');
  const [storyThemes, setStoryThemes] = useState('');
  const [storyWorld, setStoryWorld] = useState('');
  const [storyRules, setStoryRules] = useState('');
  const [title, setTitle] = useState('Untitled Movie');
  const [goal, setGoal] = useState('Create a cinematic establishing frame for the opening scene');
  const [lastTask, setLastTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiLocale, setUiLocale] = useState<UiLocale>(() => {
    const saved = window.localStorage.getItem('openmovie.uiLocale');
    return saved === 'en' || saved === 'zh-CN' ? saved : detectUiLocale(navigator.language);
  });
  const t = (key: TranslationKey, values?: Record<string, string>): string =>
    translate(uiLocale, key, values);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
    window.localStorage.setItem('openmovie.uiLocale', uiLocale);
  }, [uiLocale]);

  useEffect(() => {
    if (!showCreate && !showTask && !showSettings) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    window.requestAnimationFrame(() =>
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (showSettings) setShowSettings(false);
        else if (showTask) setShowTask(false);
        else setShowCreate(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [showCreate, showSettings, showTask]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void Promise.all([
      window.openMovie.initialize(),
      window.openMovie.coreHealth(),
      window.openMovie.listHarnesses(),
      window.openMovie.listRecentProjects(),
      window.openMovie.getUpdateStatus(),
    ])
      .then(([initialize, health, detectedHarnesses, recents, nextUpdateState]) => {
        setRuntime({ kind: 'ready', initialize, health });
        setHarnesses(detectedHarnesses);
        setRecentProjects(recents);
        setUpdateState(nextUpdateState);
        window.openMovie.reportReady();
      })
      .catch((caught: unknown) => {
        setRuntime({
          kind: 'error',
          message: caught instanceof Error ? caught.message : String(caught),
        });
      });
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      const next = await window.openMovie.getUpdateStatus();
      if (!disposed) setUpdateState(next);
    };
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [showSettings]);

  useEffect(() => {
    if (!lastTask || !['queued', 'planning', 'running'].includes(lastTask.status)) return;
    let disposed = false;
    const poll = async (): Promise<void> => {
      try {
        const tasks = await window.openMovie.listTasks();
        const next = tasks.find((task) => task.id === lastTask.id);
        if (!next || disposed) return;
        setLastTask(next);
        if (['succeeded', 'failed', 'cancelled'].includes(next.status) && project) {
          await loadProject(await window.openMovie.getProjectSummary());
        }
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    const timer = window.setInterval(() => void poll(), 750);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [lastTask?.id, lastTask?.status, project?.id]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const loadProject = async (summary: ProjectSummary): Promise<void> => {
    setProject(summary);
    setTitle(summary.title);
    const [
      nextRevisions,
      tasks,
      nextBranches,
      nextCharacters,
      nextScenes,
      nextShots,
      nextWorkingChanges,
      nextStory,
      nextTimeline,
      nextTimelineRenders,
      nextProviders,
      nextProposals,
      nextStorageReport,
    ] = await Promise.all([
      window.openMovie.listRevisions(),
      window.openMovie.listTasks(),
      window.openMovie.listBranches(),
      window.openMovie.listEntities('character'),
      window.openMovie.listEntities('scene'),
      window.openMovie.listEntities('shot'),
      window.openMovie.getWorkingChanges(),
      window.openMovie.getStory(),
      window.openMovie.getTimeline(),
      window.openMovie.listTimelineRenders(),
      window.openMovie.listProviders(),
      window.openMovie.listProposals(),
      window.openMovie.getStorageReport(),
    ]);
    setRevisions(nextRevisions);
    setBranches(nextBranches);
    setCharacters(
      nextCharacters.filter((entity): entity is Character => entity.type === 'character'),
    );
    setScenes(nextScenes.filter((entity): entity is Scene => entity.type === 'scene'));
    const typedShots = nextShots.filter((entity): entity is Shot => entity.type === 'shot');
    setShots(typedShots);
    const takeEntries = await Promise.all(
      typedShots.map(async (shot) => [shot.id, await window.openMovie.listTakes(shot.id)] as const),
    );
    const nextTakes = Object.fromEntries(takeEntries);
    setTakesByShot(nextTakes);
    const allTakes = takeEntries.flatMap(([, items]) => items);
    const evaluationEntries = await Promise.all(
      allTakes.map(
        async (take) => [take.id, await window.openMovie.listEvaluations(take.id)] as const,
      ),
    );
    setEvaluationsByTake(Object.fromEntries(evaluationEntries));
    const feedbackEntries = await Promise.all(
      allTakes.map(
        async (take) =>
          [take.id, await window.openMovie.listFeedback('take', take.id, 'open')] as const,
      ),
    );
    setFeedbackByTake(Object.fromEntries(feedbackEntries));
    const analysisEntries = await Promise.all(
      allTakes.map(
        async (take) => [take.id, await window.openMovie.listAnalyses(take.id)] as const,
      ),
    );
    setAnalysesByTake(Object.fromEntries(analysisEntries));
    setWorkingChanges(nextWorkingChanges);
    setStory(nextStory);
    setTimeline(nextTimeline);
    setTimelineRenders(nextTimelineRenders);
    setProviders(nextProviders);
    setProposals(nextProposals);
    setStorageReport(nextStorageReport);
    setStoryPremise(nextStory.brief.premise);
    setStoryThemes(nextStory.bible.themes.join(', '));
    setStoryWorld(nextStory.bible.world);
    setStoryRules(nextStory.bible.rules.join('\n'));
    setDoctorReport(null);
    setSelectedDiff(null);
    setShotSceneId((current) => current || (nextScenes[0]?.id ?? ''));
    setLastTask(tasks.at(-1) ?? null);
  };

  const createProject = (): void => {
    void run(async () => {
      const created = await window.openMovie.createProject(title);
      if (!created) return;
      setShowCreate(false);
      setRecentProjects(await window.openMovie.listRecentProjects());
      await loadProject(created);
    });
  };

  const openProject = (): void => {
    void run(async () => {
      const opened = await window.openMovie.openProject();
      if (opened) {
        setRecentProjects(await window.openMovie.listRecentProjects());
        await loadProject(opened);
      }
    });
  };

  const openRecentProject = (path: string): void => {
    void run(async () => {
      await loadProject(await window.openMovie.openRecentProject(path));
      setRecentProjects(await window.openMovie.listRecentProjects());
    });
  };

  const renameProject = (): void => {
    if (!project || title.trim() === project.title) return;
    void run(async () => loadProject(await window.openMovie.renameProject(title)));
  };

  const restoreRevision = (revisionId: string): void => {
    void run(async () => loadProject(await window.openMovie.restoreRevision(revisionId)));
  };

  const cleanProjectCache = (): void => {
    void run(async () => setStorageReport(await window.openMovie.cleanProjectCache()));
  };

  const inspectRevision = (revisionId: string): void => {
    void run(async () => setSelectedDiff(await window.openMovie.getRevisionDiff(revisionId)));
  };

  const createBranch = (): void => {
    void run(async () => {
      await window.openMovie.createBranch(branchName);
      setBranches(await window.openMovie.listBranches());
    });
  };

  const switchBranch = (name: string): void => {
    void run(async () => {
      const result = await window.openMovie.switchBranch(name);
      await loadProject(result.project);
    });
  };

  const createCharacter = (): void => {
    void run(async () => {
      await window.openMovie.createCharacter(characterName, characterAppearance);
      setCharacterName('');
      setCharacterAppearance('');
      if (project) await loadProject(await window.openMovie.getProjectSummary());
    });
  };

  const createScene = (): void => {
    void run(async () => {
      const result = await window.openMovie.createScene(sceneTitle, sceneGoal);
      setSceneTitle('');
      setSceneGoal('');
      setShotSceneId(result.entity.id);
      if (project) await loadProject(await window.openMovie.getProjectSummary());
    });
  };

  const createShot = (): void => {
    void run(async () => {
      await window.openMovie.createShot(
        shotSceneId,
        Math.round(Number(shotDuration) * 1_000_000),
        shotFraming,
        shotMovement,
      );
      if (project) await loadProject(await window.openMovie.getProjectSummary());
    });
  };

  const saveStory = (): void => {
    void run(async () => {
      await window.openMovie.updateStory({
        premise: storyPremise,
        themes: storyThemes
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        world: storyWorld,
        rules: storyRules
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      if (project) await loadProject(await window.openMovie.getProjectSummary());
    });
  };

  const assembleTimeline = (): void => {
    void run(async () => {
      const result = await window.openMovie.assembleTimeline();
      setTimeline(result.timeline);
      if (project) await loadProject(await window.openMovie.getProjectSummary());
    });
  };

  const renderTimeline = (): void => {
    void run(async () => {
      const task = await window.openMovie.renderTimeline();
      setLastTask(task);
      setSection('Overview');
    });
  };

  const runTask = (): void => {
    void run(async () => {
      const result = await window.openMovie.runTask(
        goal,
        plannerProviderId,
        requiresApproval,
        taskShotId || undefined,
        taskMediaKind,
        mediaProviderId,
        taskFeedbackId,
      );
      setTaskFeedbackId(undefined);
      setLastTask(result.task);
      await loadProject(result.project);
      setShowTask(false);
    });
  };

  const approveTask = (): void => {
    if (!lastTask) return;
    void run(async () => {
      const result = await window.openMovie.approveTask(lastTask.id);
      setLastTask(result.task);
      await loadProject(result.project);
    });
  };

  const cancelTask = (): void => {
    if (!lastTask) return;
    void run(async () => setLastTask(await window.openMovie.cancelTask(lastTask.id)));
  };

  const selectTake = (takeId: string): void => {
    void run(async () => {
      const result = await window.openMovie.selectTake(takeId);
      await loadProject(result.project);
    });
  };

  const createTakeFeedback = (takeId: string): void => {
    const body = feedbackDrafts[takeId]?.trim();
    if (!body) return;
    void run(async () => {
      const range = feedbackRangeDrafts[takeId];
      const hasRange = Boolean(range?.start || range?.end);
      const startSeconds = Number(range?.start);
      const endSeconds = Number(range?.end);
      if (
        hasRange &&
        (!range?.start ||
          !range.end ||
          !Number.isFinite(startSeconds) ||
          !Number.isFinite(endSeconds) ||
          startSeconds < 0 ||
          endSeconds <= startSeconds)
      ) {
        throw new Error('Feedback timecode must have an end after its non-negative start');
      }
      await window.openMovie.createFeedback(
        'take',
        takeId,
        body,
        hasRange
          ? {
              startUs: Math.round(startSeconds * 1_000_000),
              endUs: Math.round(endSeconds * 1_000_000),
            }
          : undefined,
      );
      setFeedbackDrafts((current) => ({ ...current, [takeId]: '' }));
      setFeedbackRangeDrafts((current) => ({ ...current, [takeId]: { start: '', end: '' } }));
      const next = await window.openMovie.listFeedback('take', takeId, 'open');
      setFeedbackByTake((current) => ({
        ...current,
        [takeId]: next,
      }));
    });
  };

  const analyzeTake = (takeId: string): void => {
    void run(async () => {
      const task = await window.openMovie.analyzeTake(takeId, analysisProviderId, analysisPrompt);
      setLastTask(task);
      setSection('Overview');
    });
  };

  const fixFeedback = (feedback: FeedbackRecord, shot: Shot, take: TakeRecord): void => {
    void run(async () => {
      setProviders(await window.openMovie.listProviders());
      const timecode = feedback.timeRangeUs
        ? ` from ${(feedback.timeRangeUs.startUs / 1_000_000).toFixed(3)}s to ${(feedback.timeRangeUs.endUs / 1_000_000).toFixed(3)}s`
        : '';
      setGoal(`Fix this feedback for ${shot.id}${timecode}: ${feedback.body}`);
      setTaskShotId(shot.id);
      setTaskMediaKind(take.artifact.mimeType.startsWith('video/') ? 'video' : 'image');
      setMediaProviderId('fake');
      setTaskFeedbackId(feedback.id);
      setShowTask(true);
    });
  };

  const openTask = (): void => {
    void run(async () => {
      setProviders(await window.openMovie.listProviders());
      setTaskShotId((current) => current || (shots[0]?.id ?? ''));
      setTaskFeedbackId(undefined);
      setShowTask(true);
    });
  };

  const openSettings = (): void => {
    void run(async () => {
      const [nextProviders, nextUpdateState] = await Promise.all([
        window.openMovie.listProviders(),
        window.openMovie.getUpdateStatus(),
      ]);
      setProviders(nextProviders);
      setUpdateState(nextUpdateState);
      setShowSettings(true);
    });
  };

  const checkForUpdates = (): void => {
    void run(async () => setUpdateState(await window.openMovie.checkForUpdates()));
  };

  const installUpdate = (): void => {
    void run(async () => {
      await window.openMovie.installUpdate();
    });
  };

  const saveProvider = (): void => {
    void run(async () => {
      await window.openMovie.saveProvider(providerForm);
      setProviders(await window.openMovie.listProviders());
      setProviderForm((current) => ({ ...current, apiKey: '' }));
    });
  };

  const testProvider = (providerId: string): void => {
    void run(async () => {
      const probe = await window.openMovie.testProvider(providerId);
      setProviderProbes((current) => ({ ...current, [providerId]: probe }));
    });
  };

  const runDoctor = (deep = false): void => {
    void run(async () => setDoctorReport(await window.openMovie.runDoctor(deep)));
  };

  const acceptProposal = (proposalId: string): void => {
    void run(async () => {
      await window.openMovie.acceptProposal(proposalId);
      await loadProject(await window.openMovie.getProjectSummary());
    });
  };

  const rejectProposal = (proposalId: string): void => {
    void run(async () => {
      await window.openMovie.rejectProposal(proposalId);
      setProposals(await window.openMovie.listProposals());
    });
  };

  return (
    <div className="app-shell" aria-busy={busy}>
      <a className="skip-link" href="#main-content">
        {t('skipToContent')}
      </a>
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? t('busy') : ''}
      </span>
      <header className="titlebar">
        <div className="brand">
          <Clapperboard size={20} /> OpenMovie
          {project && <span className="project-crumb">/ {project.title}</span>}
        </div>
        <div className="runtime-chip" data-state={runtime.kind}>
          <span className="status-dot" />
          {runtime.kind === 'ready' ? `Core ${runtime.health.status}` : runtime.kind}
        </div>
        <button className="icon-button" aria-label={t('settings')} onClick={openSettings}>
          <Settings size={18} />
        </button>
      </header>

      {project ? (
        <main id="main-content" className="project-workspace" tabIndex={-1}>
          <aside className="project-nav">
            <div className="nav-label">{t('project').toUpperCase()}</div>
            {(
              ['Overview', 'Story', 'Characters', 'Scenes', 'Shots', 'Timeline', 'Tests'] as const
            ).map((item) => (
              <button
                key={item}
                className={section === item ? 'nav-item active' : 'nav-item'}
                onClick={() => setSection(item)}
              >
                {t(sectionTranslation[item])}
                <ChevronRight size={14} />
              </button>
            ))}
          </aside>
          <section className="project-main">
            <div className="project-heading">
              <div>
                <div className="eyebrow">
                  <Sparkles size={14} /> {t('movieProject').toUpperCase()}
                </div>
                <input
                  className="title-input"
                  value={title}
                  aria-label="Movie title"
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={renameProject}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') renameProject();
                  }}
                />
                <div className="project-meta">
                  <span>
                    {project.delivery.width} × {project.delivery.height} · {project.locale}
                  </span>
                  <label className="branch-picker">
                    <GitBranch size={13} />
                    <select
                      value={project.currentBranch}
                      onChange={(event) => switchBranch(event.target.value)}
                      disabled={busy}
                    >
                      {branches.map((branch) => (
                        <option key={branch.name} value={branch.name}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>{project.root}</span>
                </div>
              </div>
              <button className="primary" disabled={busy} onClick={openTask}>
                <Sparkles size={17} /> {t('giveTask')}
              </button>
            </div>

            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {section === 'Overview' ? (
              <div className="project-grid">
                <article className="empty-stage">
                  <Clapperboard size={30} />
                  <h2>Build the movie as structured intent</h2>
                  <p>
                    {lastTask
                      ? `Task ${lastTask.status}: ${lastTask.goal}`
                      : `${characters.length} characters · ${scenes.length} scenes · ${shots.length} shots`}
                  </p>
                  {lastTask && (
                    <div className="task-steps">
                      {lastTask.steps.map((step) => (
                        <div key={step.id} data-status={step.status}>
                          <span className="status-dot" />
                          <strong>{step.title}</strong>
                          <small>{step.status}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="secondary" onClick={() => setSection('Scenes')}>
                    <Plus size={17} /> Add a scene
                  </button>
                  {lastTask?.status === 'awaiting_approval' && (
                    <button className="primary" disabled={busy} onClick={approveTask}>
                      Approve and continue
                    </button>
                  )}
                  {lastTask && ['queued', 'planning', 'running'].includes(lastTask.status) && (
                    <button className="secondary" disabled={busy} onClick={cancelTask}>
                      Cancel task
                    </button>
                  )}
                  {storageReport && (
                    <div className="storage-panel" aria-live="polite">
                      <div>
                        <strong>Project storage</strong>
                        <span>
                          {formatBytes(storageReport.totalBytes)} used ·{' '}
                          {formatBytes(storageReport.disk.freeBytes)} free on disk
                        </span>
                      </div>
                      <div className="storage-categories">
                        <span>Media {formatBytes(storageReport.categories.objects)}</span>
                        <span>Sources {formatBytes(storageReport.categories.sources)}</span>
                        <span>Runtime {formatBytes(storageReport.categories.database)}</span>
                        <span>Cache {formatBytes(storageReport.reclaimableBytes)}</span>
                      </div>
                      {storageReport.disk.lowSpace && (
                        <em>Disk space is low. Clear rebuildable cache or move the project.</em>
                      )}
                      <button
                        className="secondary compact"
                        disabled={busy || storageReport.reclaimableBytes === 0}
                        onClick={cleanProjectCache}
                      >
                        Clear rebuildable cache
                      </button>
                    </div>
                  )}
                  {proposals.filter((proposal) => proposal.status === 'pending').length > 0 && (
                    <div className="proposal-list">
                      <span className="section-label">AGENT PROPOSALS</span>
                      {proposals
                        .filter((proposal) => proposal.status === 'pending')
                        .map((proposal) => (
                          <div className="proposal-card" key={proposal.id}>
                            <strong>{proposal.summary}</strong>
                            <span>
                              {proposal.plan.actions.length} structured action
                              {proposal.plan.actions.length === 1 ? '' : 's'} · base{' '}
                              {proposal.baseRevisionId.slice(-8)}
                            </span>
                            <ul>
                              {proposal.plan.actions.map((action, index) => (
                                <li key={`${action.type}-${index}`}>
                                  <code>{action.type}</code>{' '}
                                  {Object.entries(action)
                                    .filter(([key]) => key !== 'type')
                                    .map(
                                      ([key, value]) =>
                                        `${key}=${Array.isArray(value) ? value.join(', ') : String(value)}`,
                                    )
                                    .join(' · ')}
                                </li>
                              ))}
                            </ul>
                            {proposal.baseRevisionId !== project.currentRevisionId && (
                              <em>
                                The project changed; regenerate this proposal before applying.
                              </em>
                            )}
                            <div className="proposal-actions">
                              <button
                                className="primary"
                                disabled={
                                  busy || proposal.baseRevisionId !== project.currentRevisionId
                                }
                                onClick={() => acceptProposal(proposal.id)}
                              >
                                Accept as Revision
                              </button>
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => rejectProposal(proposal.id)}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </article>
                <article className="history-panel">
                  <div className="panel-title">
                    <History size={17} /> Revisions
                  </div>
                  <div className="branch-create">
                    <input
                      aria-label="New branch name"
                      value={branchName}
                      onChange={(event) => setBranchName(event.target.value)}
                    />
                    <button disabled={busy || !branchName.trim()} onClick={createBranch}>
                      Branch
                    </button>
                  </div>
                  {workingChanges.length > 0 && (
                    <div className="working-changes">
                      {workingChanges.length} uncommitted Movie IR file
                      {workingChanges.length === 1 ? '' : 's'}
                    </div>
                  )}
                  <div className="revision-list">
                    {revisions.map((revision) => (
                      <div className="revision-row" key={revision.id}>
                        <span className="revision-node" />
                        <div>
                          <button
                            className="revision-title"
                            onClick={() => inspectRevision(revision.id)}
                          >
                            {revision.message}
                          </button>
                          <span>
                            <Clock3 size={12} /> {revision.branch} ·{' '}
                            {new Date(revision.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {revision.id !== project.currentRevisionId && (
                          <button disabled={busy} onClick={() => restoreRevision(revision.id)}>
                            Restore
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {selectedDiff && (
                    <div className="diff-panel">
                      <strong>Structured diff</strong>
                      {selectedDiff.files.map((file) => (
                        <div className="diff-file" key={file.path}>
                          <span data-status={file.status}>{file.status}</span>
                          <code>{file.path}</code>
                          <small>
                            {file.changes
                              .slice(0, 4)
                              .map((change) => `${change.operation} ${change.pointer}`)
                              .join(' · ')}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            ) : section === 'Story' ? (
              <div className="entity-workbench">
                <article className="entity-list-panel story-editor">
                  <span className="section-label">STORY SOURCE</span>
                  <h2>The narrative contract for every downstream shot.</h2>
                  <label>
                    Premise
                    <textarea
                      value={storyPremise}
                      onChange={(event) => setStoryPremise(event.target.value)}
                    />
                  </label>
                  <label>
                    World
                    <textarea
                      value={storyWorld}
                      onChange={(event) => setStoryWorld(event.target.value)}
                    />
                  </label>
                </article>
                <article className="entity-form">
                  <h3>Story constraints</h3>
                  <label>
                    Themes (comma separated)
                    <input
                      value={storyThemes}
                      onChange={(event) => setStoryThemes(event.target.value)}
                    />
                  </label>
                  <label>
                    Rules (one per line)
                    <textarea
                      value={storyRules}
                      onChange={(event) => setStoryRules(event.target.value)}
                    />
                  </label>
                  <span className="form-note">
                    {story?.screenplay.scenes.length ?? 0} scenes are linked from the screenplay.
                  </span>
                  <button className="primary" disabled={busy} onClick={saveStory}>
                    Commit story Revision
                  </button>
                </article>
              </div>
            ) : section === 'Characters' ? (
              <div className="entity-workbench">
                <article className="entity-list-panel">
                  <span className="section-label">CHARACTERS</span>
                  <h2>Identity is testable project data.</h2>
                  {characters.map((character) => (
                    <div className="entity-row" key={character.id}>
                      <div>
                        <strong>{character.name}</strong>
                        <span>{character.identity.appearance || 'Appearance not defined'}</span>
                      </div>
                      <code>r{character.revision}</code>
                    </div>
                  ))}
                </article>
                <article className="entity-form">
                  <h3>New character</h3>
                  <label>
                    Name
                    <input
                      value={characterName}
                      onChange={(event) => setCharacterName(event.target.value)}
                    />
                  </label>
                  <label>
                    Appearance
                    <textarea
                      value={characterAppearance}
                      onChange={(event) => setCharacterAppearance(event.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !characterName.trim()}
                    onClick={createCharacter}
                  >
                    Create character
                  </button>
                </article>
              </div>
            ) : section === 'Scenes' ? (
              <div className="entity-workbench">
                <article className="entity-list-panel">
                  <span className="section-label">SCENES</span>
                  <h2>Narrative units with explicit goals.</h2>
                  {scenes.map((scene) => (
                    <div className="entity-row" key={scene.id}>
                      <div>
                        <strong>
                          {scene.order + 1}. {scene.title}
                        </strong>
                        <span>
                          {scene.story_goal || 'Story goal not defined'} · {scene.shots.length}{' '}
                          shots
                        </span>
                      </div>
                      <code>r{scene.revision}</code>
                    </div>
                  ))}
                </article>
                <article className="entity-form">
                  <h3>New scene</h3>
                  <label>
                    Title
                    <input
                      value={sceneTitle}
                      onChange={(event) => setSceneTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    Story goal
                    <textarea
                      value={sceneGoal}
                      onChange={(event) => setSceneGoal(event.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !sceneTitle.trim()}
                    onClick={createScene}
                  >
                    Create scene
                  </button>
                </article>
              </div>
            ) : section === 'Shots' ? (
              <div className="entity-workbench">
                <article className="entity-list-panel">
                  <span className="section-label">SHOTS</span>
                  <h2>Every generated take starts from inspectable intent.</h2>
                  {shots.map((shot) => (
                    <div className="shot-card" key={shot.id}>
                      <div className="entity-row">
                        <div>
                          <strong>{shot.camera.framing || 'Unspecified framing'}</strong>
                          <span>
                            {(shot.duration_us / 1_000_000).toFixed(1)}s ·{' '}
                            {shot.camera.movement || 'static'} · {shot.scene}
                          </span>
                        </div>
                        <code>r{shot.revision}</code>
                      </div>
                      <div className="take-list">
                        {(takesByShot[shot.id] ?? []).map((take) => {
                          const evaluation = evaluationsByTake[take.id]?.[0];
                          const selected = shot.selected_take === take.id;
                          const model =
                            typeof take.provider.model === 'string'
                              ? take.provider.model
                              : typeof take.provider.providerId === 'string'
                                ? take.provider.providerId
                                : 'Take';
                          const previewUrl = artifactUrl(take.artifact.objectUri);
                          return (
                            <div className="take-block" key={take.id}>
                              <div className="take-row" data-selected={selected}>
                                <div className="take-preview-slot">
                                  {previewUrl && take.artifact.mimeType.startsWith('image/') && (
                                    <img
                                      className="take-preview"
                                      src={previewUrl}
                                      alt="Generated Take"
                                    />
                                  )}
                                  {previewUrl && take.artifact.mimeType.startsWith('video/') && (
                                    <video
                                      className="take-preview"
                                      src={previewUrl}
                                      controls
                                      preload="metadata"
                                    />
                                  )}
                                </div>
                                <div>
                                  <strong>{model}</strong>
                                  <span>
                                    {take.artifact.mimeType} · {take.artifact.byteSize} bytes
                                    {evaluation
                                      ? ` · score ${Math.round((evaluation.score ?? 0) * 100)}`
                                      : ''}
                                  </span>
                                </div>
                                <span className="evaluation-state" data-status={evaluation?.status}>
                                  {evaluation?.status ?? 'not evaluated'}
                                </span>
                                <button
                                  disabled={busy || selected}
                                  onClick={() => selectTake(take.id)}
                                >
                                  {selected ? 'Selected' : 'Select'}
                                </button>
                              </div>
                              <div className="take-feedback">
                                {(analysesByTake[take.id] ?? []).slice(0, 1).map((analysis) => (
                                  <div className="analysis-result" key={analysis.id}>
                                    <strong>
                                      {analysis.kind} analysis · {analysis.modelId}
                                    </strong>
                                    <span>{analysis.summary}</span>
                                  </div>
                                ))}
                                <button
                                  className="analyze-button"
                                  disabled={busy}
                                  onClick={() => analyzeTake(take.id)}
                                >
                                  Analyze image / video
                                </button>
                                {(feedbackByTake[take.id] ?? []).map((feedback) => (
                                  <div className="feedback-row" key={feedback.id}>
                                    <span>
                                      {feedback.timeRangeUs && (
                                        <code>
                                          {(feedback.timeRangeUs.startUs / 1_000_000).toFixed(2)}–
                                          {(feedback.timeRangeUs.endUs / 1_000_000).toFixed(2)}s
                                        </code>
                                      )}{' '}
                                      {feedback.body}
                                    </span>
                                    <button onClick={() => fixFeedback(feedback, shot, take)}>
                                      Fix with AI
                                    </button>
                                  </div>
                                ))}
                                <div className="feedback-compose">
                                  <input
                                    placeholder="What should change in this Take?"
                                    value={feedbackDrafts[take.id] ?? ''}
                                    onChange={(event) =>
                                      setFeedbackDrafts((current) => ({
                                        ...current,
                                        [take.id]: event.target.value,
                                      }))
                                    }
                                  />
                                  <input
                                    className="timecode-input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    aria-label="Feedback start time in seconds"
                                    placeholder="Start s"
                                    value={feedbackRangeDrafts[take.id]?.start ?? ''}
                                    onChange={(event) =>
                                      setFeedbackRangeDrafts((current) => ({
                                        ...current,
                                        [take.id]: {
                                          start: event.target.value,
                                          end: current[take.id]?.end ?? '',
                                        },
                                      }))
                                    }
                                  />
                                  <input
                                    className="timecode-input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    aria-label="Feedback end time in seconds"
                                    placeholder="End s"
                                    value={feedbackRangeDrafts[take.id]?.end ?? ''}
                                    onChange={(event) =>
                                      setFeedbackRangeDrafts((current) => ({
                                        ...current,
                                        [take.id]: {
                                          start: current[take.id]?.start ?? '',
                                          end: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                  <button
                                    disabled={busy || !feedbackDrafts[take.id]?.trim()}
                                    onClick={() => createTakeFeedback(take.id)}
                                  >
                                    Add feedback
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {(takesByShot[shot.id] ?? []).length === 0 && (
                          <span className="no-takes">
                            No Takes yet. Target this shot in a task.
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </article>
                <article className="entity-form">
                  <h3>New shot</h3>
                  <label>
                    Scene
                    <select
                      value={shotSceneId}
                      onChange={(event) => setShotSceneId(event.target.value)}
                    >
                      <option value="">Choose a scene</option>
                      {scenes.map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {scene.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Duration (seconds)
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={shotDuration}
                      onChange={(event) => setShotDuration(event.target.value)}
                    />
                  </label>
                  <label>
                    Framing
                    <input
                      value={shotFraming}
                      onChange={(event) => setShotFraming(event.target.value)}
                    />
                  </label>
                  <label>
                    Movement
                    <input
                      value={shotMovement}
                      onChange={(event) => setShotMovement(event.target.value)}
                    />
                  </label>
                  <label>
                    Vision analysis provider
                    <select
                      value={analysisProviderId}
                      onChange={(event) => setAnalysisProviderId(event.target.value)}
                    >
                      <option value="fake">Built-in deterministic Provider</option>
                      {providers
                        .filter(
                          (provider) =>
                            provider.hasSecret &&
                            ['openai_chat', 'openai_responses', 'custom'].includes(
                              provider.protocol,
                            ),
                        )
                        .map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label} · {provider.model}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Analysis prompt
                    <textarea
                      value={analysisPrompt}
                      onChange={(event) => setAnalysisPrompt(event.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !shotSceneId || !(Number(shotDuration) > 0)}
                    onClick={createShot}
                  >
                    Create shot
                  </button>
                </article>
              </div>
            ) : section === 'Timeline' ? (
              <article className="placeholder-panel timeline-panel">
                <span className="section-label">CURRENT CUT</span>
                <h2>Assemble selected Takes into a deterministic cut.</h2>
                <p>
                  Timeline clips reference Shots and immutable Takes. Rebuilding the cut creates a
                  reviewable Revision and never overwrites generated media.
                </p>
                <div className="timeline-actions">
                  <button
                    className="secondary"
                    disabled={busy || shots.length === 0}
                    onClick={assembleTimeline}
                  >
                    Assemble from shots
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      (timeline?.video_tracks[0]?.clips.length ?? 0) === 0 ||
                      (timeline?.video_tracks[0]?.clips ?? []).some((clip) => !clip.take)
                    }
                    onClick={renderTimeline}
                  >
                    Render current cut
                  </button>
                </div>
                <div className="timeline-track">
                  {(timeline?.video_tracks[0]?.clips ?? []).map((clip) => {
                    const shot = shots.find((item) => item.id === clip.shot);
                    const take = (takesByShot[clip.shot] ?? []).find(
                      (item) => item.id === clip.take,
                    );
                    const previewUrl = take ? artifactUrl(take.artifact.objectUri) : undefined;
                    return (
                      <div className="timeline-clip" key={clip.id}>
                        {previewUrl && take?.artifact.mimeType.startsWith('image/') && (
                          <img src={previewUrl} alt="Timeline clip" />
                        )}
                        {previewUrl && take?.artifact.mimeType.startsWith('video/') && (
                          <video src={previewUrl} preload="metadata" />
                        )}
                        <strong>{shot?.camera.framing || clip.shot}</strong>
                        <span>
                          {(clip.start_us / 1_000_000).toFixed(1)}s ·{' '}
                          {(clip.duration_us / 1_000_000).toFixed(1)}s
                        </span>
                        {!clip.take && <em>No Take selected</em>}
                      </div>
                    );
                  })}
                </div>
                {timelineRenders[0] && (
                  <div className="current-render">
                    <span className="section-label">LATEST RENDER</span>
                    <video
                      src={artifactUrl(timelineRenders[0].objectUri)}
                      controls
                      preload="metadata"
                    />
                    <span>
                      Revision {timelineRenders[0].sourceRevisionId.slice(-8)} ·{' '}
                      {(timelineRenders[0].durationUs / 1_000_000).toFixed(1)}s ·{' '}
                      {(timelineRenders[0].byteSize / 1_048_576).toFixed(1)} MiB
                    </span>
                  </div>
                )}
              </article>
            ) : section === 'Tests' ? (
              <article className="placeholder-panel doctor-panel">
                <span className="section-label">PROJECT DOCTOR</span>
                <h2>Verify the movie like a codebase.</h2>
                <p>
                  Check Movie IR schemas and references, selected Takes, SQLite integrity, Object
                  Store files, and working changes. Deep mode also re-hashes every media object.
                </p>
                <div className="doctor-actions">
                  <button className="primary" disabled={busy} onClick={() => runDoctor(false)}>
                    Run checks
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => runDoctor(true)}>
                    Run deep checks
                  </button>
                </div>
                {doctorReport && (
                  <div className="doctor-report" data-status={doctorReport.status}>
                    <strong>
                      {doctorReport.status} · {doctorReport.checks} checks
                    </strong>
                    {doctorReport.issues.length === 0 ? (
                      <span>No project integrity problems found.</span>
                    ) : (
                      doctorReport.issues.map((issue, index) => (
                        <div className="doctor-issue" key={`${issue.code}-${index}`}>
                          <code>{issue.code}</code>
                          <span>
                            {issue.path ? `${issue.path}: ` : ''}
                            {issue.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </article>
            ) : null}
          </section>
        </main>
      ) : (
        <main id="main-content" className="home" tabIndex={-1}>
          <section className="hero">
            <div className="eyebrow">
              <Sparkles size={14} /> {t('homeEyebrow')}
            </div>
            <h1>{t('homeTitle')}</h1>
            <p>{t('homeSubtitle')}</p>
            <div className="actions">
              <button className="primary" disabled={busy} onClick={() => setShowCreate(true)}>
                <Plus size={18} /> {t('newMovie')}
              </button>
              <button className="secondary" disabled={busy} onClick={openProject}>
                <FolderOpen size={18} /> {t('openProject')}
              </button>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
          </section>

          <section className="workspace-card">
            <div>
              <span className="section-label">{t('recentProjects').toUpperCase()}</span>
              <h2>{recentProjects.length > 0 ? t('continueMovie') : t('noMovies')}</h2>
              {recentProjects.length > 0 ? (
                <div className="recent-list">
                  {recentProjects.slice(0, 6).map((recent) => (
                    <button
                      className="recent-project"
                      key={recent.path}
                      disabled={busy}
                      onClick={() => openRecentProject(recent.path)}
                    >
                      <strong>{recent.title}</strong>
                      <span>{recent.path}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p>{t('noMoviesHelp')}</p>
              )}
            </div>
            <div className="health-stack">
              <div className="runtime-status" data-state={runtime.kind}>
                <span className="status-dot" />
                {runtime.kind === 'loading' && t('startingCore')}
                {runtime.kind === 'error' && t('coreUnavailable', { message: runtime.message })}
                {runtime.kind === 'ready' &&
                  `Core ${runtime.health.status} · protocol ${runtime.initialize.protocolVersion}`}
              </div>
              <div className="harness-list">
                {runtime.kind === 'ready' && (
                  <span data-available={runtime.health.media.ffmpeg.available}>
                    FFmpeg {runtime.health.media.ffmpeg.source}
                  </span>
                )}
                {harnesses.map((harness) => (
                  <span key={harness.id} data-available={harness.available}>
                    {harness.name}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}

      {showCreate && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowCreate(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="section-label">NEW PROJECT</span>
            <h2 id="create-title">What are you making?</h2>
            <label>
              Movie title
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createProject();
                }}
              />
            </label>
            <p>You will choose where the portable project folder is stored next.</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !title.trim()} onClick={createProject}>
                Choose location
              </button>
            </div>
          </div>
        </div>
      )}
      {showTask && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTask(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="section-label">NEW TASK</span>
            <h2 id="task-title">What should OpenMovie make?</h2>
            <label>
              Goal
              <textarea autoFocus value={goal} onChange={(event) => setGoal(event.target.value)} />
            </label>
            <label>
              Planning model
              <select
                value={plannerProviderId}
                onChange={(event) => setPlannerProviderId(event.target.value)}
              >
                <option value="fake">Built-in Fake Provider</option>
                {harnesses.some((harness) => harness.id === 'codex' && harness.available) && (
                  <option value="harness:codex">Local Codex Harness</option>
                )}
                {harnesses.some((harness) => harness.id === 'claude_code' && harness.available) && (
                  <option value="harness:claude_code">Local Claude Code Harness</option>
                )}
                {providers
                  .filter(
                    (provider) =>
                      provider.hasSecret &&
                      ['openai_chat', 'openai_responses', 'custom'].includes(provider.protocol),
                  )
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label} · {provider.model}
                    </option>
                  ))}
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(event) => setRequiresApproval(event.target.checked)}
              />
              Pause for approval before generation
            </label>
            <label>
              Target shot
              <select value={taskShotId} onChange={(event) => setTaskShotId(event.target.value)}>
                <option value="">Project-level fixture</option>
                {shots.map((shot) => (
                  <option key={shot.id} value={shot.id}>
                    {shot.id} · {shot.camera.framing || 'shot'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Media output
              <select
                value={taskMediaKind}
                onChange={(event) => {
                  setTaskMediaKind(event.target.value as 'image' | 'video');
                  setMediaProviderId('fake');
                }}
              >
                <option value="image">Image Take</option>
                <option value="video">Video Take</option>
              </select>
            </label>
            <label>
              Media provider
              <select
                value={mediaProviderId}
                onChange={(event) => setMediaProviderId(event.target.value)}
              >
                <option value="fake">Built-in deterministic Provider</option>
                {providers
                  .filter(
                    (provider) =>
                      provider.hasSecret &&
                      (taskMediaKind === 'video'
                        ? provider.protocol === 'http_video_jobs'
                        : provider.protocol === 'openai_images'),
                  )
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label} · {provider.model}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              The planning model produces visual intent; built-in deterministic media keeps local
              development free of paid generation calls.
            </p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowTask(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !goal.trim()} onClick={runTask}>
                Run task
              </button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowSettings(false)}
        >
          <div
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="section-label">SETTINGS</span>
            <h2 id="settings-title">Model providers</h2>
            {providers.map((provider) => (
              <div className="provider-row" key={provider.id}>
                <div>
                  <strong>{provider.label}</strong>
                  <span>
                    {provider.protocol} · {provider.model || provider.baseUrl}
                  </span>
                  {providerProbes[provider.id] && (
                    <span className={`probe-result ${providerProbes[provider.id]?.status}`}>
                      {providerProbes[provider.id]?.message} ·{' '}
                      {providerProbes[provider.id]?.latencyMs} ms
                    </span>
                  )}
                </div>
                <div className="provider-actions">
                  <span className={provider.hasSecret ? 'key-state ready' : 'key-state'}>
                    {provider.hasSecret ? 'Key saved' : 'No key'}
                  </span>
                  <button
                    className="secondary compact"
                    disabled={busy || !provider.hasSecret}
                    onClick={() => testProvider(provider.id)}
                  >
                    Test
                  </button>
                </div>
              </div>
            ))}
            <div className="provider-form">
              <label>
                Provider name
                <input
                  value={providerForm.label}
                  onChange={(event) =>
                    setProviderForm({ ...providerForm, label: event.target.value })
                  }
                />
              </label>
              <label>
                API protocol
                <select
                  value={providerForm.protocol}
                  onChange={(event) =>
                    setProviderForm({
                      ...providerForm,
                      protocol: event.target.value as ProviderProfile['protocol'],
                    })
                  }
                >
                  <option value="openai_chat">OpenAI-compatible Chat / Vision</option>
                  <option value="openai_responses">OpenAI Responses / Vision</option>
                  <option value="custom">Custom OpenAI Chat-compatible</option>
                  <option value="openai_images">OpenAI-compatible Images</option>
                  <option value="http_video_jobs">Async HTTP Video Jobs</option>
                </select>
              </label>
              <label>
                Base URL
                <input
                  value={providerForm.baseUrl}
                  onChange={(event) =>
                    setProviderForm({ ...providerForm, baseUrl: event.target.value })
                  }
                />
              </label>
              <label>
                Model
                <input
                  placeholder="model/name"
                  value={providerForm.model}
                  onChange={(event) =>
                    setProviderForm({ ...providerForm, model: event.target.value })
                  }
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Stored with system encryption"
                  value={providerForm.apiKey}
                  onChange={(event) =>
                    setProviderForm({ ...providerForm, apiKey: event.target.value })
                  }
                />
              </label>
            </div>
            <span className="section-label settings-subsection">
              {t('application').toUpperCase()}
            </span>
            <div className="provider-row">
              <div>
                <strong>{t('language')}</strong>
                <span>The interface language is stored only on this device.</span>
              </div>
              <select
                aria-label={t('language')}
                value={uiLocale}
                onChange={(event) => setUiLocale(event.target.value as UiLocale)}
              >
                <option value="en">{t('english')}</option>
                <option value="zh-CN">{t('chinese')}</option>
              </select>
            </div>
            <div className="provider-row" aria-live="polite">
              <div>
                <strong>OpenMovie {updateState?.currentVersion ?? ''}</strong>
                <span>{updateState?.message ?? 'Loading update status…'}</span>
              </div>
              <div className="provider-actions">
                {updateState?.status === 'downloaded' ? (
                  <button className="primary compact" disabled={busy} onClick={installUpdate}>
                    Install and restart
                  </button>
                ) : (
                  <button
                    className="secondary compact"
                    disabled={
                      busy ||
                      !updateState ||
                      ['disabled', 'checking', 'available', 'downloading'].includes(
                        updateState.status,
                      )
                    }
                    onClick={checkForUpdates}
                  >
                    Check for updates
                  </button>
                )}
              </div>
            </div>
            {runtime.kind === 'ready' && (
              <div className="provider-row">
                <div>
                  <strong>FFmpeg media runtime</strong>
                  <span>
                    {runtime.health.media.ffmpeg.available
                      ? `${runtime.health.media.ffmpeg.source} · ${runtime.health.media.ffmpeg.version ?? 'version available'}`
                      : 'Unavailable · reinstall OpenMovie before rendering or video analysis'}
                  </span>
                </div>
                <span
                  className={
                    runtime.health.media.ffmpeg.available ? 'key-state ready' : 'key-state'
                  }
                >
                  {runtime.health.media.ffmpeg.available ? 'Ready' : 'Missing'}
                </span>
              </div>
            )}
            {error && <div className="error-banner">{error}</div>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowSettings(false)}>
                {t('close')}
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !providerForm.model ||
                  (!providerForm.apiKey &&
                    !providers.some((item) => item.id === providerForm.id && item.hasSecret))
                }
                onClick={saveProvider}
              >
                Save provider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
