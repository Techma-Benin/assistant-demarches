# Connecter plusieurs serveurs MCP

Décision du 28 octobre 2026 : l’administration configure une connexion par serveur MCP. Les actions sont découvertes auprès du serveur ; l’administrateur sélectionne celles accessibles au modèle. Le serveur Techma existant est une connexion parmi les autres. Cette évolution ne crée pas de connecteur administratif réel : une action externe doit déjà être implémentée par le serveur ajouté.

## Parcours administrateur

Dans Swagger, contrat `admin`, groupe **Serveurs MCP**, choisir **Tester comme administrateur** en intégration locale. Hors intégration, fournir un JWT de l’administration avec `admin:read admin:write` et les en-têtes de trace.

1. `POST /v1/admin/mcp-servers` avec une nouvelle `Idempotency-Key` :

```json
{
  "id": "service-public",
  "name": "Service public",
  "url": "https://mcp.service.example/mcp",
  "enabled": true,
  "transport": "streamable-http",
  "auth": {"type": "none"},
  "policy": "generic"
}
```

2. `POST /v1/admin/mcp-servers/service-public/discover`, sans corps. Le backend réalise la connexion MCP et `tools/list`, y compris ses pages. La réponse conserve les noms, descriptions, paramètres et schémas de sortie du serveur. Pas de création ou renommage manuel d’action.
3. `GET /v1/admin/mcp-servers/service-public/tools` retourne le catalogue et les permissions. Les actions nouvelles sont **désactivées**. Choisir une action réellement découverte.
4. `PUT /v1/admin/mcp-servers/service-public/tools/{nom-encode}` :

```json
{"enabled": true, "requiresMandate": false}
```

`requiresMandate` vaut `true` par défaut. Le passage à `false` est une décision explicite de l’administration pour cette action, généralement de lecture. Les annotations du serveur ne donnent pas automatiquement ce droit. Avec `true`, un mandat local actif est nécessaire ; cela ne fournit pas à un service externe une identité déléguée de l’usager. Les actions métier Techma qui imposent un mandat ne permettent pas de retirer cette exigence.

5. Envoyer un message utilisateur demandant l’action. Le backend présente au modèle les seules actions autorisées et encore exposées. Le modèle peut choisir de les appeler ; l’activation ne force pas un appel.

La collection des connexions possède `cursor/limit`. Le catalogue par connexion est borné à 1 000 actions et retourné en une réponse (`nextCursor: null`). Une découverte dépassant 20 pages ou 1 000 actions est refusée.

## Désactivation, modification et suppression

- `PUT /mcp-servers/{id}` remplace la connexion entière. `enabled:false` retire toutes ses actions des prochains appels.
- Le PUT de permission désactive une action seule.
- `DELETE /mcp-servers/{id}`, sans corps avec une clé d’idempotence, supprime la connexion et ses permissions ; conserve dossiers et audit.
- Le backend revérifie les permissions juste avant chaque exécution. Une action déjà partie ne peut pas être annulée rétroactivement.
- Changer URL, authentification ou politique efface les capacités précédemment approuvées. Découvrir puis réactiver les actions.
- Une action supprimée à distance devient `available:false` après découverte. Une définition modifiée est désactivée pour nouvelle approbation ; elle n’est pas utilisée avec un ancien schéma.

`GET/PUT/DELETE /mcp-servers/{id}` sont isolés par l’administration du JWT. La même clé CRUD rejoue le succès pendant 24 h ; une charge différente donne 409. Les écritures sont auditées sans secrets. Découverte et PUT de permission sont répétables sans clé obligatoire, et produisent un audit à chaque réussite.

## Authentification et configuration d’exploitation

Les configurations ne contiennent **jamais les valeurs des secrets**. Déclarer par exemple `MCP_SECRET_REFERENCES={"service-token":"SERVICE_MCP_TOKEN","service-client-secret":"SERVICE_CLIENT_SECRET"}`, puis injecter les vraies valeurs dans ces variables côté serveur via l’outillage d’exploitation. Le jeton spécial `backend-agent` conserve le client OAuth dédié de Techma.

Modes réellement implémentés :

```json
{"type":"none"}
```

```json
{"type":"bearer","secretRef":"service-token"}
```

```json
{"type":"headers","headers":{"X-Api-Key":"service-token"}}
```

```json
{
  "type":"oauth-client-credentials",
  "tokenUrl":"https://identity.service.example/token",
  "clientId":"techma",
  "clientSecretRef":"service-client-secret",
  "scope":"requests:read requests:write",
  "audience":"service-public"
}
```

Ce dernier mode fait un vrai échange `grant_type=client_credentials`, avec `client_secret_post` et paramètre `resource` égal à l’URL MCP. Il utilise le jeton Bearer retourné ; `scope` et `audience` sont facultatifs. Il ne prétend pas implémenter toute l’extension MCP OAuth : pas de découverte automatique de l’émetteur, ni de négociation des capacités OAuth, ni de `private_key_jwt`, ni de flux navigateur Authorization Code + PKCE. Un serveur exigeant ces mécanismes n’est pas encore compatible. Aucun faux succès ni fausse authentification interactive.

