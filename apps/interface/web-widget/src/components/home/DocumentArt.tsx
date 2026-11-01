import type { ReactNode } from 'react';

export type DocumentKind = 'acte-naissance' | 'casier' | 'passeport' | 'cni' | 'entreprise' | 'permis';

const INK = 'var(--color-ink)';
const MUTED = 'var(--color-ink-muted)';
const PAPER = 'var(--color-surface)';
const SUNKEN = 'var(--color-sunken)';
const LINE = 'var(--color-line)';
const TRUST = 'var(--color-trust)';

function FlagStrip({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="14" height="24" rx="2" fill="var(--color-trust)" />
      <rect x="15" width="21" height="11.5" rx="2" fill="var(--color-sun)" />
      <rect x="15" y="12.5" width="21" height="11.5" rx="2" fill="var(--color-flag-red)" />
    </g>
  );
}

function Header({ x = 20, y = 20 }: { x?: number; y?: number }) {
  return (
    <g>
      <FlagStrip x={x} y={y} />
      <text x={x + 46} y={y + 16} fontSize="9.5" fontWeight="600" fill={MUTED} fontFamily="inherit">
        RÉPUBLIQUE DU BÉNIN
      </text>
    </g>
  );
}

/** Rounded bars standing in for lines of text. */
function Lines({ x, y, widths, gap = 16 }: { x: number; y: number; widths: number[]; gap?: number }) {
  return (
    <g fill={MUTED} opacity="0.35">
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height="6" rx="3" />
      ))}
    </g>
  );
}

function Title({ children, y = 86, size = 17 }: { children: ReactNode; y?: number; size?: number }) {
  return (
    <text x="20" y={y} fontSize={size} fontWeight="800" fill={INK} fontFamily="inherit">
      {children}
    </text>
  );
}

function Paper() {
  return <rect width="240" height="320" rx="10" fill={PAPER} />;
}

function StampShape({ label }: { label: string }) {
  return (
    <g>
      <circle cx="60" cy="60" r="54" fill="none" stroke={TRUST} strokeWidth="6" />
      <circle cx="60" cy="60" r="44" fill="none" stroke={TRUST} strokeWidth="2" />
      <path d="M38 52l13 13 25-27" fill="none" stroke={TRUST} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <text x="60" y="92" textAnchor="middle" fontSize="15" fontWeight="800" fill={TRUST} fontFamily="inherit" letterSpacing="1">
        {label}
      </text>
    </g>
  );
}

export function Stamp({ className, label = 'Validé' }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true" focusable="false">
      <StampShape label={label} />
    </svg>
  );
}

function Body({ kind }: { kind: DocumentKind }) {
  switch (kind) {
    case 'acte-naissance':
      return (
        <g>
          <Paper />
          <Header />
          <Title>Acte de naissance</Title>
          <Lines x={20} y={118} widths={[200, 170, 190, 140, 180, 120]} gap={20} />
          <circle cx="188" cy="270" r="26" fill="none" stroke={MUTED} strokeWidth="2" opacity="0.5" />
          <circle cx="188" cy="270" r="18" fill="none" stroke={MUTED} strokeWidth="1.5" opacity="0.5" />
        </g>
      );
    case 'casier':
      return (
        <g>
          <Paper />
          <Header />
          <Title>Casier judiciaire</Title>
          <text x="20" y="106" fontSize="11" fill={MUTED} fontFamily="inherit">
            Bulletin n° 3
          </text>
          <Lines x={20} y={130} widths={[200, 160, 190, 130, 170]} gap={20} />
          <path d="M20 280c14-22 22 14 34-6s16-10 26-2 14-12 28-4" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        </g>
      );
    case 'passeport':
      return (
        <g>
          <rect x="34" y="22" width="190" height="276" rx="10" fill={SUNKEN} transform="rotate(5 130 160)" />
          <rect x="20" y="22" width="190" height="276" rx="10" fill={INK} />
          <circle cx="115" cy="130" r="38" fill="none" stroke={PAPER} strokeWidth="3" />
          <circle cx="115" cy="130" r="14" fill={PAPER} />
          <text x="115" y="214" textAnchor="middle" fontSize="19" fontWeight="800" fill={PAPER} fontFamily="inherit" letterSpacing="3">
            PASSEPORT
          </text>
          <text x="115" y="236" textAnchor="middle" fontSize="9.5" fontWeight="600" fill={PAPER} fontFamily="inherit" opacity="0.7">
            RÉPUBLIQUE DU BÉNIN
          </text>
        </g>
      );
    case 'cni':
      return (
        <g transform="translate(0 70)">
          <rect width="240" height="160" rx="10" fill={PAPER} />
          <FlagStrip x={16} y={14} />
          <text x="62" y="30" fontSize="9" fontWeight="600" fill={MUTED} fontFamily="inherit">
            RÉPUBLIQUE DU BÉNIN
          </text>
          <text x="62" y="43" fontSize="9" fill={MUTED} fontFamily="inherit">
            Carte d’identité
          </text>
          <rect x="16" y="62" width="76" height="84" rx="6" fill={SUNKEN} />
          <circle cx="54" cy="94" r="14" fill={MUTED} opacity="0.5" />
          <path d="M24 146c0-22 14-34 30-34s30 12 30 34z" fill={MUTED} opacity="0.5" />
          <Lines x={108} y={70} widths={[110, 90, 100, 70]} gap={18} />
          <rect x="108" y="132" width="116" height="6" rx="3" fill={INK} opacity="0.7" />
        </g>
      );
    case 'entreprise':
      return (
        <g>
          <Paper />
          <Header />
          <Title size={15}>Création d’entreprise</Title>
          <g>
            <rect x="20" y="108" width="200" height="84" rx="6" fill={SUNKEN} />
            <rect x="20" y="108" width="200" height="22" rx="6" fill={INK} opacity="0.85" />
            <rect x="96" y="130" width="2" height="62" fill={PAPER} />
            <rect x="20" y="152" width="200" height="2" fill={PAPER} />
            <rect x="30" y="165" width="50" height="6" rx="3" fill={MUTED} opacity="0.35" />
            <rect x="108" y="165" width="80" height="6" rx="3" fill={MUTED} opacity="0.35" />
          </g>
          <Lines x={20} y={216} widths={[190, 150, 170]} gap={20} />
        </g>
      );
    case 'permis':
      return (
        <g>
          <Paper />
          <Header />
          <Title size={15}>Permis de construire</Title>
          <g fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
            <path d="M36 200v-56l84-40 84 40v56z" />
            <path d="M104 200v-36h32v36" />
            <path d="M52 156h24v18H52zM164 156h24v18h-24z" />
          </g>
          <Lines x={20} y={236} widths={[180, 140, 160]} gap={20} />
        </g>
      );
  }
}

/** Flat paper-document drawings; colours come from CSS variables so dark mode follows. */
export function DocumentArt({ kind, className, stamped }: { kind: DocumentKind; className?: string; stamped?: boolean }) {
  return (
    <svg viewBox="0 0 240 320" className={className} aria-hidden="true" focusable="false">
      <Body kind={kind} />
      {stamped && (
        <g transform="translate(136 206) rotate(-12 50 50) scale(0.84)">
          <circle cx="60" cy="60" r="58" fill={PAPER} opacity="0.85" />
          <StampShape label="Validé" />
        </g>
      )}
    </svg>
  );
}
