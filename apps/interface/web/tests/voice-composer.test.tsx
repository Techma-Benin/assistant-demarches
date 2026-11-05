import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { ComponentProps } from 'react';
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

function setup(getUserMedia: (constraints?: unknown) => Promise<unknown>) {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
}
const granted = () => Promise.resolve({ getTracks: () => [{ stop }] });
const stopName = { name: 'Terminer la dictée' };
function fakeClient(text = 'Comment obtenir un acte') {
  return {
    uploadFile: vi.fn(async () => ({ id: 'fil_X' })),
    transcribeAudio: vi.fn(async () => ({ text })),
  } as unknown as NonNullable<ComponentProps<typeof Composer>['client']> & {
    uploadFile: ReturnType<typeof vi.fn>;
    transcribeAudio: ReturnType<typeof vi.fn>;
  };
}
const micName = { name: 'Dicter un message' };

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
    expect(screen.getByRole('button', { name: 'Terminer la dictée' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Enregistrement…');
    expect(screen.queryByLabelText('Votre message')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Terminer la dictée' }), { key: 'Escape' });
    expect(stop).toHaveBeenCalled();
    expect(screen.getByLabelText('Votre message')).toBeInTheDocument();
    expect(screen.getByRole('button', micName)).toHaveFocus();
  });

  it('asks for the raw microphone signal', async () => {
    const getUserMedia = vi.fn(granted);
    setup(getUserMedia);
    render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} client={fakeClient()} />);
    await startRecording();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  });

  it('uploads then transcribes into the textarea, without sending anything', async () => {
    setup(granted);
    const client = fakeClient();
    const onFiles = vi.fn();
    const onSend = vi.fn();
    render(<Composer disabled={false} onSend={onSend} onFiles={onFiles} client={client} />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', stopName));
    await act(async () => {});
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    const [file, mime] = client.uploadFile.mock.calls[0] as unknown as [File, string];
    expect(file.name).toBe('Message vocal.m4a');
    expect(mime).toBe('audio/mp4');
    expect(client.transcribeAudio).toHaveBeenCalledWith('fil_X', expect.anything());
    expect(screen.getByLabelText('Votre message')).toHaveValue('Comment obtenir un acte');
    expect(screen.getByLabelText('Votre message')).toHaveFocus();
    expect(onFiles).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('puts the transcript in a controlled composer without sending', async () => {
    setup(granted);
    const client = fakeClient('et un justificatif');
    const onSend = vi.fn();
    function Host() {
      const [value, setValue] = useState('');
      return <Composer disabled={false} onSend={onSend} onFiles={() => {}} client={client} value={value} onValueChange={setValue} />;
    }
    render(<Host />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', stopName));
    await act(async () => {});
    expect(screen.getByLabelText('Votre message')).toHaveValue('et un justificatif');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('appends to existing text when the text changed while transcribing', async () => {
    setup(granted);
    let release!: (value: { text: string }) => void;
    const client = fakeClient();
    client.transcribeAudio.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    function Host() {
      const [value, setValue] = useState('');
      return (
        <>
          <button onClick={() => setValue('Bonjour  ')}>externe</button>
          <Composer disabled={false} onSend={() => {}} onFiles={() => {}} client={client} value={value} onValueChange={setValue} />
        </>
      );
    }
    render(<Host />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', stopName));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'externe' }));
    await act(async () => release({ text: 'voici la suite' }));
    expect(screen.getByLabelText('Votre message')).toHaveValue('Bonjour voici la suite');
  });

  it('shows a status and no prompt while transcribing', async () => {
    setup(granted);
    const client = fakeClient();
    client.transcribeAudio.mockImplementation(() => new Promise(() => {}));
    const onSend = vi.fn();
    render(<Composer disabled={false} onSend={onSend} onFiles={() => {}} client={client} />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', stopName));
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Transcription en cours…');
    expect(screen.queryByLabelText('Votre message')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Envoyer' })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows an alert and an editable textarea when the transcription fails', async () => {
    setup(granted);
    const client = fakeClient();
    client.transcribeAudio.mockRejectedValue(new Error('boom'));
    function Host() {
      const [value, setValue] = useState('');
      return <Composer disabled={false} onSend={() => {}} onFiles={() => {}} client={client} value={value} onValueChange={setValue} />;
    }
    render(<Host />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', stopName));
    await act(async () => {});
    expect(screen.getByText('La transcription n’a pas abouti. Réessayez ou écrivez votre message.')).toBeInTheDocument();
    expect(screen.getByLabelText('Votre message')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Votre message'), { target: { value: 'Ma saisie' } });
    expect(screen.getByLabelText('Votre message')).toHaveValue('Ma saisie');
  });

  it('rejects a message shorter than a second', async () => {
    setup(granted);
    const onFiles = vi.fn();
    render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    await startRecording();
    fireEvent.click(screen.getByRole('button', { name: 'Terminer la dictée' }));
    await act(async () => {});
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText('Message trop court.')).toBeInTheDocument();
  });

  it('uses ogg when the browser supports it', async () => {
    supportedTypes = ['audio/ogg;codecs=opus', 'audio/mp4'];
    setup(granted);
    const onFiles = vi.fn();
    const client = fakeClient();
    render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} client={client} />);
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Terminer la dictée' }), { key: 'Enter' });
    await act(async () => {});
    expect(client.uploadFile.mock.calls[0][0]).toMatchObject({ type: 'audio/ogg', name: 'Message vocal.ogg' });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('explains a blocked microphone', async () => {
    setup(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    await startRecording();
    expect(screen.getByText(/Micro bloqué\. Autorisez le micro/)).toBeInTheDocument();
    expect(screen.getByRole('button', micName)).toBeEnabled();
  });
});
