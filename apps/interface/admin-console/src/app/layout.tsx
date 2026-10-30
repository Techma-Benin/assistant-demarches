import type { Metadata, Viewport } from 'next';
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { ThemeScript } from '@techma/ui';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { ConsoleProvider } from '@/components/console/console-context';
import { AppShell } from '@/components/shell/app-shell';
import { DEFAULT_SESSION_ID, DEMO_SESSIONS, DEPARTMENT_COOKIE, SESSION_COOKIE, findSession } from '@/server/session';
import './globals.css';

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  variable: '--font-inter-tight',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Console d’administration',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0D0D0F' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const sessions = DEMO_SESSIONS.map(({ id, label }) => ({ id, label }));
  const sessionId = findSession(jar.get(SESSION_COOKIE)?.value)?.id ?? DEFAULT_SESSION_ID;
  const department = jar.get(DEPARTMENT_COOKIE)?.value;

  return (
    <html lang="fr" className={`${interTight.variable} ${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-canvas font-sans text-ink antialiased">
        <ConsoleProvider
          initialSessions={sessions}
          initialSessionId={sessionId}
          initialDepartmentId={department && /^[a-z0-9-]{1,64}$/.test(department) ? department : null}
        >
          <AppShell>{children}</AppShell>
        </ConsoleProvider>
      </body>
    </html>
  );
}
