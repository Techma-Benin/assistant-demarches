# Backend

Le backend est le service sur le port 4010. Il tient les conversations, l'agent, les pièces et le consentement. Il ne stocke ni les dossiers ni l'annuaire : ça reste dans le X-Road simulé. Le contrat commun est [CONTRACTS.md](CONTRACTS.md).

Il se configure uniquement par variables d'environnement. La liste complète est dans [.env.example](.env.example).

## Aller vite, sur un poste local

Prérequis : Node.js 22 et pnpm 10.20.0 (`corepack enable`).

```sh
pnpm install
cp .env.example .env
```

Renseigner `MODEL_API_KEY` dans `.env`. Laisser le bloc « poste local » commenté. Puis :

```sh
pnpm dev backend
```

La commande démarre un PostgreSQL et un Keycloak locaux, crée la clé de signature, applique les migrations et lance le backend. Le premier lancement télécharge environ 230 Mo. Arrêt : Ctrl+C. Un second lancement réutilise `.local/` : rien n'est réinstallé.

Le backend écoute sur <http://127.0.0.1:4010>. Les comptes de démo sont dans le [README](README.md).

Une variable déjà présente dans `.env` est conservée. Le script ne remplit que les variables absentes. Si `DATABASE_URL` ou `OIDC_ISSUER` est renseigné, l'instance locale correspondante n'est pas démarrée.

## Sans le script

