import { WorkList } from '@/components/admin/work/work-list';

export const metadata = { title: 'En attente · Console d’administration' };

export default function Page() {
  return <WorkList view="pending" />;
}
