import { PageHeader } from '@/components/page-header';
import { ProceduresTable } from '@/components/resource-tables';

export const metadata = { title: 'Fiches de démarche · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Fiches de démarche" description="Fiches de démarche et leur état de validation." />
      <ProceduresTable />
    </>
  );
}
