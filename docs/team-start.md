# Démarrer sans attendre les autres équipes

Exécuter d'abord les commandes du README. `pnpm mocks` lance les deux serveurs fictifs. Le test `tests/integration.test.mjs` donne des exemples complets d'appels HTTP, client MCP officiel et WebSocket.

## Interface

Créer `interface/<tache>` depuis `dev`. Utiliser le client partagé pour la conversation ou les types OpenAPI directement. Brancher les vues au port 4010 avec `mock-user` ; console avec `mock-admin`. Ne jamais mettre de jeton de service dans le navigateur. Commencer par la conversation texte, le rendu des cinq blocs, puis fichiers, tickets WS / reprise et consentement. L'adaptateur reçoit les rappels C4, les acquitte/déduplique et envoie à Meta ; toute vérification Meta reste dans l'adaptateur. Écrire les tests du récepteur callback avant l'envoi réel.

## Backend

Créer `backend/<tache>`. Implémenter les routes C1 et C3 ainsi que l'ingestion C4, en reprenant strictement les schémas. Tester d'abord l'orchestration déterministe contre le serveur MCP mock du port 4020. Le client MCP officiel des tests montre le transport et les en-têtes. Séparer le client `backend-agent` du client de contrôle des mandats dès le départ. Aucun accès direct aux portails administratifs ; appels fournisseur de modèle via son adaptateur dédié.

## Tooling

Créer `tooling/<tache>`. Reprendre le catalogue C2, les routes privées et la propriété des demandes/mandats. Commencer par recherche/lecture sur contenu synthétique, puis actions avec contrôle de propriété et de mandat. Émettre les événements C4 et un journal d'action durable. Les fichiers ne passent que comme références opaques ; l'API privée de contrôle des fichiers est définie dans backend-resources.openapi.json et doit être implémentée par Backend avant traitement réel.

## Remplacer une simulation

1. Garder le même contrat et les mêmes fixtures.
2. Démarrer le service réel sur une URL libre.
3. Exécuter les tests de conformité avec `BACKEND_UNDER_TEST` et `TOOLING_UNDER_TEST` ; ils doivent viser un environnement synthétique configuré pour les identités de test documentées, jamais un serveur de production. Sans ces variables, les tests démarrent et arrêtent leurs propres mocks.
4. PR vers `dev`, relecture du groupe consommateur, CI verte, déploiement de test.

Les tests actuels attestent le scénario de référence et les échecs critiques ; ils ne constituent pas une certification de sécurité ou une couverture complète du produit.
