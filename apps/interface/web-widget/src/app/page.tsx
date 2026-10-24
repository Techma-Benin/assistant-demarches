import { ChatWidget } from '@/components/chat/ChatWidget';

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-stretch justify-center md:items-center md:py-6">
      <div className="h-dvh w-full overflow-hidden md:h-[44rem] md:rounded-card md:border md:border-line md:shadow-[var(--ui-shadow-pop)]">
        <ChatWidget />
      </div>
    </main>
  );
}
