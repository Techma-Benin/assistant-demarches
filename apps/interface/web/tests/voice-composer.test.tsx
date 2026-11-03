import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/components/chat/Composer';

const stop = vi.fn();
let supportedTypes: string[];

class FakeRecorder {
  static isTypeSupported = (type: string) => supportedTypes.includes(type);
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    public options: { mimeType: string },
  ) {}
  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.options.mimeType }) });
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['more']) });
    this.onstop?.();
  }
}

function setup(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
}
const granted = () => Promise.resolve({ getTracks: () => [{ stop }] });
const micName = { name: 'Enregistrer un message vocal' };

async function startRecording() {
  fireEvent.click(await screen.findByRole('button', micName));
  await act(async () => {});
}

beforeEach(() => {
  stop.mockClear();
  supportedTypes = ['audio/mp4'];
  vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Composer voice recording', () => {
  it('shows the mic only when the text is empty and no file is staged', async () => {
    setup(granted);
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    expect(await screen.findByRole('button', micName)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Votre message'), { target: { value: 'bonjour' } });
    expect(screen.queryByRole('button', micName)).toBeNull();
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Votre message'), { target: { value: '' } });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    expect(screen.queryByRole('button', micName)).toBeNull();
  });

  it('renders no mic when the browser cannot record a contract format', async () => {
    supportedTypes = ['audio/webm'];
    setup(granted);
    render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    await act(async () => {});
    expect(screen.queryByRole('button', micName)).toBeNull();
  });

  it('shows the recording bar, and Escape cancels and stops the tracks', async () => {
    setup(granted);
    render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    await startRecording();
    expect(screen.getByRole('button', { name: 'Envoyer le message vocal' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Enregistrement…');
    expect(screen.queryByLabelText('Votre message')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Envoyer le message vocal' }), { key: 'Escape' });
    expect(stop).toHaveBeenCalled();
    expect(screen.getByLabelText('Votre message')).toBeInTheDocument();
    expect(screen.getByRole('button', micName)).toHaveFocus();
  });

  it('sends one audio File with voice metadata', async () => {
    setup(granted);
    const onFiles = vi.fn();
    render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le message vocal' }));
    await act(async () => {});
    expect(onFiles).toHaveBeenCalledTimes(1);
    const [files, note, meta] = onFiles.mock.calls[0];
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('audio/mp4');
    expect(files[0].name).toBe('Message vocal.m4a');
    expect(note).toBeUndefined();
    expect(meta.waveform).toHaveLength(32);
    expect(meta.durationMs).toBeGreaterThanOrEqual(1000);
    expect(stop).toHaveBeenCalled();
  });

  it('rejects a message shorter than a second', async () => {
    setup(granted);
    const onFiles = vi.fn();
    render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    await startRecording();
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le message vocal' }));
    await act(async () => {});
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText('Message trop court.')).toBeInTheDocument();
  });

  it('uses ogg when the browser supports it', async () => {
    supportedTypes = ['audio/ogg;codecs=opus', 'audio/mp4'];
    setup(granted);
    const onFiles = vi.fn();
    render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Envoyer le message vocal' }), { key: 'Enter' });
    await act(async () => {});
    expect(onFiles.mock.calls[0][0][0]).toMatchObject({ type: 'audio/ogg', name: 'Message vocal.ogg' });
  });

  it('explains a blocked microphone', async () => {
    setup(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    await startRecording();
    expect(screen.getByText(/Micro bloqué\. Autorisez le micro/)).toBeInTheDocument();
    expect(screen.getByRole('button', micName)).toBeEnabled();
  });
});
