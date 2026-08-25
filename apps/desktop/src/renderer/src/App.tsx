import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Clapperboard,
  Clock3,
  FolderOpen,
  History,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';

import type {
  CoreHealth,
  HarnessHealth,
  InitializeResult,
  ProjectSummary,
  RevisionRecord,
  Task,
} from '@openmovie/contracts';
import type { ProviderProfile } from '../../preload/index.js';

type RuntimeState =
  | { kind: 'loading' }
  | { kind: 'ready'; initialize: InitializeResult; health: CoreHealth }
  | { kind: 'error'; message: string };

export function App(): React.JSX.Element {
  const initialized = useRef(false);
  const [runtime, setRuntime] = useState<RuntimeState>({ kind: 'loading' });
  const [harnesses, setHarnesses] = useState<HarnessHealth[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [providerForm, setProviderForm] = useState({
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    protocol: 'openai_chat' as const,
    model: '',
    apiKey: '',
  });
  const [plannerProviderId, setPlannerProviderId] = useState('fake');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [title, setTitle] = useState('Untitled Movie');
  const [goal, setGoal] = useState('Create a cinematic establishing frame for the opening scene');
  const [lastTask, setLastTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void Promise.all([
      window.openMovie.initialize(),
      window.openMovie.coreHealth(),
      window.openMovie.listHarnesses(),
    ])
      .then(([initialize, health, detectedHarnesses]) => {
        setRuntime({ kind: 'ready', initialize, health });
        setHarnesses(detectedHarnesses);
        window.openMovie.reportReady();
      })
      .catch((caught: unknown) => {
        setRuntime({
          kind: 'error',
          message: caught instanceof Error ? caught.message : String(caught),
        });
      });
  }, []);

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
    setRevisions(await window.openMovie.listRevisions());
    const tasks = await window.openMovie.listTasks();
    setLastTask(tasks.at(-1) ?? null);
  };

  const createProject = (): void => {
    void run(async () => {
      const created = await window.openMovie.createProject(title);
      if (!created) return;
      setShowCreate(false);
      await loadProject(created);
    });
  };

  const openProject = (): void => {
    void run(async () => {
      const opened = await window.openMovie.openProject();
      if (opened) await loadProject(opened);
    });
  };

  const renameProject = (): void => {
    if (!project || title.trim() === project.title) return;
    void run(async () => loadProject(await window.openMovie.renameProject(title)));
  };

  const restoreRevision = (revisionId: string): void => {
    void run(async () => loadProject(await window.openMovie.restoreRevision(revisionId)));
  };

  const runTask = (): void => {
    void run(async () => {
      const result = await window.openMovie.runTask(goal, plannerProviderId, requiresApproval);
      setLastTask(result.task);
      setProject(result.project);
      setRevisions(result.revisions);
      setShowTask(false);
    });
  };

  const approveTask = (): void => {
    if (!lastTask) return;
    void run(async () => {
      const result = await window.openMovie.approveTask(lastTask.id);
      setLastTask(result.task);
      setProject(result.project);
      setRevisions(result.revisions);
    });
  };

  const openTask = (): void => {
    void run(async () => {
      setProviders(await window.openMovie.listProviders());
      setShowTask(true);
    });
  };

  const openSettings = (): void => {
    void run(async () => {
      setProviders(await window.openMovie.listProviders());
      setShowSettings(true);
    });
  };

  const saveProvider = (): void => {
    void run(async () => {
      await window.openMovie.saveProvider(providerForm);
      setProviders(await window.openMovie.listProviders());
      setProviderForm((current) => ({ ...current, apiKey: '' }));
    });
  };

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <Clapperboard size={20} /> OpenMovie
          {project && <span className="project-crumb">/ {project.title}</span>}
        </div>
        <div className="runtime-chip" data-state={runtime.kind}>
          <span className="status-dot" />
          {runtime.kind === 'ready' ? `Core ${runtime.health.status}` : runtime.kind}
        </div>
        <button className="icon-button" aria-label="Settings" onClick={openSettings}>
          <Settings size={18} />
        </button>
      </header>

      {project ? (
        <main className="project-workspace">
          <aside className="project-nav">
            <div className="nav-label">PROJECT</div>
            {['Overview', 'Story', 'Characters', 'Scenes', 'Shots', 'Timeline', 'Tests'].map(
              (item, index) => (
                <button key={item} className={index === 0 ? 'nav-item active' : 'nav-item'}>
                  {item}
                  <ChevronRight size={14} />
                </button>
              ),
            )}
          </aside>
          <section className="project-main">
            <div className="project-heading">
              <div>
                <div className="eyebrow">
                  <Sparkles size={14} /> MOVIE PROJECT
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
                <p>
                  {project.delivery.width} × {project.delivery.height} · {project.locale} ·{' '}
                  {project.root}
                </p>
              </div>
              <button className="primary" disabled={busy} onClick={openTask}>
                <Sparkles size={17} /> Give OpenMovie a task
              </button>
            </div>

            {error && <div className="error-banner">{error}</div>}
            <div className="project-grid">
              <article className="empty-stage">
                <Clapperboard size={30} />
                <h2>Start with the story</h2>
                <p>
                  {lastTask
                    ? `Task ${lastTask.status}: ${lastTask.goal}`
                    : 'Describe the film you want to make. OpenMovie will turn the idea into inspectable scenes and shots.'}
                </p>
                <button className="secondary">
                  <Plus size={17} /> Add a scene
                </button>
                {lastTask?.status === 'awaiting_approval' && (
                  <button className="primary" disabled={busy} onClick={approveTask}>
                    Approve and continue
                  </button>
                )}
              </article>
              <article className="history-panel">
                <div className="panel-title">
                  <History size={17} /> Revisions
                </div>
                <div className="revision-list">
                  {revisions.map((revision) => (
                    <div className="revision-row" key={revision.id}>
                      <span className="revision-node" />
                      <div>
                        <strong>{revision.message}</strong>
                        <span>
                          <Clock3 size={12} /> {new Date(revision.createdAt).toLocaleString()}
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
              </article>
            </div>
          </section>
        </main>
      ) : (
        <main className="home">
          <section className="hero">
            <div className="eyebrow">
              <Sparkles size={14} /> AI-native filmmaking workspace
            </div>
            <h1>Build films like software.</h1>
            <p>Plan, generate, test, compare, and revise every shot in one inspectable project.</p>
            <div className="actions">
              <button className="primary" disabled={busy} onClick={() => setShowCreate(true)}>
                <Plus size={18} /> New movie
              </button>
              <button className="secondary" disabled={busy} onClick={openProject}>
                <FolderOpen size={18} /> Open project
              </button>
            </div>
            {error && <div className="error-banner">{error}</div>}
          </section>

          <section className="workspace-card">
            <div>
              <span className="section-label">RECENT PROJECTS</span>
              <h2>Your movies will appear here</h2>
              <p>
                Create a structured movie project, then give OpenMovie a goal in plain language.
              </p>
            </div>
            <div className="health-stack">
              <div className="runtime-status" data-state={runtime.kind}>
                <span className="status-dot" />
                {runtime.kind === 'loading' && 'Starting OpenMovie Core…'}
                {runtime.kind === 'error' && `Core unavailable: ${runtime.message}`}
                {runtime.kind === 'ready' &&
                  `Core ${runtime.health.status} · protocol ${runtime.initialize.protocolVersion}`}
              </div>
              <div className="harness-list">
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
                {providers
                  .filter((provider) => provider.hasSecret && provider.protocol === 'openai_chat')
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
            <p>
              The planning model produces visual intent; the deterministic image fixture keeps this
              early slice free of paid generation calls.
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
                  <span>{provider.model || provider.baseUrl}</span>
                </div>
                <span className={provider.hasSecret ? 'key-state ready' : 'key-state'}>
                  {provider.hasSecret ? 'Key saved' : 'No key'}
                </span>
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
            {error && <div className="error-banner">{error}</div>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowSettings(false)}>
                Close
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
