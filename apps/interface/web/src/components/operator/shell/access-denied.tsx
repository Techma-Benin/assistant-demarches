import { BrandMark, Button } from '@techma/ui';

export function AccessDenied() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-6 px-6">
      <BrandMark />
      <p className="text-lg font-semibold text-ink">Accès réservé à l’opérateur.</p>
      <form method="post" action="/auth/logout">
        <Button type="submit" variant="outline">
          Se déconnecter
        </Button>
      </form>
    </main>
  );
}
