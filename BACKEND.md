# Backend

Le backend est le service sur le port 4010. Il tient les conversations, l'agent, les pièces et le consentement. Il ne stocke ni les dossiers ni l'annuaire : ça reste dans le X-Road simulé. Le contrat commun est [CONTRACTS.md](CONTRACTS.md).

## Démarrer

Prérequis : Node.js 22 et pnpm 10.20.0 (`corepack enable`). Rien d'autre à installer.

Depuis la racine du dépôt :

```sh
pnpm install
cp .env.example .env
```

Ouvrir `.env` et renseigner `MODEL_API_KEY`. Puis :

```sh
pnpm dev backend
```

Cette commande démarre PostgreSQL et Keycloak, crée la clé de signature locale, applique les migrations, puis lance le backend. Le premier lancement télécharge environ 230 Mo. Arrêt : Ctrl+C.

Le backend écoute sur <http://127.0.0.1:4010>. Un visiteur obtient un jeton avec `POST /v1/guest-sessions`. Sans `MODEL_API_KEY`, le serveur répond, mais l'assistant ne produit pas de texte.

## Quoi renseigner

Une seule valeur est obligatoire : `MODEL_API_KEY`. Sans autre réglage, le fournisseur est Groq et le modèle est `llama-3.3-70b-versatile`.

| Variable | Quand la remplir |
|---|---|
| `MODEL_API_KEY` | Toujours. La clé du fournisseur. |
| `MODEL_PROVIDER` | Pour changer de fournisseur : `openai`, `openrouter`, `mistral`, `deepseek`, `gemini`. |
| `MODEL_NAME` | Pour un autre modèle du même fournisseur. |
| `MODEL_BASE_URL` | Pour une autre adresse compatible OpenAI. |
| `MODEL_PROTOCOL` | `chat-completions` par défaut, `responses` si l'API l'exige. |
| `TRANSCRIPTION_ENABLED` | `true` pour transcrire les vocaux, avec la même clé. |
| `TRANSCRIPTION_MODEL` | Par défaut `whisper-large-v3-turbo`. |

Les adresses, la base, Keycloak et les ports ne se mettent pas dans `.env`. `pnpm dev` les injecte depuis `scripts/dev/local-config.mjs`.

Les comptes de démo et le mot de passe sont dans le [README](README.md).

## Ce que le script couvre

`pnpm dev backend` couvre l'infrastructure et le backend.

| Commande | Effet |
|---|---|
| `pnpm dev backend` | PostgreSQL, Keycloak et le backend |
| `pnpm dev:infra` | PostgreSQL et Keycloak seulement |
| `pnpm dev:reset` | Efface les données locales, garde les téléchargements |
| `pnpm --filter @techma/backend typecheck` | Vérifie le typage |
| `pnpm --filter @techma/backend test` | Lance les tests du backend |

`pnpm dev` sans argument tente aussi le tooling, le X-Road simulé et l'interface. Ces trois-là ne sont pas encore branchés sur cette commande : le tooling s'arrête faute de `JWT_ISSUER`, l'application `apps/interface/web` n'existe pas, et le X-Road simulé tourne encore avec d'anciens jetons de démo. Les lancer ainsi ne permet pas de vérifier le parcours complet.

## Brancher une autre équipe

Le backend est déjà joignable sans configuration supplémentaire.

| Équipe | Adresse |
|---|---|
| Interface | `http://127.0.0.1:4010` |
| Tooling, événements | `POST http://127.0.0.1:4010/internal/v1/events` |
| Tooling, pièces | `GET http://127.0.0.1:4010/internal/v1/files/{fileId}` avec `X-User-Ref` |
| Clés des jetons invités | `GET http://127.0.0.1:4010/.well-known/jwks.json` |
