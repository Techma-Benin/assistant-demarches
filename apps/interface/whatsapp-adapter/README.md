# whatsapp-adapter

Adaptateur WhatsApp (NestJS 12, ESM) de l’assistant démarches. Il fait le pont entre l’API WhatsApp Cloud de Meta et le Backend :

- **entrant** : webhook Meta (vérification de signature) → transmission au Backend par le contrat C1 ;
- **sortant** : rappel C4 du Backend (`message.sent`) → rendu en messages WhatsApp → envoi via Meta.

Aucune logique IA n’est ici (CONTRACTS.md §2). Contrats de référence : `CONTRACTS.md` (§2, §3, §4, §5, §9, §10), `contracts/v1/whatsapp-callback.openapi.json`, `contracts/v1/conversation.openapi.json`.

## Lancer en développement

Prérequis : Node 22, `pnpm install` à la racine du dépôt.

```bash
pnpm mocks                                   # racine : Backend simulé sur le port 4010
pnpm --filter @techma/whatsapp-adapter dev   # adaptateur sur le port 4030 (PORT pour changer)
```

Sans compte Meta, rien ne sort sur le réseau : les messages sont enregistrés en mémoire.

- `GET /health` → `{ "status": "ok" }`
- `GET /dev/outbox` → messages « envoyés » (numéro masqué `+229••••••12`)
- `POST /dev/media/:id` (corps binaire + `Content-Type`) → enregistre un média factice pour un message image/document/audio entrant
- `POST /webhooks/meta` : à signer avec `META_APP_SECRET` (`X-Hub-Signature-256: sha256=<hmac hex>`)
- `POST /v1/callbacks/events` : jeton `Bearer mock-backend-delivery` en développement

Scripts : `dev`, `build`, `start` (`node dist/main.js`), `typecheck`, `test`.

## Variables d’environnement

Voir `.env.example` (valeurs d’exemple uniquement). La configuration est validée au démarrage ; une erreur donne la liste des variables fautives, sans valeur secrète.

| Variable | Dev | Production |
|---|---|---|
| `PORT` | 4030 | 4030 |
| `NODE_ENV` | `development` | `production` |
| `BACKEND_URL` | `http://127.0.0.1:4010` | HTTPS obligatoire hors localhost |
| `META_APP_SECRET`, `META_VERIFY_TOKEN` | valeurs de dev par défaut | obligatoires |
| `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` | optionnels : sans eux, envoi simulé (`RecordingMetaSender`) | obligatoires |
| `META_GRAPH_VERSION` | `v23.0` | obligatoire |
| `SUBJECT_HMAC_KEY` | valeur de dev par défaut | obligatoire, ≥ 32 caractères |
| `CALLBACK_JWKS_URL`, `CALLBACK_ISSUER` | inutiles (jeton statique) | obligatoires |
| `MOCK_USER_TOKEN` | `mock-user` | **refusé** |
| `CONTRACTS_DIR` | `contracts/v1` du dépôt | idem (surcharge possible) |

## Architecture (`src/`)

| Module | Rôle |
|---|---|
| `config` | lecture et validation de l’environnement (`loadConfig`) |
| `webhook` | entrée Meta : vérification GET, signature sur octets bruts, `InboundQueue` (séquentielle par abonné, 5 reprises 1/2/4/8/16 s), `InboundProcessor` (déduplication, mapping vers `MessageInput`, médias, formulaires) |
| `backend` | client C1 (`traceparent`, `Idempotency-Key`, problem+json → `C1Error`) et `SubjectTokenProvider` |
| `callback` | récepteur C4 `POST /v1/callbacks/events` : auth (`CallbackTokenVerifier`), en-têtes, validation ajv du schéma `Event`, déduplication, 204 puis tâche d’envoi |
| `rendering` | rendu pur et déterministe `AgentMessage` → messages WhatsApp, machine d’état des formulaires (dossier de fonctions pures, sans module Nest) |
| `meta` | `MetaSender` (`GraphApiMetaSender` réel, `RecordingMetaSender` simulé), `MetaMedia` (`GraphApiMetaMedia`, `FakeMetaMedia`), `OutboundQueue` en mémoire (ordre par conversation, 10 reprises 1→60 s) |
| `storage` | interfaces + implémentations en mémoire avec TTL : `DedupeStore` (24 h), `ConversationDirectory`, `FormSessionStore` (1 h), `ButtonIdMap` |
| `dev` | routes de développement, enregistrées seulement si `NODE_ENV !== production` |

