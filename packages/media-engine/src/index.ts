import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type ExtractedFrame = { path: string; timeUs: number };

export function sampleTimestamps(durationUs: number, count = 4): number[] {
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0) throw new Error('Invalid duration');
  if (!Number.isSafeInteger(count) || count <= 0 || count > 20)
    throw new Error('Invalid frame count');
  if (count === 1) return [Math.min(durationUs - 1, Math.round(durationUs / 2))];
  const edge = Math.min(250_000, Math.floor(durationUs / (count * 2)));
  const available = Math.max(0, durationUs - edge * 2);
  return Array.from({ length: count }, (_, index) =>
    Math.min(durationUs - 1, Math.round(edge + (available * index) / (count - 1))),
  );
}

export class FfmpegFrameExtractor {
  constructor(private readonly executable = process.env.OPENMOVIE_FFMPEG_PATH || 'ffmpeg') {}

  async detect(): Promise<{ available: boolean; version?: string }> {
    try {
      const output = await run(this.executable, ['-version']);
      const version = output.split('\n')[0];
      return { available: true, ...(version ? { version } : {}) };
    } catch {
      return { available: false };
    }
  }

  async extract(
    inputPath: string,
    outputRoot: string,
    durationUs: number,
    signal?: AbortSignal,
  ): Promise<ExtractedFrame[]> {
    await mkdir(outputRoot, { recursive: true });
    const frames: ExtractedFrame[] = [];
    for (const [index, timeUs] of sampleTimestamps(durationUs).entries()) {
      const path = join(outputRoot, `frame-${String(index).padStart(2, '0')}.jpg`);
      await run(
        this.executable,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          (timeUs / 1_000_000).toFixed(6),
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-vf',
          'scale=min(1280\\,iw):-2',
          '-y',
          path,
        ],
        signal,
      );
      frames.push({ path, timeUs });
    }
    return frames;
  }
}

function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 8_000) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code, exitSignal) => {
      if (code === 0) resolve(stdout);
      else
        reject(new Error(`Media command failed (${code ?? exitSignal ?? 'unknown'}): ${stderr}`));
    });
  });
}
