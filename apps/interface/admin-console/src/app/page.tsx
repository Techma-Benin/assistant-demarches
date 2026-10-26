import { Dashboard } from '@/components/dashboard';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Tableau de bord · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Tableau de bord" description="Indicateurs de l’assistant." />
      <Dashboard />
    </>
  );
}
