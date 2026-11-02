# Contribution

- Branches `interface/…`, `backend/…`, `tooling/…`, `docs/…` créées depuis `dev`, PR vers `dev`. Livraison par PR `dev` → `main`.
- Commits Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), en anglais. Textes d'interface en français.
- Avant une PR : `pnpm check` passe, les types générés sont à jour.
- Un changement de frontière passe d'abord par une PR de contrat (voir [CONTRACTS.md](CONTRACTS.md) §14), relue par les trois équipes.
- Une fonctionnalité est terminée quand elle marche de bout en bout avec `pnpm dev`, sans donnée en dur, avec ses tests.
