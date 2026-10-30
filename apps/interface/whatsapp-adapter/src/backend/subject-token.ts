import { isLoopbackHost } from '../config/config.js';

/** Fournit le jeton Backend de l’usager WhatsApp : le numéro n’est jamais envoyé au Backend autrement. */
export interface SubjectTokenProvider {
  tokenFor(waId: string): Promise<string>;
}

/** Développement : jeton de simulation, uniquement vers un Backend en boucle locale. */
export class DevSubjectTokenProvider implements SubjectTokenProvider {
  constructor(
    private readonly mockToken: string | undefined,
    private readonly backendUrl: string,
  ) {}

  async tokenFor(_waId: string): Promise<string> {
    if (!this.mockToken) throw new Error('MOCK_USER_TOKEN absent');
    if (!isLoopbackHost(new URL(this.backendUrl).hostname))
      throw new Error('Le jeton de simulation n’est utilisable que vers un Backend en boucle locale');
    return this.mockToken;
  }
}

/** Production : échange de jeton pas encore branché. */
export class ExchangeSubjectTokenProvider implements SubjectTokenProvider {
  async tokenFor(_waId: string): Promise<string> {
    // TODO : échanger auprès de l’émetteur OIDC un jeton portant le claim signé `channel_subject`
    // (CONTRACTS.md §3), client `whatsapp-adapter`, scope `conversation:relay`.
    throw new Error('Échange de jeton non branché');
  }
}
