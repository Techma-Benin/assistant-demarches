import { PageHeader } from '@/components/admin/page-header';
import { ActivityLog } from '@/components/admin/work/activity-log';

export const metadata = { title: 'Journal · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Journal" description="Qui a fait quoi sur quel dossier, et quand." />
      <ActivityLog />
    </>
  );
}
