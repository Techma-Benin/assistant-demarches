const INK = 'var(--ui-text)';
const MUTED = 'var(--ui-text-muted)';
const PAPER = 'var(--ui-surface)';
const SUNKEN = 'var(--ui-sunken)';
const LINE = 'var(--ui-border)';
const TRUST = 'var(--ui-trust)';

const SUBTLE = 'var(--ui-text-subtle)';

export type DocumentKind = 'acte-naissance' | 'casier' | 'passeport' | 'cni' | 'entreprise' | 'permis' | 'residence';

/** Deterministic pseudo-random modules for a decorative QR code. Never encodes anything. */
export function qrModules(seed: number, n = 11): boolean[][] {
  let s = (seed * 2654435761) >>> 0;
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return ((s >>> 16) & 3) !== 0;
    }),
  );
}

function Qr({ x, y, size, seed, paper = PAPER, ink = INK }: { x: number; y: number; size: number; seed: number; paper?: string; ink?: string }) {
  const n = 11;
  const m = size / n;
  const f = (v: number) => v.toFixed(2);
  const grid = qrModules(seed, n);
  let d = '';
  grid.forEach((row, r) =>
    row.forEach((on, c) => {
      const inFinder = (r < 4 && c < 4) || (r < 4 && c >= n - 4) || (r >= n - 4 && c < 4);
      if (on && !inFinder) d += `M${f(c * m)} ${f(r * m)}h${f(m)}v${f(m)}h${f(-m)}z`;
    }),
  );
  const finders: [number, number][] = [[0, 0], [n - 3, 0], [0, n - 3]];
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-1.5" y="-1.5" width={size + 3} height={size + 3} rx="2" fill={paper} stroke={ink} strokeWidth="0.5" opacity="0.9" />
      <path d={d} fill={ink} opacity="0.75" />
      {finders.map(([c, r]) => (
        <g key={`${c}-${r}`}>
          <rect x={f(c * m)} y={f(r * m)} width={f(3 * m)} height={f(3 * m)} fill={ink} opacity="0.85" />
          <rect x={f((c + 1) * m)} y={f((r + 1) * m)} width={f(m)} height={f(m)} fill={paper} />
        </g>
      ))}
    </g>
  );
}

/** Thin tricolour rule under the republic header (only place the flag colours appear, besides cards). */
function FlagRule({ cx = 105, y, w = 70, light }: { cx?: number; y: number; w?: number; light?: boolean }) {
  const t = w / 3;
  return (
    <g opacity={light ? 0.95 : 1}>
      <rect x={cx - w / 2} y={y} width={t} height="1.6" fill="var(--color-trust)" />
      <rect x={cx - w / 2 + t} y={y} width={t} height="1.6" fill="var(--color-sun)" />
      <rect x={cx - w / 2 + 2 * t} y={y} width={t} height="1.6" fill="var(--color-flag-red)" />
    </g>
  );
}

function RepHeader({ cx = 105, y = 18, fill = INK }: { cx?: number; y?: number; fill?: string }) {
  return (
    <g>
      <text x={cx} y={y} textAnchor="middle" fontSize="9" fontWeight="700" fill={fill} fontFamily="inherit">
        RÉPUBLIQUE DU BÉNIN
      </text>
      <FlagRule cx={cx} y={y + 5} />
    </g>
  );
}

function Paper() {
  return <rect x="0.5" y="0.5" width="209" height="296" rx="6" fill={PAPER} stroke={LINE} strokeWidth="1" />;
}

/** Centred short bars (sub-authority, reference). */
function CenterBars({ y, widths, gap = 8 }: { y: number; widths: number[]; gap?: number }) {
  return (
    <g fill={SUBTLE} opacity="0.6">
      {widths.map((w, i) => (
        <rect key={i} x={105 - w / 2} y={y + i * gap} width={w} height="3.5" rx="1.75" />
      ))}
    </g>
  );
}

function TitlePill({ y, text, w }: { y: number; text: string; w: number }) {
  return (
    <g>
      <rect x={105 - w / 2} y={y} width={w} height="16" rx="8" fill="none" stroke={INK} strokeWidth="0.8" />
      <text x="105" y={y + 10.8} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={INK} fontFamily="inherit">
        {text}
      </text>
    </g>
  );
}

