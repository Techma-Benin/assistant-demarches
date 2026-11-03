import type { Metadata } from 'next';
import { ChatWidget } from '@/components/chat/ChatWidget';

export const metadata: Metadata = { title: 'Assistant démarches' };

/** Chat intégrable: the conversation alone, full height, no site header or footer. */
export default function Page() {
  return <ChatWidget />;
}
