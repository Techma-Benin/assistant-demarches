import { WorkList } from '@/components/work/work-list';

export const metadata = { title: 'Complété · Console d’administration' };

export default function Page() {
  return <WorkList mode="completed" />;
}
