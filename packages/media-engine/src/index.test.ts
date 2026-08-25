import { describe, expect, it } from 'vitest';

import { sampleTimestamps } from './index.js';

describe('media sampling', () => {
  it('creates deterministic in-range timecode samples', () => {
    expect(sampleTimestamps(4_000_000, 4)).toEqual([250_000, 1_416_667, 2_583_333, 3_750_000]);
    expect(sampleTimestamps(100_000, 1)).toEqual([50_000]);
  });
});
