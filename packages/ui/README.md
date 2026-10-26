# @techma/ui

Fondation de design « Sceau » : tokens, thème Tailwind v4 et composants React partagés (widget web et futures interfaces).

## Référence visuelle (verrouillée)

Direction principale : douceur façon Headspace (canevas blanc cassé chaud, surfaces très arrondies, boutons pilule encre quasi noire), ancrée dans le service public béninois (service-public.bj) : le vert porte uniquement la confiance.

- À conserver : canevas blanc cassé chaud ; bouton pilule encre = LA action principale ; grands rayons (pilule pour boutons, chips, composeur ; 20 px pour bulles et cartes) ; vert réservé aux signaux de confiance (sources, liens officiels, statuts terminés ou positifs, marque) ; jaune soleil uniquement pour le petit point de la marque.
- À refuser : accents indigo, violet ou bleu ; dégradés ; halos ; ombres lourdes ; liserés décoratifs à gauche ; cartes comme conteneurs par défaut ; emoji ; CTA vert (le CTA reste encre) ; jaune ailleurs que sur la marque.
- Ton : chaleureux, grand public, pour des personnes peu à l’aise avec le numérique : texte de base 16 px, cibles tactiles d’au moins 44 px, français simple, états clairs.
- Ne jamais suggérer un aval officiel : pas de « officiel » à côté de la marque ; sous-titre « Réponses sourcées ». Seuls le lien vers le portail officiel et les sources peuvent dire « portail officiel » / « Source ».

## Tokens

Source unique : `src/styles/tokens.css` (préfixe `--ui-`). Clair sur `:root` ; sombre sous `[data-theme="dark"]` et sous `prefers-color-scheme: dark` (sauf si `data-theme="light"`).

| token | clair | sombre | rôle |
|---|---|---|---|
| canvas | #FBFAF7 | #121614 | page, fond du chat |
| surface | #FFFFFF | #1A1F1C | bulles, cartes, champs |
| sunken | #F3F1EC | #0E110F | piste du composeur, fonds en creux |
| border | #E7E4DC | rgba(255,255,255,0.10) | filets |
| border-strong | #D9D5CB | rgba(255,255,255,0.16) | boutons et chips contour |
| field-border | #8A918C | #6A726C | bordures de champs (contraste 3:1) |
| text | #17201A | #EEF1EE | texte courant |
| text-muted | #56605A | #A9B2AC | texte secondaire |
| text-subtle | #6B736D | #87908A | métadonnées, placeholders |
| action | #17201A | #F1EFE8 | fond du CTA, bulle de l’usager |
| action-hover | #2A352D | #DAD7CE | survol du CTA |
| on-action | #FFFFFF | #121614 | texte sur action |
| trust | #0B6B3A | #3FAE6E | remplissage confiance (marque, icône) |
| trust-text | #0B5A31 | #7FD3A0 | texte et liens de confiance |
| trust-soft | #E6F2EA | #173323 | fond de chip ou carte de confiance |
| trust-line | #B9DCC6 | #2C5A3E | bordures de confiance |
| on-trust | #FFFFFF | #0E110F | texte sur fond confiance |
| sun | #FCD116 | #FCD116 | point de la marque UNIQUEMENT |
| danger-text | #B42318 | #FF8A80 | erreurs |
| danger-soft | #FDECEA | #3A1714 | fond d’erreur |
| warning-text | #7A4F00 | #F5C451 | attention |
| warning-soft | #FFF4D6 | #33270B | fond d’attention |
| focus | #17201A | #F1EFE8 | anneau de focus |

Autres tokens : rayons `--ui-radius-sm` 10 px, `--ui-radius-field` 14 px, `--ui-radius-card` 20 px, `--ui-radius-pill` 9999 px ; ombre `--ui-shadow-pop` (éléments flottants uniquement) ; mouvement (voir ci-dessous).

Tokens de mouvement :

