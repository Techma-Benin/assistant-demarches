# Recette du Backend du pivot

État au 30 octobre 2026. Branche : `backend/department-pivot` dans `assistant-demarches`. La livraison est commitée localement, sans push. Les contrats et le Backend sont dans `99b1938` et `d57a087` ; les guides sont ajoutés dans le commit de documentation suivant. Ne pas changer de branche pour suivre ce guide.

Ce guide sert à essayer la livraison et à répartir le travail restant. Swagger permet d’appeler les APIs ; les écrans du pivot restent à raccorder par l’équipe Interface.

## 1. Voir précisément ce qui a été livré

| Fonction | Livré côté Backend | Dépendance restante |
|---|---|---|
| Départements, utilisateurs et profils | Création, affectations, rôles, désactivation, profil, pagination et protection contre les modifications concurrentes | Identités OIDC réelles ; annuaire local de démonstration à raccorder à l’annuaire Tooling final |
| Cloisonnement | Accès agent/admin par département, super administrateur, droits opérateur séparés, révocation effective | Configurer les vrais comptes et affectations ; rendre ces droits dans l’interface |
| Console de dossiers | Listes, détails, filtres, dossiers bloqués/terminés, progression, pièces, paiement et provenance reçus de Tooling | Tooling doit publier les snapshots complets et versionnés du pivot ; Interface doit afficher ces données |
| Intervention humaine | Routes de prise en charge, demande de complément, approbation, rejet et reprise ; appel HTTP authentifié et idempotent vers Tooling | Implémenter/configurer le nouvel endpoint Tooling ; il n’est pas configuré dans le `.env` actuel |
| Indicateurs et activité | KPI par département, délai médian, canaux, démarches fréquentes, audit et résolution des questions sans réponse | Des dossiers du pivot doivent alimenter la projection pour obtenir des indicateurs métier représentatifs |
| Documents | Stockage privé, transfert entre services, téléchargement protégé et expiration | Tooling produit et référence les documents ; Interface présente le téléchargement |
| Agent et consentement | Sources contrôlées, réponses vides/malformées reprises, prévention des doubles actions, consentement via catalogue MCP | Raccorder le catalogue et les connecteurs finaux ; poursuivre l’évaluation avec les démarches retenues |
| Audio | Adaptateur de transcription optionnel, vérification des formats et de la propriété | Tester un vrai vocal et prévoir l’information de l’usager ; l’essai Groq réussi concerne le texte et les outils |

Le Backend ne crée pas de décision administrative ou de paiement à la place de Tooling. Les commandes métier sont implémentées côté Backend et testées contre un serveur Tooling synthétique conforme au contrat ; cela ne prouve pas que l’autre équipe a déjà livré son endpoint.

Les routes et formats complets sont dans [le contrat de raccordement](backend-pivot-api.md). Les résultats vérifiés et limites sont dans [l’état de reprise](backend-pivot-status.md).

## 2. Vérifier automatiquement la livraison

Prérequis : dépendances Node installées, PostgreSQL local et Redis de test. Depuis le dossier `assistant-demarches`, sur ce poste :

```sh
export LD_LIBRARY_PATH="$(pwd)/../.backend-runtime/redis/usr/lib/x86_64-linux-gnu"
export REDIS_TEST_BINARY="$(pwd)/../.backend-runtime/redis/usr/bin/redis-server"
node scripts/verify-backend-pivot.mjs
```

Le script reconstruit les services, vérifie les contrats et lance les tests Backend, Tooling et intégration existante. Il affiche `PASS` pour chaque étape et le chemin des rapports. Dans chaque rapport de tests, vérifier `fail 0` **et** `skipped 0`. Un test ignoré n’est pas une preuve de réussite. Les bases sont temporaires et les appels IA synthétiques ; ce contrôle ne lance pas Groq. Les tests de bases externes exigent une base dédiée finissant par `_test`.

Pour inspecter uniquement les nouveaux scénarios départementaux, après compilation :

```sh
node apps/backend/scripts/build.mjs
node --test apps/backend/tests/admin-directory.test.mjs apps/backend/tests/department-work.test.mjs
```

Les libellés détaillent les contrôles : deux ministères dans une conversation, isolation des dossiers/documents/KPI, révocation des droits, événements contradictoires, traitement humain, commandes concurrentes et reprise après réponse distante perdue. Ces tests nettoient leurs données ; ils ne remplissent pas la base de Swagger.

### Essai séparé avec le vrai Groq

Depuis la racine, après le build :

```sh
GROQ_LIVE_TEST=true GROQ_LIVE_MODEL=openai/gpt-oss-20b node --test apps/backend/tests/groq.live.mjs
```

Ce test utilise la clé locale, le vrai modèle et des données/outils fictifs. Il vérifie la salutation, une réponse citant le catalogue et la création d’un seul brouillon autorisé avec son vrai statut. Deux parcours complets ont réussi le 30 octobre. Éviter les répétitions rapprochées : un essai supplémentaire a reçu `429 rate_limit_exceeded`. Aucun dépôt, paiement ou dossier externe réel n’est créé.

## 3. Essayer soi-même dans Swagger

Sur ce poste, `.env` fournit déjà PostgreSQL sur localhost et active l’identité locale de test. PostgreSQL doit tourner. Depuis la racine :

```sh
BACKEND_DEV_AUTH=true HOST=127.0.0.1 PORT=4010 node apps/backend/scripts/dev.mjs
```

Le lanceur charge `.env`, compile, applique les migrations dans la base configurée et démarre l’API. Les créations faites dans Swagger restent dans cette base locale. Il ne démarre pas le worker ni Tooling. Arrêt par Ctrl+C. Si le port 4010 est déjà occupé, arrêter sa propre ancienne session ou choisir un autre port avec `PORT`.

