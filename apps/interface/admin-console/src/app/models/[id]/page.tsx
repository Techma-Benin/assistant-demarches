import { RequireCapability } from '@/components/session/require-capability';
import { ModelEdit } from '@/components/model-edit';
import { decodeParam } from '@/lib/find-resource';

export const metadata = { title: 'Modifier un modèle · Console d’administration' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireCapability capability="models.view">
      <ModelEdit id={decodeParam(id)} />
    </RequireCapability>
  );
}
