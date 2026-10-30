import { RequireCapability } from '@/components/session/require-capability';
import { PageHeader } from '@/components/page-header';
import { ConversationBrowser } from '@/components/conversations/conversation-browser';

export const metadata = { title: 'Conversations · Console d’administration' };

export default function Page() {
  return (
    <RequireCapability capability="conversations.view">
      <PageHeader title="Conversations" description="Conversations des usagers, pseudonymisées." />
      <ConversationBrowser />
    </RequireCapability>
  );
}
