import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForLiveInput } from '@/hooks/use-voice-recorder';
import { downsampleWaveform, formatDuration, pickRecorderMime } from '@/lib/voice';

describe('pickRecorderMime', () => {
  it('prefers ogg opus, then mp4', () => {
    expect(pickRecorderMime(() => true)).toEqual({ recorderType: 'audio/ogg;codecs=opus', fileType: 'audio/ogg' });
    expect(pickRecorderMime((t) => t === 'audio/mp4')).toEqual({ recorderType: 'audio/mp4', fileType: 'audio/mp4' });
  });

  it('falls back to webm (Chrome), accepted by the v2 upload contract', () => {
    expect(pickRecorderMime((t) => t.includes('webm'))).toEqual({
      recorderType: 'audio/webm;codecs=opus',
      fileType: 'audio/webm',
    });
  });

  it('returns null when nothing the contract accepts can be recorded', () => {
    expect(pickRecorderMime(() => false)).toBeNull();
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

describe('waitForLiveInput', () => {
  const analyserFor = (level: () => number) => ({
    fftSize: 8,
    getFloatTimeDomainData: (data: Float32Array) => data.fill(level()),
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  const settled = (promise: Promise<void>) => {
    const state = { done: false };
    void promise.then(() => (state.done = true));
    return state;
  };

  it('does not wait without an analyser', async () => {
    await expect(waitForLiveInput(null)).resolves.toBeUndefined();
  });

  it('waits for 300 ms of continuous signal after digital silence', async () => {
    const start = Date.now();
    const state = settled(waitForLiveInput(analyserFor(() => (Date.now() - start < 500 ? 0 : 0.1))));
    await vi.advanceTimersByTimeAsync(700);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(state.done).toBe(true);
  });

  it('resets the count on a gap', async () => {
    const start = Date.now();
    // signal from 300 ms on, a gap at 500-600 ms, signal again from 600 ms
    const gapped = () => {
      const t = Date.now() - start;
      if (t < 300) return 0;
      if (t >= 500 && t < 600) return 0;
      return 0.1;
    };
    const state = settled(waitForLiveInput(analyserFor(gapped)));
    await vi.advanceTimersByTimeAsync(590);
    expect(state.done).toBe(false); // without the gap it would resolve at ~600 ms
    await vi.advanceTimersByTimeAsync(250);
    expect(state.done).toBe(false); // the count restarted at 600 ms
    await vi.advanceTimersByTimeAsync(100);
    expect(state.done).toBe(true);
  });

  it('gives up after the maximum delay even with no signal', async () => {
    const state = settled(waitForLiveInput(analyserFor(() => 0)));
    await vi.advanceTimersByTimeAsync(1400);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(state.done).toBe(true);
  });
});
