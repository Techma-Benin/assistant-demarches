import type { Metadata, Viewport } from 'next';
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { ThemeScript } from '@techma/ui';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${interTight.variable} ${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-canvas font-sans text-ink antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
