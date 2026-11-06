import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockRenderer, type BlockRendererProps } from '@/components/blocks/BlockRenderer';
import { navigate } from '@/lib/navigate';
import { noopConsent } from '@/lib/consent';
import {
  CONVERSATION_ID,
  caseCardBlock,
  consentBlock,
  exampleAgentMessage,
  exampleCase,
  exampleRequest,
  fileRequestBlock,
  issuedCase,
  loginRequiredBlock,
  requestCardBlock,
  textBlock,
  exampleSource,
  type Block,
} from './fixtures-v2';

vi.mock('@/lib/navigate', () => ({ navigate: vi.fn() }));

function show(block: Block, over: Partial<BlockRendererProps> = {}) {
  const props: BlockRendererProps = {
    block,
    interactive: true,
    onButton: vi.fn(),
    onForm: vi.fn(),
    onFiles: vi.fn(),
    conversationId: CONVERSATION_ID,
    ...over,
  };
  render(<BlockRenderer {...props} />);
  return props;
}

beforeEach(() => {
  vi.mocked(navigate).mockReset();
  window.history.replaceState(null, '', '/conversation');
});

describe('every v2 block of an agent message renders', () => {
  it('the example message of the contract: text with sources, then buttons', () => {
    for (const block of exampleAgentMessage.blocks) show(block);
    expect(screen.getByText(/L'extrait B3 du casier judiciaire/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Préparer ma demande' })).toBeInTheDocument();
  });

  it.each([
    caseCardBlock(),
    consentBlock(),
    requestCardBlock(),
    fileRequestBlock(),
    loginRequiredBlock,
    { type: 'form', id: 'f1', fields: [{ name: 'profession', label: 'Profession', required: true, type: 'text' }] },
  ] as Block[])('renders $type without throwing', (block) => {
    const { container } = render(<BlockRenderer block={block} interactive onButton={vi.fn()} onForm={vi.fn()} onFiles={vi.fn()} />);
    expect(container).not.toBeEmptyDOMElement();
  });
});

describe('text block', () => {
  it('shows clickable sources and no version', () => {
    show(textBlock('Le casier coûte 1 900 FCFA.', [exampleSource]));
    const link = screen.getByRole('link', { name: /PS00373/ });
    expect(link).toHaveAttribute('href', exampleSource.url);
    expect(screen.queryByText(/v\d/)).toBeNull();
  });

  it('a conversational text may have no source', () => {
    show(textBlock('Bonjour, comment puis-je vous aider ?'));
    expect(screen.queryByLabelText('Sources de la réponse')).toBeNull();
  });
});

describe('numbered titles split by bullets', () => {
  it('numbers the second title 2 and sets start on its list', () => {
    const { container } = render(
      <BlockRenderer block={textBlock('1. **A**\n - x\n\n2. **B**\n - y')} interactive onButton={vi.fn()} onForm={vi.fn()} onFiles={vi.fn()} conversationId={CONVERSATION_ID} />,
    );
    const lists = container.querySelectorAll('ol');
    expect(lists).toHaveLength(2);
    expect(lists[0].hasAttribute('start')).toBe(false);
    expect(lists[1].getAttribute('start')).toBe('2');
    expect(lists[1].querySelector('[aria-hidden="true"]')?.textContent).toBe('2');
  });
});

