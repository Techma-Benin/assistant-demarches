import { PageHeader } from '@/components/page-header';
import { UsersList } from '@/components/work/users-list';

export const metadata = { title: 'Utilisateurs · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Utilisateurs" description="Les personnes qui ont accès à ce ministère." />
      <UsersList />
    </>
  );
}