PostgreSQL et Keycloak doivent déjà exister. Décommenter le bloc « poste local » de `.env` et y mettre vos adresses.

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Base PostgreSQL du backend. Supabase ou un PostgreSQL déjà installé conviennent. |
| `OIDC_ISSUER` | URL du realm Keycloak. Importer `infra/keycloak/realm-techma.json` dans ce Keycloak, ou y recréer les clients et les rôles. |
| `OIDC_JWKS_URL` | Certificats du realm. Facultatif : déduit de `OIDC_ISSUER` s'il est absent. |
| `OIDC_CLIENT_ID` | Client de service du backend. En local : `backend`. |
| `OIDC_CLIENT_SECRET` | Secret de ce client. En local : `backend-local-secret`. |
| `SIGNING_KEY_FILE` | Clé privée RSA PKCS8. Le script la crée ; sinon la générer avec `openssl` (commande dans `.env.example`). |
| `PUBLIC_URL` | Adresse publique du backend, utilisée comme émetteur des jetons invités. |
| `TOOLING_URL` | Adresse du tooling. Obligatoire au démarrage, même si le tooling n'est pas encore lancé. |
| `XROAD_URL` | Adresse du X-Road simulé. Sans elle, l'accueil et « Mes démarches » répondent indisponible. |
| `PORT` | Port d'écoute. Défaut `4010`. |
| `HOST` | Interface d'écoute. Défaut `127.0.0.1`. Mettre `0.0.0.0` pour être joignable hors de la machine. |
| `CORS_ORIGINS` | Origine de l'interface, par exemple `http://127.0.0.1:3000`. |
| `MCP_ALLOWED_URLS` | URL MCP du tooling autorisée. |
| `GUEST_SESSIONS_PER_HOUR` | Sessions invitées créables par heure depuis une même adresse (le BFF de l'Interface les crée toutes). Défaut `300`. |
| `MCP_SECRET_REFERENCES` | JSON des secrets MCP. Défaut `{}`. |
| `FILE_STORAGE_DIR` | Dossier des pièces quand `STORAGE_DRIVER=local`. |
| `STORAGE_DRIVER` | `local` par défaut. `s3` ou `gcs` demandent `STORAGE_BUCKET`. |

Puis, depuis la racine :

```sh
pnpm --filter @techma/backend dev
```

Les migrations partent sur la `DATABASE_URL` indiquée. Le script local n'est pas lancé.

## Modèle

| Variable | Quand la remplir |
|---|---|
| `MODEL_API_KEY` | Toujours, pour que l'assistant réponde. |
| `MODEL_PROVIDER` | `openai`, `openrouter`, `mistral`, `deepseek` ou `gemini`. Défaut `groq`. |
| `MODEL_NAME` | Un autre modèle du même fournisseur. |
| `MODEL_BASE_URL` | Une autre adresse compatible OpenAI. |
| `MODEL_PROTOCOL` | `chat-completions` par défaut, `responses` si l'API l'exige. |
| `TRANSCRIPTION_MODEL` | Modèle vocal. Défaut `whisper-large-v3-turbo`. |
| `TRANSCRIPTION_ENDPOINT` | Adresse de transcription. Défaut : Groq. |

La transcription est active dès que `MODEL_API_KEY` est présente.

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev backend` | PostgreSQL et Keycloak locaux s'ils ne sont pas déjà configurés, puis le backend |
| `pnpm --filter @techma/backend dev` | Backend seul, avec le `.env` |
| `pnpm dev:infra` | PostgreSQL et Keycloak locaux seulement |
| `pnpm dev:reset` | Efface les données locales du script |
| `pnpm --filter @techma/backend typecheck` | Vérifie le typage |
| `pnpm --filter @techma/backend test` | Lance les tests du backend |
| `pnpm dev:check` | Diagnostique la pile déjà lancée (santé, `/health/ready`, parcours invité → message.sent) ; avec `--interface-url`, rejoue aussi le parcours du navigateur par l'Interface (WebSocket, deltas) ; `--voice` ajoute un message vocal |

`pnpm dev` sans argument tente aussi le tooling, le X-Road simulé et l'interface si le paquet est présent.

## Brancher le front

1. Copier `.env.example` → `.env` et renseigner `MODEL_API_KEY` (sans la coller ailleurs).
2. `pnpm dev` — PostgreSQL, Keycloak, backend, tooling, xroad-sim ; l'interface seulement si `apps/interface/web` est dans cette branche.
3. `pnpm dev:check` (options `--backend-url`, `--interface-url`).
4. Comptes de démo, mot de passe `demo-2026` : `aminata.usager`, `agent.justice`, `operateur` (liste complète dans le README).
5. Lire les ✘ : 404/405 = endpoint absent côté backend ; 401/403 = auth ; 503 = modèle/Tooling/X-Road ; timeout `message.sent` = agent bloqué (souvent pas de `MODEL_API_KEY`). Un échec sur `POST /v1/guest-sessions` est un problème backend, pas front.

`GET /health` = processus + migrations. `GET /health/ready` = modèle, Tooling, MCP, X-Road, Keycloak/JWKS, base (aucun secret).

## Interface web (`apps/interface/web`)

Ce que l'Interface attend du Backend, vérifié par `apps/backend/tests/interface-wiring.test.mjs` (mêmes requêtes que `c1-client.ts`, `conversation-stream.ts`, `auth/callback`) et par `pnpm dev:check --interface-url http://127.0.0.1:3000 [--voice]` (parcours navigateur par le BFF, WebSocket avec l'origine de l'Interface).

- **WebSocket.** `POST …/socket-ticket` renvoie `ws://{PUBLIC_URL}/v1/stream?ticket=…`. L'origine du navigateur doit figurer dans `CORS_ORIGINS` ; pour une origine en boucle locale (`127.0.0.1`, `localhost`, `[::1]`), les autres écritures de la même adresse (même schéma et même port) sont acceptées. Les trames sont des `Event` JSON (`message.received`, `message.delta`, `message.sent`) lus dans l'ordre depuis le curseur : une notification en direct réveille seulement la lecture, jamais un événement n'est poussé hors ordre. Un curseur inconnu ferme la socket en `1008 REPLAY_EXPIRED` (l'Interface repart sans curseur).
- **Vocal.** L'Interface téléverse le blob tel quel (`POST /v1/files`, `X-File-Mime-Type: audio/webm`, `audio/ogg` ou `audio/mp4`), puis envoie `{type: audio, fileId}`. La transcription est un second `message.received` du même `message.id` (avec `transcript`) ; l'historique rejoué contient déjà la transcription. Sans clé (`MODEL_API_KEY`), l'assistant répond que la transcription n'est pas disponible.
- **Pièce d'un `fileRequest`.** Le message `{type: file, fileId, documentType}` est transmis au modèle comme une instruction opaque (demande, type de pièce, identifiant de fichier) pour rattacher la pièce au brouillon ; le contenu du fichier n'est jamais envoyé au modèle. Un fichier sans `documentType` reçoit un simple accusé.
- **Reprise après connexion et après consentement.** L'Interface n'envoie rien après `POST …/attach` ni après `POST …/mandates` : le Backend met lui-même en file un tour de reprise (jamais affiché comme message de l'usager) quand la dernière réponse demandait la connexion, et à chaque mandat accordé.
- **Téléchargement.** `GET /v1/cases/{caseId}/documents/{documentId}` (et la même route de la console) renvoie `Content-Disposition: attachment; filename=…` avec le nom du document du dossier.
- **Sessions invitées.** Le BFF de l'Interface crée les sessions invitées depuis son serveur : toutes partagent une adresse source. `GUEST_SESSIONS_PER_HOUR` (défaut `300`) borne ces créations pour cette adresse.
- **Streaming.** Les `message.delta` sont émis une fois la réponse du modèle complète et validée (sources observées, texte masqué), jamais avant : l'Interface les reçoit par morceaux de mots, immédiatement avant `message.sent`, mais pas pendant la génération. Choix assumé tant qu'aucun texte non validé ne doit apparaître.

## Brancher une autre équipe

| Équipe | Adresse |
|---|---|
| Interface | la valeur de `PUBLIC_URL` |
| Tooling, événements | `POST {PUBLIC_URL}/internal/v1/events` (scope `events:publish`, audience `techma-backend`) |
| Tooling, pièces | `GET {PUBLIC_URL}/internal/v1/files/{fileId}` et `/content` avec `X-User-Ref` (scope `files:read`) |
| Clés des jetons invités et des preuves de mandat | `GET {PUBLIC_URL}/.well-known/jwks.json` (audience `techma-mandate` pour le `proofToken`) |

Le Tooling v2 (équipe Tooling) est le serveur MCP. `TOOLING_MCP_URL` (sinon la première URL de `MCP_ALLOWED_URLS`) enregistre la connexion `tooling` (`policy: techma`, `auth.secretRef: backend` = jeton Keycloak `tools:call`, audience `techma-tooling`). Les mandats partent sur `TOOLING_URL` avec le scope `mandates:grant` ; la révocation envoie `X-User-Ref`. Sans conversation, `tools/list` n’envoie pas le contexte usager ; `tools/call` envoie `X-Conversation-Id`, `X-User-Ref`, `X-Channel`, `X-Mandate-Id` et `Idempotency-Key`.
