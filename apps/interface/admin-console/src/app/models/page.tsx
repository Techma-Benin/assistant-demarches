import { PageHeader } from '@/components/page-header';
import { ModelsTable } from '@/components/resource-tables';

export const metadata = { title: 'Modèles · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Modèles" description="Configuration des modèles." />
      <ModelsTable />
    </>
  );
}
