# Backend pivot — état de reprise

Dernière mise à jour : **30 octobre 2026**. Branche : **`backend/department-pivot`**.
Base : `integration/backend-tooling`, commit `006c7af`. Le worktree `integration/full-stack` reste séparé et n’a pas été modifié par ce chantier.

## État actuel

**Implémentation Backend terminée, vérifiée localement et commitée ; parcours Groq validé sur données fictives.** La livraison est versionnée sur `backend/department-pivot`, sans push. Les nouvelles APIs doivent être raccordées aux travaux des équipes Interface et Tooling. Les services de l’État et paiements réels ne sont pas validés par ces essais.

Commits de livraison : `99b1938` (contrats 1.3.0 et types générés), `d57a087` (implémentation Backend, migrations et tests). Le commit de documentation qui contient cette mise à jour ajoute la recette et le suivi de reprise ; consulter `git log -3 --oneline` pour ses références exactes.

Ce document permet de reprendre après interruption sans l’historique du chat. Pour essayer la livraison, commencer par [la recette manuelle et automatique](backend-pivot-recette.md). Lire aussi [contrat et guide de raccordement](backend-pivot-api.md) et [garanties agent / diagnostic Groq](backend-pivot-agent.md).

**Revalidation Groq — 30 octobre, 08:42–08:45 UTC :** le refus réseau a disparu. L’essai a révélé un outil fictif `json` généré à la place du contenu final (`400 tool_use_failed`). Le prompt distingue désormais réponse JSON et appel d’outil ; seule cette erreur Groq est reprise dans le budget de trois réponses, sans exploiter `failed_generation` ni répéter les actions réussies. **Deux exécutions complètes ont ensuite réussi** avec `openai/gpt-oss-20b`. Une troisième répétition rapprochée a reçu `429 rate_limit_exceeded` de type `tokens`, après la salutation : la limite de débit/quota reste à prendre en compte pour la démonstration et l’exploitation.

## Objectif et références

Périmètre Backend du compte rendu d’appel du 29 octobre et de `Pivot-Assistant-demarches.pptx`, disponibles dans `docs/` du dossier parent du dépôt. Les trois équipes partent de ces documents. L’utilisateur a demandé une nouvelle branche, la réutilisation ciblée du full-stack, des tests approfondis et une documentation de reprise ; aucun push ou contact avec les autres équipes n’est implicitement autorisé.

## Livré

| Chantier | État et emplacement |
|---|---|
| Contrats du pivot | Manifeste **1.3.0**, 78 schémas, 64 opérations HTTP, 8 outils MCP ; types régénérés |
| Annuaire / départements / profils | `admin-directory.ts`, son contrôleur, `department-auth.ts`, migration 008 |
| Dossiers / KPI / activités / questions | `department-work.ts`, son contrôleur, migration 009 |
| Commandes d’intervention | `department-commands.ts`, contrat `tooling-admin.openapi.json` |
| Sources et fiabilité agent | `agent.ts`, `model.ts`, `model-reply.ts`, prompt versionné |
| Consentement via catalogue MCP | `consent.ts` et `runtime.ts` ; pas de dépendance SQL obligatoire aux fiches locales |
| Audio optionnel | `transcription.ts`, `Files.readOwned`, intégration agent/runtime |
| Pièces et documents délivrés | Transfert service dédié, stockage privé, téléchargement usager/admin contrôlé |
| Tests et reprise | `scripts/verify-backend-pivot.mjs` (`check:pivot`), nouveaux tests Backend, cette documentation |

Les fichiers Interface et Tooling applicatifs n’ont pas été modifiés. Les contrats communs ont évolué explicitement pour le raccordement des équipes.

## Décisions essentielles

