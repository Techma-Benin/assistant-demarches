import { describe, expect, it } from 'vitest';
import { downsampleWaveform, formatDuration, pickRecorderMime } from '@/lib/voice';

describe('pickRecorderMime', () => {
  it('prefers ogg opus, then mp4', () => {
    expect(pickRecorderMime(() => true)).toEqual({ recorderType: 'audio/ogg;codecs=opus', fileType: 'audio/ogg' });
    expect(pickRecorderMime((t) => t === 'audio/mp4')).toEqual({ recorderType: 'audio/mp4', fileType: 'audio/mp4' });
  });

  it('returns null when neither is supported, and never asks for webm', () => {
    const asked: string[] = [];
    expect(
      pickRecorderMime((t) => {
        asked.push(t);
        return t.includes('webm');
      }),
    ).toBeNull();
    expect(asked.some((t) => t.includes('webm'))).toBe(false);
  });
});

describe('downsampleWaveform', () => {
  it('returns exactly 32 values in [0.08, 1], normalised by the max', () => {
    const wave = downsampleWaveform(Array.from({ length: 200 }, (_, i) => (i % 10) / 20));
    expect(wave).toHaveLength(32);
    expect(Math.max(...wave)).toBe(1);
    expect(Math.min(...wave)).toBeGreaterThanOrEqual(0.08);
  });

  it('applies the floor on silence and short input', () => {
    expect(downsampleWaveform([])).toEqual(Array(32).fill(0.08));
    expect(downsampleWaveform([0, 0, 0])).toEqual(Array(32).fill(0.08));
    const short = downsampleWaveform([0.5, 1]);
    expect(short).toHaveLength(32);
    expect(short.every((v) => v >= 0.08 && v <= 1)).toBe(true);
  });
});

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7400)).toBe('0:07');
    expect(formatDuration(83_000)).toBe('1:23');
  });
});
