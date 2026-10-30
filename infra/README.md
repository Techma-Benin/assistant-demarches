# Infrastructure

`backend-dependencies.compose.yml` fournit des dépendances locales facultatives : PostgreSQL 16 et Redis 7, avec ports limités à localhost. Voir `apps/backend/README.md` pour les commandes et la configuration. Il est possible d’utiliser un PostgreSQL local dédié existant.

Le déploiement de test complet reste à assembler : API/worker, Tooling, Interface, OIDC, TLS, stockage chiffré, sauvegardes et supervision. Le fichier Compose ne déploie aucun fournisseur de modèle et ne crée aucune ressource cloud. La CI utilise PostgreSQL 16 et Redis 7 pour les tests synthétiques.