- `--ui-dur-fast` 120 ms : survols, couleurs.
- `--ui-dur-base` 200 ms : entrées et fondus.
- `--ui-dur-press` 160 ms : retour d’appui (`scale(0.97)`).
- `--ui-dur-exit` 150 ms : sorties (plus rapides que les entrées).
- `--ui-ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` : courbe par défaut des entrées.
- `--ui-ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)` : mouvements sur place (`.ui-shake`).
- `--ui-ease-drawer` `cubic-bezier(0.32, 0.72, 0, 1)` : panneaux et tiroirs.

Utilitaires de mouvement (`theme.css`) : `.ui-press`, `.ui-pop`, `.ui-rise`, `.ui-swap` (avec une `key` React), `.ui-stagger` (`--i` sur les enfants, plafonné à 9), `.ui-row-enter` (ligne de tableau, via `TableRow enterIndex`), `.ui-shake` (erreur uniquement). Avec `prefers-reduced-motion`, ils ne gardent que l’opacité et les couleurs : plus de translation, d’échelle, de flou ni de secousse.

Les contrastes WCAG sont vérifiés par `tests/contrast.test.tsx` (clair et sombre).

## Utilisation

Dans la feuille globale de l’application (Tailwind v4) :

```css
@import "tailwindcss";
@import "@techma/ui/styles.css";
```

Avec Next.js : `transpilePackages: ['@techma/ui']`, police Plus Jakarta Sans via `next/font/google` (`variable: '--font-jakarta'`), `<ThemeScript />` dans `<head>` et `suppressHydrationWarning` sur `<html>`.

Utilitaires générés : couleurs `canvas surface sunken line line-strong field ink ink-muted ink-subtle action action-hover on-action trust trust-text trust-soft trust-line on-trust sun danger danger-soft warning warning-soft focus`, rayons `rounded-field rounded-card rounded-pill`, police `font-sans`. Pas de couleur brute dans les composants.

Échelle typographique : légende 13 px, corps 16 px, lead 18 px, titre 22 px/800, display 28 px/800 `tracking-tight`.

## Composants

Tous exportés depuis `@techma/ui`.

- `cn(...classes)` : `twMerge(clsx(...))`.
- `Button` : variantes `primary | secondary | ghost`, tailles `md | sm`, `asChild`, `leadingIcon`, `trailingIcon`.
- `IconButton` : rond 44 px, prop `label` obligatoire (`aria-label`).
- `Chip` : réponse rapide en pilule, `selected` (`aria-pressed`).
- `TextField`, `TextArea` : `label`, `hint`, `error`, `required` (marqueur « * » + « (obligatoire) » pour lecteurs d’écran).
- `Card` : `tone` `default | trust | warning | danger`.
- `Badge` : `tone` `neutral | trust | warning | danger`, `icon`.
- `Switch` : bouton `role="switch"` (`checked`, `onCheckedChange`, libellé en enfant ou `aria-label`) ; activé = `action`, désactivé = `sunken` avec bordure.
- `BrandMark` : `size` `sm` (32 px) | `lg` (64 px), `aria-hidden` par défaut.
- `InlineAlert` : `role="alert"`, `tone` `danger | warning`.
- `TypingIndicator` : trois points animés, statique si mouvement réduit.
- `ThemeScript`, `ThemeToggle` : thème système, clair ou sombre, stocké dans `localStorage['techma-theme']`.
- `Table`, `TableHead`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell` : tableau dense (texte 14 px, lignes de 44 px) dans un conteneur à défilement horizontal.
- `VisuallyHidden`.

```tsx
import { Button, Chip, TextField, Card, Badge } from '@techma/ui';

<Button>Valider</Button>
<Button variant="secondary" size="sm">Annuler</Button>
<Button asChild><a href="https://example.org">Ouvrir</a></Button>
<Chip selected>Oui</Chip>
<TextField label="Nom" required error="Indiquez votre nom." />
<Card tone="trust"><Badge tone="trust">Source : service-public.bj</Badge></Card>
```

Un guide de style vivant est disponible dans le widget web : `/dev/design`.

## Développement

```bash
pnpm --filter @techma/ui typecheck
pnpm --filter @techma/ui test
```

Tous les modules de `src/` sont en `.tsx` pour rester hors du typecheck racine (`packages/**/*.ts`).
