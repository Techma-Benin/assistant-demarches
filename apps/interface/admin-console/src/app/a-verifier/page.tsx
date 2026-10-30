import { WorkList } from '@/components/work/work-list';

export const metadata = { title: 'En attente · Console d’administration' };

export default function Page() {
  return <WorkList mode="pending" />;
}
