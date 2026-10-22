# Contribution

Branches `interface/…`, `backend/…`, `tooling/…`, `infra/…`, `docs/…` depuis `dev`. PR vers `dev`, puis PR de livraison `dev` vers `main`. Pas de branche permanente par équipe. Commits `feat:`, `fix:`, `docs:`, `chore:`.

Avant PR : `pnpm check`, vérifier les types générés et lire la checklist. Chaque changement de frontière inclut contrat, exemples, simulation et tests dans la même PR. Augmenter `contracts/manifest.json.version` ; rupture = nouveau répertoire v2. Revue par chaque groupe affecté ; sécurité pour consentement, authentification, données et connecteurs. Fusion quotidienne recommandée, branches de deux jours maximum.

Les responsables nominatifs des trois groupes ne sont pas fournis ; `CODEOWNERS` utilise le compte administrateur connu en attendant. Ne pas inventer des équipes GitHub inexistantes. La règle de revue collective reste obligatoire dans la checklist.

Une tâche métier est terminée lorsqu'elle est intégrée, conforme au contrat, testée, documentée et déployée en environnement de test. Le présent socle n'est pas un déploiement de produit.
