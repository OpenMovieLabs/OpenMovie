export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not_available'
  | 'error';

export type DesktopUpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  checkedAt?: string;
  message: string;
};

type UpdateInfo = { version?: unknown };
type DownloadProgress = { percent?: unknown };

export type UpdateClient = Pick<
  AppUpdater,
  'autoDownload' | 'autoInstallOnAppQuit' | 'on' | 'checkForUpdates' | 'quitAndInstall'
>;

export class DesktopUpdateManager {
  private state: DesktopUpdateState;

  constructor(
    private readonly client: UpdateClient,
    options: { enabled: boolean; currentVersion: string },
  ) {
    this.state = {
      status: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      message: options.enabled
        ? 'OpenMovie will check GitHub Releases for signed updates.'
        : 'Updates are available in installed Windows and macOS builds.',
    };
    if (!options.enabled) return;

    client.autoDownload = true;
    client.autoInstallOnAppQuit = false;
    client.on('checking-for-update', () => this.transition('checking', 'Checking for updates…'));
    client.on('update-available', (info) => {
      const version = versionFrom(info);
      this.state = {
        ...this.state,
        status: 'available',
        ...(version ? { availableVersion: version } : {}),
        message: version ? `Downloading OpenMovie ${version}…` : 'Downloading an update…',
      };
    });
    client.on('download-progress', (progress) => {
      const percent = percentFrom(progress);
      this.state = {
        ...this.state,
        status: 'downloading',
        ...(percent === undefined ? {} : { progressPercent: percent }),
        message: percent === undefined ? 'Downloading update…' : `Downloading update… ${percent}%`,
      };
    });
    client.on('update-downloaded', (info) => {
      const version = versionFrom(info);
      this.state = {
        ...this.state,
        status: 'downloaded',
        ...(version ? { availableVersion: version } : {}),
        progressPercent: 100,
        message: version
          ? `OpenMovie ${version} is ready to install.`
          : 'The update is ready to install.',
      };
    });
    client.on('update-not-available', () =>
      this.transition('not_available', 'OpenMovie is up to date.'),
    );
    client.on('error', () => this.transition('error', 'Update check failed. Try again later.'));
  }

  getState(): DesktopUpdateState {
    return { ...this.state };
  }

  async check(): Promise<DesktopUpdateState> {
    if (this.state.status === 'disabled') return this.getState();
    this.state = {
      ...this.state,
      status: 'checking',
      checkedAt: new Date().toISOString(),
      message: 'Checking for updates…',
    };
    try {
      await this.client.checkForUpdates();
    } catch {
      this.transition('error', 'Update check failed. Try again later.');
    }
    return this.getState();
  }

  install(): void {
    if (this.state.status !== 'downloaded') throw new Error('No downloaded update is ready');
    this.client.quitAndInstall(false, true);
  }

  private transition(status: UpdateStatus, message: string): void {
    this.state = { ...this.state, status, message };
  }
}

function versionFrom(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const version = (value as UpdateInfo).version;
  return typeof version === 'string' && version.length <= 100 ? version : undefined;
}

function percentFrom(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const percent = (value as DownloadProgress).percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
import type { AppUpdater } from 'electron-updater';
