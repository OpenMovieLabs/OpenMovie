import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FfmpegTimelineRenderer, sampleTimestamps, selectVideoEncoder } from './index.js';

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
  }, 20_000);
});
