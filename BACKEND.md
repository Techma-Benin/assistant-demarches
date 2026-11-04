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

`MODEL_API_KEY` (et éventuellement `MODEL_PROVIDER`) suffisent : le script démarre PostgreSQL et Keycloak et injecte les URLs locales. Une `DATABASE_URL` loopback sur `:5432` ou un `TOOLING_URL` / `MCP_ALLOWED_URLS` loopback sur `:4020` (ancien .env) est ignorée, avec un avertissement, au profit des ports locaux (`54329` / `4030`). Une `DATABASE_URL` ou un `OIDC_ISSUER` distant est conservé : l'instance locale correspondante n'est alors pas démarrée.

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
| `MODEL_NAME` | Un autre modèle du même fournisseur. Défauts : Groq `qwen/qwen3.8-27b` (outils), Gemini `gemini-3.5-flash`. |
| `MODEL_BASE_URL` | Une autre adresse compatible OpenAI. |
| `MODEL_PROTOCOL` | `chat-completions` par défaut, `responses` si l'API l'exige. |
| `TRANSCRIPTION_MODEL` | Modèle vocal. Défaut `whisper-large-v3-turbo`. |
| `TRANSCRIPTION_ENDPOINT` | Adresse de transcription. Défaut : Groq. |

Les schémas d’outils envoyés à Groq/Gemini inlinent les `$ref` et omettent `additionalProperties: false` (rejetés par ces hôtes). Un hôte OpenAI/Azure strict les conserve. `response_format` n’est demandé que sans outils. Gemini 3 n’accepte un rejeu `tool_calls` qu’avec `thought_signature` ; un appel forcé côté serveur est renvoyé comme donnée utilisateur.

La transcription est active dès que `MODEL_API_KEY` est présente.

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev backend` | PostgreSQL et Keycloak locaux s'ils ne sont pas déjà configurés, puis le backend |
| `pnpm --filter @techma/backend dev` | Backend seul, avec le `.env` |
| `pnpm dev:infra` | PostgreSQL et Keycloak locaux seulement |
| `pnpm dev:reset` | Efface les données locales du script |
| `pnpm --filter @techma/backend typecheck` | Vérifie le typage |
| `pnpm --filter @techma/backend test` | Lance les tests du backend (PostgreSQL embarqué via `@embedded-postgres/<plateforme>-<arch>/native/bin` si `PG_BIN` est absent) |
| `pnpm dev:check` | Diagnostique la pile déjà lancée (santé, `/health/ready`, parcours invité → message.sent) ; avec `--interface-url`, rejoue aussi le parcours du navigateur par l'Interface (WebSocket, deltas) ; `--voice` ajoute un message vocal |

`pnpm dev` sans argument tente aussi le tooling, le X-Road simulé et l'interface si le paquet est présent.

## Brancher le front

1. Copier `.env.example` → `.env` et renseigner `MODEL_API_KEY` (sans la coller ailleurs).
2. `pnpm dev` — PostgreSQL, Keycloak, backend, tooling, xroad-sim ; l'interface seulement si `apps/interface/web` est dans cette branche.
3. `pnpm dev:check` (options `--backend-url`, `--interface-url`).
4. Comptes de démo, mot de passe `demo-2026` : `aminata.usager`, `agent.justice`, `operateur` (liste complète dans le README).
5. Lire les ✘ : 404/405 = endpoint absent côté backend ; 401/403 = auth ; 503 = modèle/Tooling/X-Road ; timeout `message.sent` = agent bloqué (souvent pas de `MODEL_API_KEY`). Un échec sur `POST /v1/guest-sessions` est un problème backend, pas front.

`GET /health` = processus + migrations. `GET /health/ready` = modèle, Tooling, MCP, X-Road, Keycloak/JWKS, base (aucun secret). La ligne modèle sonde le fournisseur (GET `…/models`, cache 60 s) sauf `MODEL_READINESS_PROBE=off` (désactivé par défaut dans les tests). `pnpm dev:check` affiche la couche (`ready.model`) et un conseil si la sonde échoue.

## Interface web (`apps/interface/web`)

Ce que l'Interface attend du Backend, vérifié par `apps/backend/tests/interface-wiring.test.mjs` (mêmes requêtes que `c1-client.ts`, `conversation-stream.ts`, `auth/callback`) et par `pnpm dev:check --interface-url http://127.0.0.1:3000 [--voice]` (parcours navigateur par le BFF, WebSocket avec l'origine de l'Interface).