- Tooling reste référence des dossiers, paiements et décisions ; Backend ne lit pas sa base et ne simule pas une décision en cas d’erreur.
- L’administration cible appartient au **dossier**, indépendamment de l’administration technique de la conversation : deux ministères peuvent recevoir des dossiers d’une même conversation.
- L’annuaire Backend est un adaptateur local de démonstration, remplaçable par l’annuaire Tooling ; OIDC reste la référence d’identité. Ne pas exploiter deux annuaires concurrents.
- Les droits métier et opérateur sont séparés. Même un super administrateur métier ne contourne pas `operator:*`. La désactivation d’un compte inscrit s’applique immédiatement malgré un JWT encore valide.
- Les snapshots complets ont une révision croissante ; ancien événement ignoré, révision contradictoire refusée, propriétaire et routage immuables. Un dossier passé aux snapshots n’accepte plus les événements legacy non versionnés.
- Toutes les mutations de dossier prennent le verrou conversation avant le verrou dossier. Les commandes gardent un verrou de session, inscrivent leur marqueur avant RPC en autocommit, puis enregistrent projection et réponse dans une transaction. Aucun emprunt d’une seconde connexion n’est nécessaire : le test avec pool maximal de 1 passe.
- Les clés distantes sont stables ; une réponse Tooling perdue peut être récupérée avec la même clé, même après réception de son snapshot. Une nouvelle clé portant une révision obsolète reste refusée.
- Les snapshots privés et les textes de conversation ne sont pas exposés dans le journal admin. Les notifications usager utilisent des cartes de statut contrôlées.
- Le paiement est un état projeté de Tooling ; cette livraison n’ajoute ni prestataire réel, ni débit réel.
- Audio explicitement activable, formats et propriété vérifiés ; aucune pièce PDF/image envoyée à la transcription. Pas de garantie revendiquée de chiffrement de bout en bout jusqu’au modèle.
- Pièces entrantes : 24 h. Documents délivrés : 30 jours par défaut de démonstration, configurable. Les durées du pilote restent à fixer avec le porteur public.

## Résultats exacts de vérification

Validation complète puis dernière passe ciblée après renforcement des commandes :

| Vérification | Résultat |
|---|---|
| Contrats, génération et TypeScript partagé | réussis |
| Build Backend et Tooling | réussis |
| Tests contrats / mocks du dépôt | **10 / 10** |
| Tests Backend finaux | **81 / 81**, PostgreSQL/HTTP/MCP/Redis/stockage réels locaux ; passe de 80 tests puis worker/Redis relancé et réussi |
| Tests Tooling, y compris répliques PostgreSQL | **42 / 42** |
| Intégration Backend ↔ Tooling existante | **7 / 7** |
| Total synthétique validé | **140 tests réussis**, chacun exécuté ; contrôles contrats/Tooling/intégration conservés de la passe précédente |
| Test Groq réel séparé | **2 parcours complets réussis** après correction ; répétition suivante limitée par **HTTP 429** ; aucun HTTP 403 dans cette reprise |
| Diff / syntaxe | contrôlés, sans erreur |

Les tests couvrent notamment : droits inter-départements, révocation et élévation de droits, idempotence, collisions et concurrence, réponse distante perdue, compatibilité legacy, refus des fausses preuves, documents d’un autre usager/expirés, médiane et dates des KPI, reprise du worker, sources exactes, erreurs fournisseur et audio. Le test des nouvelles commandes utilise un serveur HTTP synthétique conforme au contrat ; il ne prouve pas que le nouvel endpoint existe déjà dans la branche de l’autre équipe.

Dernier rapport global : `/tmp/techma-pivot-checks-1793343710956/`. Passe Backend avant revalidation Groq : `/tmp/techma-pivot-backend-final.log`. Nouvelle passe : `/tmp/techma-groq-backend-regression.log` (80 réussis, worker initialement ignoré à cause du chemin Redis ; worker relancé séparément avec le chemin absolu correct : 1/1). Les 18 tests ciblés modèle/agent passent également, dont trois nouveaux cas pour la classification des erreurs, la borne de reprise et l’absence de double écriture. Ces fichiers temporaires peuvent disparaître ; les résultats et commandes durables sont consignés ici.

