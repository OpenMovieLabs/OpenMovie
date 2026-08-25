import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePackagedMediaSidecar } from './media-sidecar.js';

describe('packaged FFmpeg Sidecar', () => {
  it('resolves both executables from the immutable resources directory', () => {
    const root = join('fixture', 'resources');
    const result = resolvePackagedMediaSidecar(root, 'win32', () => true);

    expect(result).toEqual({
      OPENMOVIE_FFMPEG_PATH: join(root, 'ffmpeg', 'bin', 'ffmpeg.exe'),
      OPENMOVIE_FFPROBE_PATH: join(root, 'ffmpeg', 'bin', 'ffprobe.exe'),
      OPENMOVIE_FFMPEG_SOURCE: 'bundled',
    });
  });

  it('does not partially configure a damaged Sidecar', () => {
    const result = resolvePackagedMediaSidecar(join('fixture', 'resources'), 'darwin', (path) =>
      path.endsWith('/ffmpeg'),
    );
    expect(result).toEqual({});
  });
});
