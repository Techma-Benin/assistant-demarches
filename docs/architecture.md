# Architecture de départ

Un monorepo, trois périmètres d'équipe. Le groupe Interface produit plusieurs exécutables : adaptateur NestJS, widget Next.js et console Next.js. « Trois groupes » ne signifie donc pas exactement trois processus à déployer ; Backend et Tooling sont chacun un service NestJS modulaire.

```text
WhatsApp → adaptateur ─┐
Widget web ───────────┼─ C1 → Backend (conversation, agent, modèles, fichiers, admin)
Console admin ────────┘─ C3 →       │ C2 appels MCP / contrôle mandat séparé
                                  ▼
                           Tooling (mandats, demandes, connecteurs, audit)
                                  │ C4 → Backend → canaux
                                  ▼
                      Portails officiels / XROAD BJ en phase suivante
```

Backend détient conversations, base de connaissances / fiches, fichiers, configuration. Tooling détient demandes, mandats et audit autoritatifs ; le Backend peut conserver une projection des statuts alimentée par C4, jamais écrire dans la base Tooling. Tooling consulte les fiches via une copie validée versionnée ou une API Backend ; aucune connexion SQL croisée. Les API privées Backend de consultation des fiches et de métadonnées de pièces sont définies dans `backend-resources.openapi.json`. Le transfert sécurisé des pièces vers un connecteur institutionnel relève de la phase suivante.

Stack cible du cadre technique : TypeScript, Node 22, NestJS, Next.js, pnpm/Turborepo ; PostgreSQL/pgvector, Redis/BullMQ, stockage S3 compatible, OIDC Keycloak, OpenTelemetry. Les mocks utilisent Node pour rester petits et vérifiables ; ils ne dictent pas l'architecture interne des services.

## Décisions complémentaires au PDF

1. Flux Git `feature → dev → main`, suivant la demande du responsable.
2. C1 crée explicitement une conversation ; identité résolue depuis le jeton.
3. C2 utilise le vrai protocole MCP Streamable HTTP, contexte injecté en en-têtes hors arguments modèle.
4. Cycle de consentement indépendant des outils IA ; contrôle interne authentifié séparément.
5. Phase 1 prépare un lien officiel : pas de faux statut de dépôt.
6. WS à ticket + rejeu des événements ; callback WhatsApp statique, même enveloppe.
7. Demandes et mandats ont un propriétaire unique, Tooling ; pas de double écriture.
8. Les exemples sont intégralement synthétiques ; aucun tarif/délai officiel n'est affirmé.

## Références techniques vérifiées

- [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0.html)
- [SDK MCP TypeScript officiel](https://github.com/modelcontextprotocol/typescript-sdk)
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema)
- [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)

Les quatre PDF source demeurent dans le dossier `docs` du projet parent, hors dépôt : `Cadre_technique_trois_groupes.pdf`, `Plan_travail_parallele.pdf`, `Assistant_WhatsApp_plan_architecture_defis.pdf`, `communique-prix-national-simplification.pdf.pdf`.
