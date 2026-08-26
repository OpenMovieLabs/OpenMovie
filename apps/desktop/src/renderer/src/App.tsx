import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  GitBranch,
  History,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  UserRound,
  Video,
  X,
} from 'lucide-react';

import type {
  BranchRecord,
  CoreHealth,
  DoctorReport,
  HarnessHealth,
  ProjectSummary,
  ProviderUsageSummary,
  RevisionProposalRecord,
  RevisionRecord,
  Task,
  TakeRecord,
  TimelineRenderRecord,
} from '@openmovie/contracts';
import type { Character, Scene, Shot } from '@openmovie/movie-ir';
import type {
  DesktopUpdateState,
  ProviderProfile,
  RecentProject,
  StoryDocuments,
} from '../../preload/index.js';
import { detectUiLocale, type UiLocale } from './i18n.js';

type RuntimeState =
  { kind: 'loading' } | { kind: 'ready'; health: CoreHealth } | { kind: 'error'; message: string };

type ResourceSelection =
  | { kind: 'project'; item: ProjectSummary }
  | { kind: 'story'; item: StoryDocuments }
  | { kind: 'character'; item: Character }
  | { kind: 'scene'; item: Scene }
  | { kind: 'shot'; item: Shot }
  | { kind: 'take'; item: TakeRecord }
  | { kind: 'render'; item: TimelineRenderRecord }
  | { kind: 'revision'; item: RevisionRecord }
  | { kind: 'doctor'; item: DoctorReport };

type ResourceView = 'resources' | 'versions';

const activeTaskStatuses = new Set<Task['status']>(['queued', 'planning', 'running']);

