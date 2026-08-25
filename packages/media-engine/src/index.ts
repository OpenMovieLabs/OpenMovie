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

export type MediaInspection = {
  durationUs: number;
  width: number;
  height: number;
  frameRate: string;
  hasAudio: boolean;
};

export type Waveform = {
  sampleRate: number;
  durationUs: number;
  peaks: number[];
  truncated: boolean;
};

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

export class FfmpegMediaAnalyzer {
  constructor(
    private readonly executable = process.env.OPENMOVIE_FFMPEG_PATH || 'ffmpeg',
    private readonly probeExecutable = process.env.OPENMOVIE_FFPROBE_PATH || 'ffprobe',
  ) {}

  async inspect(inputPath: string, signal?: AbortSignal): Promise<MediaInspection> {
    const output = await run(
      this.probeExecutable,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height,r_frame_rate',
        '-of',
        'json',
        inputPath,
      ],
      signal,
    );
    const value = JSON.parse(output) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
      }>;
    };
    const video = value.streams?.find((stream) => stream.codec_type === 'video');
    if (!video) throw new Error('Media has no video stream');
    const durationSeconds = Number(value.format?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Media duration is unavailable');
    }
    return {
      durationUs: Math.round(durationSeconds * 1_000_000),
      width: video.width ?? 0,
      height: video.height ?? 0,
      frameRate: video.r_frame_rate ?? '0/1',
      hasAudio: value.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
    };
  }

  async createProxy(
    inputPath: string,
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<VideoEncoder> {
    const encoders = supportedVideoEncoders(
      await run(this.executable, ['-hide_banner', '-encoders'], signal),
    );
    let lastError: unknown;
    for (const encoder of encoders) {
      try {
        await run(
          this.executable,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-i',
            inputPath,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-vf',
            'scale=min(1280\\,iw):-2,format=yuv420p',
            '-c:v',
            encoder,
            ...encoderArguments(encoder),
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            '-y',
            outputPath,
          ],
          signal,
        );
        return encoder;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No video encoder succeeded');
  }

  async extractAudio(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
    await run(
      this.executable,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        '-y',
        outputPath,
      ],
      signal,
    );
  }

  async waveform(
    inputPath: string,
    durationUs: number,
    buckets = 240,
    signal?: AbortSignal,
  ): Promise<Waveform> {
    const sampleRate = 8_000;
    const maximumDurationSeconds = 600;
    const pcm = await runBuffer(
      this.executable,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-t',
        String(maximumDurationSeconds),
        '-f',
        's16le',
        '-',
      ],
      signal,
      maximumDurationSeconds * sampleRate * 2 + 1024,
    );
    return buildWaveform(
      pcm,
      sampleRate,
      Math.min(durationUs, maximumDurationSeconds * 1_000_000),
      buckets,
      durationUs > maximumDurationSeconds * 1_000_000,
    );
  }

  async detectShotBoundaries(
    inputPath: string,
    threshold = 0.3,
    signal?: AbortSignal,
  ): Promise<number[]> {
    if (!(threshold > 0 && threshold < 1)) throw new Error('Invalid scene threshold');
    const result = await runDetailed(
      this.executable,
      [
        '-hide_banner',
        '-loglevel',
        'info',
        '-nostdin',
        '-i',
        inputPath,
        '-vf',
        `select='gt(scene,${threshold})',showinfo`,
        '-an',
        '-f',
        'null',
        '-',
      ],
      signal,
      1024 * 1024,
    );
    return parseSceneTimes(result.stderr);
  }
}

export function parseSceneTimes(output: string): number[] {
  return [...output.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map((match) =>
    Math.round(Number(match[1]) * 1_000_000),
  );
}

export function buildWaveform(
  pcm: Buffer,
  sampleRate: number,
  durationUs: number,
  buckets: number,
  truncated = false,
): Waveform {
  if (!Number.isSafeInteger(buckets) || buckets <= 0 || buckets > 2_000) {
    throw new Error('Invalid waveform bucket count');
  }
  const samples = Math.floor(pcm.length / 2);
  const peaks = Array.from({ length: buckets }, (_, bucket) => {
    const start = Math.floor((samples * bucket) / buckets);
    const end = Math.max(start + 1, Math.floor((samples * (bucket + 1)) / buckets));
    let peak = 0;
    for (let index = start; index < Math.min(end, samples); index += 1) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(index * 2)) / 32768);
    }
    return Math.round(peak * 10_000) / 10_000;
  });
  return { sampleRate, durationUs, peaks, truncated };
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
  return runDetailed(command, args, signal).then((result) => result.stdout);
}

function runDetailed(
  command: string,
  args: string[],
  signal?: AbortSignal,
  outputLimit = 8_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < outputLimit) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < outputLimit) stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code, exitSignal) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(new Error(`Media command failed (${code ?? exitSignal ?? 'unknown'}): ${stderr}`));
    });
  });
}

function runBuffer(
  command: string,
  args: string[],
  signal: AbortSignal | undefined,
  outputLimit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    const chunks: Buffer[] = [];
    let byteSize = 0;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      byteSize += chunk.length;
      if (byteSize > outputLimit) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code, exitSignal) => {
      if (byteSize > outputLimit) reject(new Error('Media command output exceeds safe limit'));
      else if (code === 0) resolve(Buffer.concat(chunks));
      else
        reject(new Error(`Media command failed (${code ?? exitSignal ?? 'unknown'}): ${stderr}`));
    });
  });
}