La liste `MCP_ALLOWED_URLS` du déploiement doit inclure l’URL MCP exacte **et** l’URL du token OAuth lorsqu’elle est utilisée. HTTPS exigé hors localhost ; redirections refusées. Cela permet à l’admin de choisir parmi les destinations réseau approuvées sans donner au modèle un accès HTTP arbitraire. Le déploiement doit aussi maîtriser DNS et sorties réseau des domaines approuvés. Les en-têtes réservés au protocole, à l’identité interne et au transport ne sont pas remplaçables par l’admin.

Le transport pris en charge est **Streamable HTTP**. Pas d’exécution de commande `stdio` dans ce backend hébergé, ni d’ancien HTTP+SSE. Les sessions MCP sont ouvertes/fermées par opération ; il n’y a pas d’abonnement persistant aux notifications de catalogue. Utiliser la découverte explicite pour actualiser les permissions. Le traitement redécouvre également les capacités avant de les proposer au modèle.

## Actions du modèle et résultats

Chaque action générique reçoit un alias de modèle stable calculé à partir de la connexion et du nom distant. Deux serveurs exposant `search` restent distincts ; le gateway appelle chacun avec son vrai nom `search`. `modelName` est visible pour le diagnostic, pas modifiable.

Le backend valide les arguments avec le schéma découvert, et le résultat structuré avec le schéma de sortie s’il existe. Les réponses uniquement textuelles sont également transmises au modèle. Les résultats externes ne deviennent pas automatiquement des fiches administratives validées ou des cartes de dossier Techma ; aucune provenance officielle n’est inventée. Les identifiants internes d’usager, conversation et mandat ne sont pas transmis aux connexions `generic`.

`policy: techma` est réservé au serveur métier de confiance : maintien des huit noms historiques, de leurs schémas partagés, contrôles de mandat, sources validées et cartes de dossier. Deux connexions `techma` activées exposant les mêmes actions provoquent un refus explicite de collision ; utiliser `generic` pour des connexions supplémentaires. Le catalogue Techma ne limite plus les actions génériques externes.

## Migration et provisioning

La migration `006_mcp_servers.sql` groupe les anciens `ToolConfig` par administration, URL et référence d’authentification. Une connexion `techma` est créée par groupe, avec les activations des anciennes actions conservées. Le serveur est redécouvert avant utilisation. La découverte administrative est authentifiée avec l’identité de service, sans inventer de conversation ou d’usager ; le serveur Techma exige toujours un contexte valide pour exécuter une action. Les anciennes routes `/v1/admin/tools` sont dépréciées mais conservées avec un pont vers les permissions pour les clients existants ; ne pas les employer dans les nouveaux écrans.

Le fichier de seed accepte désormais `mcpServers: [McpServer]`, en plus des modèles et procédures. Après démarrage, découvrir les actions et choisir les permissions via C3. Le champ historique `tools` reste accepté pour la compatibilité et pour la pile d’intégration existante. Le provisioning ne remplace pas la découverte et ne prouve pas la disponibilité d’un serveur.

## Vérification

`pnpm --filter @techma/backend test` exécute notamment `mcp-connections.test.mjs` : deux vrais serveurs MCP HTTP locaux, découverte paginée, action absente du catalogue historique, noms distants identiques, routage, sortie texte, permissions, désactivation pendant un traitement, isolation JWT, refus d’URL, authentification par en-tête/Bearer/OAuth, invalidation et suppression en cascade. Les serveurs de ce test sont synthétiques, le protocole et les appels réseau sont réels.

`pnpm test:integration` conserve le parcours avec le serveur MCP Techma existant : mandat, création/modification, pièces, préparation finale et événements. Les sources externes réelles et l’authentification interactive ne sont pas validées par ces tests locaux.

## Sources de conception

Recherche effectuée sur les sources officielles MCP et le SDK installé `@modelcontextprotocol/sdk` 1.32.1, dont `LATEST_PROTOCOL_VERSION` vaut `2025-11-25` :

- [Tools : découverte, pagination, schémas et résultats](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
- [Transports MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) : séparation stdio / serveur HTTP et endpoint MCP commun.
- [Autorisation MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) : OAuth utilisateur distinct d’un simple jeton préconfiguré ; mécanismes interactifs exclus explicitement de cette implémentation.
- [Extension OAuth Client Credentials](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials) : cas serveur-à-serveur ; notre mode implémente le flux explicite à secret client, pas l’ensemble de l’extension.
- [SDK TypeScript officiel](https://github.com/modelcontextprotocol/typescript-sdk) et ses déclarations locales `client/streamableHttp.d.ts`, `client/auth.d.ts` : transport officiel réutilisé ; pas de réimplémentation JSON-RPC.
