import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandMark } from '@techma/ui';
import { NpiSignIn } from '@/components/app/NpiSignIn';
import { CONVERSATION_ID, safeReturnTo } from '@/server/auth/links';
import { npiLoginEnabled } from '@/server/auth/npi';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

type Params = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function Page({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(first(params.returnTo));
  const rawConversation = first(params.conversationId);
  const conversationId = rawConversation && CONVERSATION_ID.test(rawConversation) ? rawConversation : null;

  if (!npiLoginEnabled()) {
    const query = new URLSearchParams({ returnTo });
    if (conversationId) query.set('conversationId', conversationId);
    redirect(`/auth/login?${query}`);
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line-subtle">
        <div className="mx-auto flex max-w-[960px] items-center px-4 py-3 md:px-6 md:py-4">
          <Link href="/" aria-label="Accueil" className="shrink-0 rounded-pill no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">
            <BrandMark />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-[560px] flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
        <h1 className="m-0 font-display text-[clamp(32px,4vw,48px)] font-extrabold leading-none tracking-[-0.04em]">Connexion</h1>
        <NpiSignIn returnTo={returnTo} conversationId={conversationId} />
      </main>
    </div>
  );
}
