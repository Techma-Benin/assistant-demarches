export type RecorderChoice = { recorderType: string; fileType: 'audio/ogg' | 'audio/mp4' | 'audio/webm' };

// The upload contract (v2) accepts ogg, mpeg, mp4 and webm audio. Chrome only records webm.
const CANDIDATES: RecorderChoice[] = [
  { recorderType: 'audio/ogg;codecs=opus', fileType: 'audio/ogg' },
  { recorderType: 'audio/mp4', fileType: 'audio/mp4' },
  { recorderType: 'audio/webm;codecs=opus', fileType: 'audio/webm' },
];

export const WAVEFORM_BARS = 32;
const WAVEFORM_FLOOR = 0.08;

/** First MediaRecorder type the browser can record that the upload contract accepts; null when none. */
export function pickRecorderMime(isSupported: (type: string) => boolean): RecorderChoice | null {
  return CANDIDATES.find((candidate) => isSupported(candidate.recorderType)) ?? null;
}

/** Reduces level samples to exactly 32 values in [0.08, 1], normalised by the loudest sample. */
export function downsampleWaveform(samples: number[], bars = WAVEFORM_BARS): number[] {
  const max = Math.max(0, ...samples);
  return Array.from({ length: bars }, (_, i) => {
    if (samples.length === 0 || max === 0) return WAVEFORM_FLOOR;
    const from = Math.floor((i * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / bars));
    const slice = samples.slice(from, to);
    const peak = Math.max(...slice);
    return Math.min(1, Math.max(WAVEFORM_FLOOR, peak / max));
  });
}

/** "0:07", "1:23". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
