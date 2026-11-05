'use client';

import type { ReactNode } from 'react';
import { Button, Tile } from '@techma/ui';
import { LogIn } from 'lucide-react';
import { NpiSignIn } from '@/components/app/NpiSignIn';
import { useSessionUser } from '@/hooks/use-session-user';
import { loginHref } from '@/lib/auth-links';
import { navigate } from '@/lib/navigate';

type Props = {
  block: { type: 'loginRequired'; reason: string };
  conversationId: string | null;
  /** Only the last agent message offers the sign-in; an older card shows the reason alone. */
  interactive?: boolean;
};

/**
 * The action needs an account. Simulated NPI sign-in inline when enabled (the NPI never enters the chat),
 * else a full navigation to the Keycloak login; both attach the guest's conversation.
 */
export function LoginRequiredBlock({ block, conversationId, interactive = true }: Props) {
  const { status, signIn } = useSessionUser();
  let action: ReactNode = null;
  if (status === 'user') {
    action = (
      <p role="status" className="m-0 text-base font-semibold text-trust-text">
        Connexion effectuée.
      </p>
    );
  } else if (status === 'checking') {
    // Keeps the card height steady until the session is known.
    action = <div aria-hidden="true" className="min-h-[52px]" />;
  } else if (interactive && signIn === 'npi') {
    action = <NpiSignIn conversationId={conversationId} returnTo={window.location.pathname} />;
  } else if (interactive) {
    action = (
      <Button
        size="lg"
        className="min-h-[52px] self-start px-7 font-bold"
        leadingIcon={<LogIn aria-hidden="true" className="size-[18px]" />}
        onClick={() => navigate(loginHref(window.location.pathname, conversationId ?? undefined))}
      >
        Se connecter pour continuer
      </Button>
    );
  }
  return (
    <Tile tone="outline" role="region" aria-label="Connexion requise" className="flex flex-col gap-4 rounded-[28px] p-7 md:p-7">
      {status !== 'user' && <p className="m-0 whitespace-pre-wrap break-words text-[17px] leading-[1.55]">{block.reason}</p>}
      {action}
    </Tile>
  );
}
