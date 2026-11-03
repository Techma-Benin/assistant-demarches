import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '@/components/admin/console/console-context';
import { MAX_AVATAR_BYTES, ProfileView } from '@/components/admin/console/profile-view';
import { AGENT, OFFICIAL_ID, SUPER, SUPER_ME, json, me, official, problem, stubFetch } from './helpers/fixtures';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/profil', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

function setup(profile = me(AGENT), onWrite?: (method: string, url: string, init: any) => Response) {
  const writes: Array<{ method: string; path: string; headers: Record<string, string>; body: any }> = [];
  stubFetch((call) => {
    if (call.method !== 'GET') {
      writes.push({ method: call.method, path: call.url.pathname, headers: call.headers, body: call.body });
      return onWrite ? onWrite(call.method, call.url.pathname, call) : json(official());
    }
    if (call.url.pathname.endsWith('/administrations')) return json({ items: [] });
    return json(profile);
  });
  render(
    <ConsoleProvider initialAdministrationId={null}>
      <ProfileView />
    </ConsoleProvider>,
  );
  return writes;
}

describe('Profil (A10)', () => {
  it('shows name, function, e-mail, role, administration and permissions', async () => {
    setup();
    expect(await screen.findByText('Agent Justice', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Agent instructeur', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('agent.justice@demo.techma.bj')).toBeInTheDocument();
    expect(screen.getByText('Ministère de la Justice')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Permissions' });
    expect(list).toHaveTextContent('cases:read');
    expect(list).toHaveTextContent('cases:act');
  });

  it('shows « Toutes les administrations » for a super admin', async () => {
    setup(SUPER_ME);
    expect(await screen.findByText('Toutes les administrations')).toBeInTheDocument();
    expect(screen.getByText('Super administrateur')).toBeInTheDocument();
    expect(SUPER).toContain('administrations:all');
  });

  it('shows the photo through the avatar route when there is one, else initials', async () => {
    setup(me(AGENT, { official: official({ avatarUrl: 'https://backend.example/avatars/x' }) }));
    const image = await screen.findByRole('img', { name: 'Photo de Agent Justice' });
    expect(image).toHaveAttribute('src', `/api/admin/v1/admin/avatars/${OFFICIAL_ID}`);
  });

  it('shows initials without a photo', async () => {
    setup();
    await screen.findByText('Agent instructeur', { selector: 'p' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('AJ')).toBeInTheDocument();
  });

  it('saves the name and function with PUT /me and shows the new values', async () => {
    const writes = setup(me(AGENT), () => json(official({ displayName: 'Camille Dossou', jobTitle: 'Cheffe de service' })));
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/Nom affiché/));
    await user.type(screen.getByLabelText(/Nom affiché/), 'Camille Dossou');
    await user.clear(screen.getByLabelText(/Fonction/));
    await user.type(screen.getByLabelText(/Fonction/), 'Cheffe de service');
    await user.click(save);
    expect(await screen.findByText('Profil enregistré.')).toBeInTheDocument();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('PUT');
    expect(writes[0].path).toBe('/api/admin/v1/admin/me');
    expect(writes[0].body).toEqual({ displayName: 'Camille Dossou', jobTitle: 'Cheffe de service' });
    expect(screen.getByText('Cheffe de service', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Camille Dossou', { selector: 'p' })).toBeInTheDocument();
  });

  it('shows a refused update as a message', async () => {
    setup(me(AGENT), () => problem(400, 'INVALID_REQUEST', 'Nom trop long'));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nom affiché/), 'x');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Données refusées : Nom trop long')).toBeInTheDocument();
  });

  it('uploads a JPEG as a raw body with X-File-Mime-Type and shows the new photo', async () => {
    const writes = setup(me(AGENT), () => json(official({ avatarUrl: 'https://backend.example/a' })));
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'moi.jpg', { type: 'image/jpeg' });
    await user.upload(await screen.findByLabelText(/Choisir une photo/), file);
    expect(await screen.findByRole('img', { name: /Photo de/ })).toHaveAttribute('src', `/api/admin/v1/admin/avatars/${OFFICIAL_ID}`);
    expect(writes[0]).toMatchObject({ method: 'PUT', path: '/api/admin/v1/admin/me/avatar' });
    expect(writes[0].headers['x-file-mime-type']).toBe('image/jpeg');
    expect(writes[0].headers['content-type']).toBe('application/octet-stream');
    expect(writes[0].body).toBe(file);
  });

  it('refuses a GIF and an image above the 2 Mio limit without calling the server', async () => {
    const writes = setup();
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByLabelText(/Choisir une photo/);
    await user.upload(input, new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' }));
    expect(await screen.findByText('Format non pris en charge : JPEG ou PNG uniquement.')).toBeInTheDocument();
    const big = new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], 'big.png', { type: 'image/png' });
    await user.upload(input, big);
    expect(await screen.findByText('Image trop volumineuse (2 Mio maximum).')).toBeInTheDocument();
    expect(writes).toHaveLength(0);
    expect(MAX_AVATAR_BYTES).toBe(2 * 1024 * 1024);
  });

  it('shows a server refusal of the photo (415)', async () => {
    setup(me(AGENT), () => problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Type refusé'));
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText(/Choisir une photo/), new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    expect(await screen.findByText('Format non pris en charge : JPEG ou PNG uniquement.')).toBeInTheDocument();
  });

  it('shows an error when the profile cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('down'))));
    render(
      <ConsoleProvider initialAdministrationId={null}>
        <ProfileView />
      </ConsoleProvider>,
    );
    expect(await screen.findByText('Impossible de charger votre profil. Réessayez.')).toBeInTheDocument();
    await act(async () => undefined);
    await waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull());
  });
});
