import { PageHeader } from '@/components/page-header';
import { ConversationBrowser } from '@/components/conversations/conversation-browser';

export const metadata = { title: 'Conversations · Console d’administration' };

export default function Page() {
  return (
    <>
      <PageHeader title="Conversations" description="Conversations des usagers, pseudonymisées." />
      <ConversationBrowser />
    </>
  );
}
