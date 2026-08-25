import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ExtractedFrame = { path: string; timeUs: number };
export type TimelineRenderClip = {
  path: string;
  mimeType: string;
  durationUs: number;
  sourceInUs?: number;
};

export type TimelineRenderOptions = {
  clips: TimelineRenderClip[];
  outputPath: string;
  workRoot: string;
  width: number;
  height: number;
  frameRate: { numerator: number; denominator: number };
  audioSampleRate: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};

export type VideoEncoder = 'libx264' | 'h264_videotoolbox' | 'h264_mf' | 'mpeg4';

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

export class FfmpegTimelineRenderer {
  constructor(
    private readonly executable = process.env.OPENMOVIE_FFMPEG_PATH || 'ffmpeg',
    private readonly probeExecutable = process.env.OPENMOVIE_FFPROBE_PATH || 'ffprobe',
  ) {}

  async detect(): Promise<{ available: boolean; version?: string }> {
    try {
      const output = await run(this.executable, ['-version']);
      const version = output.split('\n')[0];
      return { available: true, ...(version ? { version } : {}) };
    } catch {
      return { available: false };
    }
  }

  async render(options: TimelineRenderOptions): Promise<void> {
    if (options.clips.length === 0) throw new Error('Timeline has no selected media to render');
    await mkdir(options.workRoot, { recursive: true });
    const rate = `${options.frameRate.numerator}/${options.frameRate.denominator}`;
    const videoEncoders = supportedVideoEncoders(
      await run(this.executable, ['-hide_banner', '-encoders'], options.signal),
    );
    if (videoEncoders.length === 0) throw new Error('FFmpeg has no supported MP4 video encoder');
    let selectedVideoEncoder: VideoEncoder | undefined;
    const filter = [
      `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease`,
      `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `fps=${rate}`,
      'format=yuv420p',
    ].join(',');
    const segments: string[] = [];
    for (const [index, clip] of options.clips.entries()) {
      const segment = join(options.workRoot, `segment-${String(index).padStart(4, '0')}.mp4`);
      const duration = (clip.durationUs / 1_000_000).toFixed(6);
      const hasSourceAudio =
        !clip.mimeType.startsWith('image/') &&
        (await this.hasAudioStream(clip.path, options.signal));
      const input = clip.mimeType.startsWith('image/')
        ? ['-loop', '1', '-i', clip.path]
        : ['-ss', ((clip.sourceInUs ?? 0) / 1_000_000).toFixed(6), '-i', clip.path];
      const silentAudioInput = hasSourceAudio
        ? []
        : [
            '-f',
            'lavfi',
            '-i',
            `anullsrc=channel_layout=stereo:sample_rate=${options.audioSampleRate}`,
          ];
      const segmentArguments = (videoEncoder: VideoEncoder): string[] => [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        ...input,
        ...silentAudioInput,
        '-t',
        duration,
        '-map',
        '0:v:0',
        '-map',
        hasSourceAudio ? '0:a:0' : '1:a:0',
        '-vf',
        filter,
        '-c:v',
        videoEncoder,
        ...encoderArguments(videoEncoder),
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        String(options.audioSampleRate),
        '-ac',
        '2',
        '-af',
        'apad',
        '-movflags',
        '+faststart',
        '-y',
        segment,
      ];
      if (selectedVideoEncoder) {
        await run(this.executable, segmentArguments(selectedVideoEncoder), options.signal);
      } else {
        let lastError: unknown;
        for (const videoEncoder of videoEncoders) {
          try {
            await run(this.executable, segmentArguments(videoEncoder), options.signal);
            selectedVideoEncoder = videoEncoder;
            break;
          } catch (error) {
            if (options.signal?.aborted) throw error;
            lastError = error;
          }
        }
        if (!selectedVideoEncoder) {
          throw lastError instanceof Error ? lastError : new Error('No video encoder succeeded');
        }
      }
      segments.push(segment);
      options.onProgress?.(index + 1, options.clips.length + 1);
    }
    const manifest = join(options.workRoot, 'segments.ffconcat');
    const content = [
      'ffconcat version 1.0',
      ...segments.map((path) => `file '${quote(path)}'`),
    ].join('\n');
    await writeFile(manifest, `${content}\n`, 'utf8');
    await run(
      this.executable,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        manifest,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-y',
        options.outputPath,
      ],
      options.signal,
    );
    options.onProgress?.(options.clips.length + 1, options.clips.length + 1);
  }

  private async hasAudioStream(path: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const output = await run(
        this.probeExecutable,
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=index',
          '-of',
          'csv=p=0',
          path,
        ],
        signal,
      );
      return output.trim().length > 0;
    } catch (error) {
      if (signal?.aborted) throw error;
      return false;
    }
  }
}

export function selectVideoEncoder(encoders: string): VideoEncoder {
  const selected = supportedVideoEncoders(encoders)[0];
  if (selected) return selected;
  throw new Error('FFmpeg has no supported MP4 video encoder');
}

function supportedVideoEncoders(encoders: string): VideoEncoder[] {
  const supported: VideoEncoder[] = [];
  for (const encoder of ['libx264', 'h264_videotoolbox', 'h264_mf', 'mpeg4'] as const) {
    if (new RegExp(`(?:^|\\s)${encoder.replaceAll('_', '\\_')}(?:\\s|$)`, 'm').test(encoders)) {
      supported.push(encoder);
    }
  }
  return supported;
}

function encoderArguments(encoder: VideoEncoder): string[] {
  if (encoder === 'libx264') return ['-preset', 'medium', '-crf', '18'];
  if (encoder === 'mpeg4') return ['-q:v', '3'];
  return ['-b:v', '8M'];
}

function quote(path: string): string {
  return path.replaceAll("'", "'\\''");
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
