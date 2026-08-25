import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolvePackagedMediaSidecar(
  resourcesPath: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): NodeJS.ProcessEnv {
  const suffix = platform === 'win32' ? '.exe' : '';
  const ffmpeg = join(resourcesPath, 'ffmpeg', 'bin', `ffmpeg${suffix}`);
  const ffprobe = join(resourcesPath, 'ffmpeg', 'bin', `ffprobe${suffix}`);
  if (!exists(ffmpeg) || !exists(ffprobe)) return {};
  return {
    OPENMOVIE_FFMPEG_PATH: ffmpeg,
    OPENMOVIE_FFPROBE_PATH: ffprobe,
    OPENMOVIE_FFMPEG_SOURCE: 'bundled',
  };
}
