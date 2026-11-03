import { WorkList } from '@/components/admin/work/work-list';

export const metadata = { title: 'Rejeté · Console d’administration' };

export default function Page() {
  return <WorkList view="rejected" />;
}
