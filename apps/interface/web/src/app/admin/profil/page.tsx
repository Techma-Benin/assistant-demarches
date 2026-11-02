import { ProfileView } from '@/components/admin/console/profile-view';
import { PageHeader } from '@/components/admin/page-header';

export const metadata = { title: 'Profil · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Profil" description="Votre identité, vos ministères et vos droits, tels que le Backend les connaît." />
      <ProfileView />
    </>
  );
}
