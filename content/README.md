# content

## Fiches officielles : `service-public/catalogue.json`

Catalogue du Portail national des services publics ([service-public.bj](https://service-public.bj)), importé depuis son API publique par :

```sh
pnpm catalogue:import
```

- Chaque fiche garde son identifiant officiel (`PS00373`…), son lien public (`https://service-public.bj/public/services/service/<id>`), sa date de collecte (`retrievedAt`) et le texte du portail tel quel : coût, délai, pièces, lieu, horaires, par canal (en ligne, sur place).
- Les liens de canal (sites des ministères, e-services) sont vérifiés à l'import : `urlStatus` vaut `ok`, `broken` (404/410) ou `unreachable`. Seuls les liens `ok` sont montrés aux usagers ; la fiche service-public.bj reste le lien de référence. `unreachableLinks` liste les autres.
- Le X-Road simulé (`apps/xroad-sim`) sert ces fiches : toutes en consultation, quatre en dépôt (voir [CONTRACTS.md](../CONTRACTS.md) §8). Un test compare les démarches déposables à ce fichier.

Relancer l'import avant une démonstration pour avoir les coûts, délais et liens du jour.
