# Revue du cadre technique

Le PDF donne une répartition exploitable et une intention architecturale. Ses exemples ne sont pas des spécifications suffisantes pour connecter trois implémentations indépendantes.

| Lacune initiale | Décision / livrable |
|---|---|
| Extraits de schémas pseudo-JSON, aucun contrat exécutable | Schémas JSON complets, OpenAPI, catalogue MCP validés |
| Aucun démarrage de conversation | POST explicite, identité du jeton |
| Contexte MCP sans emplacement de transport | En-têtes de service hors arguments modèle |
| Consentement décrit sans échange ni preuve | Challenge, accord, révocation, contrôle privé distinct |
| Retour WS/callback sans enveloppe ni rejeu | CloudEvents, ticket WS, curseur, callback formalisé |
| API Admin sans schémas | Types, pagination, routes de mise à jour |
| Mandats / dossiers attribués de façon ambiguë | Tooling autoritatif, projection Backend |
| Dépôt réel évoqué malgré phase 2 | Statut awaiting_user_validation en phase 1 |
| « Trois services » malgré plusieurs apps Interface | Trois groupes, plusieurs exécutables Interface |
| Versions et règles de fusion générales | Version manifeste, CI et modèle de revue |

Ces décisions complètent le PDF et sont des choix d'implémentation proposés, pas des décisions déjà approuvées par les trois équipes. Les points de déploiement et intégration institutionnelle restent explicitement ouverts dans readiness.md.
