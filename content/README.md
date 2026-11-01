# content

## Fiches officielles : `service-public/catalogue.json`

Catalogue du Portail national des services publics ([service-public.bj](https://service-public.bj)), importé depuis son API publique par :

```sh
node scripts/import-service-public.mjs
```

- Chaque fiche garde son identifiant officiel (`PS00373`…), son lien public (`https://service-public.bj/public/services/service/<id>`), sa date de collecte (`retrievedAt`) et le texte du portail tel quel : coût, délai, pièces, lieu, horaires, par canal (en ligne, sur place).
- Les liens de canal (sites des ministères, e-services) sont vérifiés à l'import : `urlStatus` vaut `ok`, `broken` (404/410) ou `unreachable`. Seuls les liens `ok` sont montrés aux usagers ; la fiche service-public.bj reste toujours le lien de référence. `unreachableLinks` liste les autres, à signaler au portail.
- Le X-Road simulé (`apps/xroad-sim`) sert ces fiches à l'agent : toutes en consultation, quatre en dépôt simulé (`FILINGS` dans `apps/xroad-sim/src/data.ts`), vérifiées contre ce fichier par `apps/xroad-sim/test/catalogue.test.ts`.

Relancer l'import avant une démonstration pour avoir les coûts, délais et liens du jour ; le test du catalogue signale toute démarche déposable dont la fiche officielle a changé.

## Fixtures de test

`mocks/fixtures.json` reste un jeu de données de test (fiche `demo-procedure`) pour les tests unitaires et le serveur de mocks. Il ne sert pas aux démonstrations : utiliser la vraie pile (`pnpm dev:slide8`).
