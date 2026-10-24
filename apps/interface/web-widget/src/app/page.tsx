import { ChatWidget } from '@/components/chat/ChatWidget';

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-stretch justify-center md:items-center md:py-6">
      <div className="h-dvh w-full overflow-hidden md:h-[40rem] md:rounded-lg md:border md:border-slate-300 md:shadow">
        <ChatWidget />
      </div>
    </main>
  );
}
