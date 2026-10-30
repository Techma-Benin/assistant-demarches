# Vérifier Backend + Tooling ensemble

Branche locale : `integration/backend-tooling`, issue de `backend/agent-orchestration` (`c6fa434`) et `tooling/service` (`fa43337`).

Cette pile démarre le vrai Backend NestJS, un vrai processus worker BullMQ/Redis et le vrai Tooling MCP avec deux bases PostgreSQL isolées. Les huit outils viennent du catalogue partagé. Les ressources et les événements circulent par HTTP entre les services. Les quatre clients de service obtiennent des JWT RS256 par `client_credentials` ; les services vérifient signatures, audiences et scopes. Le consentement est signé par une autre clé et vérifié par le Tooling via JWKS.

Deux dépendances sont des fixtures locales : fournisseur d’identité minimal et modèle scripté. Les fichiers sont stockés sans analyse antivirus ni analyse du contenu. Cette pile valide le raccordement technique et les contrôles d’accès, pas la qualité d’un vrai modèle ou un déploiement Keycloak. Aucun appel à un fournisseur IA externe n’est effectué.

## Démarrer sur ce poste

Depuis la racine du dépôt :

```sh
git switch integration/backend-tooling
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:integration
pnpm dev:integration
```

Le fichier ignoré `integration/.env` est déjà configuré sur ce poste pour les binaires locaux disponibles. Il ne charge pas le `.env` du backend existant et ne réutilise pas sa base métier.

Le test automatique se termine avec `fail 0` et, sous Linux/macOS, `skipped 0`. Sous Windows, seul le test du signal de groupe POSIX est ignoré. Le mode interactif reste ouvert jusqu’à Ctrl+C et affiche :

- Swagger : <http://127.0.0.1:4110/docs>.
- Tooling : `http://127.0.0.1:4130/mcp` (transport MCP POST ; ce n’est pas une page web).
- Le chemin d’un fichier `synthetic.pdf` utilisable pour le test de pièce jointe.

Chaque lancement crée ses propres bases, clés, fichiers et préfixe de file Redis. Ctrl+C supprime les ressources de cette session ; les conversations disparaissent. Ne pas arrêter le processus brutalement si l’on veut garantir ce nettoyage. Les jetons expirent après huit heures : relancer la pile à ce moment-là.

## Démarrer sur une autre machine

Prérequis : Node 22, pnpm 10.20.0 et Docker Compose, ou des binaires PostgreSQL et Redis locaux.

Avec Docker, depuis la racine :

```sh
docker compose -f integration/dependencies.compose.yml up -d --wait
cp integration/.env.example integration/.env
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:integration
pnpm dev:integration
```

Sous PowerShell, remplacer `cp` par `Copy-Item`. Les dépendances sont dédiées, sur les ports 5434 et 6381. Le mot de passe fourni est uniquement une valeur publique de test local. Après les essais et l’arrêt de la pile :

```sh
docker compose -f integration/dependencies.compose.yml down
```

Sans Docker, omettre `INTEGRATION_DATABASE_URL` et `INTEGRATION_REDIS_URL` : le lanceur cherche PostgreSQL dans `/usr/lib/postgresql` et Redis dans `/usr/bin/redis-server`. `PG_BIN` et `REDIS_TEST_BINARY` permettent d’indiquer d’autres emplacements. Il ne faut pas exécuter `initdb` en root.

Une base externe doit avoir un nom finissant par `_test` et un compte autorisé à créer une base temporaire et le rôle SQL `tooling_app`. Le Backend utilise un schéma aléatoire dans la base de test ; le Tooling dispose d’une autre base temporaire. Le Redis externe doit être local et dédié aux essais ; seul le préfixe aléatoire de la session est nettoyé.

## Faire soi-même le parcours dans Swagger

