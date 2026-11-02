'use client';

import { Button, Tile } from '@techma/ui';
import { LogIn } from 'lucide-react';
import { loginHref } from '@/lib/auth-links';
import { navigate } from '@/lib/navigate';

type Props = {
  block: { type: 'loginRequired'; reason: string };
  conversationId: string | null;
};

/** The action needs an account: full navigation to the server-side login, which attaches the guest's conversation. */
export function LoginRequiredBlock({ block, conversationId }: Props) {
  return (
    <Tile tone="outline" role="region" aria-label="Connexion requise" className="flex flex-col gap-4 rounded-[28px] p-7 md:p-7">
      <p className="m-0 whitespace-pre-wrap break-words text-[17px] leading-[1.55]">{block.reason}</p>
      <Button
        size="lg"
        className="min-h-[52px] self-start px-7 font-bold"
        leadingIcon={<LogIn aria-hidden="true" className="size-[18px]" />}
        onClick={() => navigate(loginHref(window.location.pathname, conversationId ?? undefined))}
      >
        Se connecter pour continuer
      </Button>
    </Tile>
  );
}
