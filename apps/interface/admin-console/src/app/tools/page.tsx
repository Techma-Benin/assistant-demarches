import { PageHeader } from '@/components/page-header';
import { ToolsTable } from '@/components/tools-table';

export const metadata = { title: 'Outils · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Outils"
        description="Activez ou désactivez un outil. Le serveur et la référence du secret restent en lecture seule."
      />
      <ToolsTable />
    </>
  );
}
