import { PageHeader } from '@/components/page-header';
import { ConversationsTable } from '@/components/resource-tables';

export const metadata = { title: 'Conversations · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Conversations" description="Conversations des usagers." />
      <ConversationsTable />
    </>
  );
}