Ouvrir <http://127.0.0.1:4010/docs>, sélectionner **department-admin**, puis cliquer **Tester comme administrateur**. Après changement de contrat, recliquer sur le bouton si l’autorisation n’est plus présente. Déplier une route, **Try it out**, puis **Execute**. Les en-têtes techniques laissés aux valeurs d’exemple sont complétés automatiquement ; une valeur personnalisée reste conservée pour les tests de rejeu.

### Parcours administration — environ dix minutes

1. `GET /v1/admin/me` : attendre **200**, vérifier le sujet et les permissions. Le sujet local non inscrit peut avoir `revision: 0` ; modifier son propre profil demande d’abord une inscription dans l’annuaire.
2. `POST /v1/admin/departments`, avec :

   ```json
   {"id":"justice-recette","name":"Justice — recette","active":true}
   ```

   Attendre **201** et `revision: 1`. Créer un second département en remplaçant par `education-recette` et un autre nom. Si ces IDs existent déjà, les relire ou choisir de nouveaux IDs.
3. `GET /v1/admin/departments` : retrouver les deux départements.
4. `POST /v1/admin/users`, avec :

   ```json
   {
     "subject":"agent-recette",
     "displayName":"Agent de recette",
     "memberships":[{"departmentId":"justice-recette","role":"agent","active":true}]
   }
   ```

   Attendre **201**. Ce sujet est un exemple d’affectation : cette route ne crée ni mot de passe, ni compte OIDC, ni bouton de connexion pour cet agent. Le test d’isolation avec plusieurs identités signées existe dans la suite automatique.
5. `GET /v1/admin/users?departmentId=justice-recette` : retrouver l’affectation. Modifier l’utilisateur par `PUT /v1/admin/users/agent-recette`, avec sa révision actuelle, par exemple `{"revision":1,"displayName":"Agent renommé"}`. Attendre **200** puis une révision augmentée. Réenvoyer l’ancienne révision avec **une nouvelle clé d’idempotence** : attendre **409**. Rejouer la même clé et le même corps retourne au contraire le premier résultat.
6. `GET /v1/admin/work-items?departmentId=justice-recette&status=all` : attendre **200**. Une liste vide est normale tant qu’aucun snapshot de dossier n’a été reçu pour ce département.
7. `GET /v1/admin/dashboard?departmentId=justice-recette`, puis `/v1/admin/activity` et `/v1/admin/unanswered` avec ce même `departmentId` : attendre **200** ; compteurs nuls ou listes vides en l’absence de données métier. L’activité métier n’est pas le journal des créations d’utilisateurs.

Ne pas conclure qu’une liste vide valide le traitement des dossiers. Pour voir les scénarios alimentés dès maintenant, exécuter `department-work.test.mjs` ; pour les manipuler durablement dans Swagger, Tooling doit publier les snapshots décrits dans le contrat de raccordement. Les anciens événements de création ne suffisent pas à alimenter la nouvelle console départementale.

### Conversation et agent

Pour une réponse asynchrone, lancer aussi le worker dans un second terminal, depuis la racine et avec le même environnement :

```sh
node --env-file=.env apps/backend/dist/apps/backend/src/worker.js
```

Redis, un seul modèle actif pour l’administration, ses accès fournisseur et les outils MCP doivent être disponibles. Le bouton de Swagger ne configure pas ces services. Le test Groq séparé ci-dessus reste le moyen reproductible de vérifier le modèle sans dépendre de ce provisioning.

Dans le contrat **conversation**, cliquer **Tester comme usager**, créer une conversation avec `{"channel":"web","locale":"fr"}`, envoyer un message texte avec un nouvel ID `msg_…` et lire ses événements. **202** signifie « message accepté » ; l’événement `message.sent` contient la réponse. Le [guide détaillé du socle](../apps/backend/docs/testing.md) explique ces étapes. Il faut les vrais IDs retournés, un catalogue valide et un mandat explicite pour essayer une création de dossier.

## 4. Ce qui reste à organiser

| Responsable | Prochaine action concrète | Critère de réception |
|---|---|---|
| Équipe Backend / toi | Relire cette recette, conserver les résultats et choisir les démarches de la démo | Liste des scénarios acceptés et anomalies observées |
| Équipe Tooling | Adopter les contrats 1.3.0 : snapshots, commandes humaines, documents, annuaire final et parcours simulé dépôt/paiement/suivi | Un dossier créé dans le chat arrive dans le bon département ; une action agent produit le nouvel état et une notification usager |
| Équipe Interface | Brancher profils, droits, dossiers, KPI, progression et documents aux nouvelles APIs | Le même scénario se réalise dans les écrans, avec indication de simulation |
| Coordination produit | Fixer départements/comptes de démo, étapes et règles de traitement, consentements et durées de conservation | Paramètres partagés et parcours de démonstration cohérent avec les deux assets |
| Déploiement / exploitation | Configurer OIDC, clients de service, API + worker, bases, stockage et capacité Groq ; appliquer migrations 008/009 | Essai complet sur l’environnement de démo, avec compte agent réel et vérification de la limite de débit |

La recette finale entre équipes doit couvrir : un usager et deux départements, refus d’accès croisé, dépôt simulé avec référence, intervention humaine, suivi usager et document privé. Les briques Backend et leurs tests existent ; leur raccordement au travail des autres équipes reste à valider ensemble. L’ancien lanceur `integration/local-stack.mjs` teste le socle avec un modèle scripté ; il n’est pas une démonstration complète du pivot ni un test Groq.