Flux entrant : signature Meta → 200 immédiat → file → déduplication du `wamid` → conversation (`Idempotency-Key: wa-conv-<subjectKey>`) → `MessageInput` d’identifiant dérivé du `wamid` (les relivraisons Meta donnent le même identifiant) → C1.
Flux sortant : rappel Backend → 204 → recherche du numéro par conversation → rendu → envoi Meta dans l’ordre.

Le rendu suit les cinq blocs du contrat : texte (+ « Sources : »), boutons (le texte précédent ≤ 1024 caractères devient le corps du message à boutons), formulaire (question par question), demande de pièce, carte de statut.

## Règles de confidentialité

- Aucun numéro (`wa_id`, `from`), texte de message, octet de média, jeton, secret d’application ni signature n’est journalisé. Les journaux portent la clé d’abonné (`subjectKey` = HMAC-SHA256(`SUBJECT_HMAC_KEY`, `wa_id`) complet, en hex), le `wamid`, des identifiants et des codes d’erreur (test dédié).
- Le numéro n’est jamais envoyé au Backend (ni corps, ni URL) : le Backend identifie l’usager par le jeton fourni par `SubjectTokenProvider`.
- Signature Meta vérifiée à temps constant sur les octets bruts, avant tout parsing JSON.
- Jeton de rappel jamais renvoyé dans une réponse d’erreur.
- Le `waId` stocké dans `ConversationDirectory` devra être chiffré au repos dès qu’une vraie persistance existera.

## Ce qui est simulé

- Meta : `RecordingMetaSender` et `FakeMetaMedia` (dev et tests). `GraphApiMetaSender` / `GraphApiMetaMedia` sont écrits et testés avec un `fetch` factice, mais jamais exercés en direct (pas de compte Meta).
- Authentification Backend : `DevSubjectTokenProvider` renvoie `MOCK_USER_TOKEN`, uniquement vers un Backend en boucle locale. Tous les numéros partagent donc le même usager simulé.
- Authentification du rappel : jeton statique `mock-backend-delivery` en dev ; en production, JWT RS256 vérifié par JWKS (testé avec des clés locales).
- Stockage et files : tout est en mémoire, perdu au redémarrage.

## Questions ouvertes

1. **STOP / HISTORIQUE** : l’identifiant du mandat et l’historique de l’usager ne sont pas fournis à l’adaptateur par le contrat actuel. Pour l’instant ces mots-clés sont transmis comme texte normal (et interrompent un formulaire en cours). TODO dans `webhook/inbound-processor.ts`.
2. **Échange de jeton** : en production `SubjectTokenProvider` lève « Échange de jeton non branché ». Il faut un jeton d’échange portant le claim signé `channel_subject`, client `whatsapp-adapter`, scope `conversation:relay` (CONTRACTS.md §3).
3. **Réponses de formulaire** : encodage provisoire `{ type: 'interaction', actionId: <formId>, value: JSON.stringify(valeurs) }`, identique au widget web ; à confirmer avec le Backend.
4. **Persistance** : file et stockage en mémoire ; BullMQ/Redis (files) et une base chiffrée (conversations, sessions) à brancher dans une tâche ultérieure.
5. **Contrat d’erreurs** : une erreur interne imprévue répond 500 avec le code `UPSTREAM_UNAVAILABLE`, faute de code dédié dans le schéma `Problem`.

## Tests

`pnpm --filter @techma/whatsapp-adapter test` : unitaires (rendu, formulaires, identifiants, signature, files, config, client Graph) et bout en bout (Nest + supertest, et contre le vrai mock Backend de `mocks/server.mjs` démarré sur des ports libres).
