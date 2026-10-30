'use client';

import { Button } from '@techma/ui';
import type { ReactNode } from 'react';
import { can, type Capability, type Identity } from '@/lib/permissions';
import { useSession } from './session-context';

/**
 * « Pas d’accès » screen, with a shortcut to each identity of the session that would be allowed.
 * `accepts` narrows the candidates further (e.g. the administration owning a fiche).
 */
export function AccessDenied({
  capability,
  accepts = () => true,
}: {
  capability: Capability;
  accepts?: (identity: Identity) => boolean;
}) {
  const { session, identity, switchIdentity, switching } = useSession();
  const candidates = (session?.identities ?? []).filter(
    (candidate) => candidate.id !== identity?.id && can(candidate, capability) && accepts(candidate),
  );
  return (
    <section aria-labelledby="no-access-title" className="flex max-w-xl flex-col gap-4 py-6">
      <h1 id="no-access-title" className="font-display text-[clamp(32px,4vw,48px)] leading-none font-extrabold tracking-[-0.04em]">
        Pas d’accès avec cette identité
      </h1>
      <p className="text-base text-ink-muted">
        {identity ? `Vous agissez en tant que : ${identity.label}. ` : ''}Cette page n’est pas disponible pour cette identité.
      </p>
      {candidates.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {candidates.map((candidate) => (
            <Button key={candidate.id} variant="outline" disabled={switching} onClick={() => void switchIdentity(candidate.id)}>
              {`Passer à ${candidate.label}`}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm font-semibold">Aucune de vos identités n’y a accès.</p>
      )}
    </section>
  );
}

/** Renders its children only when the active identity has `capability`. */
export function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can: allowed } = useSession();
  return allowed(capability) ? <>{children}</> : <AccessDenied capability={capability} />;
}