/** « label : value » rows made of bars. */
function Rows({ y, rows, gap = 9, lx = 18, vx = 80 }: { y: number; rows: [number, number][]; gap?: number; lx?: number; vx?: number }) {
  return (
    <g>
      {rows.map(([lw, vw], i) => (
        <g key={i}>
          <rect x={lx} y={y + i * gap} width={lw} height="4" rx="2" fill={SUBTLE} opacity="0.6" />
          <rect x={vx} y={y + i * gap - 0.25} width={vw} height="4.5" rx="2.25" fill={INK} opacity="0.8" />
        </g>
      ))}
    </g>
  );
}

/** The issuing office's own round seal: a star, never a check mark (the check belongs to our green « Validé » stamp). */
function Seal({ cx, cy, r = 15 }: { cx: number; cy: number; r?: number }) {
  const s = r * 0.32;
  const star = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 === 0 ? s : s * 0.45;
    return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return (
    <g fill="none" stroke={MUTED} strokeWidth="1.2" opacity="0.6">
      <circle cx={cx} cy={cy} r={r} />
      <circle cx={cx} cy={cy} r={r * 0.68} />
      <polygon points={star} fill={MUTED} stroke="none" />
    </g>
  );
}

function Scribble({ x, y, w = 40 }: { x: number; y: number; w?: number }) {
  const k = w / 40;
  return (
    <path
      d={`M${x} ${y}c${6 * k}-14 ${10 * k}-14 ${12 * k}-2s${6 * k} 10 ${10 * k}-2 ${8 * k}-8 ${18 * k}-6`}
      fill="none"
      stroke={INK}
      strokeWidth="1.3"
      strokeLinecap="round"
      opacity="0.75"
    />
  );
}

/** « Fait à …, le … » right-aligned, signature and seal bottom-right. */
function Footer({ y = 238 }: { y?: number }) {
  return (
    <g>
      <g fill={SUBTLE} opacity="0.6">
        <rect x="110" y={y} width="24" height="4" rx="2" />
        <rect x="160" y={y} width="32" height="4" rx="2" />
      </g>
      <rect x="136" y={y - 0.25} width="22" height="4.5" rx="2.25" fill={INK} opacity="0.8" />
      <Scribble x={116} y={y + 30} />
      <Seal cx={172} cy={y + 32} />
    </g>
  );
}

