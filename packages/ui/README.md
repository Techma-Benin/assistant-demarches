# @techma/ui

Fondation de design « Bonjour, Bénin » : tokens, thème Tailwind v4 et composants React partagés (widget web et futures interfaces).

## Référence visuelle (verrouillée)

Direction « Bonjour, Bénin » : un seul accueil orienté conversation. Fond blanc, encre quasi noire, très grands titres serrés (Inter Tight 800), tuiles très arrondies. Les couleurs du drapeau béninois (vert, jaune, rouge) n’apparaissent qu’en accents.

- À conserver : bouton pilule encre = LA action principale (48 à 56 px) ; tuiles à 32 px de rayon (`Tile`), cartes à 28 px, chips et boutons en pilule ; vert = confiance (sources, statuts positifs, tuile WhatsApp, « Valider et publier ») ; glyphes « rebus » en `em` dans les titres ; une seule ombre (`shadow-prompt`), réservée à la zone de question.
- Le jaune (`sun`) sert UNIQUEMENT en fond (tuile, pastille « brouillon / à valider », avertissement) : jamais en texte. Le texte posé dessus est l’encre fixe (`text-warning`). Le rouge (`flag-red`) ne sert qu’au drapeau et aux compteurs d’accent.
- Le drapeau (`FlagGlyph`) garde ses couleurs exactes dans les deux thèmes. `BrandMark showFlag={false}` donne le mot-symbole seul si l’équipe refuse le drapeau dans la marque.
- À refuser : accents indigo, violet ou bleu ; dégradés ; halos ; ombres lourdes ; liserés décoratifs à gauche ; emoji ; CTA vert hors « Valider et publier » ; jaune en texte.
- Ton : chaleureux, grand public, pour des personnes peu à l’aise avec le numérique : texte de base 16 px, cibles tactiles d’au moins 44 px, français simple, états clairs.
- Ne jamais suggérer un aval officiel : pas de « officiel » à côté de la marque. Seuls le lien vers le portail officiel et les sources peuvent dire « portail officiel » / « Source ».

## Tokens

Source unique : `src/styles/tokens.css` (préfixe `--ui-`). Clair sur `:root` ; sombre sous `[data-theme="dark"]` et sous `prefers-color-scheme: dark` (sauf si `data-theme="light"`).

| token | clair | sombre | rôle |
|---|---|---|---|
| canvas | #FFFFFF | #0D0D0F | page, fond du chat |
| surface | #FFFFFF | #17171A | champs, tuiles blanches |
| sunken | #F3F3F1 | #1E1E22 | tuiles grises, chips, bulle usager |
| shell (nouveau) | #FAFAF8 | #131316 | barre latérale admin, en-têtes de tableau |
| border | #DCDCD8 | rgba(255,255,255,0.14) | bordures de tuiles et de boîtes |
| border-subtle (nouveau) | #EBEBE8 | rgba(255,255,255,0.08) | lignes de tableau, séparateurs |
| border-strong | #C4C4C0 | rgba(255,255,255,0.28) | pointillés, interrupteur inactif |
| field-border | #8A8B90 | #75757D | bordures de champs (3:1) |
| text | #0D0D0F | #F5F5F2 | texte courant |
| text-muted | #3A3A40 | #C8C8CC | texte secondaire |
| text-subtle | #55565C | #A0A0A6 | métadonnées (4,5:1 sur blanc et sur sunken) |
| action | #0D0D0F | #FFFFFF | boutons principaux, envoi |
| action-hover | #2A2A2F | #E4E4E0 | survol |
| on-action | #FFFFFF | #0D0D0F | texte sur action |
| trust | #00855A | #2FBF7A | vert du drapeau : fonds, statuts positifs |
| trust-text | #00573A | #5FD39B | texte vert |
| trust-soft | #E6F4EC | #123528 | pastille « Validée » / « Source » |
| trust-line | #A9D8BF | #1F5A41 | bordures de confiance |
| on-trust | #FFFFFF | #0D0D0F | texte sur confiance |
| sun | #FCD116 | #FCD116 | jaune du drapeau : fonds UNIQUEMENT, jamais texte |
| flag-red (nouveau) | #D21034 | #D21034 | rouge du drapeau, compteurs d’accent |
| danger-text | #B3122B | #FF8A80 | erreurs |
| danger-soft | #FDECEE | #3A1714 | fond d’erreur |
| warning-text | #0D0D0F | #0D0D0F | encre sur fond jaune |
| warning-soft | #FCD116 | #FCD116 | fond d’avertissement (= sun) |
| focus | #0D0D0F | #FCD116 | anneau de focus |
| viz-1 | #0D0D0F | #F5F5F2 | visualisation : Web |
| viz-2 | #00855A | #2FBF7A | visualisation : WhatsApp |
| viz-3 | #E3A800 | #FCD116 | visualisation : Mobile |

Règle des tokens `viz-1..3` : marques de visualisation de données uniquement (barres, segments, pastilles de légende), attribuées dans cet ordre fixe aux entités (Web = 1, WhatsApp = 2, Mobile = 3) ; la couleur suit l’entité, jamais son rang. Jamais pour l’interface, le texte ou un statut. Textes, valeurs, légendes et axes utilisent toujours les tokens de texte (`ink`, `ink-muted`), jamais une couleur viz.

Autres tokens : rayons `--ui-radius-sm` 10 px, `--ui-radius-field` 14 px, `--ui-radius-card` 28 px, `--ui-radius-tile` 32 px (nouveau), `--ui-radius-pill` 9999 px ; ombres `--ui-shadow-pop` (éléments flottants) et `--ui-shadow-prompt` (nouveau, zone de question uniquement) ; mouvement (voir ci-dessous).

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

Avec Next.js : `transpilePackages: ['@techma/ui']`, polices via `next/font/google` : Inter Tight 600–900 (`--font-inter-tight`, titres), Inter 400–700 (`--font-inter`, texte), et JetBrains Mono 400–600 (`--font-jetbrains-mono`, identifiants) dans la console admin uniquement, `<ThemeScript />` dans `<head>` et `suppressHydrationWarning` sur `<html>`.

Utilitaires générés : couleurs `canvas surface sunken line line-strong field ink ink-muted ink-subtle action action-hover on-action trust trust-text trust-soft trust-line on-trust sun danger danger-soft warning warning-soft focus viz-1 viz-2 viz-3`, rayons `rounded-field rounded-card rounded-tile rounded-pill`, ombre `shadow-prompt`, polices `font-display font-sans font-mono`, animation `.ui-glyph-pop`. Pas de couleur brute dans les composants.

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
