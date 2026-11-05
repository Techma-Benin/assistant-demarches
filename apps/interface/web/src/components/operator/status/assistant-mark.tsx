import type { SVGProps } from 'react';

type AssistantMarkProps = SVGProps<SVGSVGElement>;

/** Hub-and-branch glyph for the operator connection schema (Assistant center). */
export function AssistantMark({ className, ...props }: AssistantMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 88 88"
      width={88}
      height={88}
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient id="op-assistant-hub" x1="44" y1="10" x2="44" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ui-trust-line)" />
          <stop offset="1" stopColor="var(--ui-trust)" />
        </linearGradient>
        <linearGradient id="op-assistant-spine" x1="44" y1="36" x2="44" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ui-trust)" />
          <stop offset="1" stopColor="var(--ui-trust-text)" />
        </linearGradient>
        <filter id="op-assistant-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="var(--ui-trust-text)" floodOpacity="0.18" />
        </filter>
      </defs>

      <g filter="url(#op-assistant-soft)">
        <rect x="28" y="8" width="32" height="32" rx="10" fill="var(--ui-trust-soft)" stroke="url(#op-assistant-hub)" strokeWidth="2" />
        <path
          d="M44 22 L48 30 L40 30 Z"
          fill="var(--ui-trust-text)"
          opacity="0.92"
        />
        <circle cx="44" cy="18" r="2.5" fill="var(--ui-trust)" />
      </g>

      <path
        d="M44 40 V48"
        stroke="url(#op-assistant-spine)"
        strokeWidth="2.75"
        strokeLinecap="round"
      />

      <path
        d="M18 70 C18 56 30 50 44 48 C58 50 70 56 70 70"
        fill="none"
        stroke="var(--ui-trust-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      <g fill="var(--ui-surface)" stroke="var(--ui-trust-text)" strokeWidth="2">
        <rect x="10" y="62" width="16" height="16" rx="5" />
        <rect x="36" y="66" width="16" height="16" rx="5" />
        <rect x="62" y="62" width="16" height="16" rx="5" />
      </g>

      <g fill="var(--ui-trust)">
        <circle cx="18" cy="70" r="3" />
        <circle cx="44" cy="74" r="3" />
        <circle cx="70" cy="70" r="3" />
      </g>
    </svg>
  );
}
