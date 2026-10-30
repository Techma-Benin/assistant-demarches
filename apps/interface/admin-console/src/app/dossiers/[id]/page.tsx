import { WorkItemDetail } from '@/components/work/work-detail';

export const metadata = { title: 'Dossier · Console d’administration' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkItemDetail id={id} />;
}
