# Architecture

```text
 Usager web ─┐                               ┌─ Agent de ministère, super admin
 WhatsApp ───┤                               ├─ Opérateur
             ▼                               ▼
   ┌──────────────────────── Interface (Next.js, :3000) ───────────────────────┐
   │  /  site usager   /embed  chat intégrable   /admin  console   /operateur   │
   └──────────────┬───────────────────────────────┬─────────────────────────────┘
                  │ conversation.openapi          │ admin.openapi · operator.openapi
                  ▼                               ▼
   ┌──────────────────────────── Backend (:4010) ───────────────────────────────┐
   │ conversations · agent IA · pièces · consentement · console · opérateur     │
   │ module WhatsApp (webhook Meta)                                             │
   └──────┬───────────────────────┬──────────────────────────────┬──────────────┘
          │ MCP (mcp.tools)       │ tooling-internal (mandats)    │ xroad.openapi (console, Mes démarches)
          ▼                       ▼                               │
   ┌──────────── Tooling (:4030) ───────────┐                     │
   │ brouillons · mandats · dépôt · suivi    │ ── backend-internal (événements, pièces) ──▶ Backend
   └──────┬──────────────────────────────────┘                     │
          │ xroad.openapi (côté usager)                            │
          ▼                                                        ▼
   ┌──────────────────────── X-Road simulé (:4040) ───────────────────────────────┐
   │ administrations · catalogue service-public.bj · dossiers · annuaire · KPI    │
   └──────────────────────────────────────────────────────────────────────────────┘
   Keycloak (:8080) : identités des personnes et des services · PostgreSQL (:54329) : bases backend, tooling, xroad
```

## Processus

| Processus | Lancé par | Notes |
|---|---|---|
| PostgreSQL 18 | `pnpm dev` (paquet `embedded-postgres`, vrais binaires) | Données dans `.local/postgres` |
| Keycloak 26.8.1 | `pnpm dev` (téléchargé avec un Java 21 portable dans `.local/`) | Realm `infra/keycloak/realm-techma.json` importé au premier démarrage |
| Backend | `pnpm dev` | API et traitement des messages dans le même processus, sans Redis |
| Tooling | `pnpm dev` | Un seul processus |
| X-Road simulé | `pnpm dev` | Base `xroad` |
| Interface | `pnpm dev` | Une seule application Next.js |

Aucun Docker. La configuration locale de tous les services est dans `scripts/dev/local-config.mjs` ; seules les clés externes (Groq, Meta) vont dans `.env`.

## Décisions

| Décision | Raison |
|---|---|
| Le X-Road simulé détient administrations, agents, catalogue et dossiers | Une seule source ; c'est l'hypothèse présentée au jury (le back-end des administrations existe) |
| Keycloak pour toutes les personnes et tous les services | Identité réelle (OIDC), comptes de démo reproductibles, aucun jeton en dur |
| Un client de service par service (`backend`, `tooling`) | Les clients multiples d'un même processus n'apportaient aucune isolation |
| Le Backend crée le consentement et les cartes (`consent`, `requestCard`, `caseCard`) | L'Interface n'a aucune heuristique ; le modèle ne fabrique aucun état |
| Pas de Redis | PostgreSQL contient déjà les messages en attente |
| Une seule application d'interface | Un design, une session, un déploiement |
| WhatsApp dans le Backend | Plus de contrat de rappel ni de service à part |

## Ce qui a été retiré de l'ancienne base

- Contrats v1 (11 fichiers où chaque OpenAPI recopiait tous les schémas), C1–C4 historiques.
- Annuaire et copie des dossiers dans le Backend, snapshots `request.snapshot`, relais des actions de console par le Tooling.
- Serveur de mocks, faux fournisseur d'identité, jetons `mock-*`, sessions de démo codées en dur, galeries de démonstration.
- Lanceurs multiples (`local-stack`, `slide8-demo`, `dev:stack`), Docker, Redis, worker séparé, superviseur multi-processus du Tooling.
- Documents d'avancement et journaux d'intégration devenus faux.