1. Ouvrir `/docs` et cliquer **Tester comme usager**. Les en-têtes techniques d’exemple sont générés automatiquement. Rester sur le contrat `conversation`.
2. Exécuter `POST /v1/conversations` avec `{"channel":"web","locale":"fr"}`. Attendre **201** et conserver le `cnv_…` retourné.
3. Exécuter `POST /v1/conversations/{conversationId}/messages`, en remplaçant le paramètre par ce `cnv_…`, avec :

   ```json
   {
     "id": "msg_00000000000000000000000001",
     "content": {"type":"text","text":"rechercher"},
     "sentAt": "2026-10-28T12:00:00Z"
   }
   ```

   `sentAt` est une date ISO ; utiliser l’heure de son essai. Incrémenter la fin de l’identifiant `msg_…` pour chaque nouveau message. **202** signifie accepté ; la réponse de l’agent arrive ensuite.
4. Après une ou deux secondes, exécuter `GET /v1/conversations/{conversationId}/events`, sans curseur. Vérifier les événements `tool.called` et `message.sent`. La réponse cite la fiche fictive `demo-procedure`.
5. Exécuter `POST /v1/conversations/{conversationId}/mandate-challenges` avec :

   ```json
   {"procedureId":"demo-procedure","scopes":["requests:write","documents:write","requests:submit"]}
   ```

   Conserver le `chl_…`, lire le texte de consentement, puis exécuter `POST /v1/conversations/{conversationId}/mandates` avec `{"challengeId":"chl_…","accepted":true}`. Attendre **201** et un mandat `active`.
6. Envoyer un nouveau message dont le texte est **`creer`**. Dans les événements, la carte de statut de la réponse contient le `req_…` créé. Conserver cet identifiant. `GET /v1/requests/{requestId}` doit également retourner cette demande : cela vérifie la projection des événements Tooling vers Backend.
7. Envoyer **`completer req_…`** avec l’identifiant réel. La fixture remplit le champ fictif `displayName` avec `Usager fictif`. La demande reste `draft` tant qu’il manque sa pièce.
8. Exécuter `POST /v1/files` avec `application/octet-stream`, le fichier `synthetic.pdf` dont le chemin est affiché dans le terminal et `X-File-Mime-Type: application/pdf`. Conserver le `fil_…`. Le fichier est disponible immédiatement ; `synthetic.pdf` est un exemple, pas une restriction du stockage. Les contrôles de taille, MIME déclaré, propriété et expiration restent applicables.
9. Envoyer **`joindre req_… fil_…`**, en remplaçant les deux identifiants. Attendre une carte `ready` dans les événements.
10. Envoyer **`soumettre req_…`**. Attendre `awaiting_user_validation` et le lien fictif `https://example.org/demonstration`. L’essai prépare un lien ; aucun dépôt administratif réel n’est effectué.
11. Envoyer **`STOP`**. Vérifier `mandate.revoked` puis la confirmation de l’agent. Une nouvelle action ne doit plus réussir sans nouvelle autorisation.

Les mots ci-dessus sont des commandes exactes du modèle de test, en minuscules sans accents. Ce modèle n’interprète pas librement le français. Les identifiants à substituer sont les valeurs réellement retournées, sans chevrons ni points de suspension.

## Ce que les tests garantissent

`pnpm test:integration` vérifie le parcours ci-dessus, ainsi que :

- Refus d’un jeton invalide, d’une identité administrateur sur les routes usager et de l’accès d’un autre usager.
- Découverte des huit outils, lecture des fiches du vrai Backend et citations contrôlées.
- Refus d’une action sans mandat et refus d’une preuve de consentement altérée.
- Rejeu de consentement et d’action sans doublon ; conflit si la même clé porte un autre contenu.
- Création réelle d’une demande, réception des événements C4 et lecture de sa projection.
- Dépôt et utilisation immédiate de pièces sans scanner, remplissage et préparation du lien.
- Redémarrage du worker sans seconde réponse, révocation par STOP et refus d’utiliser le mandat révoqué.
- Utilisation des quatre clients `client_credentials`, outbox entièrement publiée et aucune entrée en échec définitif.
- Arrêt interactif par Ctrl+C sur le groupe de processus et suppression des fichiers temporaires (Linux/macOS).

