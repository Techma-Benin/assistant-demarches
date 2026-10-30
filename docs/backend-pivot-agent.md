# Agent, catalogue et validation du pivot

État au 30 octobre 2026, branche `backend/department-pivot`.

## Comportements livrés

- Les réponses finales sont validées comme blocs du contrat. Le JSON entouré d’une balise `json` et les contenus multipart du fournisseur sont acceptés. Le texte brut arbitraire ne devient jamais automatiquement une réponse autorisée.
- Une citation doit correspondre exactement à une `Source` reçue avec une `Procedure` complète, validée, dont l’identifiant correspond à celui de la source. Un résultat d’outil en erreur, une fiche brouillon ou un serveur MCP générique ne donnent pas de preuve administrative.
- Les salutations et clarifications sans source utilisent les phrases relues de `model-reply.ts`, également fournies au modèle dans `prompts/agent-v1.txt`. Ajouter une phrase exige de modifier les deux listes. Les réponses administratives citées restent rédigées par le modèle : ce contrôle vérifie leur provenance déclarée, pas l’exactitude sémantique de chaque phrase.
- Les cartes de statut reprennent uniquement une `Request` observée par outil pendant le message courant et appartenant à la conversation et à son usager. Un statut fourni par le modèle est ignoré. Un ancien statut ne sert pas de preuve d’un état actuel.
- Les demandes de pièces doivent utiliser un type de document du catalogue validé ; les champs de formulaire doivent exister dans le schéma d’une démarche validée.
- La génération HTTP dispose de trois tentatives au maximum pour les problèmes réseau, réponses fournisseur malformées et HTTP 408, 425, 429 ou 5xx. Les refus 400, 401 et 403 remontent immédiatement, avec une exception précise : `400 tool_use_failed` sur `api.groq.com` est classé `provider_tool_generation_invalid`. L’agent reprend cette génération rejetée dans son budget commun de trois réponses, avec une consigne corrective. Il ne lit ni n’exécute `failed_generation` ; aucun outil local n’a exécuté la génération rejetée. Les réponses finales vides, malformées ou non justifiées utilisent le même budget. Historique, checkpoints et clés d’idempotence sont conservés ; une action identique déjà réussie pour ce message réutilise son résultat. [Groq documente ces rejets et leur reprise](https://console.groq.com/docs/tool-use/local-tool-calling).
- `tools` est omis quand la liste est vide, pour les fournisseurs qui refusent `tools: []`. Pour Chat Completions sur `api.groq.com`, les modèles `openai/gpt-oss-20b`, `openai/gpt-oss-120b` et `openai/gpt-oss-safeguard-20b` reçoivent `parallel_tool_calls: false` lorsque des outils sont présents. Les autres fournisseurs et modèles restent inchangés ; une option facultative `Provider.parallelToolCalls` permet de préciser leur comportement. Groq documente ces modèles comme séquentiels alors que la valeur API par défaut est `true`. [Capacités officielles](https://console.groq.com/docs/tool-use/overview), [référence API](https://console.groq.com/docs/api-reference).
- Le mandat est choisi selon les scopes de l’outil et la démarche connue ; Tooling conserve son propre contrôle d’autorisation. Le modèle ne reçoit ni identité interne, ni preuve de consentement, ni identifiant de mandat.
- Le challenge de consentement lit le catalogue par `procedures.get` sur une connexion MCP Techma activée, avec un contrat découvert inchangé. Un unique catalogue doit être configuré pour l’administration persistée de la conversation. L’appel distant est réalisé hors transaction SQL ; un challenge déjà créé se rejoue depuis le cache d’idempotence. Le texte de consentement décrit les actions effectivement demandées : préparation/modification, ajout de pièces et/ou dépôt. Il ne présente pas un droit de dépôt comme une simple préparation. `LocalProcedureCatalog` est un adaptateur de compatibilité explicitement injectable, jamais le défaut du runtime.
- L’audio utilise le port de transcription optionnel. Le transcript est traité comme texte usager, puis expurgé avant le modèle, sans modifier le message audio ni son empreinte d’origine. Un audio impossible à transcrire ou dépassant 4 000 caractères demande un message plus court ou du texte ; il n’est pas tronqué silencieusement. Les autres pièces restent des références opaques.
- Les demandes non répondues sont enregistrées dans `backend_unanswered` après migration 009, avec identifiants et motif (`missing_source`, `tool_failure`, `provider_failure`, `invalid_reply`), sans recopier le texte de l’usager.

## Vérifications réalisées

Exécuter depuis la racine du dépôt, après génération des contrats si ceux-ci changent :

```sh
node apps/backend/scripts/build.mjs
node --env-file-if-exists=integration/.env --test apps/backend/tests/model.test.mjs apps/backend/tests/pivot-agent.test.mjs apps/backend/tests/conversations.test.mjs apps/backend/tests/transcription.test.mjs apps/backend/tests/worker.test.mjs
```

Les tests utilisent des bases PostgreSQL temporaires, des serveurs HTTP/MCP locaux et le Redis de test configuré. Ils nécessitent l’autorisation réseau locale de l’environnement d’exécution. Résultat vérifié : **34 tests ciblés réussis**, puis **1 test worker/Redis réussi sans exclusion**. Le worker vérifie les reprises bornées et l’absence de nouvelle réponse après redémarrage.

Les tests couvrent notamment : source exacte et source inventée, faits non sourcés, statut falsifié, pièces hors catalogue, réponse vide/malformée après outil réussi, déduplication d’écriture, confidentialité des diagnostics, erreurs 401/503, multipart, absence d’outils, transcription et message original inchangé, challenge MCP sans fiche SQL et rejeu idempotent. La finalisation ajoute un cas de capacités fournisseur vérifiant GPT-OSS séquentiel sans modifier les autres modèles, ainsi qu’une assertion sur le texte explicite du consentement au dépôt ; ces ajouts doivent être inclus dans la passe complète après reconstruction.

La revalidation Groq ajoute trois régressions : distinction des erreurs fournisseur, reprise après écriture réussie sans doublon, arrêt après trois générations rejetées avec réponse explicite et journalisation sans texte brut. **18 tests ciblés modèle/agent réussis** ; la passe Backend finale valide **81 tests**, avec relance séparée et réussie du worker après correction du chemin du Redis portable. Voir `backend-pivot-status.md` pour les **140 validations synthétiques cumulées** et les limites interéquipes.

## Test réel Groq : deux parcours validés, limite de débit observée

```sh
GROQ_LIVE_TEST=true GROQ_LIVE_MODEL=openai/gpt-oss-20b node --test apps/backend/tests/groq.live.mjs
# Ou via le script dédié, qui reconstruit puis active explicitement le test :
GROQ_LIVE_MODEL=openai/gpt-oss-20b pnpm --filter @techma/backend test:groq
```

Ce test charge `.env` en mémoire sans l’afficher et n’utilise que des données fictives. Il doit vérifier successivement une salutation sans outils, une réponse citant le catalogue synthétique et la création autorisée d’un brouillon synthétique dont la carte garde le statut réel. Aucun dépôt, paiement ou dossier externe réel n’est créé. Le fichier `groq.live.mjs` est hors du glob `tests/*.test.mjs` : la suite par défaut ne lance aucun test réel et ne le compte pas comme un test ignoré. La réussite de la suite locale ne valide donc pas Groq. En lancement direct, `GROQ_LIVE_TEST=true` reste nécessaire.

Lors de la reprise du **30 octobre vers 08:42 UTC**, la connexion réelle à Groq fonctionne avec la clé existante et `openai/gpt-oss-20b`. Le premier parcours a révélé `400 tool_use_failed` : après l’outil catalogue, le modèle tentait un outil inexistant `json` pour rendre sa réponse. Le prompt précise désormais que le JSON final va dans le contenu texte assistant. La reprise ciblée décrite plus haut conserve les outils déjà exécutés et les exigences de sources.

Après correction, **deux exécutions complètes consécutives réussissent** :

1. Salutation réelle sans outil et réponse conforme au contrat.
2. Consultation du catalogue fictif et citation de sa source effectivement observée.
3. Création autorisée d’un seul brouillon fictif et carte affichant son statut réel `draft`.

Une troisième répétition rapprochée, vers **08:45 UTC**, a reçu **HTTP 429**, `rate_limit_exceeded`, type `tokens`, pendant le catalogue, après une salutation réussie. Les trois tentatives HTTP courtes n’ont pas suffi à lever la limite. Ce résultat ne distingue pas à lui seul une limite minute d’un quota plus long ; prévoir la capacité fournisseur avant une démonstration ou un test de charge. Aucun autre modèle, prestataire ou compte n’a été substitué et aucune limite n’a été contournée.

Le test utilise le vrai modèle et des outils locaux synthétiques : il ne valide pas les endpoints administratifs externes, un paiement ni la transcription réelle. La clé n’a été ni affichée ni modifiée.

## Historique du blocage réseau précédent — résolu à la reprise

Lors des premières passes des 29 et 30 octobre, le premier appel à `https://api.groq.com/openai/v1/chat/completions` recevait **HTTP 403**, classé `provider_network_access_denied`, même avec l’exécution réseau autorisée. Les observations ci-dessous sont historiques ; elles ne décrivent plus la connexion lors de la revalidation réussie.

Vérification indépendante du transport applicatif :

1. Un POST fictif par `curl`, avec les variables réseau de l’environnement, renvoie le même 403.
2. Le même POST par `curl --noproxy '*'` renvoie le même 403. Aucune variable `HTTP_PROXY`, `HTTPS_PROXY` ou `ALL_PROXY` n’est configurée ; `NO_PROXY` ne l’est pas non plus.
3. `GET /openai/v1/models`, avec puis sans authentification, renvoie également ce 403 et la même classification. Le DNS résout, la connexion TLS est vérifiée et l’en-tête serveur indique Cloudflare.

Ces résultats indiquaient un refus indépendant du wrapper `HttpModels`, de la sérialisation des outils, du DNS et de la validation TLS. Le refus survenait également sans clé et ne permettait donc pas d’évaluer celle-ci. La réponse ne précisait ni liste d’adresses IP autorisées ni organisation : la cause exacte de la restriction amont n’a pas été établie. Les appels réussis de la reprise confirment désormais l’accès réseau et l’authentification pour le modèle testé. Aucun secret, en-tête d’autorisation ni corps brut de réponse n’a été imprimé.
