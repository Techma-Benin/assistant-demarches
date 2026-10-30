import { PageHeader } from '@/components/page-header';
import { AuditLog } from '@/components/audit/audit-log';

export const metadata = { title: 'Journal d’audit · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Journal d’audit" description="Chaque modification de configuration, horodatée et traçable." />
      <AuditLog />
    </>
  );
}
