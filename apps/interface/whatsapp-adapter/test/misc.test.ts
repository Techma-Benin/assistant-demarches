import { describe, expect, it, vi } from 'vitest';
import { DevSubjectTokenProvider, ExchangeSubjectTokenProvider } from '../src/backend/subject-token.js';
import { ConfigError, loadConfig } from '../src/config/config.js';
import { maskPhone } from '../src/meta/fakes.js';
import { GraphApiMetaMedia, GraphApiMetaSender } from '../src/meta/graph-api.js';
import { MediaTooLargeError, MetaPermanentError, MetaRetryableError } from '../src/meta/meta.js';
import { textMessage } from '../src/rendering/text.js';

describe('configuration', () => {
  it('valeurs de développement par défaut', () => {
    const c = loadConfig({});
    expect(c.port).toBe(4030);
    expect(c.backendUrl).toBe('http://127.0.0.1:4010');
    expect(c.meta.useGraphApi).toBe(false);
    expect(c.mockUserToken).toBe('mock-user');
  });

  it('envoi réel seulement si jeton et identifiant de numéro sont présents', () => {
    expect(loadConfig({ META_ACCESS_TOKEN: 't' }).meta.useGraphApi).toBe(false);
    expect(loadConfig({ META_ACCESS_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }).meta.useGraphApi).toBe(true);
  });

  it('production : variables obligatoires, jeton de simulation refusé, messages sans valeur secrète', () => {
    const secret = 'valeur-secrete-123';
    try {
      loadConfig({ NODE_ENV: 'production', SUBJECT_HMAC_KEY: secret, MOCK_USER_TOKEN: 'mock-user', BACKEND_URL: 'https://b.example.org' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const { message } = error as ConfigError;
      for (const name of ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_VERSION', 'CALLBACK_JWKS_URL', 'CALLBACK_ISSUER', 'MOCK_USER_TOKEN', 'SUBJECT_HMAC_KEY']) {
        expect(message).toContain(name);
      }
      expect(message).not.toContain(secret);
    }
  });

  it('SUBJECT_HMAC_KEY de moins de 32 caractères refusée', () => {
    expect(() => loadConfig({ SUBJECT_HMAC_KEY: 'court' })).toThrow(/SUBJECT_HMAC_KEY/);
  });

  it('production complète acceptée', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      BACKEND_URL: 'https://backend.example.org',
      META_APP_SECRET: 'a',
      META_VERIFY_TOKEN: 'b',
      META_ACCESS_TOKEN: 'c',
      META_PHONE_NUMBER_ID: 'd',
      META_GRAPH_VERSION: 'v23.0',
      SUBJECT_HMAC_KEY: 'k'.repeat(32),
      CALLBACK_JWKS_URL: 'https://idp.example.org/jwks',
      CALLBACK_ISSUER: 'https://idp.example.org/realms/techma',
    });
    expect(c.isProduction).toBe(true);
    expect(c.meta.useGraphApi).toBe(true);
    expect(c.mockUserToken).toBeUndefined();
  });
});

describe('fournisseurs de jeton', () => {
  it('développement : jeton de simulation seulement vers une boucle locale', async () => {
    await expect(new DevSubjectTokenProvider('mock-user', 'http://127.0.0.1:4010').tokenFor('229')).resolves.toBe('mock-user');
    await expect(new DevSubjectTokenProvider('mock-user', 'http://localhost:4010').tokenFor('229')).resolves.toBe('mock-user');
    await expect(new DevSubjectTokenProvider('mock-user', 'https://backend.example.org').tokenFor('229')).rejects.toThrow();
  });
  it('production : échange non branché', async () => {
    await expect(new ExchangeSubjectTokenProvider().tokenFor('229')).rejects.toThrow('Échange de jeton non branché');
  });
});

describe('masquage', () => {
  it('garde les 4 premiers et les 2 derniers caractères', () => {
    expect(maskPhone('22961234567')).toBe('+229••••••67');
  });
});

describe('API Graph (client simulé)', () => {
  const sender = (fetchImpl: typeof fetch) =>
    new GraphApiMetaSender({ accessToken: 'TOKEN', phoneNumberId: '123', graphVersion: 'v23.0', fetchImpl });

  it('envoie le corps attendu avec le jeton Bearer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await sender(fetchImpl as never).send('22961234567', textMessage('Bonjour'));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v23.0/123/messages');
    expect(init.headers.Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '22961234567',
      type: 'text',
      text: { body: 'Bonjour', preview_url: false },
    });
  });

  it('429 et 5xx : retentable ; 4xx : permanent ; réseau : retentable', async () => {
    const run = (r: () => Promise<Response>) => sender((async () => r()) as never).send('1', textMessage('x'));
    await expect(run(async () => new Response('', { status: 429 }))).rejects.toBeInstanceOf(MetaRetryableError);
    await expect(run(async () => new Response('', { status: 503 }))).rejects.toBeInstanceOf(MetaRetryableError);
    await expect(run(async () => new Response('', { status: 400 }))).rejects.toBeInstanceOf(MetaPermanentError);
    await expect(run(async () => { throw new Error('réseau'); })).rejects.toBeInstanceOf(MetaRetryableError);
  });

  const media = (responses: Response[], max?: number) => {
    const fetchImpl = vi.fn();
    responses.forEach((r) => fetchImpl.mockResolvedValueOnce(r));
    return { fetchImpl, media: new GraphApiMetaMedia({ accessToken: 'TOKEN', graphVersion: 'v23.0', fetchImpl: fetchImpl as never }, max) };
  };

  it('média : deux appels (métadonnées puis octets), Bearer sur les deux', async () => {
    const { fetchImpl, media: m } = media([
      new Response(JSON.stringify({ url: 'https://cdn.example/x', mime_type: 'image/png', file_size: 3 })),
      new Response(Buffer.from('abc')),
    ]);
    expect((await m.download('MEDIA1')).toString()).toBe('abc');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://graph.facebook.com/v23.0/MEDIA1');
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://cdn.example/x');
    for (const call of fetchImpl.mock.calls) expect(call[1].headers.Authorization).toBe('Bearer TOKEN');
  });

  it('média : refus selon file_size annoncé', async () => {
    const { media: m } = media([new Response(JSON.stringify({ url: 'https://cdn.example/x', file_size: 11 }))], 10);
    await expect(m.download('M')).rejects.toBeInstanceOf(MediaTooLargeError);
  });

  it('média : refus pendant la lecture même si file_size est faux', async () => {
    const { media: m } = media(
      [new Response(JSON.stringify({ url: 'https://cdn.example/x', file_size: 1 })), new Response(Buffer.alloc(50))],
      10,
    );
    await expect(m.download('M')).rejects.toBeInstanceOf(MediaTooLargeError);
  });
});
