import { ProcedureEdit } from '@/components/procedure-edit';
import { decodeParam } from '@/lib/find-resource';

export const metadata = { title: 'Modifier une fiche · Console d’administration' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProcedureEdit id={decodeParam(id)} />;
}
