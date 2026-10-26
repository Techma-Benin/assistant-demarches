'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from './IconButton';

export const THEME_STORAGE_KEY = 'techma-theme';
type Preference = 'system' | 'light' | 'dark';
const ORDER: Preference[] = ['system', 'light', 'dark'];
const LABELS: Record<Preference, string> = {
  system: 'Thème : système',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};
const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

/** Inline script for <head>: applies the stored theme before first paint. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

function readStored(): Preference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [preference, setPreference] = useState<Preference>('system');

  // Read after mount to avoid a hydration mismatch.
  useEffect(() => setPreference(readStored()), []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
    setPreference(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice only lasts for this page.
    }
  }

  const Icon = ICONS[preference];
  return (
    <IconButton label={LABELS[preference]} variant="ghost" className={className} onClick={cycle}>
      <Icon key={preference} aria-hidden="true" className="ui-swap ui-theme-icon size-5" />
    </IconButton>
  );
}
