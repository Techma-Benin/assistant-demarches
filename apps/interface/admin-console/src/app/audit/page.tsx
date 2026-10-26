import { PageHeader } from '@/components/page-header';
import { AuditTable } from '@/components/resource-tables';

export const metadata = { title: 'Journal d’audit · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Journal d’audit" description="Modifications de configuration tracées." />
      <AuditTable />
    </>
  );
}
