# État du socle initial

## Livré

- Dépôt privé Techma-Benin/assistant-demarches, copie locale dans le sous-dossier `assistant-demarches` du projet parent.
- Branches `main` et `dev`, flux de travail documenté.
- Contrats v1 : OpenAPI 3.1, JSON Schema 2020-12, catalogue des huit outils MCP.
- Schémas des échanges internes pour consentement, fiches, métadonnées de fichiers et événements ; rappel WhatsApp formalisé.
- Types TypeScript générés, client conversation, monorepo pnpm/Turborepo avec emplacements des applications.
- Simulations locales HTTP, MCP Streamable HTTP et WebSocket, récepteur callback de référence et fixtures synthétiques.
- CI GitHub Actions et tests d'intégration positifs / négatifs.
- Backend NestJS : parcours texte C1/C2/C3/C4, identités portail/WhatsApp vérifiées, agent multi-protocoles, worker BullMQ, consentement signé, fichiers privés sans analyse de contenu, adaptateurs de stockage et callbacks. Tests sur PostgreSQL/Redis et fournisseurs synthétiques ; voir `apps/backend/README.md` pour les limites et dépendances.

## Limites de cette livraison

- Le Backend doit encore être validé avec Keycloak, le Tooling, les canaux, des modèles réels et le stockage du déploiement. Les autres dossiers applicatifs restent des emplacements réservés. La transcription/OCR, les traces OpenTelemetry et l'export du journal autoritatif Tooling ne sont pas branchés.
- Les mocks partagent de la mémoire dans un processus et utilisent des jetons publics de test. Ils n'implémentent pas OIDC, TLS, chiffrement, outbox, persistance, audit chaîné, reprise durable ou intégration Meta. Les clés, preuves signées, sauvegardes et déploiements réels restent aux équipes.
- Le simulateur répond avec un texte déterministe fictif ; aucune qualité d'IA ou fiabilité administrative n'est revendiquée. Les 50 questions métier sont à collecter.
- Contrats complétés à partir des documents, à relire par les responsables de chaque groupe ; ce dépôt n'atteste pas leur approbation.
- Les comptes des responsables Interface/Backend/Tooling ne sont pas connus. CODEOWNERS désigne temporairement @billos-e. La règle de revue croisée figure dans la checklist de PR.
- Les protections `main` et `dev` ont été demandées via Composio et refusées par GitHub (403). Elles ne sont donc **pas actives**. Vérifier les permissions de la connexion et l'offre GitHub de l'organisation avant activation.
- Configuration souhaitée : PR obligatoire, au moins une approbation, revue CODEOWNERS, conversations résolues, contrôle `contracts` requis, branche à jour, pas de force-push ni suppression. Le contrôle CI ne bloque pas à lui seul une fusion tant que la protection n'est pas activée.
- L'accès Git local n'est pas authentifié : le jeton gh existant est invalide et l'agent SSH refuse la signature. La publication initiale utilise Composio ; origin reste une URL HTTPS normale, sans secret. Les futures opérations fetch/push du terminal nécessitent une authentification Git locale valide.

## Avant démonstration

Choisir les démarches, implémenter les services et les adaptateurs, renseigner les responsables, activer les protections, déployer l'environnement de test, connecter Meta, charger les fiches sourcées, évaluer l'agent et effectuer la revue sécurité. Ne pas utiliser de données réelles avant le pilote autorisé.
