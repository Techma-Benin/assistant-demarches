import { PageHeader } from '@/components/page-header';
import { ProcedureBrowser } from '@/components/procedures/procedure-browser';
import { parseStatusFilter } from '@/lib/procedure-list';

export const metadata = { title: 'Fiches de démarche · Console d’administration' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; stale?: string | string[] }>;
}) {
  const { status, stale } = await searchParams;
  return (
    <>
      <PageHeader
        title="Fiches de démarche"
        description="La seule source que l’assistant a le droit de citer. Une fiche n’est citée qu’une fois validée."
      />
      <ProcedureBrowser
        initialStatus={parseStatusFilter(Array.isArray(status) ? status[0] : status)}
        initialStale={(Array.isArray(stale) ? stale[0] : stale) === '1'}
      />
    </>
  );
}
