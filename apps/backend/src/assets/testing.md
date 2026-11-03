# Guide de test Backend v2

Scénario 1 : session invitée, conversation, message, événements.
Scénario 2 : connexion Keycloak citizen, attach d’une session invitée (usage unique).
Scénario 3 : MANDATE_MISSING ou MANDATE_EXPIRED → bloc consent, puis POST /mandates (usager connecté).
Scénario 4 : dépôt simulé, requestCard / fileRequest / case.updated.
Scénario 5 : console official `/v1/admin/*` et opérateur `/v1/operator/*`.