- **WebSocket.** `POST …/socket-ticket` renvoie `ws://{PUBLIC_URL}/v1/stream?ticket=…`. L'origine du navigateur doit figurer dans `CORS_ORIGINS` ; pour une origine en boucle locale (`127.0.0.1`, `localhost`, `[::1]`), les autres écritures de la même adresse (même schéma et même port) sont acceptées. Les trames sont des `Event` JSON (`message.received`, `message.delta`, `message.sent`) lus dans l'ordre depuis le curseur : une notification en direct réveille seulement la lecture, jamais un événement n'est poussé hors ordre. Un curseur inconnu ferme la socket en `1008 REPLAY_EXPIRED` (l'Interface repart sans curseur).
- **Vocal.** L'Interface téléverse le blob tel quel (`POST /v1/files`, `X-File-Mime-Type: audio/webm`, `audio/ogg` ou `audio/mp4`), puis envoie `{type: audio, fileId}`. La transcription est un second `message.received` du même `message.id` (avec `transcript`) ; l'historique rejoué contient déjà la transcription. Sans clé (`MODEL_API_KEY`), l'assistant répond que la transcription n'est pas disponible.
- **Pièce d'un `fileRequest`.** Le contrat lie l’upload au besoin via le message `{type: file, fileId, documentType}` (`documentType` = type du `fileRequest` ; `null` = pièce libre). `POST /v1/files` n’accepte ni `documentType` ni `requestId`. Si l’Interface envoie `documentType: null` alors qu’un `fileRequest` est encore ouvert, le Backend rattache la pièce à la plus ancienne exigence non satisfaite et transmet au modèle (et à `documents.attach` s’il est activé) le `fileId` / `documentType` / `requestId` réels. Le contenu du fichier n’est jamais envoyé au modèle. Une pièce vraiment libre (aucun `fileRequest` en attente) reçoit un simple accusé. Si le modèle refuse après un `requestCard` / `fileRequest` / `consent` / `loginRequired` / `caseCard` déjà construit, le Backend envoie une phrase courte d’accompagnement plutôt que le refus générique « source administrative validée ».
- **Reprise après connexion et après consentement.** L'Interface n'envoie rien après `POST …/attach` ni après `POST …/mandates` : le Backend met lui-même en file un tour de reprise (jamais affiché comme message de l'usager) quand la dernière réponse demandait la connexion, et à chaque mandat accordé. `MANDATE_EXPIRED` (mandat d’une heure périmé) est traité comme `MANDATE_MISSING` : nouveau challenge, bloc `consent`, puis la même reprise.
- **Téléchargement.** `GET /v1/cases/{caseId}/documents/{documentId}` (et la même route de la console) renvoie `Content-Disposition: attachment; filename=…` avec le nom du document du dossier.
- **Sessions invitées.** Le BFF de l'Interface crée les sessions invitées depuis son serveur : toutes partagent une adresse source. `GUEST_SESSIONS_PER_HOUR` (défaut `300`) borne ces créations pour cette adresse.
- **Streaming en direct.** Les `message.delta` sont écrits et poussés **pendant** la génération du modèle (`apps/backend/src/live-reply.ts`), pas après. Règles : (1) seul le texte des blocs `text` de l'enveloppe JSON du modèle est streamé (jamais `buttons`, `form`, sources ni blocs construits par le Backend) ; (2) un tour qui démarre un appel d'outil n'est jamais streamé (`onToolCall` coupe le flux du tour, y compris le texte de la même trame) : seul le tour final l'est ; (3) le texte libre, un JSON qui cite une source hors des résultats d'outils du tour, ou un fait administratif (tarif, fiche, lien, nombre) sans source observée restent en tampon et ne sont jamais écrits — seuls les essais qui seront acceptés sont diffusés (après les outils, dès que les sources du tour sont connues) ; (4) une réponse n'est streamée qu'une fois : si un delta existe déjà pour ce `messageId` (nouvelle tentative après réponse invalide, nouvelle tentative du fournisseur après coupure, reprise du worker après crash), les tentatives suivantes restent silencieuses, pour ne jamais nourrir deux brouillons ; (5) index 0-based strictement croissants, morceaux regroupés sur 40 ms au plus (le premier part tout de suite), même `messageId` que le `message.sent` ; (6) tout est écrit avant `message.sent` : aucun delta après lui. Le texte streamé est **masqué** (`redact`) : seule la partie stable est publiée, le dernier mot incomplet et tout suffixe pouvant devenir un e-mail, un numéro ou une valeur « NPI / OTP / code SMS / mot de passe » étant retenus jusqu'à un séparateur ou la fin du flux (`stableEnd`) ; le protocole `responses` met le texte du tour en tampon jusqu'à savoir qu'il n'appelle aucun outil. Une source citée par `procedureId`+`url` est rattachée à la Source observée du Backend (`retrievedAt` jamais pris au modèle). `message.sent` fait foi. Les deltas ne sont jamais dans l'historique rechargeable (`GET …/events` sans curseur) et expirent après 48 h. Une écriture de delta en échec n'interrompt pas la réponse et le texte reste en tampon pour le prochain envoi. Un refus de `presentModelReply` est journalisé (motif structuré, sans texte de question ni PII). `pnpm dev:check --interface-url …` échoue (✘) si ≥ 3 deltas arrivent moins de `--min-stream-ms` (150) avant `message.sent`.

## Brancher une autre équipe

| Équipe | Adresse |
|---|---|
| Interface | la valeur de `PUBLIC_URL` |
| Tooling, événements | `POST {PUBLIC_URL}/internal/v1/events` (scope `events:publish`, audience `techma-backend`) |
| Tooling, pièces | `GET {PUBLIC_URL}/internal/v1/files/{fileId}` et `/content` avec `X-User-Ref` (scope `files:read`) |
| Clés des jetons invités et des preuves de mandat | `GET {PUBLIC_URL}/.well-known/jwks.json` (audience `techma-mandate` pour le `proofToken`) |

Le Tooling v2 (équipe Tooling) est le serveur MCP. `TOOLING_MCP_URL` (sinon la première URL de `MCP_ALLOWED_URLS`) enregistre la connexion `tooling` (`policy: techma`, `auth.secretRef: backend` = jeton Keycloak `tools:call`, audience `techma-tooling`). Les mandats partent sur `TOOLING_URL` avec le scope `mandates:grant` ; la révocation envoie `X-User-Ref`. Sans conversation, `tools/list` n’envoie pas le contexte usager ; `tools/call` envoie `X-Conversation-Id`, `X-User-Ref`, `X-Channel`, `X-Mandate-Id` et `Idempotency-Key`. Les schémas d’outils sont compilés et comparés après résolution des `$defs` du catalogue `mcp.tools.json` (forme brute à `$ref`) : un Tooling qui sert des schémas autonomes reste accepté. `GET /v1/home` lit d’abord `/v1/procedures?assisted=true` et tronque `suggestions` à 8.

## Agent : reprise, formulaire, paiement

- **Réponse du modèle.** Les cartes copiées (`requestCard`, `consent`…), les boutons `payment.confirm.*` et les boutons de plus de 24 caractères sont retirés de la réponse sans la refuser ; une réponse réduite à ces blocs reste refusée. Refus `admin_fact_without_source` ou `unobserved_source` sans source observée dans le tour : le Backend lit la fiche de la demande en cours (`procedures.get`), puis le modèle refait sa réponse, sans texte en direct entre-temps.
- **Reprise de l’action bloquée.** Au premier blocage `LOGIN_REQUIRED`, `MANDATE_MISSING` ou `MANDATE_EXPIRED` d’un tour, le Backend garde l’appel (nom, arguments, valeurs de formulaire) dans `backend_conversations.pending_action`. Au message technique de reprise (connexion ou consentement), l’appel est rejoué une fois sans passer par le modèle, par tout le pipeline (mandat, schéma, connexion), puis la colonne est vidée. Sans action en attente, rien n’est forcé.
- **Formulaire.** Une interaction dont `value` est un objet JSON remplit le dossier : le Backend force `request.update` sur le brouillon du tour ou, à défaut, sur la dernière carte `draft`/`ready` de la conversation (champs connus et non vides, `source: "answer"`). Sans brouillon, le tour continue ; l’appel part dès que `request.create` réussit. Les valeurs sont typées d’après `filing.formSchema` (par exemple `"2"` devient `2`) avant l’appel. Le modèle voit le `detail` (300 caractères au plus) des erreurs `INVALID_REQUEST`, `REQUEST_INCOMPLETE` et `PAYMENT_CONFIRMATION_REQUIRED`.
- **Paiement.** `request.pay` n’est appelé que pour la demande confirmée par le bouton `payment.confirm.<requestId>`. Sinon le Backend lit le montant (`case.status`), renvoie `PAYMENT_CONFIRMATION_REQUIRED` au modèle et ajoute le bouton « Confirmer … FCFA » (24 caractères au plus, limite du contrat ; « Confirmer le paiement » si le montant est illisible). Le clic force `request.pay` pour ce seul `requestId`.
- **Liens.** Les URL qui ne sont pas une source observée sont retirées du texte (un lien Markdown garde son libellé) avant les contrôles ; l’événement `model.reply_url_removed` ne porte que leur nombre. Un `PS\d{5}` inconnu ou une source citée non observée restent refusés.
- **Limite restante.** Un essai refusé pour une source citée inconnue peut avoir déjà affiché un début de texte sans fait administratif ; `message.sent` le remplace.

## Risques résiduels acceptés

- Le plafond de sessions invitées (`GUEST_SESSIONS_PER_HOUR`) est tenu en mémoire du processus : il se réinitialise au redémarrage et n'est pas partagé entre instances.
- `/health/ready` n'est pas authentifié : il expose l'état des dépendances (sans secret) à quiconque atteint le Backend.
