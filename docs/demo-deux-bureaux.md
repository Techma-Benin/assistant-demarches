# Démo « un message, deux bureaux »

À faire par Tooling et Interface, chacun sur **sa** branche. On ramène ensuite leur travail dans `integration/pivot-combo`.

Référence : PowerPoint du 29 octobre, slides 7, 8 et 10. Branche de référence des contrats : `integration/pivot-combo` (commit `38ec092` au 30 octobre 2026). Le détail des routes est dans [backend-pivot-api.md](backend-pivot-api.md).

## La démo à obtenir

1. Dans le chat, un usager demande son casier judiciaire et le dossier est déposé chez nous.
2. On ouvre la console avec un agent de la **Justice** : **En attente (1)**, ce casier, « nouvelle demande, à vérifier ».
3. Le même écran, avec un agent de l’**Enseignement** : **En attente (0)**. Il ne voit pas le dossier de la Justice.
4. Un super admin voit les deux ministères. Même écran, seules les données changent.
5. **Complété** regroupe ce qui est terminé, par l’assistant ou par un agent.

Tout ce qui est simulé doit être affiché comme tel.

## Qui travaille où

| Équipe | Branche à continuer | On récupère ensuite |
|---|---|---|
| Tooling | `tooling/xroad-connector` | merge dans `integration/pivot-combo` |
| Interface | `interface/redesign` | merge dans `integration/pivot-combo` |

Ne pas commiter ce travail sur `integration/pivot-combo`, `main` ou `dev`. Les sous-branches `tooling/xroad-contract`, `tooling/xroad-sim`, `tooling/backend-integration` et `interface/widget-redesign` sont déjà dans les deux branches ci-dessus : continuer sur l’ombrelle, pas à côté.

Les contrats du pivot (files par ministère, snapshots, actions d’agent) sont sur `integration/pivot-combo`. Les implémenter tels quels. Ne pas les réécrire, ne pas remettre `scanStatus`. Le Backend n’appelle pas le X-Road : la console lit la file du Backend.

Identifiants de la simulation, à réutiliser tels quels : `justice`, `enseignement`. Les autres ministères déjà dans `apps/xroad-sim` (`affaires-etrangeres`, `sante`, `interieur`) restent. `interieur` reste « à connecter ».

## Tooling — `tooling/xroad-connector`

Le dépôt dans le X-Road simulé existe. La file du Backend reste vide, parce que le connecteur ne lui envoie pas le dossier au format attendu.

Après chaque dépôt, paiement ou changement d’état, publier un snapshot complet vers `POST /internal/v1/events` :

- type `bj.techma.request.snapshot.v1`, kind `request.snapshot` ;
- `administrationId` du ministère qui traite (`justice` pour le casier) ;
- révision strictement croissante ;
- `simulation: true` et une référence de dépôt (`receiptRef`) ;
- le statut qui alimente l’écran : `submitted`, `processing` ou `blocked` pour **En attente** ; `completed` pour **Complété**.

Le casier de la démo doit **apparaître dans En attente** de la Justice (slide 8 : « nouvelle demande, à vérifier »). Une complétion automatique immédiate rate la démo : l’agent doit d’abord voir le dossier.

Les actions que l’agent déclenche depuis la console arrivent déjà du Backend sur :

`POST /internal/v1/admin/requests/{id}/actions`

Actions : `claim`, `request_information`, `approve`, `reject`, `resume`. Répondre avec le dossier complet et une révision plus haute, puis republier le snapshot. Sans cet endpoint, le bouton de la console n’a rien à appeler.

Critère : un casier déposé dans le chat crée une ligne **En attente** pour `justice`, invisible pour `enseignement`.

## Interface — `interface/redesign`

La console actuelle montre encore l’écran opérateur (modèles, outils, conversations). La démo a besoin de l’écran du PowerPoint, branché sur la file du Backend :

- sélecteur de ministère (Justice, Enseignement, et les autres déjà simulés) ;
- **En attente** : `GET /v1/admin/work-items?departmentId=justice&status=pending` ;
- **Complété** : la même route avec `status=completed` ;
- vue d’ensemble : `GET /v1/admin/dashboard?departmentId=…` ;
- profil et droits : `GET /v1/admin/me`.

Deux sessions de démo suffisent : un agent n’affecté qu’à `justice`, un agent n’affecté qu’à `enseignement`. Le super admin choisit le ministère et peut tous les voir. Pas le texte des conversations dans cet écran : le journal garde les identifiants, pas les messages. Afficher que le dossier est simulé.

Critère : avec les mêmes données, Justice affiche **En attente (1)** et Enseignement **En attente (0)**.

## Ce que le Backend ne refait pas

Les routes de file, de tableau de bord et d’actions sont déjà sur `integration/pivot-combo`. Pour la démo, il reste à créer les départements `justice` et `enseignement` et les deux agents, avec ces identifiants. Ce n’est pas une nouvelle branche Backend.

## Retour

Quand c’est prêt, pousser la branche de l’équipe. On fetch `techma` et on merge `tooling/xroad-connector` puis `interface/redesign` dans `integration/pivot-combo`. On garde les contrats du combo et on prend le code applicatif des deux branches.
