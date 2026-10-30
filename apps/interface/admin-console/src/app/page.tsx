import { RequireCapability } from '@/components/session/require-capability';
import { Dashboard } from '@/components/dashboard';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Vue d’ensemble · Console d’administration' };

export default function Page() {
  return (
    <RequireCapability capability="overview.view">
      <PageHeader
        title="Vue d’ensemble"
        description="Ce qui se passe sur les canaux et ce qui attend une décision de votre équipe."
      />
      <Dashboard />
    </RequireCapability>
  );
}
