import type { SVGAttributes } from 'react';

export type FlagGlyphProps = Omit<SVGAttributes<SVGSVGElement>, 'role' | 'aria-label' | 'aria-hidden'> & {
  /** true : purement décoratif (masqué aux lecteurs d’écran). */
  decorative?: boolean;
};

/**
 * Drapeau du Bénin en SVG en ligne, dimensionné en `em` pour s’insérer dans un titre.
 * Les couleurs sont des littéraux : le drapeau garde ses couleurs exactes en clair comme en sombre.
 */
export function FlagGlyph({ decorative = false, width = '1.36em', height = '1em', style, ...props }: FlagGlyphProps) {
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Drapeau du Bénin' };
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 30 22"
      style={{ display: 'inline-block', verticalAlign: '-0.1em', ...style }}
      {...a11y}
      {...props}
    >
      <rect width="30" height="22" rx="5" fill="#FCD116" />
      <path d="M12 11h18v6a5 5 0 0 1-5 5H12z" fill="#D21034" />
      <path d="M5 0h7v22H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z" fill="#00855A" />
    </svg>
  );
}