describe('buttons block', () => {
  it('sends the clicked item once', async () => {
    const props = show({ type: 'buttons', items: [{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(props.onButton).toHaveBeenCalledWith({ id: 'yes', label: 'Oui' });
    expect(screen.getByRole('button', { name: 'Non' })).toBeDisabled();
  });

  it('is disabled when the message is not the last one', () => {
    show({ type: 'buttons', items: [{ id: 'yes', label: 'Oui' }] }, { interactive: false });
    expect(screen.getByRole('button', { name: 'Oui' })).toBeDisabled();
  });
});

describe('form block', () => {
  it('sends the typed values under the form id', async () => {
    const props = show({
      type: 'form',
      id: 'identity',
      fields: [
        { name: 'profession', label: 'Profession', required: true, type: 'text' },
        { name: 'enfants', label: 'Nombre d’enfants', required: false, type: 'number' },
      ],
    });
    await userEvent.type(screen.getByLabelText(/Profession/), 'Comptable');
    await userEvent.type(screen.getByLabelText(/Nombre d’enfants/), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(props.onForm).toHaveBeenCalledWith('identity', { profession: 'Comptable', enfants: '2' }, 'Formulaire envoyé');
  });
});

describe('fileRequest block', () => {
  const pdf = () => new File(['%PDF-1.4'], 'acte.pdf', { type: 'application/pdf' });

  it('an add button per line hands the file with the documentType of the line', async () => {
    const props = show(fileRequestBlock());
    const region = screen.getByText('Extrait d’acte de naissance').closest('[data-request-id]')!;
    expect(region).toHaveAttribute('data-request-id', exampleRequest.id);
    const input = region.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toBe('application/pdf,image/jpeg');
    await userEvent.upload(input, pdf());
    expect(props.onFiles).toHaveBeenCalledWith([expect.any(File)], 'extrait-acte-naissance');
    // Nothing is received until the composer sends the file.
    expect(screen.queryByText(/Reçue/)).toBeNull();
  });

  it('shows a file waiting in the composer, with nothing to add', () => {
    show(fileRequestBlock(), { fileRequestPending: { name: 'acte.pdf', size: 8 } });
    expect(screen.getByText('Prête à envoyer : acte.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/Reçue/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter cette pièce' })).toBeNull();
  });

  it('shows the file as received once the composer sent it', () => {
    show(fileRequestBlock(), { fileRequestSent: { name: 'acte.pdf', size: 8 } });
    expect(screen.getByText(/Reçue : acte\.pdf/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter cette pièce' })).toBeNull();
  });

  it('refuses a format the line does not accept', async () => {
    const props = show(fileRequestBlock());
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'photo.png', { type: 'image/png' }), { applyAccept: false });
    expect(props.onFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/Format non accepté/)).toBeInTheDocument();
  });

  it('shows the received state and offers nothing to add', () => {
    show(fileRequestBlock(true));
    expect(screen.getByText('Pièce reçue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter cette pièce' })).toBeNull();
  });

  it('is disabled on an older message', () => {
    show(fileRequestBlock(), { interactive: false });
    expect(screen.getByRole('button', { name: 'Ajouter cette pièce' })).toBeDisabled();
  });
});

describe('loginRequired block', () => {
  const session = (body: unknown, delayed = false) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (delayed ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))),
    );
  afterEach(() => vi.unstubAllGlobals());

  it('Keycloak: shows the reason and navigates to the login with the current path and the conversation', async () => {
    session({ user: null, signIn: 'oidc' });
    show(loginRequiredBlock);
    expect(screen.getByText('Connectez-vous pour déposer ce dossier.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Se connecter pour continuer' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    const url = new URL(vi.mocked(navigate).mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/auth/login');
    expect(url.searchParams.get('returnTo')).toBe('/conversation');
    expect(url.searchParams.get('conversationId')).toBe(CONVERSATION_ID);
  });

  it('Keycloak: omits the conversation id when there is none', async () => {
    session({ user: null, signIn: 'oidc' });
    show(loginRequiredBlock, { conversationId: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Se connecter pour continuer' }));
    expect(new URL(vi.mocked(navigate).mock.calls[0][0], 'http://localhost').searchParams.has('conversationId')).toBe(false);
  });

  it('NPI: shows the reason then the sign-in form instead of the Keycloak button', async () => {
    session({ user: null, signIn: 'npi' });
    show(loginRequiredBlock);
    expect(screen.getByText('Connectez-vous pour déposer ce dossier.')).toBeInTheDocument();
    expect(await screen.findByLabelText('Votre NPI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Se connecter pour continuer' })).toBeNull();
  });

  it('already signed in: only « Connexion effectuée. », no form and no button', async () => {
    session({ user: { name: 'Usager', roles: ['citizen'] }, signIn: 'npi' });
    show(loginRequiredBlock);
    expect(await screen.findByText('Connexion effectuée.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Votre NPI')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('while the session loads: no form and no button', () => {
    session(null, true);
    show(loginRequiredBlock);
    expect(screen.getByText('Connectez-vous pour déposer ce dossier.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Votre NPI')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an older block shows no form and no button', async () => {
    session({ user: null, signIn: 'npi' });
    show(loginRequiredBlock, { interactive: false });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByLabelText('Votre NPI')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('consent block', () => {
  it('shows consentText as sent and answers through the controls', async () => {
    const accept = vi.fn();
    const refuse = vi.fn();
    const block = consentBlock();
    show(block, { consent: { ...noopConsent, accept, refuse } });
    expect(screen.getByText('J’autorise l’assistant à préparer ma demande de casier judiciaire.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'J’autorise' }));
    expect(accept).toHaveBeenCalledWith((block as Extract<Block, { type: 'consent' }>).challenge);
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(refuse).toHaveBeenCalledTimes(1);
  });
});

describe('requestCard block', () => {
  it('says what is missing, or that the draft is ready', () => {
    show(requestCardBlock({ ...exampleRequest, status: 'draft', missing: ['Profession', 'Extrait d’acte de naissance'] }));
    expect(screen.getByText(/Il manque : Profession, Extrait d’acte de naissance/)).toBeInTheDocument();
  });

  it('ready draft', () => {
    show(requestCardBlock());
    expect(screen.getByText(exampleRequest.title)).toBeInTheDocument();
    expect(screen.getByText(/Tout est prêt pour le dépôt/)).toBeInTheDocument();
  });

  it('says the dossier is filed once submitted, even with nothing missing', () => {
    show(requestCardBlock({ ...exampleRequest, status: 'submitted', missing: [] }));
    expect(screen.getByText('Dossier déposé.')).toBeInTheDocument();
    expect(screen.queryByText(/Tout est prêt/)).toBeNull();
  });

  it('says the request is cancelled', () => {
    show(requestCardBlock({ ...exampleRequest, status: 'cancelled', missing: [] }));
    expect(screen.getByText('Demande annulée.')).toBeInTheDocument();
  });
});

describe('caseCard block', () => {
  it('shows the status in French, the SIM reference with a Simulation mark, the administration and the payment', () => {
    show(caseCardBlock());
    const card = screen.getByRole('region', { name: 'État du dossier' });
    expect(within(card).getByText('En cours d’examen')).toBeInTheDocument();
    expect(within(card).getByText('SIM-JUS-2026-000001')).toBeInTheDocument();
    expect(within(card).getByText('Simulation')).toBeInTheDocument();
    expect(within(card).getByText('Justice')).toBeInTheDocument();
    expect(card.textContent).toMatch(/1\s900 FCFA, payé \(simulé\)/);
    expect(within(card).getByText(exampleCase.title)).toBeInTheDocument();
    // Never a pay action in the chat.
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull();
  });

  it.each([
    ['awaiting_payment', 'En attente de paiement'],
    ['received', 'Dossier reçu'],
    ['in_review', 'En cours d’examen'],
    ['information_requested', 'Complément demandé'],
    ['completed', 'Terminé'],
    ['rejected', 'Rejeté'],
  ] as const)('labels %s as « %s »', (status, label) => {
    show(caseCardBlock({ ...exampleCase, status }));
    expect(screen.getByRole('region', { name: 'État du dossier' })).toHaveTextContent(label);
  });

  it('a pending payment is told, without any pay button', () => {
    show(
      caseCardBlock({
        ...exampleCase,
        status: 'awaiting_payment',
        payment: { amountFcfa: 1900, status: 'pending', reference: null, paidAt: null, simulated: true },
      }),
    );
    expect(screen.getByRole('region', { name: 'État du dossier' }).textContent).toMatch(/1\s900 FCFA, à payer \(simulé\)/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the note of the information request', () => {
    show(
      caseCardBlock({
        ...exampleCase,
        status: 'information_requested',
        informationRequest: { note: 'Merci de joindre une pièce d’identité lisible.', requestedAt: '2026-11-02T10:00:00Z', requestedBy: 'off_01JD0000000000000000000001' as never },
      }),
    );
    expect(screen.getByRole('note')).toHaveTextContent('Merci de joindre une pièce d’identité lisible.');
  });

  it('offers a download link for each issued document only', () => {
    const item = issuedCase();
    show(caseCardBlock(item));
    const issued = item.documents.find((d) => d.kind === 'issued')!;
    const link = screen.getByRole('link', { name: /Extrait B3 du casier judiciaire/ });
    expect(link).toHaveAttribute('href', `/api/backend/v1/cases/${item.id}/documents/${issued.id}`);
    expect(screen.queryByRole('link', { name: /Extrait d'acte de naissance/ })).toBeNull();
  });

  it('shows no document section without an issued document', () => {
    show(caseCardBlock());
    expect(screen.queryByText('Documents délivrés')).toBeNull();
  });
});