/** Two lines of tiny monospace-like cells; not real characters. */
function Mrz({ x, y, w, fill = INK, opacity = 0.5 }: { x: number; y: number; w: number; fill?: string; opacity?: number }) {
  return (
    <g stroke={fill} strokeWidth="4.5" strokeDasharray="1.6 1.4" opacity={opacity}>
      <line x1={x} x2={x + w} y1={y} y2={y} />
      <line x1={x} x2={x + w * 0.92} y1={y + 7} y2={y + 7} />
    </g>
  );
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
          <Qr x={14} y={10} size={22} seed={11} />
          <Qr x={170} y={10} size={26} seed={29} />
          <RepHeader />
          <CenterBars y={34} widths={[56, 84]} />
          <rect x="85" y="50" width="40" height="3.5" rx="1.75" fill="var(--color-flag-red)" opacity="0.7" />
          <TitlePill y={60} text="ACTE DE NAISSANCE" w={124} />
          <text x="105" y="91" textAnchor="middle" fontSize="7" fontWeight="700" fill={INK} fontFamily="inherit">
            VOLET N° 1
          </text>
          <Rows y={100} rows={[[34, 86], [42, 60], [30, 100], [38, 74], [46, 52], [36, 90]]} />
          <g fill={SUBTLE} opacity="0.6">
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <rect x="18" y={158 + i * 8} width={30 + (i % 2) * 8} height="3.5" rx="1.75" />
                <rect x="18" y={162.2 + i * 8} width="52" height="0.6" />
              </g>
            ))}
          </g>
          <rect x="76" y="154" width="0.6" height="36" fill={SUBTLE} />
          <Rows y={158} lx={82} vx={112} gap={8} rows={[[18, 70], [20, 54], [18, 62], [20, 46]]} />
          <Rows y={200} rows={[[40, 56], [34, 48], [38, 62]]} />
          <Footer y={236} />
          <line x1="204" x2="204" y1="12" y2="285" stroke={SUBTLE} strokeWidth="0.8" strokeDasharray="2 2" data-cut-line="" />
        </g>
      );
    case 'residence':
      return (
        <g>
          <Paper />
          <g>
            <circle cx="26" cy="22" r="10" fill="none" stroke={MUTED} strokeWidth="1.2" opacity="0.6" />
            <path d="M26 15.5l1.9 4.2 4.5.4-3.4 3 1 4.4-4-2.3-4 2.3 1-4.4-3.4-3 4.5-.4z" fill={MUTED} opacity="0.6" />
          </g>
          <g fill={SUBTLE} opacity="0.6">
            <rect x="42" y="16" width="52" height="4" rx="2" />
            <rect x="42" y="24" width="36" height="4" rx="2" />
          </g>
          <Qr x={170} y={10} size={26} seed={47} />
          <rect x="175" y="42" width="16" height="3.5" rx="1.75" fill={SUBTLE} opacity="0.6" />
          <TitlePill y={50} text="CERTIFICAT DE RÉSIDENCE" w={150} />
          <CenterBars y={75} widths={[90]} />
          <rect x="75" y="83" width="60" height="4.5" rx="2.25" fill={INK} opacity="0.8" />
          <Divider y={100} label="REQUÉRANT" />
          <Rows y={110} gap={9} lx={18} vx={90} rows={[[44, 80], [36, 60], [50, 96], [40, 70], [34, 54], [46, 84], [52, 64], [38, 76]]} />
          <rect x="18" y="186" width="58" height="4.5" rx="2.25" fill={INK} opacity="0.8" />
          <g fill={INK} opacity="0.8">
            <rect x="90" y="185.75" width="100" height="4.5" rx="2.25" />
            <rect x="90" y="194.75" width="88" height="4.5" rx="2.25" />
            <rect x="90" y="203.75" width="58" height="4.5" rx="2.25" />
          </g>
          <Divider y={222} label="DÉCLARANT" />
          <Rows y={232} gap={9} lx={18} vx={90} rows={[[42, 72], [36, 58], [48, 84]]} />
          <g fill={SUBTLE} opacity="0.6">
            {[14, 64, 114].map((x) => (
              <rect key={x} x={x} y="264" width="36" height="3.5" rx="1.75" />
            ))}
          </g>
          {[14, 64, 114].map((x) => (
            <Scribble key={x} x={x} y={282} w={34} />
          ))}
          <Seal cx={174} cy={272} />
        </g>
      );
    case 'casier':
      return (
        <g>
          <Paper />
          <Qr x={170} y={10} size={26} seed={5} />
          <RepHeader />
          <CenterBars y={34} widths={[70, 90]} />
          <TitlePill y={52} text="CASIER JUDICIAIRE" w={116} />
          <text x="105" y="83" textAnchor="middle" fontSize="7" fontWeight="700" fill={INK} fontFamily="inherit">
            BULLETIN N° 3
          </text>
          <Rows y={96} rows={[[34, 90], [40, 64], [30, 104], [44, 70], [36, 56], [42, 96], [32, 80]]} />
          <Footer y={188} />
        </g>
      );
    case 'passeport':
      return (
        <g>
          <rect x="34" y="20" width="164" height="256" rx="8" fill={SUNKEN} transform="rotate(5 116 148)" />
          <rect x="16" y="20" width="164" height="256" rx="8" fill={INK} />
          <RepHeader cx={98} y={52} fill={PAPER} />
          <g fill="none" stroke={PAPER} strokeWidth="2.5">
            <circle cx="98" cy="128" r="36" />
            <circle cx="98" cy="128" r="12" fill={PAPER} />
          </g>
          <text x="98" y="204" textAnchor="middle" fontSize="17" fontWeight="800" fill={PAPER} fontFamily="inherit" letterSpacing="3">
            PASSEPORT
          </text>
          <Mrz x={30} y={236} w={136} fill={PAPER} opacity={0.45} />
        </g>
      );
    case 'cni':
      return (
        <g transform="translate(0 76)">
          <rect x="0.5" y="0.5" width="209" height="142" rx="8" fill={PAPER} stroke={LINE} strokeWidth="1" />
          <RepHeader y={16} />
          <TitlePill y={28} text="CARTE D’IDENTITÉ" w={96} />
          <rect x="14" y="52" width="62" height="64" rx="5" fill={SUNKEN} />
          <circle cx="45" cy="76" r="11" fill={MUTED} opacity="0.5" />
          <path d="M20 116c0-18 11-28 25-28s25 10 25 28z" fill={MUTED} opacity="0.5" />
          <g fill={SUBTLE} opacity="0.6">
            <rect x="86" y="54" width="34" height="3.5" rx="1.75" />
            <rect x="86" y="72" width="28" height="3.5" rx="1.75" />
            <rect x="86" y="90" width="38" height="3.5" rx="1.75" />
          </g>
          <g fill={INK} opacity="0.8">
            <rect x="86" y="60" width="70" height="4.5" rx="2.25" />
            <rect x="86" y="78" width="56" height="4.5" rx="2.25" />
            <rect x="86" y="96" width="64" height="4.5" rx="2.25" />
          </g>
          <Qr x={172} y={56} size={22} seed={73} />
          <Mrz x={14} y={122} w={180} />
        </g>
      );
    case 'entreprise':
      return (
        <g>
          <Paper />
          <Qr x={14} y={10} size={22} seed={83} />
          <RepHeader />
          <CenterBars y={34} widths={[64, 86]} />
          <TitlePill y={52} text="CRÉATION D’ENTREPRISE" w={140} />
          <Rows y={84} rows={[[38, 96], [44, 70], [34, 84], [42, 60]]} />
          <g>
            <rect x="18" y="128" width="174" height="64" rx="4" fill="none" stroke={INK} strokeWidth="0.8" />
            <rect x="18" y="128" width="174" height="14" rx="4" fill={SUNKEN} />
            <rect x="96" y="128" width="0.8" height="64" fill={INK} />
            <rect x="18" y="142" width="174" height="0.6" fill={INK} />
            <g fill={SUBTLE} opacity="0.6">
              <rect x="26" y="133" width="40" height="3.5" rx="1.75" />
              <rect x="104" y="133" width="44" height="3.5" rx="1.75" />
              {[0, 1, 2].map((i) => (
                <rect key={i} x="26" y={150 + i * 13} width={46 - i * 6} height="3.5" rx="1.75" />
              ))}
            </g>
            <g fill={INK} opacity="0.8">
              {[0, 1, 2].map((i) => (
                <rect key={i} x="104" y={149.75 + i * 13} width={70 - i * 8} height="4.5" rx="2.25" />
              ))}
            </g>
          </g>
          <Rows y={204} rows={[[40, 78], [36, 92]]} />
          <Footer y={232} />
        </g>
      );
    case 'permis':
      return (
        <g>
          <Paper />
          <Qr x={14} y={10} size={22} seed={97} />
          <Qr x={170} y={10} size={26} seed={101} />
          <RepHeader />
          <CenterBars y={34} widths={[64, 86]} />
          <TitlePill y={52} text="PERMIS DE CONSTRUIRE" w={136} />
          <Rows y={82} rows={[[36, 90], [42, 64], [32, 80]]} />
          <rect x="18" y="116" width="174" height="92" rx="4" fill="none" stroke={INK} strokeWidth="0.8" />
          <g fill="none" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85">
            <rect x="48" y="134" width="114" height="58" />
            <path d="M48 160h50M98 134v36M130 134v58" />
            <path d="M80 192v-8a8 8 0 0 1 8 8" />
            <path d="M58 134h16M138 134h16M162 150v14" strokeWidth="3" />
          </g>
          <Rows y={218} rows={[[38, 70], [34, 88]]} />
          <Footer y={236} />
        </g>
      );
  }
}

function Divider({ y, label }: { y: number; label: string }) {
  return (
    <g>
      <rect x="18" y={y} width="62" height="0.5" fill={INK} opacity="0.7" />
      <rect x="130" y={y} width="62" height="0.5" fill={INK} opacity="0.7" />
      <text x="105" y={y + 2.4} textAnchor="middle" fontSize="6.5" fontWeight="700" fill={INK} fontFamily="inherit" letterSpacing="0.6">
        {label}
      </text>
    </g>
  );
}

/** Flat paper-document drawings; colours come from CSS variables so dark mode follows. */
export function DocumentArt({ kind, className, stamped }: { kind: DocumentKind; className?: string; stamped?: boolean }) {
  return (
    <svg viewBox="0 0 210 297" data-theme="light" className={className} aria-hidden="true" focusable="false">
      <Body kind={kind} />
      {stamped && (
        <g transform="translate(112 176) rotate(-12 50 50) scale(0.78)">
          <circle cx="60" cy="60" r="58" fill={PAPER} opacity="0.85" />
          <StampShape label="Validé" />
        </g>
      )}
    </svg>
  );
}