`pnpm check` ajoute les contrats, les types, les tests des simulations et les suites de chaque service. Le test worker de la suite Backend nécessite `REDIS_TEST_URL` ou `REDIS_TEST_BINARY` dans l’environnement du terminal. Le fichier `integration/.env` est chargé automatiquement uniquement par les deux commandes d’intégration. En CI Linux, PostgreSQL et Redis sont fournis aux deux suites. Les contrôles macOS/Windows exécutent `pnpm check:portable` ; le parcours intégré complet avec bases est dans le job Linux.

## Raccorder ensuite les services de déploiement

Le `.env.example` du Backend et son exemple de provisioning visent maintenant le vrai Tooling sur 4030. Configurer les huit `ToolConfig.serverUrl` sur `/mcp`, `secretRef=backend-agent` et l’autorisation réseau `MCP_ALLOWED_URLS`. Les variables et les valeurs en base doivent être cohérentes.

Remplacer les fixtures par Keycloak et un fournisseur de modèle réels. Configurer les quatre clients : `backend-agent` (`tools:call`) et `backend-mandates` (`mandates:grant`) vers l’audience `techma-tooling`, puis `tooling-resources` (`resources:read`) et `tooling-events` (`events:publish`) vers `techma-backend`. Leurs jetons doivent inclure les claims attendus, dont `sub`, `iat`, `exp` et `azp` ou `client_id`.

Fournir la clé privée de consentement au Backend ; publier uniquement sa clé publique via `PROOF_JWKS_URL` et aligner `PROOF_ISSUER` sur `MANDATE_ISSUER`. Utiliser deux configurations d’environnement distinctes pour les bases Backend et Tooling. Activer HTTPS hors localhost, démarrer le worker séparément et refaire le même parcours avec ces dépendances. Le test local ne vaut pas validation d’un environnement de production.

Décision sur les pièces : [stockage sans antivirus](../docs/file-storage-decision.md).

## Connexion MCP dans l’administration

La pile conserve le premier serveur MCP Techma et ses permissions issues du provisioning historique. Dans Swagger `admin`, le groupe **Serveurs MCP** permet de lister cette connexion, découvrir ses huit actions et les désactiver individuellement ou désactiver tout le serveur. Le champ `policy:techma` conserve les contrôles métier et de provenance. Les connexions externes `generic` se configurent via les mêmes endpoints, après autorisation de leurs URLs côté déploiement. Voir [guide multi-MCP](../docs/mcp-connections.md).

Le test backend `mcp-connections.test.mjs` ajoute le cas de deux serveurs MCP avec actions hors catalogue et noms identiques, plusieurs authentifications et contrôle immédiat des permissions. Les fixtures locales ne prouvent pas une compatibilité avec tout fournisseur OAuth ni une soumission administrative réelle.

## Slide 8 : un message, deux bureaux

`pnpm test:slide8` joue la démo du PowerPoint avec le vrai Backend, le vrai Tooling et le X-Road simulé : consentement, dépôt d’un casier, paiement simulé, file **En attente** de la Justice, file vide pour l’Enseignement, puis prise en charge et approbation depuis la route de la console jusqu’au X-Road. Ni Redis ni modèle : les appels d’outils de l’agent passent directement par le `McpGateway` du Backend. PostgreSQL reste requis (`BACKEND_TEST_DATABASE_URL` ou `PG_BIN`).

`pnpm dev:slide8` démarre la même pile (Backend sur 4110) avec un casier en attente pour la Justice et une authentification de diplôme complétée pour l’Enseignement supérieur (fiches officielles de service-public.bj), puis écrit les jetons des trois sessions de démo dans `admin-demo-tokens.json`. Pour la console :

```sh
BACKEND_URL=http://127.0.0.1:4110 ADMIN_DEMO_TOKENS="$(cat <chemin affiché>)" pnpm --filter @techma/admin-console dev
```

Ouvrir <http://localhost:3100> (pas `127.0.0.1` : Next.js bloque alors ses ressources de développement).
