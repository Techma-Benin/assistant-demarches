/** Existing fills. Sun stays yellow, so its label stays dark; the others pair with a readable foreground. */
const BADGE_TONES = [
  'bg-trust text-on-trust',
  'bg-sun text-warning',
  'bg-flag-red text-white',
  'bg-web text-on-trust',
  'bg-ink text-on-action',
] as const;

/** Same key always lands on the same swatch. */
export function badgeTone(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BADGE_TONES[hash % BADGE_TONES.length];
}
