import { PageHeader } from '@/components/admin/page-header';
import { UsersList } from '@/components/admin/work/users-list';

export const metadata = { title: 'Utilisateurs · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Utilisateurs" description="Les agents qui ont accès à cette administration." />
      <UsersList />
    </>
  );
}
