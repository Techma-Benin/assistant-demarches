import { PageHeader } from '@/components/page-header';
import { ActivityLog } from '@/components/work/activity-log';

export const metadata = { title: 'Journal d’audit · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Journal d’audit" description="Les actions appliquées aux dossiers, horodatées et traçables." />
      <ActivityLog />
    </>
  );
}