## Relancer les vérifications

Depuis la racine du dépôt :

```sh
node scripts/verify-backend-pivot.mjs
```

Le script construit les services, génère les types, exécute les contrats et les tests. Il fournit un PostgreSQL temporaire aux tests Tooling si `TEST_DATABASE_URL` est absent et nettoie ses ressources. PostgreSQL, Redis et les dépendances Node verrouillées doivent être disponibles. Les serveurs locaux peuvent nécessiter l’exécution hors bac à sable.

Sur ce poste, Redis portable nécessite les deux variables suivantes (elles ne sont pas des secrets) :

```sh
export LD_LIBRARY_PATH="$(pwd)/../.backend-runtime/redis/usr/lib/x86_64-linux-gnu"
export REDIS_TEST_BINARY="$(pwd)/../.backend-runtime/redis/usr/bin/redis-server"
node scripts/verify-backend-pivot.mjs
```

Le binaire PostgreSQL local est dans `/usr/lib/postgresql/18/bin`. Aucun test ne cible par défaut le `DATABASE_URL` métier.

Test Groq explicite, après build, depuis la racine :

```sh
GROQ_LIVE_TEST=true GROQ_LIVE_MODEL=openai/gpt-oss-20b node --test apps/backend/tests/groq.live.mjs
```

Le test charge `.env` en mémoire, sans afficher ses secrets. Il est hors du glob des tests habituels et ne consomme aucun appel réel par défaut. Les deux parcours réussis vérifient la salutation sans outil, la source réellement observée du catalogue fictif et un brouillon autorisé créé une seule fois avec sa carte `draft`. Ne pas lancer des répétitions rapprochées sans tenir compte des quotas : un essai supplémentaire a reçu `429 rate_limit_exceeded`. Le précédent blocage réseau `403` est historique, résolu lors de cette reprise. Voir le diagnostic détaillé.

## Travail restant hors du Backend livré

1. **Tooling** : implémenter/raccorder le contrat d’intervention `backend-admin`, publier un snapshot après chaque mutation, brancher la simulation de dépôt/paiement/suivi et l’annuaire distant final. Client `tooling-documents` pour les octets privés et les documents délivrés.
2. **Interface** : consommer les nouveaux OpenAPI, rendre les dossiers/KPI/profils/permissions, panneau de progression et provenance ; utiliser la session OIDC réelle. Présenter explicitement le caractère simulé et le traitement éventuel des vocaux par le fournisseur.
3. **Fournisseur** : le parcours Groq sur données fictives est validé. Vérifier les limites de débit/tokens disponibles pour la démo et la charge attendue ; la répétition des essais a rencontré un `429`. Sa clé n’a pas été exposée ni modifiée. L’audio réel reste à valider séparément.
4. **Déploiement** : appliquer migrations 008/009, initialiser `justice` / `enseignement` via `apps/backend/seeds/demo-deux-bureaux.json`, configurer les identités de service et lancer API + worker. Les garanties infrastructure (TLS, sauvegardes, hébergement, etc.) ne sont pas établies par les tests locaux.

## Consignes de reprise

- Vérifier d’abord la branche, `git log` et `git status` ; la livraison décrite ici est commitée. Préserver toute modification ultérieure et le worktree full-stack.
- Lire `backend-pivot-api.md` pour les routes, schémas, clients et scopes attendus.
- Après une modification, relancer la suite pertinente ; le script complet donne un rapport de contrôle reproductible.
- Ne pas imprimer `.env`, clés, JWT ou conversations. Ne pas copier les notes/configurations privées du dossier parent dans Git.
- Publier/committer seulement selon l’instruction de l’utilisateur. Présenter précisément la validation Groq : modèle réel et outils/données fictifs, deux parcours réussis. Ne pas présenter les services administratifs, paiements ou audio réels comme validés avant raccordement et essai effectifs.
