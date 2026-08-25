import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DesktopUpdateManager, type UpdateClient } from './update-manager.js';

class FakeUpdateClient extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  checkForUpdates = vi.fn(() => Promise.resolve(null));
  quitAndInstall = vi.fn();
}

describe('DesktopUpdateManager', () => {
  it('stays inert in development builds', async () => {
    const client = new FakeUpdateClient();
    const manager = new DesktopUpdateManager(client as unknown as UpdateClient, {
      enabled: false,
      currentVersion: '0.1.0',
    });

    expect((await manager.check()).status).toBe('disabled');
    expect(client.checkForUpdates).not.toHaveBeenCalled();
  });

  it('downloads but never installs without an explicit user action', async () => {
    const client = new FakeUpdateClient();
    const manager = new DesktopUpdateManager(client as unknown as UpdateClient, {
      enabled: true,
      currentVersion: '0.1.0',
    });

    expect(client.autoDownload).toBe(true);
    expect(client.autoInstallOnAppQuit).toBe(false);
    await manager.check();
    client.emit('update-available', { version: '0.2.0' });
    client.emit('download-progress', { percent: 54.6 });
    expect(manager.getState()).toMatchObject({
      status: 'downloading',
      availableVersion: '0.2.0',
      progressPercent: 55,
    });
    expect(client.quitAndInstall).not.toHaveBeenCalled();

    client.emit('update-downloaded', { version: '0.2.0' });
    manager.install();
    expect(client.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('does not expose network errors or remote response details', async () => {
    const client = new FakeUpdateClient();
    client.checkForUpdates.mockRejectedValueOnce(
      new Error('request contained https://token@example.invalid/private'),
    );
    const manager = new DesktopUpdateManager(client as unknown as UpdateClient, {
      enabled: true,
      currentVersion: '0.1.0',
    });

    expect(await manager.check()).toMatchObject({
      status: 'error',
      message: 'Update check failed. Try again later.',
    });
  });
});
