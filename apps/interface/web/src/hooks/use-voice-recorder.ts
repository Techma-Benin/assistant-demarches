'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { downsampleWaveform, pickRecorderMime, type RecorderChoice } from '@/lib/voice';

export type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'error';
export type VoiceRecording = { file: File; durationMs: number; waveform: number[] };

type Options = {
  maxMs?: number;
  minMs?: number;
  /** Called once when the maximum duration is reached; the recording is still open, so the caller can finish() it. */
  onMaxReached?: () => void;
};

const SAMPLE_EVERY_MS = 100;

function detect(): RecorderChoice | null {
  if (typeof window === 'undefined') return null;
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  return pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
}

function errorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Micro bloqué. Autorisez le micro dans votre navigateur pour envoyer un message vocal.';
  }
  if (name === 'NotFoundError') return 'Aucun micro détecté.';
  return 'Impossible d’enregistrer pour le moment.';
}

export function useVoiceRecorder({ maxMs = 120_000, minMs = 1_000, onMaxReached }: Options = {}) {
  const [choice, setChoice] = useState<RecorderChoice | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const chunks = useRef<Blob[]>([]);
  const samples = useRef<number[]>([]);
  const startedAt = useRef(0);
  const lastSample = useRef(0);
  const maxFired = useRef(false);
  const generation = useRef(0);
  const onMax = useRef(onMaxReached);
  onMax.current = onMaxReached;

  useEffect(() => {
    setChoice(detect());
  }, []);

  const release = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioContext.current?.close?.();
    audioContext.current = null;
  }, []);

  const teardown = useCallback(() => {
    generation.current += 1;
    const current = recorder.current;
    recorder.current = null;
    if (current && current.state !== 'inactive') {
      current.ondataavailable = null;
      current.onstop = null;
      try {
        current.stop();
      } catch {
        // already stopped
      }
    }
    release();
    chunks.current = [];
    samples.current = [];
  }, [release]);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (!choice || status === 'requesting' || status === 'recording') return;
    const mine = ++generation.current;
    setError(null);
    setStatus('requesting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (generation.current !== mine) return;
      setError(errorMessage(e));
      setStatus('error');
      return;
    }
    if (generation.current !== mine) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream.current = media;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(media, { mimeType: choice.recorderType });
    } catch (e) {
      release();
      setError(errorMessage(e));
      setStatus('error');
      return;
    }
    chunks.current = [];
    samples.current = [];
    maxFired.current = false;
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.current.push(event.data);
    };
    recorder.current = rec;

    let analyser: AnalyserNode | null = null;
    const Ctx = typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (Ctx) {
      try {
        const ctx = new Ctx();
        audioContext.current = ctx;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(media).connect(analyser);
      } catch {
        analyser = null; // metering is optional
      }
    }

    rec.start(250);
    startedAt.current = performance.now();
    lastSample.current = 0;
    setElapsedMs(0);
    setLevel(0);
    setStatus('recording');

    const data = analyser ? new Float32Array(analyser.fftSize) : null;
    const tick = () => {
      const elapsed = performance.now() - startedAt.current;
      setElapsedMs(elapsed);
      if (analyser && data) {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        const rms = Math.min(1, Math.sqrt(sum / data.length) * 3);
        setLevel(rms);
        if (elapsed - lastSample.current >= SAMPLE_EVERY_MS) {
          lastSample.current = elapsed;
          samples.current.push(rms);
        }
      }
      if (elapsed >= maxMs && !maxFired.current) {
        maxFired.current = true;
        onMax.current?.();
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [choice, status, maxMs, release]);

  const cancel = useCallback(() => {
    teardown();
    setError(null);
    setElapsedMs(0);
    setLevel(0);
    setStatus('idle');
  }, [teardown]);

  const finish = useCallback(async (): Promise<VoiceRecording | null> => {
    const rec = recorder.current;
    if (!rec || !choice) return null;
    const durationMs = Math.min(performance.now() - startedAt.current, maxMs);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    recorder.current = null;
    await new Promise<void>((resolve) => {
      if (rec.state === 'inactive') return resolve();
      rec.onstop = () => resolve();
      rec.stop();
    });
    const parts = chunks.current;
    const levels = samples.current;
    release();
    chunks.current = [];
    samples.current = [];
    setLevel(0);
    setElapsedMs(0);
    if (durationMs < minMs || parts.length === 0) {
      setError('Message trop court.');
      setStatus('error');
      return null;
    }
    setStatus('idle');
    const ext = choice.fileType === 'audio/ogg' ? 'ogg' : choice.fileType === 'audio/webm' ? 'webm' : 'm4a';
    const file = new File(parts, `Message vocal.${ext}`, { type: choice.fileType });
    return { file, durationMs, waveform: downsampleWaveform(levels) };
  }, [choice, maxMs, minMs, release]);

  return { supported: choice !== null, status, elapsedMs, level, error, start, cancel, finish };
}