function artifactUrl(uri: string): string | undefined {
  const match = /^om:\/\/object\/sha256\/([a-f0-9]{64})$/.exec(uri);
  return match?.[1] ? `openmovie-artifact://sha256/${match[1]}` : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function taskStatusText(status: Task['status'], locale: UiLocale): string {
  const labels: Record<Task['status'], [string, string]> = {
    queued: ['已排队', 'Queued'],
    planning: ['正在规划', 'Planning'],
    awaiting_approval: ['等待你的确认', 'Needs approval'],
    running: ['正在执行', 'Running'],
    succeeded: ['已完成', 'Completed'],
    failed: ['失败', 'Failed'],
    cancelled: ['已取消', 'Cancelled'],
  };
  return labels[status][locale === 'zh-CN' ? 0 : 1];
}

function taskStepText(title: string, locale: UiLocale): string {
  const labels: Record<string, [string, string]> = {
    'Plan the visual intent': ['规划视觉意图', 'Plan the visual intent'],
    'Prepare reviewable Movie IR actions': [
      '准备可审查的工程修改',
      'Prepare reviewable project changes',
    ],
    'Generate an image Take': ['生成图片 Take', 'Generate an image Take'],
    'Generate a video Take': ['生成视频 Take', 'Generate a video Take'],
    'Render selected Takes into the current cut': [
      '将已选 Take 渲染为当前成片',
      'Render selected Takes into the current cut',
    ],
    'Analyze media with timecoded evidence': [
      '分析媒体并生成时间码证据',
      'Analyze media with timecoded evidence',
    ],
  };
  const label = labels[title];
  return label ? label[locale === 'zh-CN' ? 0 : 1] : title;
}

function taskErrorSummary(error: string | undefined, locale: UiLocale): string {
  const isCodexSandboxMismatch =
    error?.includes('unknown variant `readOnly`') || error?.includes('expected one of `read-only`');
  if (isCodexSandboxMismatch) {
    return locale === 'zh-CN'
      ? '本地 Codex 的协议参数不兼容。OpenMovie 已修复该问题，请重新发送任务。'
      : 'The local Codex protocol parameters were incompatible. OpenMovie has fixed this; resend the task.';
  }
  return locale === 'zh-CN'
    ? '任务没有完成。你可以检查模型设置后重新发送。'
    : 'The task did not complete. Check the model settings and try again.';
}

function applicationErrorText(error: string, locale: UiLocale): string {
  if (error.includes('No project is open')) {
    return locale === 'zh-CN'
      ? '当前工程连接已失效，请从左侧重新打开工程。'
      : 'The current project connection was lost. Reopen it from the sidebar.';
  }
  if (error.includes('Project is not in Recent Projects')) {
    return locale === 'zh-CN'
      ? '这个工程不在最近列表中，请使用“打开工程”重新选择。'
      : 'This movie is no longer in Recents. Use Open project to select it again.';
  }
  if (error.toLowerCase().includes('lock')) {
    return locale === 'zh-CN'
      ? '这个工程正在另一个 OpenMovie 窗口中使用。关闭另一个窗口后再试。'
      : 'This movie is open in another OpenMovie window. Close it and try again.';
  }
  const detail = error.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
  return locale === 'zh-CN' ? `操作未完成：${detail}` : `The action did not complete: ${detail}`;
}

export function App(): React.JSX.Element {
  const initialized = useRef(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const [runtime, setRuntime] = useState<RuntimeState>({ kind: 'loading' });
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [harnesses, setHarnesses] = useState<HarnessHealth[]>([]);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [usage, setUsage] = useState<ProviderUsageSummary | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [takes, setTakes] = useState<TakeRecord[]>([]);
  const [renders, setRenders] = useState<TimelineRenderRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [proposals, setProposals] = useState<RevisionProposalRecord[]>([]);
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [story, setStory] = useState<StoryDocuments | null>(null);
  const [selection, setSelection] = useState<ResourceSelection | null>(null);
  const [resourceView, setResourceView] = useState<ResourceView>('resources');
  const [sceneTreeOpen, setSceneTreeOpen] = useState(true);
  const [resourceSearch, setResourceSearch] = useState('');
  const [composer, setComposer] = useState('');
  const [plannerProviderId, setPlannerProviderId] = useState('fake');
  const [mediaProviderId, setMediaProviderId] = useState('fake');
  const [mediaKind, setMediaKind] = useState<'image' | 'video'>('image');
  const [showComposerSettings, setShowComposerSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('Untitled Movie');
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState('');
  const [remoteMediaPolicy, setRemoteMediaPolicy] = useState<'allow' | 'confirm' | 'deny'>(
    'confirm',
  );
  const [providerForm, setProviderForm] = useState({
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    protocol: 'openai_chat' as ProviderProfile['protocol'],
    model: '',
    apiKey: '',
  });
  const [uiLocale, setUiLocale] = useState<UiLocale>(() => {
    const stored = window.localStorage.getItem('openmovie.uiLocale');
    return stored === 'en' || stored === 'zh-CN' ? stored : detectUiLocale(navigator.language);
  });

  const text = (zh: string, en: string): string => (uiLocale === 'zh-CN' ? zh : en);
  const selectedShotId =
    selection?.kind === 'shot'
      ? selection.item.id
      : selection?.kind === 'take'
        ? selection.item.shotId
        : undefined;

  const planningProviders = useMemo(
    () => [
      { id: 'fake', label: text('内置离线模型', 'Built-in offline') },
      ...harnesses
        .filter((item) => item.available && item.id !== 'direct')
        .map((item) => ({ id: `harness:${item.id}`, label: item.name })),
      ...providers
        .filter((item) =>
          ['openai_chat', 'openai_responses', 'custom', 'plugin'].includes(item.protocol),
        )
        .map((item) => ({ id: item.id, label: item.label })),
    ],
    [harnesses, providers, uiLocale],
  );

  const mediaProviders = useMemo(
    () => [
      { id: 'fake', label: text('内置演示生成器', 'Built-in demo generator') },
      ...providers
        .filter((item) =>
          mediaKind === 'video'
            ? item.protocol === 'http_video_jobs'
            : item.protocol === 'openai_images',
        )
        .map((item) => ({ id: item.id, label: item.label })),
    ],
    [mediaKind, providers, uiLocale],
  );

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
    setMonthlyBudgetUsd(
      summary.policies.monthlyBudgetUsdMicros === null
        ? ''
        : String(summary.policies.monthlyBudgetUsdMicros / 1_000_000),
    );
    setRemoteMediaPolicy(summary.policies.remoteMediaPolicy);
    const [
      nextCharacters,
      nextScenes,
      nextShots,
      nextStory,
      nextRenders,
      nextTasks,
      nextProposals,
      nextRevisions,
      nextBranches,
      nextProviders,
      nextUsage,
    ] = await Promise.all([
      window.openMovie.listEntities('character'),
      window.openMovie.listEntities('scene'),
      window.openMovie.listEntities('shot'),
      window.openMovie.getStory(),
      window.openMovie.listTimelineRenders(),
      window.openMovie.listTasks(),
      window.openMovie.listProposals(),
      window.openMovie.listRevisions(),
      window.openMovie.listBranches(),
      window.openMovie.listProviders(),
      window.openMovie.getProviderUsage(),
    ]);
    const typedCharacters = nextCharacters.filter(
      (item): item is Character => item.type === 'character',
    );
    const typedScenes = nextScenes.filter((item): item is Scene => item.type === 'scene');
    const typedShots = nextShots.filter((item): item is Shot => item.type === 'shot');
    const takeGroups = await Promise.all(
      typedShots.map((shot) => window.openMovie.listTakes(shot.id)),
    );
    setCharacters(typedCharacters);
    setScenes(typedScenes);
    setShots(typedShots);
    setStory(nextStory);
    setRenders(nextRenders);
    setTasks(nextTasks);
    setProposals(nextProposals);
    setRevisions(nextRevisions);
    setBranches(nextBranches);
    setProviders(nextProviders);
    setUsage(nextUsage);
    setTakes(takeGroups.flat());
    setSelection((current) => current ?? { kind: 'project', item: summary });
  };

  const refreshProject = async (): Promise<void> => {
    if (!project) return;
    await loadProject(await window.openMovie.getProjectSummary());
  };

  useEffect(() => {
    document.documentElement.lang = uiLocale;
    window.localStorage.setItem('openmovie.uiLocale', uiLocale);
  }, [uiLocale]);

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
      .then(([, health, nextHarnesses, recents, updates]) => {
        setRuntime({ kind: 'ready', health });
        setHarnesses(nextHarnesses);
        setRecentProjects(recents);
        setUpdateState(updates);
        const preferred = nextHarnesses.find(
          (item) => item.available && (item.id === 'codex' || item.id === 'claude_code'),
        );
        if (preferred) setPlannerProviderId(`harness:${preferred.id}`);
        window.openMovie.reportReady();
      })
      .catch((caught: unknown) =>
        setRuntime({
          kind: 'error',
          message: caught instanceof Error ? caught.message : String(caught),
        }),
      );
  }, []);

  useEffect(() => {
    if (!tasks.some((task) => activeTaskStatuses.has(task.status))) return;
    const timer = window.setInterval(() => {
      void window.openMovie
        .listTasks()
        .then(async (nextTasks) => {
          setTasks(nextTasks);
          if (!nextTasks.some((task) => activeTaskStatuses.has(task.status))) {
            await refreshProject();
          }
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : String(caught)),
        );
    }, 900);
    return () => window.clearInterval(timer);
  }, [tasks, project?.id]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [tasks.length, tasks.at(-1)?.status, proposals.length]);

  useEffect(() => {
    if (mediaProviders.some((item) => item.id === mediaProviderId)) return;
    setMediaProviderId('fake');
  }, [mediaKind, mediaProviders, mediaProviderId]);

  const createProject = (): void => {
    void run(async () => {
      const created = await window.openMovie.createProject(newProjectTitle.trim());
      if (!created) return;
      setShowCreate(false);
      setSelection(null);
      setRecentProjects(await window.openMovie.listRecentProjects());
      await loadProject(created);
    });
  };

  const openProject = (): void => {
    void run(async () => {
      const opened = await window.openMovie.openProject();
      if (!opened) return;
      setSelection(null);
      setRecentProjects(await window.openMovie.listRecentProjects());
      await loadProject(opened);
    });
  };

  const openRecent = (path: string): void => {
    void run(async () => {
      setSelection(null);
      const opened = await window.openMovie.openRecentProject(path);
      setRecentProjects(await window.openMovie.listRecentProjects());
      await loadProject(opened);
    });
  };

  const submitPrompt = (): void => {
    const goal = composer.trim();
    if (!project || !goal || busy) return;
    setComposer('');
    void run(async () => {
      const result = await window.openMovie.runTask(
        goal,
        plannerProviderId,
        false,
        selectedShotId,
        mediaKind,
        mediaProviderId,
      );
      setTasks((current) => [...current, result.task]);
    });
  };

  const editPrompt = (prompt: string): void => {
    setComposer(prompt);
    window.requestAnimationFrame(() => composerInput.current?.focus());
  };

  const approveTask = (taskId: string): void => {
    void run(async () => {
      const result = await window.openMovie.approveTask(taskId);
      setTasks((current) => current.map((task) => (task.id === taskId ? result.task : task)));
    });
  };

  const cancelTask = (taskId: string): void => {
    void run(async () => {
      const cancelled = await window.openMovie.cancelTask(taskId);
      setTasks((current) => current.map((task) => (task.id === taskId ? cancelled : task)));
    });
  };

  const acceptProposal = (proposalId: string): void => {
    void run(async () => {
      await window.openMovie.acceptProposal(proposalId);
      await refreshProject();
    });
  };

  const rejectProposal = (proposalId: string): void => {
    void run(async () => {
      await window.openMovie.rejectProposal(proposalId);
      setProposals(await window.openMovie.listProposals());
    });
  };

  const runDoctor = (): void => {
    void run(async () => {
      setSelection({ kind: 'doctor', item: await window.openMovie.runDoctor(true) });
      setResourceView('resources');
    });
  };

  const assembleTimeline = (): void => {
    void run(async () => {
      await window.openMovie.assembleTimeline();
      await refreshProject();
    });
  };

  const renderTimeline = (): void => {
    void run(async () => {
      const task = await window.openMovie.renderTimeline();
      setTasks((current) => [...current, task]);
    });
  };

  const selectTake = (take: TakeRecord): void => {
    void run(async () => {
      await window.openMovie.selectTake(take.id);
      setSelection({ kind: 'take', item: take });
      await refreshProject();
    });
  };

  const restoreRevision = (revision: RevisionRecord): void => {
    void run(async () => loadProject(await window.openMovie.restoreRevision(revision.id)));
  };

  const savePolicies = (): void => {
    if (!project) return;
    void run(async () => {
      const value = monthlyBudgetUsd.trim();
      const dollars = value ? Number(value) : null;
      if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
        throw new Error(text('预算必须是非负美元金额', 'Budget must be non-negative'));
      }
      const micros = dollars === null ? null : Math.round(dollars * 1_000_000);
      await loadProject(await window.openMovie.updateProjectPolicies(micros, remoteMediaPolicy));
    });
  };

  const saveProvider = (): void => {
    void run(async () => {
      await window.openMovie.saveProvider(providerForm);
      setProviders(await window.openMovie.listProviders());
      setProviderForm((current) => ({ ...current, apiKey: '' }));
    });
  };

  const query = resourceSearch.trim().toLowerCase();
  const filteredShots = shots.filter((shot) =>
    `${shot.id} ${shot.camera.framing ?? ''} ${shot.camera.movement ?? ''}`
      .toLowerCase()
      .includes(query),
  );
  const filteredTakes = takes.filter((take) =>
    `${take.id} ${take.shotId}`.toLowerCase().includes(query),
  );
  const hasActiveTasks = tasks.some((task) => activeTaskStatuses.has(task.status));
  const hasProjectResources = shots.length > 0 || takes.length > 0 || renders.length > 0;
  const hasSelectedTake = shots.some((shot) => Boolean(shot.selected_take));
  const projectNavigationLocked = busy || hasActiveTasks;
  const sidebarProjects = project
    ? [
        {
          path: project.root,
          title: project.title,
          lastOpenedAt:
            recentProjects.find((recent) => recent.path === project.root)?.lastOpenedAt ?? '',
        },
        ...recentProjects.filter((recent) => recent.path !== project.root),
      ]
    : recentProjects;

  return (
    <div className="studio-shell" aria-busy={busy}>
      <aside className="project-sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Aperture size={17} />
          </div>
          <strong>OpenMovie</strong>
          <button className="icon-button quiet" aria-label="Menu">
            <MoreHorizontal size={17} />
          </button>
        </div>
        <button
          className="new-project-button"
          disabled={projectNavigationLocked}
          title={
            projectNavigationLocked
              ? text('请先等待当前任务结束或停止任务', 'Wait for or stop the current task first')
              : undefined
          }
          onClick={() => setShowCreate(true)}
        >
          <Plus size={16} /> {text('新建电影', 'New movie')}
        </button>
        <div className="projects-area">
          <span className="sidebar-label">{text('电影工程', 'MOVIE PROJECTS')}</span>
          {sidebarProjects.map((sidebarProject) => {
            const isCurrent = project?.root === sidebarProject.path;
            return (
              <div
                className={isCurrent ? 'sidebar-project current' : 'sidebar-project'}
                key={sidebarProject.path}
              >
                <button
                  className="project-row"
                  disabled={!isCurrent && projectNavigationLocked}
                  title={
                    !isCurrent && projectNavigationLocked
                      ? text(
                          '当前任务运行期间不能切换工程',
                          'Projects cannot be switched while a task is running',
                        )
                      : sidebarProject.title
                  }
                  onClick={() => {
                    if (isCurrent && project) {
                      setSelection({ kind: 'project', item: project });
                      setResourceView('resources');
                    } else {
                      openRecent(sidebarProject.path);
                    }
                  }}
                >
                  {isCurrent ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Film size={14} />
                  <span>
                    <strong>{sidebarProject.title}</strong>
                    <small>
                      {isCurrent
                        ? text('正在编辑', 'Editing')
                        : new Date(sidebarProject.lastOpenedAt).toLocaleDateString()}
                    </small>
                  </span>
                </button>
                {isCurrent && project && (
                  <div className="project-expanded">
                    <nav
                      className="project-tree"
                      aria-label={text('工程结构', 'Project structure')}
                    >
                      <button
                        className={selection?.kind === 'story' ? 'tree-row active' : 'tree-row'}
                        onClick={() => story && setSelection({ kind: 'story', item: story })}
                      >
                        <FileText size={15} />
                        <span>{text('故事与世界观', 'Story & world')}</span>
                      </button>
                      <button
                        className={selection?.kind === 'character' ? 'tree-row active' : 'tree-row'}
                        onClick={() =>
                          setSelection(
                            characters[0] ? { kind: 'character', item: characters[0] } : null,
                          )
                        }
                      >
                        <UserRound size={15} />
                        <span>{text('角色', 'Characters')}</span>
                        <small>{characters.length}</small>
                      </button>
                      <button
                        className="tree-row"
                        onClick={() => setSceneTreeOpen((value) => !value)}
                      >
                        {sceneTreeOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <span>{text('场景与镜头', 'Scenes & shots')}</span>
                        <small>{scenes.length}</small>
                      </button>
                      {sceneTreeOpen && (
                        <div className="tree-children">
                          {scenes.length === 0 && (
                            <span className="tree-empty">
                              {text('还没有场景', 'No scenes yet')}
                            </span>
                          )}
                          {scenes.map((scene) => (
                            <div key={scene.id} className="scene-tree-group">
                              <button
                                className={
                                  selection?.kind === 'scene' && selection.item.id === scene.id
                                    ? 'tree-row active'
                                    : 'tree-row'
                                }
                                onClick={() => setSelection({ kind: 'scene', item: scene })}
                              >
                                <Film size={14} />
                                <span>{scene.title}</span>
                              </button>
                              {shots
                                .filter((shot) => shot.scene === scene.id)
                                .map((shot, index) => (
                                  <button
                                    key={shot.id}
                                    className={
                                      selection?.kind === 'shot' && selection.item.id === shot.id
                                        ? 'tree-row shot-row active'
                                        : 'tree-row shot-row'
                                    }
                                    onClick={() => setSelection({ kind: 'shot', item: shot })}
                                  >
                                    <Clapperboard size={13} />
                                    <span>{text(`镜头 ${index + 1}`, `Shot ${index + 1}`)}</span>
                                  </button>
                                ))}
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        className="tree-row"
                        onClick={() =>
                          setSelection(renders[0] ? { kind: 'render', item: renders[0] } : null)
                        }
                      >
                        <Video size={15} />
                        <span>{text('时间线与成片', 'Timeline & cuts')}</span>
                        <small>{renders.length}</small>
                      </button>
                      <button className="tree-row" onClick={runDoctor}>
                        <Check size={15} />
                        <span>{text('工程检查', 'Project checks')}</span>
                      </button>
                    </nav>
                    <div className="branch-row">
                      <GitBranch size={14} />
                      <span>
                        {branches.find((branch) => branch.current)?.name ?? project.currentBranch}
                      </span>
                      <small>
                        {revisions.length} {text('个版本', 'revisions')}
                      </small>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {sidebarProjects.length === 0 && (
            <p className="muted-copy">{text('还没有电影工程', 'No movie projects yet')}</p>
          )}
        </div>
        <div className="sidebar-footer">
          <button
            className="tree-row"
            disabled={projectNavigationLocked}
            title={
              projectNavigationLocked
                ? text('请先等待当前任务结束或停止任务', 'Wait for or stop the current task first')
                : undefined
            }
            onClick={openProject}
          >
            <FolderOpen size={15} /> {text('打开工程', 'Open project')}
          </button>
          <button className="tree-row" onClick={() => setShowSettings(true)}>
            <Settings size={15} /> {text('设置', 'Settings')}
          </button>
        </div>
      </aside>

      <main className="conversation-pane">
        <header className="conversation-header">
          <div>
            <span className="eyebrow">{text('创作会话', 'CREATIVE SESSION')}</span>
            <h1>{project?.title ?? text('开始一部电影', 'Start a movie')}</h1>
          </div>
          <div className={`runtime-state ${runtime.kind}`}>
            <span />
            {runtime.kind === 'ready'
              ? text('本地 Core 已连接', 'Local Core connected')
              : runtime.kind === 'error'
                ? runtime.message
                : text('正在连接…', 'Connecting…')}
          </div>
        </header>
        <section className="conversation-thread" aria-live="polite">
          {!project ? (
            <div className="conversation-welcome">
              <div className="welcome-symbol">
                <Sparkles size={27} />
              </div>
              <h2>{text('从一句话开始你的电影', 'Build your film from a conversation')}</h2>
              <p>
                {text(
                  '告诉 OpenMovie 你的故事、风格或想要修改的镜头。工程结构与生成资源会在两侧自动组织。',
                  'Describe the story, style, or shot you want to change. OpenMovie keeps the project and generated resources organized around the conversation.',
                )}
              </p>
              <div className="welcome-actions">
                <button className="primary-button" onClick={() => setShowCreate(true)}>
                  <Plus size={16} /> {text('创建电影工程', 'Create movie project')}
                </button>
                <button className="secondary-button" onClick={openProject}>
                  <FolderOpen size={16} /> {text('打开已有工程', 'Open existing project')}
                </button>
              </div>
            </div>
          ) : tasks.length === 0 && proposals.length === 0 ? (
            <div className="conversation-welcome project-welcome">
              <div className="welcome-symbol small">
                <MessageSquare size={24} />
              </div>
              <h2>{text('你想先做什么？', 'What should we make first?')}</h2>
              <p>
                {text(
                  '直接描述目标。OpenMovie 会使用选定的本地 Harness 或模型进行规划，并把工程变更作为可审查提案。',
                  'Describe the outcome. OpenMovie plans with the selected local Harness or model and returns project changes as a reviewable proposal.',
                )}
              </p>
              <div className="prompt-suggestions">
                {[
                  text(
                    '帮我规划一个三分钟科幻短片的第一幕',
                    'Plan act one of a three-minute sci-fi short',
                  ),
                  text('建立主要角色和视觉风格', 'Define the main character and visual language'),
                  text('把开场设计成三个连续镜头', 'Design the opening as three continuous shots'),
                ].map((prompt) => (
                  <button key={prompt} onClick={() => setComposer(prompt)}>
                    <Sparkles size={14} /> {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {[...tasks]
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                .map((task) => (
                  <div className="task-conversation" key={task.id}>
                    <article className="message user-message">
                      <div>
                        <p>{task.goal}</p>
                      </div>
                    </article>
                    <article className="message assistant-message">
                      <div className="message-avatar assistant">
                        <Aperture size={15} />
                      </div>
                      <div className="assistant-content">
                        <div className="assistant-heading">
                          <span>OpenMovie</span>
                          <div className={`task-status ${task.status}`}>
                            {activeTaskStatuses.has(task.status) && <LoaderCircle size={12} />}
                            {taskStatusText(task.status, uiLocale)}
                          </div>
                        </div>
                        {task.status === 'failed' ? (
                          <div className="task-error">
                            <strong>{taskErrorSummary(task.error, uiLocale)}</strong>
                            {task.error && (
                              <details>
                                <summary>{text('技术详情', 'Technical details')}</summary>
                                <code>{task.error}</code>
                              </details>
                            )}
                          </div>
                        ) : (
                          <p>
                            {task.status === 'succeeded'
                              ? text(
                                  '任务已完成。新的工程变更或媒体资源已经出现在右侧。',
                                  'The task is complete. New project changes or media are available on the right.',
                                )
                              : task.status === 'awaiting_approval'
                                ? text(
                                    '这个任务将调用远程服务，需要你确认后才能继续。',
                                    'This task will contact a remote service and needs your approval.',
                                  )
                                : text(
                                    '正在分析工程并执行任务，你可以继续浏览右侧资源。',
                                    'I am inspecting the project and working through the task.',
                                  )}
                          </p>
                        )}
                        <div className="task-steps">
                          {task.steps.map((step) => (
                            <div key={step.id} className={`task-step ${step.status}`}>
                              <span className="step-indicator" />
                              <span>{taskStepText(step.title, uiLocale)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="message-actions">
                          {task.status === 'awaiting_approval' && (
                            <button
                              className="primary-button compact"
                              onClick={() => approveTask(task.id)}
                            >
                              <Check size={14} /> {text('批准并继续', 'Approve and continue')}
                            </button>
                          )}
                          {activeTaskStatuses.has(task.status) && (
                            <button className="text-button" onClick={() => cancelTask(task.id)}>
                              <Square size={12} /> {text('停止', 'Stop')}
                            </button>
                          )}
                          {task.status === 'failed' && (
                            <button className="text-button" onClick={() => editPrompt(task.goal)}>
                              <RotateCcw size={12} /> {text('修改后重试', 'Edit and retry')}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  </div>
                ))}
              {proposals
                .filter((proposal) => proposal.status === 'pending')
                .map((proposal) => (
                  <article className="message assistant-message" key={proposal.id}>
                    <div className="message-avatar assistant">
                      <Aperture size={15} />
                    </div>
                    <div className="assistant-content proposal-message">
                      <div className="assistant-heading">
                        <span>{text('工程修改提案', 'Project change proposal')}</span>
                        <div className="task-status awaiting_approval">
                          {proposal.plan.actions.length} {text('项修改', 'changes')}
                        </div>
                      </div>
                      <p>{proposal.summary}</p>
                      <div className="proposal-actions-preview">
                        {proposal.plan.actions.map((action, index) => (
                          <code key={`${proposal.id}-${index}`}>{action.type}</code>
                        ))}
                      </div>
                      <div className="message-actions">
                        <button
                          className="primary-button compact"
                          onClick={() => acceptProposal(proposal.id)}
                        >
                          <Check size={14} /> {text('应用到工程', 'Apply to project')}
                        </button>
                        <button className="text-button" onClick={() => rejectProposal(proposal.id)}>
                          <X size={13} /> {text('拒绝', 'Reject')}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          )}
          <div ref={threadEnd} />
        </section>
        {error && (
          <div className="inline-error" role="alert">
            <CircleAlert size={15} />
            <span>{applicationErrorText(error, uiLocale)}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        <footer className="composer-area">
          <div className={project ? 'composer' : 'composer disabled'}>
            <textarea
              ref={composerInput}
              value={composer}
              disabled={!project || busy}
              placeholder={
                project
                  ? text('描述你想创作或修改的内容…', 'Describe what you want to create or change…')
                  : text('先创建或打开一个电影工程', 'Create or open a movie project first')
              }
              rows={2}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="composer-options">
                <label>
                  <Bot size={13} />
                  <select
                    value={plannerProviderId}
                    onChange={(event) => setPlannerProviderId(event.target.value)}
                    disabled={!project}
                  >
                    {planningProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={
                    showComposerSettings
                      ? 'composer-settings-toggle active'
                      : 'composer-settings-toggle'
                  }
                  aria-expanded={showComposerSettings}
                  title={text('生成设置', 'Generation settings')}
                  disabled={!project}
                  onClick={() => setShowComposerSettings((value) => !value)}
                >
                  <SlidersHorizontal size={12} />
                  {text('生成设置', 'Generation')}
                </button>
                {showComposerSettings && (
                  <div className="composer-advanced-options">
                    <label>
                      {mediaKind === 'image' ? <ImageIcon size={13} /> : <Video size={13} />}
                      <select
                        value={mediaKind}
                        onChange={(event) => setMediaKind(event.target.value as 'image' | 'video')}
                        disabled={!project}
                      >
                        <option value="image">{text('图片', 'Image')}</option>
                        <option value="video">{text('视频', 'Video')}</option>
                      </select>
                    </label>
                    <label>
                      <Sparkles size={13} />
                      <select
                        value={mediaProviderId}
                        onChange={(event) => setMediaProviderId(event.target.value)}
                        disabled={!project}
                      >
                        {mediaProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {selectedShotId && (
                  <span className="target-chip">
                    <Clapperboard size={12} /> {selectedShotId}
                    <button onClick={() => setSelection(null)} aria-label="Clear target">
                      <X size={11} />
                    </button>
                  </span>
                )}
              </div>
              <button
                className="send-button"
                aria-label={text('发送', 'Send')}
                disabled={!project || busy || !composer.trim()}
                onClick={submitPrompt}
              >
                {busy ? <LoaderCircle size={17} /> : <Send size={17} />}
              </button>
            </div>
          </div>
          <small>
            {text('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for newline')}
          </small>
        </footer>
      </main>

      <aside className="resource-pane">
        <header className="resource-header">
          <div className="resource-tabs">
            <button
              className={resourceView === 'resources' ? 'active' : ''}
              onClick={() => setResourceView('resources')}
            >
              <PanelRight size={14} /> {text('资源', 'Resources')}
            </button>
            <button
              className={resourceView === 'versions' ? 'active' : ''}
              onClick={() => setResourceView('versions')}
            >
              <History size={14} /> {text('版本', 'Versions')}
            </button>
          </div>
          {project && (
            <div className="resource-count">
              {takes.length + renders.length} {text('个媒体资源', 'media assets')}
            </div>
          )}
        </header>
        {!project ? (
          <div className="resource-empty">
            <PanelRight size={25} />
            <strong>{text('工程资源会显示在这里', 'Project resources appear here')}</strong>
            <p>
              {text(
                '镜头、Take、分析和成片都会保持可检查。',
                'Shots, Takes, analyses, and cuts stay inspectable.',
              )}
            </p>
          </div>
        ) : resourceView === 'versions' ? (
          <div className="resource-scroll versions-view">
            <div className="pane-section-heading">
              <div>
                <span>{text('当前分支', 'CURRENT BRANCH')}</span>
                <h2>{project.currentBranch}</h2>
              </div>
              <GitBranch size={18} />
            </div>
            <div className="revision-list">
              {revisions.map((revision, index) => (
                <button
                  key={revision.id}
                  className={
                    selection?.kind === 'revision' && selection.item.id === revision.id
                      ? 'revision-card selected'
                      : 'revision-card'
                  }
                  onClick={() => setSelection({ kind: 'revision', item: revision })}
                >
                  <span className="revision-dot" />
                  <div>
                    <strong>{revision.message}</strong>
                    <small>
                      {index === 0 ? text('当前版本', 'Current') : revision.authorId} ·{' '}
                      {new Date(revision.createdAt).toLocaleString()}
                    </small>
                  </div>
                </button>
              ))}
            </div>
            {selection?.kind === 'revision' && (
              <div className="inspector-card">
                <span className="section-kicker">REVISION</span>
                <h3>{selection.item.message}</h3>
                <code>{selection.item.id}</code>
                <p>
                  {selection.item.changedPaths.join('\n') ||
                    text('没有文件变化', 'No file changes')}
                </p>
                <button
                  className="secondary-button"
                  onClick={() => restoreRevision(selection.item)}
                >
                  <RotateCcw size={14} /> {text('恢复为新版本', 'Restore as new revision')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="resource-scroll">
            {hasProjectResources && (
              <div className="resource-search">
                <Search size={14} />
                <input
                  value={resourceSearch}
                  placeholder={text('搜索工程资源', 'Search project resources')}
                  onChange={(event) => setResourceSearch(event.target.value)}
                />
              </div>
            )}
            {selection && (
              <ResourceInspector
                selection={selection}
                locale={uiLocale}
                onSelectTake={selectTake}
              />
            )}
            {!hasProjectResources && (
              <div className="workspace-empty-state">
                <div className="workspace-empty-icon">
                  <Sparkles size={20} />
                </div>
                <strong>{text('从对话开始创作', 'Start creating in chat')}</strong>
                <p>
                  {text(
                    '描述故事、画面或一个镜头。OpenMovie 会先给出可审查的工程修改，再生成媒体资源。',
                    'Describe a story, image, or shot. OpenMovie will propose reviewable project changes before generating media.',
                  )}
                </p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    editPrompt(
                      text(
                        '帮我设计开场场景，并拆分成三个连续镜头',
                        'Design the opening scene and break it into three continuous shots',
                      ),
                    )
                  }
                >
                  <MessageSquare size={14} /> {text('填写创作目标', 'Draft a creative goal')}
                </button>
              </div>
            )}
            {(takes.length > 0 || renders.length > 0) && (
              <section className="resource-section">
                <div className="section-title">
                  <span>{text('媒体', 'MEDIA')}</span>
                  <small>{takes.length + renders.length}</small>
                </div>
                <div className="media-grid">
                  {filteredTakes.map((take) => {
                    const url = artifactUrl(take.artifact.objectUri);
                    return (
                      <button
                        key={take.id}
                        className="media-card"
                        onClick={() => setSelection({ kind: 'take', item: take })}
                      >
                        <div className="media-preview">
                          {url && take.artifact.mimeType.startsWith('image/') ? (
                            <img src={url} alt="" />
                          ) : url && take.artifact.mimeType.startsWith('video/') ? (
                            <video src={url} muted />
                          ) : (
                            <Film size={21} />
                          )}
                        </div>
                        <span>{take.shotId}</span>
                        <small>{formatBytes(take.artifact.byteSize)}</small>
                      </button>
                    );
                  })}
                  {renders.map((render) => (
                    <button
                      key={render.id}
                      className="media-card render-card"
                      onClick={() => setSelection({ kind: 'render', item: render })}
                    >
                      <div className="media-preview">
                        <video src={artifactUrl(render.objectUri)} muted />
                        <span className="cut-badge">CUT</span>
                      </div>
                      <span>{text('当前成片', 'Current cut')}</span>
                      <small>{(render.durationUs / 1_000_000).toFixed(1)}s</small>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {shots.length > 0 && (
              <section className="resource-section">
                <div className="section-title">
                  <span>{text('镜头', 'SHOTS')}</span>
                  <small>{shots.length}</small>
                </div>
                <div className="shot-grid">
                  {filteredShots.map((shot, index) => (
                    <button
                      key={shot.id}
                      className={
                        selection?.kind === 'shot' && selection.item.id === shot.id
                          ? 'shot-card selected'
                          : 'shot-card'
                      }
                      onClick={() => setSelection({ kind: 'shot', item: shot })}
                    >
                      <div className="shot-number">{String(index + 1).padStart(2, '0')}</div>
                      <div>
                        <strong>{shot.camera.framing || text('未设置景别', 'No framing')}</strong>
                        <small>
                          {(shot.duration_us / 1_000_000).toFixed(1)}s ·{' '}
                          {takes.filter((take) => take.shotId === shot.id).length} Takes
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className="resource-section compact-section">
              <div className="section-title">
                <span>{text('工程操作', 'PROJECT ACTIONS')}</span>
              </div>
              <div className="project-actions-grid">
                <button
                  className="secondary-button"
                  disabled={busy || shots.length === 0}
                  title={
                    shots.length === 0
                      ? text('先通过对话创建镜头', 'Create shots in chat first')
                      : undefined
                  }
                  onClick={assembleTimeline}
                >
                  <Clapperboard size={14} /> {text('组装时间线', 'Assemble timeline')}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || shots.length === 0 || !hasSelectedTake}
                  title={
                    shots.length === 0
                      ? text('先通过对话创建镜头', 'Create shots in chat first')
                      : !hasSelectedTake
                        ? text('先为镜头选择一个 Take', 'Select a Take for a shot first')
                        : undefined
                  }
                  onClick={renderTimeline}
                >
                  <Video size={14} /> {text('渲染成片', 'Render cut')}
                </button>
                <button className="secondary-button" disabled={busy} onClick={runDoctor}>
                  <Check size={14} /> {text('检查工程', 'Run checks')}
                </button>
              </div>
            </section>
          </div>
        )}
      </aside>

      {showCreate && (
        <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" onClick={() => setShowCreate(false)}>
              <X size={16} />
            </button>
            <span className="section-kicker">NEW PROJECT</span>
            <h2>{text('创建电影工程', 'Create a movie project')}</h2>
            <p>
              {text(
                '工程目录包含可版本化的电影定义和本地媒体对象。',
                'The folder contains versioned movie definitions and local media objects.',
              )}
            </p>
            <label className="field-label">
              {text('电影名称', 'Movie title')}
              <input
                autoFocus
                value={newProjectTitle}
                onChange={(event) => setNewProjectTitle(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setShowCreate(false)}>
                {text('取消', 'Cancel')}
              </button>
              <button
                className="primary-button"
                disabled={busy || !newProjectTitle.trim()}
                onClick={createProject}
              >
                {text('选择目录并创建', 'Choose folder and create')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}>
          <div
            className="dialog settings-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" onClick={() => setShowSettings(false)}>
              <X size={16} />
            </button>
            <span className="section-kicker">SETTINGS</span>
            <h2>{text('OpenMovie 设置', 'OpenMovie settings')}</h2>
            <div className="settings-section">
              <h3>{text('应用', 'Application')}</h3>
              <div className="settings-row">
                <div>
                  <strong>{text('语言', 'Language')}</strong>
                  <small>{text('只保存在当前设备', 'Stored on this device')}</small>
                </div>
                <select
                  value={uiLocale}
                  onChange={(event) => setUiLocale(event.target.value as UiLocale)}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="settings-row">
                <div>
                  <strong>OpenMovie {updateState?.currentVersion ?? ''}</strong>
                  <small>{updateState?.message ?? ''}</small>
                </div>
                <span className="settings-value">
                  {runtime.kind === 'ready' && runtime.health.media.ffmpeg.available
                    ? 'FFmpeg ready'
                    : 'FFmpeg unavailable'}
                </span>
              </div>
            </div>
            {project && (
              <div className="settings-section">
                <h3>{text('工程策略', 'Project policy')}</h3>
                <div className="settings-columns">
                  <label className="field-label">
                    {text('月度费用上限（美元）', 'Monthly budget (USD)')}
                    <input
                      value={monthlyBudgetUsd}
                      placeholder={text('不限', 'Unlimited')}
                      onChange={(event) => setMonthlyBudgetUsd(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    {text('远程数据', 'Remote data')}
                    <select
                      value={remoteMediaPolicy}
                      onChange={(event) =>
                        setRemoteMediaPolicy(event.target.value as 'allow' | 'confirm' | 'deny')
                      }
                    >
                      <option value="confirm">{text('每次确认', 'Confirm')}</option>
                      <option value="allow">{text('允许', 'Allow')}</option>
                      <option value="deny">{text('禁止', 'Deny')}</option>
                    </select>
                  </label>
                </div>
                <p className="settings-note">
                  {usage
                    ? text(
                        `${usage.period}：${usage.runCount} 次调用，已报告 $${(usage.costUsdMicros / 1_000_000).toFixed(4)}，${usage.unpricedRunCount} 次未定价。`,
                        `${usage.period}: ${usage.runCount} calls, $${(usage.costUsdMicros / 1_000_000).toFixed(4)} reported, ${usage.unpricedRunCount} unpriced.`,
                      )
                    : ''}
                </p>
                <button className="secondary-button" onClick={savePolicies}>
                  {text('保存工程策略', 'Save project policy')}
                </button>
              </div>
            )}
            <div className="settings-section">
              <h3>{text('模型 Provider', 'Model providers')}</h3>
              {providers.map((provider) => (
                <div className="settings-row" key={provider.id}>
                  <div>
                    <strong>{provider.label}</strong>
                    <small>
                      {provider.protocol} · {provider.model}
                    </small>
                  </div>
                  <span className={`provider-state ${provider.hasSecret ? 'ready' : ''}`}>
                    {provider.hasSecret ? text('已连接', 'Connected') : text('缺少密钥', 'No key')}
                  </span>
                </div>
              ))}
              <div className="provider-form-grid">
                <label className="field-label">
                  ID
                  <input
                    value={providerForm.id}
                    onChange={(event) =>
                      setProviderForm({ ...providerForm, id: event.target.value })
                    }
                  />
                </label>
                <label className="field-label">
                  {text('名称', 'Name')}
                  <input
                    value={providerForm.label}
                    onChange={(event) =>
                      setProviderForm({ ...providerForm, label: event.target.value })
                    }
                  />
                </label>
                <label className="field-label">
                  {text('协议', 'Protocol')}
                  <select
                    value={providerForm.protocol}
                    onChange={(event) =>
                      setProviderForm({
                        ...providerForm,
                        protocol: event.target.value as ProviderProfile['protocol'],
                      })
                    }
                  >
                    <option value="openai_chat">OpenAI Chat</option>
                    <option value="openai_responses">OpenAI Responses</option>
                    <option value="openai_images">OpenAI Images</option>
                    <option value="http_video_jobs">HTTP Video Jobs</option>
                    <option value="custom">Custom Chat-compatible</option>
                  </select>
                </label>
                <label className="field-label">
                  Model
                  <input
                    value={providerForm.model}
                    onChange={(event) =>
                      setProviderForm({ ...providerForm, model: event.target.value })
                    }
                  />
                </label>
                <label className="field-label full">
                  Base URL
                  <input
                    value={providerForm.baseUrl}
                    onChange={(event) =>
                      setProviderForm({ ...providerForm, baseUrl: event.target.value })
                    }
                  />
                </label>
                <label className="field-label full">
                  API Key
                  <input
                    type="password"
                    autoComplete="off"
                    value={providerForm.apiKey}
                    onChange={(event) =>
                      setProviderForm({ ...providerForm, apiKey: event.target.value })
                    }
                  />
                </label>
              </div>
              <button
                className="primary-button"
                disabled={busy || !providerForm.model || !providerForm.apiKey}
                onClick={saveProvider}
              >
                {text('保存 Provider', 'Save provider')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceInspector({
  selection,
  locale,
  onSelectTake,
}: {
  selection: ResourceSelection;
  locale: UiLocale;
  onSelectTake: (take: TakeRecord) => void;
}): React.JSX.Element {
  const text = (zh: string, en: string): string => (locale === 'zh-CN' ? zh : en);
  if (selection.kind === 'take') {
    const take = selection.item;
    const url = artifactUrl(take.artifact.objectUri);
    return (
      <section className="inspector-card media-inspector">
        <div className="inspector-media">
          {url && take.artifact.mimeType.startsWith('image/') ? (
            <img src={url} alt="" />
          ) : url ? (
            <video src={url} controls />
          ) : null}
        </div>
        <div className="inspector-title">
          <div>
            <span className="section-kicker">TAKE</span>
            <h3>{take.shotId}</h3>
          </div>
          <span>{formatBytes(take.artifact.byteSize)}</span>
        </div>
        <div className="metadata-grid">
          <span>
            MIME<strong>{take.artifact.mimeType}</strong>
          </span>
          <span>
            Provider
            <strong>
              {typeof take.provider.providerId === 'string' ? take.provider.providerId : 'unknown'}
            </strong>
          </span>
        </div>
        <button className="primary-button compact" onClick={() => onSelectTake(take)}>
          <Check size={14} /> {text('选为当前 Take', 'Select this Take')}
        </button>
      </section>
    );
  }
  if (selection.kind === 'render') {
    const render = selection.item;
    return (
      <section className="inspector-card media-inspector">
        <div className="inspector-media">
          <video src={artifactUrl(render.objectUri)} controls />
        </div>
        <div className="inspector-title">
          <div>
            <span className="section-kicker">CURRENT CUT</span>
            <h3>{text('时间线成片', 'Timeline render')}</h3>
          </div>
          <span>{(render.durationUs / 1_000_000).toFixed(1)}s</span>
        </div>
        <code>{render.sourceRevisionId}</code>
      </section>
    );
  }
  if (selection.kind === 'shot') {
    const shot = selection.item;
    return (
      <section className="inspector-card">
        <span className="section-kicker">SHOT</span>
        <h3>{shot.id}</h3>
        <p>
          {shot.camera.framing || text('尚未设置景别', 'No framing yet')} ·{' '}
          {shot.camera.movement || text('静止机位', 'Static camera')}
        </p>
        <div className="metadata-grid">
          <span>
            {text('时长', 'Duration')}
            <strong>{(shot.duration_us / 1_000_000).toFixed(1)}s</strong>
          </span>
          <span>
            {text('选中 Take', 'Selected Take')}
            <strong>{shot.selected_take ?? '—'}</strong>
          </span>
        </div>
      </section>
    );
  }
  if (selection.kind === 'scene')
    return (
      <section className="inspector-card">
        <span className="section-kicker">SCENE {selection.item.order + 1}</span>
        <h3>{selection.item.title}</h3>
        <p>{selection.item.story_goal || text('尚未设置场景目标', 'No story goal yet')}</p>
        <small>
          {selection.item.shots.length} {text('个镜头', 'shots')}
        </small>
      </section>
    );
  if (selection.kind === 'character')
    return (
      <section className="inspector-card">
        <span className="section-kicker">CHARACTER</span>
        <h3>{selection.item.name}</h3>
        <p>
          {selection.item.identity.appearance || text('尚未定义外观', 'Appearance not defined')}
        </p>
      </section>
    );
  if (selection.kind === 'story')
    return (
      <section className="inspector-card">
        <span className="section-kicker">STORY</span>
        <h3>{selection.item.brief.title}</h3>
        <p>
          {selection.item.brief.premise ||
            text('通过对话建立故事前提', 'Use the conversation to define the premise')}
        </p>
        <div className="tag-list">
          {selection.item.bible.themes.map((theme) => (
            <span key={theme}>{theme}</span>
          ))}
        </div>
      </section>
    );
  if (selection.kind === 'doctor')
    return (
      <section className={`inspector-card doctor-card ${selection.item.status}`}>
        <span className="section-kicker">PROJECT DOCTOR</span>
        <h3>{selection.item.status}</h3>
        <p>
          {selection.item.checks} {text('项检查', 'checks')} · {selection.item.issues.length}{' '}
          {text('个问题', 'issues')}
        </p>
        {selection.item.issues.map((issue) => (
          <div className="doctor-issue" key={`${issue.code}-${issue.path ?? ''}`}>
            <CircleAlert size={13} />
            <span>
              <strong>{issue.code}</strong>
              {issue.message}
            </span>
          </div>
        ))}
      </section>
    );
  if (selection.kind === 'project')
    return (
      <section className="inspector-card project-inspector">
        <span className="section-kicker">PROJECT</span>
        <h3>{selection.item.title}</h3>
        <p>{selection.item.root}</p>
        <div className="metadata-grid">
          <span>
            {text('画幅', 'Frame')}
            <strong>
              {selection.item.delivery.width} × {selection.item.delivery.height}
            </strong>
          </span>
          <span>
            {text('帧率', 'Frame rate')}
            <strong>
              {selection.item.delivery.frameRate.numerator /
                selection.item.delivery.frameRate.denominator}{' '}
              fps
            </strong>
          </span>
        </div>
      </section>
    );
  return (
    <section className="inspector-card">
      <span className="section-kicker">REVISION</span>
      <h3>{selection.item.message}</h3>
    </section>
  );
}
