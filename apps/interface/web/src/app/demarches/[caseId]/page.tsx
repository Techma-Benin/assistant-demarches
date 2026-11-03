import type { Metadata } from 'next';
import { CaseDetail } from '@/components/app/MyCases';

export const metadata: Metadata = { title: 'Ma démarche' };

export default async function Page({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <CaseDetail caseId={caseId} />;
}
