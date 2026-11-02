import { WorkList } from '@/components/admin/work/work-list';

export const metadata = { title: 'Complété · Console d’administration' };

export default function Page() {
  return <WorkList mode="completed" />;
}
