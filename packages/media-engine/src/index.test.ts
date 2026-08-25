import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildWaveform,
  FfmpegMediaAnalyzer,
  FfmpegTimelineRenderer,
  parseSceneTimes,
  sampleTimestamps,
  selectVideoEncoder,
} from './index.js';

describe('media sampling', () => {
  it('creates deterministic in-range timecode samples', () => {
    expect(sampleTimestamps(4_000_000, 4)).toEqual([250_000, 1_416_667, 2_583_333, 3_750_000]);
    expect(sampleTimestamps(100_000, 1)).toEqual([50_000]);
  });

  it('selects the best available LGPL-compatible fallback encoder', () => {
    expect(selectVideoEncoder(' V..... libx264 H.264\n V..... mpeg4 MPEG-4')).toBe('libx264');
    expect(selectVideoEncoder(' V..... h264_videotoolbox VideoToolbox\n V..... mpeg4 MPEG-4')).toBe(
      'h264_videotoolbox',
    );
    expect(selectVideoEncoder(' V..... mpeg4 MPEG-4')).toBe('mpeg4');
    expect(() => selectVideoEncoder(' A..... aac AAC')).toThrow(/no supported/);
  });

  it('builds bounded deterministic waveform peaks and scene timecodes', () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(16_384, 2);
    pcm.writeInt16LE(-32_768, 4);
    pcm.writeInt16LE(8_192, 6);
    expect(buildWaveform(pcm, 8_000, 500, 2)).toEqual({
      sampleRate: 8_000,
      durationUs: 500,
      peaks: [0.5, 1],
      truncated: false,
    });
    expect(parseSceneTimes('n:1 pts_time:1.25 foo\nn:2 pts_time:3.000001')).toEqual([
      1_250_000, 3_000_001,
    ]);
  });

  it('renders selected image clips when FFmpeg is available', async () => {
    const renderer = new FfmpegTimelineRenderer();
    if (!(await renderer.detect()).available) return;
    const root = await mkdtemp(join(tmpdir(), 'openmovie-render-'));
    const image = join(root, 'frame.png');
    await writeFile(
      image,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const outputPath = join(root, 'current-cut.mp4');
    await renderer.render({
      clips: [
        { path: image, mimeType: 'image/png', durationUs: 100_000 },
        { path: image, mimeType: 'image/png', durationUs: 100_000 },
      ],
      outputPath,
      workRoot: join(root, 'work'),
      width: 64,
      height: 64,
      frameRate: { numerator: 24, denominator: 1 },
      audioSampleRate: 48_000,
    });
    expect((await stat(outputPath)).size).toBeGreaterThan(0);
    const analyzer = new FfmpegMediaAnalyzer();
    const inspection = await analyzer.inspect(outputPath);
    expect(inspection).toMatchObject({ width: 64, height: 64, hasAudio: true });
    const audioPath = join(root, 'analysis.wav');
    await analyzer.extractAudio(outputPath, audioPath);
    expect((await stat(audioPath)).size).toBeGreaterThan(0);
    expect((await analyzer.waveform(outputPath, inspection.durationUs, 8)).peaks).toHaveLength(8);
    const proxyPath = join(root, 'proxy.mp4');
    await analyzer.createProxy(outputPath, proxyPath);
    expect((await stat(proxyPath)).size).toBeGreaterThan(0);
    expect(await analyzer.detectShotBoundaries(outputPath)).toEqual([]);
  }, 20_000);
});
