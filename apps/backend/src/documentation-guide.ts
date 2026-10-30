/** Documentation overlay only: the shared wire contracts remain unchanged. */
export const traceExample = "00-12345678901234567890123456789012-1234567890123456-01";
const suffix = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
export const examples: Record<string, any> = {
  ConversationInput: { channel: "web", locale: "fr" },
  MessageInput: { id: `msg_${suffix}`, content: { type: "text", text: "Quels documents faut-il pour cette démarche ?" }, sentAt: "2026-10-26T12:00:00.000Z" },
  ChallengeInput: { procedureId: "demo-procedure", scopes: ["requests:write", "documents:write"] },
  Consent: { challengeId: `chl_${suffix}`, accepted: true },
  ModelConfig: { id: "primary", provider: "openai", model: "REPLACE_WITH_AVAILABLE_MODEL_ID", promptVersion: "agent-v1", temperature: 0.2, active: true },
  ToolConfig: { name: "procedures.get", enabled: true, serverUrl: "http://127.0.0.1:4030/mcp", secretRef: "backend-agent" },
  Procedure: { id: "demo-procedure", title: "Démarche fictive de test", administrationId: "demo-administration", summary: "Exemple technique sans valeur administrative.", requiredDocuments: ["Document fictif"], feeFcfa: 0, processingDays: 1, source: { procedureId: "demo-procedure", url: "https://example.com/demo-procedure", retrievedAt: "2026-10-26T12:00:00.000Z", version: "demo-v1" }, validationStatus: "draft", formSchema: {} },
  Event: { specversion: "1.0", id: `evt_${suffix}`, source: "urn:techma:tooling", type: "bj.techma.request.created.v1", time: "2026-10-26T12:00:00.000Z", datacontenttype: "application/json", traceparent: traceExample,
    data: { kind: "request.created", request: { id: `req_${suffix}`, conversationId: `cnv_${suffix}`, userRef: `usr_${suffix}`, procedureId: "demo-procedure", status: "draft", fields: {}, fileIds: [], officialLink: null, updatedAt: "2026-10-26T12:00:00.000Z" } } },
};

type Help = { summary: string; tag: string; before: string; action: string; expected: string; next: string; errors: string };
const help = (summary: string, tag: string, before: string, action: string, expected: string, next: string, errors: string): Help => ({ summary, tag, before, action, expected, next, errors });
const user = "JWT usager du portail (Authorize), même usager pour toute la séquence. Un jeton admin est refusé sur ce parcours.";
const owner = user + " Utiliser une conversation créée par cet usager ; remplacer les identifiants fictifs par les valeurs reçues.";
const readAdmin = "JWT administrateur avec administrationId et admin:read. Les données sont limitées à cette administration.";
const writeAdmin = "JWT administrateur avec administrationId et admin:write. Pour un PUT, commencer par le GET de la ressource existante.";
const internal = "JWT du client tooling-resources, scope resources:read. Appel réservé au Tooling ; un jeton usager/admin ne convient pas.";
export const operationHelp: Record<string, Help> = {
  createConversation: help("1. Créer une conversation", "Conversations", user, "Choisir web pour le test manuel, locale fr. Fournir traceparent et une nouvelle Idempotency-Key. Le canal doit correspondre à l’identité : whatsapp nécessite le relais vérifié de l’équipe Interface.", "201 : objet Conversation. Copier son id ; userRef est attribué par le Backend, jamais saisi dans ce corps.", "Utiliser id dans sendMessage, puis listConversationEvents. Ne crée pas de demande administrative.", "400 : corps/en-tête invalide ; 401 : JWT ; 403 : identité ou canal incompatible."),
  sendMessage: help("2. Envoyer un message à l’agent", "Conversations", owner, "Renseigner conversationId, puis le corps exemple. Changer id (msg_ + 26 caractères ULID) et Idempotency-Key pour un nouveau message. sentAt est une date ISO. Pour un rejeu, conserver exactement corps et clé. Les variantes content acceptent aussi fileId ou une interaction ; voir Schema.", "202 avec status accepted : message enregistré et mis en attente. Ce n’est pas encore la réponse IA. Une réutilisation incohérente d’un message est refusée.", "Lire listConversationEvents. La réponse nécessite worker, Redis, modèle actif et outils configurés. STOP suspend les actions ; HISTORIQUE consulte celles de la conversation. Audio/OCR non branchés.", "400 : format ; 403/404 : propriétaire ou conversation ; 409 : rejeu différent ; une pièce doit exister, être non expirée et appartenir à l’usager."),
  listConversationEvents: help("3. Lire les événements et la réponse", "Conversations", owner, "Premier appel : laisser cursor vide. Les appels suivants reprennent nextCursor de la dernière page. Cliquer Execute de nouveau pour interroger le journal ; ce GET ne lance pas le worker.", "200 : items et nextCursor. Chercher bj.techma.message.received.v1 puis bj.techma.message.sent.v1. Une page vide n’est pas une erreur.", "Poursuivre avec nextCursor ou demander un ticket WebSocket. Si aucune réponse : vérifier worker/Redis/modèle et leurs logs. Journal conservé 48 h.", "410 : curseur expiré/introuvable, reprendre sans cursor ; 403/404 : accès à la conversation."),
  createSocketTicket: help("Obtenir un ticket de connexion WebSocket", "Temps réel", owner, "Fournir une nouvelle Idempotency-Key. Ce POST crée seulement un ticket ; Swagger ne se connecte pas au WebSocket.", "201 : ticket, expiresAt et url. Ticket court, à usage unique ; ne pas le partager.", "Dans un client WebSocket, ouvrir directement url, qui contient déjà ticket ; ajouter éventuellement &cursor=<nextCursor> en encodant la valeur. L’Origin doit être autorisée dans CORS_ALLOWED_ORIGINS. Demander un nouveau ticket pour chaque connexion ; fermeture au plus tard à expiration du JWT.", "401 à la connexion : ticket expiré/utilisé ou Origin non autorisée ; 410 en relecture HTTP : curseur expiré."),
  createMandateChallenge: help("1. Préparer une demande de consentement", "Consentement", owner + " Fiche validée existante, clé de signature configurée.", "Remplacer demo-procedure par son identifiant réel. Choisir uniquement les scopes nécessaires : requests:write, documents:write, requests:submit. Nouvelle clé d’idempotence.", "201 : Challenge avec id, consentText, proofToken, expiresAt. Expiration locale : 5 minutes. Aucun accord n’est encore donné.", "Présenter consentText à l’usager. Après son accord explicite seulement, transmettre id à grantMandate. Ne jamais demander le SMS officiel ici ni exposer proofToken au modèle.", "404 : fiche absente/non validée dans l’administration ; 503 : signature non configurée."),
  grantMandate: help("2. Enregistrer un accord explicite", "Consentement", owner + " Challenge non expiré et non consommé, accord réel de l’usager, contrôle Tooling opérationnel.", "Remplacer challengeId par le id du challenge reçu. accepted doit être true. Ce clic autorise réellement les scopes demandés ; ne pas l’utiliser comme simple consultation.", "201 : MandateGrant. Le Tooling reste l’autorité sur le mandat ; conserver son identifiant pour une révocation.", "Continuer le parcours agent. Pour retirer l’accord, appeler revokeMandate. La validation officielle et le code SMS restent sur le portail.", "403 : challenge incompatible/expiré/consommé ; 503 : contrôle Tooling ou signature indisponible."),
  revokeMandate: help("3. Retirer une autorisation", "Consentement", owner + " Mandat réel de cette conversation, contrôle Tooling disponible.", "Renseigner conversationId et mandateId retournés lors de l’accord, puis une nouvelle Idempotency-Key. Pas de corps JSON.", "200 : résultat de révocation. Ne supprime pas la conversation ni les fichiers et n’annule pas automatiquement une action déjà exécutée.", "Consulter les événements. STOP constitue aussi une commande conversationnelle de suspension ; sa révocation distante nécessite le worker.", "403/404 : mauvais propriétaire ou mandat ; 503 : contrôle Tooling indisponible."),
  getRequest: help("Consulter l’état d’une demande administrative", "Demandes", user + " Une demande doit déjà avoir été créée par un outil/événement et projetée dans le Backend.", "Copier requestId depuis les événements de la conversation. Ne pas utiliser conversationId à sa place.", "200 : Request avec status, fields, fileIds et officialLink si disponible. C’est une projection locale des informations du Tooling.", "Si awaiting_user_validation, suivre le lien officiel pour la validation. Relire après un nouvel événement de statut ; ce GET ne soumet aucune démarche.", "404 : demande absente/non visible ; vérifier l’identifiant et l’usager."),
  uploadFile: help("Déposer une pièce jointe", "Fichiers", user + " Stockage configuré ; aucune analyse antivirus ou du contenu.", "Choisir un fichier de 10 Mio maximum. Corps binaire application/octet-stream, pas multipart/form-data. X-File-Mime-Type indique le MIME déclaré parmi les valeurs proposées. Nouvelle clé d’idempotence.", "201 : File, son identifiant et sa date d’expiration. Pièce utilisable immédiatement ; aucune conversation n’est modifiée par l’upload seul.", "Envoyer un MessageInput avec content {type: file, fileId: <id reçu>}. Pas de téléchargement ou GET public de fichier en v1 ; métadonnées internes réservées au Tooling. Expiration 24 h, pas de transcription/OCR ni validation administrative du contenu.", "413 : plus de 10 Mio ; 415 : mauvais type/MIME déclaré ; 503 : stockage indisponible."),
  listAdminModels: help("Lister les modèles configurés", "Modèles", readAdmin, "Laisser cursor vide et limit à 20 au premier appel. Cette route consulte les configurations en base, pas le catalogue du fournisseur IA.", "200 : items et nextCursor ; items vide si aucun provisioning dans cette administration.", "Copier un objet existant pour updateAdminModels. Un seul modèle doit être actif par administration. Liste vide : créer avec createAdminModels.", "401 : JWT ; 403 : administration/scope manquant ; 400 : pagination."),
  updateAdminModels: help("Modifier un modèle existant", "Modèles", writeAdmin, "Copier l’objet complet depuis listAdminModels ; id du chemin identique au id du corps. provider = entrée de MODEL_PROVIDERS_JSON ; model = identifiant disponible ; promptVersion = prompt installé. temperature entre 0 et 2. Nouvelle clé d’idempotence.", "200 : configuration enregistrée. Ce PUT ne crée pas de modèle et ne teste pas l’accès au fournisseur.", "Refaire GET puis tester une nouvelle conversation/message avec le worker. Les traitements commencés conservent leur configuration. Ne pas activer plusieurs modèles pour la même administration.", "404 : modèle absent ; 400 : objet/id invalide ; 409 : clé réutilisée avec un autre corps."),
  listAdminTools: help("Lister les outils MCP configurés", "Outils MCP", readAdmin, "Pagination cursor/limit ; ne découvre pas automatiquement les outils d’un serveur MCP externe.", "200 : ToolConfigPage. enabled indique si l’agent peut utiliser l’outil.", "Copier un outil pour updateAdminTools. Liste vide : créer une configuration avec createAdminTools.", "401/403 : identité/droits ; 400 : pagination."),
  updateAdminTools: help("Modifier ou activer un outil MCP existant", "Outils MCP", writeAdmin + " Serveur MCP autorisé côté déploiement.", "id du chemin = name de l’outil (ex. procedures.get). Envoyer l’objet complet : name, enabled, serverUrl, secretRef. URL dans MCP_ALLOWED_URLS ; secretRef est une référence de secret serveur, jamais le secret lui-même.", "200 : outil modifié. Ne crée ni ne supprime un serveur MCP. Une configuration sauvegardée ne prouve pas que le serveur répond.", "Refaire GET, puis un essai agent nécessitant cet outil avec les credentials de service configurés.", "400 : outil/URL/référence invalide ou destination refusée ; 404 : outil absent ; 409 : idempotence."),
  listAdminProcedures: help("Lister les fiches de démarches", "Fiches de démarches", readAdmin, "Pagination cursor/limit. Les fiches de configuration peuvent être draft ou validated.", "200 : ProcedurePage ; une liste vide signifie qu’aucune fiche n’a été provisionnée pour cette administration.", "Créer avec createAdminProcedures ou copier une fiche pour updateAdminProcedures. Seules les fiches validated sont exposées par les ressources privées.", "401/403 : identité/droits ; 400 : pagination."),
  updateAdminProcedures: help("Modifier et valider une fiche existante", "Fiches de démarches", writeAdmin, "Copier une fiche complète : id, administrationId, title, summary, requiredDocuments, feeFcfa, processingDays, source, validationStatus, formSchema. Conserver les vrais identifiants et la bonne administration. L’exemple est fictif, draft et sans valeur administrative.", "200 : fiche enregistrée. Passer à validated seulement après vérification métier des informations et de la source.", "Refaire GET ; une fiche validée devient lisible au Tooling. Pas de création par PUT.", "400 : schéma/id/administration incohérent ; 404 : fiche absente ; 409 : conflit/idempotence."),
  listAdminConversations: help("Lister les conversations de l’administration", "Supervision", readAdmin, "Premier appel sans cursor, limit entre 1 et 100.", "200 : ConversationPage. Cette liste ne remplace pas le journal des messages et ne confère pas l’identité usager pour les routes de conversation.", "Utiliser nextCursor pour poursuivre. Pour tester les messages d’un usager, repasser à son JWT dans le contrat conversation.", "401/403 : identité/droits ; 400 : pagination."),
  listAdminAudit: help("Consulter l’audit local de configuration", "Supervision", readAdmin, "Pagination cursor/limit. Effectuer un POST, PUT ou DELETE de configuration pour produire une entrée locale.", "200 : AuditEntryPage. Couvre les changements de configuration locaux ; ce n’est pas l’audit métier autoritatif du Tooling.", "Vérifier l’entrée après une modification, puis utiliser nextCursor pour poursuivre.", "401/403 : identité/droits ; 400 : pagination."),
  getAdminMetrics: help("Consulter les indicateurs de l’administration", "Supervision", readAdmin, "Fournir traceparent. Pas de corps, de cursor ni de limit.", "200 : Metrics calculées pour l’administration du JWT. Ces indicateurs décrivent l’activité locale et ne vérifient pas la disponibilité des services externes ; voir les champs du schéma.", "Comparer après des opérations réelles ; consulter les logs pour diagnostiquer un fournisseur ou worker.", "401/403 : identité/droits ; 503 : dépendance indisponible."),
  ingestEvent: help("Publier un événement métier depuis le Tooling", "Intégration Tooling", "JWT tooling-events avec events:publish. Conversation/propriétaire existants et cohérents. Ce n’est pas une route d’émission de messages usager.", "Utiliser une enveloppe CloudEvent complète. Remplacer les identifiants synthétiques par les vrais. source urn:techma:tooling ; type et data.kind doivent correspondre. Un nouvel événement reçoit un nouvel id evt_ et une nouvelle Idempotency-Key ; un rejeu conserve les mêmes données.", "202 : événement pris en compte/dédupliqué dans le journal et les projections locales. Les événements acceptés concernent les demandes et mandats du Tooling.", "Lire les événements de la conversation avec son JWT usager ou consulter getRequest. Ne pas utiliser cet appel pour contourner un mandat.", "400 : schéma/source/type incohérent ; 401/403 : client/scope/propriétaire ; 404 : ressource inconnue ; 409 : rejeu contradictoire."),
  searchPublishedProcedures: help("Chercher des fiches validées par titre", "Ressources Tooling", internal, "Renseigner query avec une partie du titre (ex. naissance). Recherche par sous-chaîne insensible à la casse ; 100 résultats maximum dans cette implémentation.", "200 : items et nextCursor null. Les fiches draft sont exclues ; une liste vide est normale si aucun titre validé ne correspond.", "Utiliser l’id d’une fiche retournée dans getPublishedProcedure.", "400 : query absent/vide ou trop long ; 401/403 : identité/scope."),
  getPublishedProcedure: help("Lire une fiche validée", "Ressources Tooling", internal, "Utiliser procedureId retourné par la recherche ou connu du catalogue. Ce champ n’est pas un identifiant de conversation.", "200 : Procedure validée et sa source.", "Le Tooling peut s’en servir pour informer/préparer la démarche. Ne pas traiter une fiche fictive comme une procédure officielle.", "404 : fiche absente ou encore draft ; 401/403 : identité/scope."),
  getFileAccess: help("Lire les métadonnées d’une pièce jointe", "Ressources Tooling", internal + " Fichier existant et propriétaire connu.", "Renseigner fileId retourné par uploadFile et X-User-Ref exact de son propriétaire (userRef de la conversation). Ne jamais deviner un propriétaire.", "200 : FileAccess, métadonnées et date d’expiration. Cette réponse n’est pas le contenu binaire ni un lien public de téléchargement.", "Utiliser une référence appartenant à l’usager et non expirée. Aucune analyse du contenu.", "400 : X-User-Ref manquant ; 404/403 : fichier/propriétaire ; fichier expiré non utilisable ; 503 : stockage absent."),
};

for (const [suffix, tag, label] of [["Models", "Modèles", "modèle"], ["Tools", "Outils MCP", "outil MCP"], ["Procedures", "Fiches de démarches", "fiche de démarche"]]) {
  operationHelp[`createAdmin${suffix}`] = help(`Créer un ${label}`, tag, writeAdmin,
    "Envoyer l’objet complet avec un nouvel id (name pour un outil), traceparent et une nouvelle Idempotency-Key. Utiliser l’administration de son JWT. Serveur MCP autorisé et références de secrets uniquement.",
    "201 : configuration créée. Un identifiant existant donne 409 INVALID_TRANSITION. Un rejeu identique avec la même clé ne crée rien de plus.",
    "Lire le GET détail. Modèle : fournisseur/prompt déjà supportés, un seul actif. Outil : doit exister au serveur. Fiche : valider après vérification métier.",
    "400 : corps/en-tête ; 403 : droits, administration ou serveur MCP non autorisé ; 409 : collision ou idempotence.");
  operationHelp[`getAdmin${suffix}`] = help(`Lire un ${label}`, tag, readAdmin,
    "Renseigner l’identifiant retourné par POST ou GET collection, sans corps.", "200 : configuration complète de cette administration.",
    "Modifier via PUT ou supprimer via DELETE. Ne pas confondre une fiche de démarche et un dossier usager.", "404 : absent ou autre administration ; 401/403 : identité/droits.");
  operationHelp[`deleteAdmin${suffix}`] = help(`Supprimer un ${label}`, tag, writeAdmin,
    "Renseigner l’identifiant et une nouvelle Idempotency-Key, sans corps. Les dossiers et l’audit sont conservés. Une fiche référencée localement (demande/mandat/challenge) ne peut pas être supprimée.",
    "204 sans corps. Même clé pendant 24 h : rejoue 204, sans supprimer une éventuelle recréation. Autre clé sur ressource absente : 404.",
    "GET détail donne 404. Remplacer les configurations nécessaires avant suppression : retirer le dernier modèle actif ou un outil peut rendre les prochains traitements indisponibles. Les références Tooling non projetées ne sont pas détectables ; éviter de supprimer une fiche utilisée.",
    "400 : clé/corps ; 403 : droits ; 404 : absent ; 409 INVALID_TRANSITION : fiche référencée.");
}

for (const [id, title] of Object.entries({listAdminMcpServers:"Lister les serveurs MCP",createAdminMcpServer:"Ajouter un serveur MCP",getAdminMcpServer:"Consulter un serveur MCP",updateAdminMcpServer:"Modifier un serveur MCP",deleteAdminMcpServer:"Supprimer un serveur MCP",discoverAdminMcpServer:"Découvrir les actions MCP",listAdminMcpTools:"Lister les actions d’un serveur MCP",updateAdminMcpToolPermission:"Autoriser ou désactiver une action MCP"})) {
 operationHelp[id]=help(title,"Serveurs MCP",id.startsWith("list")||id.startsWith("get")?readAdmin:writeAdmin,
 "Créer une connexion avec id, name, url, enabled, transport=streamable-http, auth et policy=generic. Les URL doivent être autorisées au déploiement. Utiliser uniquement des références de secrets. Découvrir les actions puis activer celles souhaitées ; leurs noms et schémas viennent du serveur.",
 "Connexion ou actions de cette administration uniquement. Nouvelles actions désactivées par défaut ; requiresMandate=true par défaut. Le PUT permission ne reçoit que enabled et requiresMandate. Suppression : 204.",
 "Découvrir après ajout, choisir les permissions, puis utiliser l’agent. Changer URL/auth/policy invalide les actions ; un changement de schéma exige une nouvelle activation. Une désactivation est revérifiée avant chaque appel.",
 "400 : configuration/auth non supportée ; 403 : URL ou droits ; 404 : connexion/action absente ; 409 : conflit ; 503 : serveur MCP, authentification ou découverte indisponible. OAuth interactif et stdio non pris en charge.");
}
examples.McpServer={id:"service-public",name:"Service public",url:"https://mcp.example.org/mcp",enabled:true,transport:"streamable-http",auth:{type:"none"},policy:"generic"};
examples.McpToolPermission={enabled:true,requiresMandate:true};

for (const [id, entry] of Object.entries(operationHelp)) {
  if (id.endsWith("AdminTools")) {
    entry.tag = "Ancienne configuration MCP (dépréciée)";
    entry.summary += " — déprécié";
    entry.before = "Compatibilité avec les anciens clients uniquement. Pour les nouveaux clients, utiliser le groupe Serveurs MCP : connexion, découverte, permissions. " + entry.before;
  }
}

const intro = `**Avant le premier essai :** Swagger envoie de vraies requêtes, y compris les modifications. [Lire le guide complet et les cinq scénarios](/docs/guide).

1. Cliquer **Authorize** et saisir un **access token JWT valide**, puis **Try it out → Execute** dans la route choisie. Une valeur d’exemple n’est pas une ressource créée.
2. **Identité :** le JWT doit provenir du portail/fournisseur configuré par OIDC_ISSUER et OIDC_JWKS_URL, audience techma-backend. L’API n’émet pas de jetons ; mock-user et mock-admin ne sont pas acceptés. Sans fournisseur d’identité et jeton, les tests authentifiés restent bloqués.
3. **En-têtes :** traceparent est prérempli pour un essai ; Idempotency-Key doit changer pour chaque nouvelle opération (garder la même clé et le même corps pour un rejeu).
4. **En local :** pnpm dev lance l’API et ses migrations. Il ne lance ni Redis, ni le worker, ni Keycloak, ni le Tooling. Une réponse IA exige aussi un modèle actif et configuré. [Vérifier uniquement l’API et la base](/health).

**Erreurs fréquentes :** 400 = données/en-têtes invalides ; 401 = jeton ; 403 = droits/propriétaire ; 404 = ressource réelle manquante ; 409 = conflit de rejeu ; 410 = curseur expiré ; 413/415 = fichier ; 503 = dépendance/configuration. Lire detail dans Server response. Authorize ne valide pas à lui seul le jeton.`;
const flow: Record<string, string> = {
  conversation: "**Parcours :** createConversation (201) → sendMessage (202 : enregistré, pas encore répondu) → listConversationEvents (200). Même JWT usager pour toute la séquence. Les mandats et fichiers ont leurs propres prérequis décrits dans les routes.",
  admin: "**Parcours :** JWT admin avec administrationId et admin:read pour GET, admin:write pour POST/PUT/DELETE. POST crée, GET collection/détail consulte, PUT remplace une ressource existante, DELETE supprime uniquement la configuration. Une fiche référencée localement est protégée (409).",
  events: "**Réservé au Tooling :** JWT de service tooling-events, scope events:publish. Ces appels modifient les projections locales ; ils ne simulent pas une conversation utilisateur.",
  "backend-resources": "**Réservé au Tooling :** JWT de service tooling-resources, scope resources:read. Fiches validées et métadonnées de fichiers ; pas d’accès public aux pièces.",
};
const parameterDescriptions: Record<string, string> = {
  traceparent: "En-tête technique de traçage W3C requis. Exemple fourni pour un essai ; générer une nouvelle trace pour un essai distinct. Ne pas y mettre de données personnelles.",
  "Idempotency-Key": "8–128 caractères. Nouvelle clé pour une nouvelle opération ; même clé + même corps pour réessayer sans doublon. Changer le corps avec la même clé peut produire 409.",
  conversationId: "Copier id retourné par createConversation, avec le même JWT usager. L’exemple est fictif et ne crée aucune conversation.",
  requestId: "Identifiant d’une demande déjà créée, récupéré depuis les événements. Différent du conversationId.",
  mandateId: "Identifiant réel du mandat retourné par grantMandate, dans cette conversation.",
  fileId: "Identifiant réel retourné par uploadFile ; respecter le propriétaire et l’expiration.",
  procedureId: "Identifiant réel d’une fiche validated ; obtenu par la recherche ou le catalogue provisionné.",
  id: "Identifiant d’une ressource existante obtenue par GET ; pour un outil, utiliser son name. PUT remplace l’objet complet.",
  cursor: "Facultatif au premier appel : laisser vide. Ensuite recopier nextCursor de la dernière page, sans le modifier.",
  limit: "Nombre d’éléments par page : 1 à 100, 20 par défaut.",
  query: "Partie du titre d’une démarche validée ; recherche insensible à la casse.",
  "X-User-Ref": "userRef exact du propriétaire du fichier ; obtenu dans sa conversation. Ce n’est pas le sub du JWT ni un numéro de téléphone.",
  "X-File-Mime-Type": "MIME d’origine du fichier, choisi dans l’enum. Le corps HTTP reste application/octet-stream, pas multipart/form-data.",
};
Object.assign(operationHelp, {
  getRequestProgress: {tag:"Suivi",summary:"Lire les étapes et sources du dossier",before:"JWT de l’usager propriétaire et identifiant de dossier projeté.",action:"GET avec l’identifiant retourné par les outils.",expected:"Étapes, informations et preuves de source du dossier ; aucune affectation interne.",next:"Afficher le panneau vos informations.",errors:"404 si autre usager ou dossier absent."},
  downloadCitizenDocument: {tag:"Documents",summary:"Télécharger son document délivré",before:"JWT propriétaire et fileId présent dans les documents du dossier.",action:"GET avec les identifiants du dossier et du document.",expected:"Octets privés en téléchargement ; aucun lien public durable.",next:"Conserver la référence de dossier pour le suivi.",errors:"404 si absence, autre propriétaire ou expiration."},
  downloadConnectorFile: {tag:"Ressources internes",summary:"Transférer une pièce au connecteur",before:"Client tooling-documents, scope documents:transfer, X-User-Ref signé par le service appelant.",action:"GET authentifié ; ne jamais transmettre ces octets au modèle conversationnel.",expected:"Pièce privée non expirée.",next:"Le connecteur traite le dépôt conformément au mandat.",errors:"401/403 si identité inadéquate ; 404 si propriété ou expiration incompatible."},
  uploadIssuedDocument: {tag:"Ressources internes",summary:"Stocker un document délivré",before:"Client tooling-documents, scope documents:transfer et dossier projeté existant.",action:"POST binaire avec X-User-Ref, X-File-Mime-Type et Idempotency-Key.",expected:"File privé, conservation dédiée (30 jours par défaut démo).",next:"Publier un snapshot Tooling qui référence le fileId dans documents.",errors:"404 si propriétaire incompatible ; 413/415 si taille ou format refusé."}
});
const parameterExamples: Record<string, unknown> = { traceparent: traceExample, conversationId: `cnv_${suffix}`, requestId: `req_${suffix}`, mandateId: `mdt_${suffix}`, fileId: `fil_${suffix}`, "X-User-Ref": `usr_${suffix}`, procedureId: "demo-procedure", query: "naissance", limit: 20, "X-File-Mime-Type": "application/pdf" };

export function describeSpecification(name: string, specification: any) {
  const spec = structuredClone(specification);
  spec.servers = [{ url: "/", description: "Backend courant (les essais peuvent modifier la base)" }];
  spec.info.description = `${flow[name]}\n\n${intro}`;
  spec.components.securitySchemes.bearerAuth.description = "Coller uniquement l’access token JWT signé par le fournisseur configuré. Swagger ajoute Bearer. Le rôle dépend du contrat : usager, admin ou service Tooling ; aucun token universel n’est livré. Voir le guide /docs/guide.";
  const tags = new Set<string>();
  for (const methods of Object.values(spec.paths) as any[]) for (const [method, operation] of Object.entries(methods) as [string, any][]) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const h = operationHelp[operation.operationId];
    if (!h) throw new Error(`Missing endpoint documentation: ${operation.operationId}`);
    tags.add(h.tag);
    operation.tags = [h.tag];
    operation.summary = h.summary;
    operation.description = `**Prérequis**\n\n${h.before}\n\n**Comment tester**\n\n${h.action}\n\n**Résultat attendu**\n\n${h.expected}\n\n**Suite du parcours**\n\n${h.next}\n\n**Erreurs à vérifier**\n\n${h.errors}`;
    for (const p of operation.parameters ?? []) {
      p.description = parameterDescriptions[p.name] ?? p.description;
      if (p.name === "Idempotency-Key") p.example = `manual-${operation.operationId}-001`;
      else if (parameterExamples[p.name] !== undefined) p.example = parameterExamples[p.name];
    }
    if (operation.parameters?.some((p: any) => p.name === "id")) {
      operation.parameters.find((p: any) => p.name === "id").example = operation.operationId.includes("Mcp") ? "service-public" : operation.operationId.includes("Models") ? "primary" : operation.operationId.includes("Tools") ? "procedures.get" : "demo-procedure";
    }
    for (const media of Object.values(operation.requestBody?.content ?? {}) as any[]) {
      const schemaName = media.schema?.$ref?.split("/").at(-1);
      if (examples[schemaName]) media.example = examples[schemaName];
    }
    for (const [code, response] of Object.entries(operation.responses) as [string, any][]) {
      response.description = code === "default" ? "Erreur au format Problem : lire status, code, detail et traceId. Voir les erreurs expliquées dans cette route et dans le guide." : h.expected;
    }
  }
  const fields: Record<string, Record<string, string>> = {
    ConversationInput: { channel: "web pour le test Swagger avec un JWT portail ; whatsapp nécessite le relais vérifié.", locale: "Langue demandée : fr, fon ou yo. Choisir fr pour le premier essai." },
    MessageInput: { id: "Identifiant client unique : msg_ + 26 caractères ULID. Nouveau pour chaque nouveau message, stable pour un rejeu.", content: "Texte, référence de fichier privé non expiré ou interaction : choisir une variante du schéma.", sentAt: "Date ISO 8601 avec fuseau, par exemple 2026-10-26T12:00:00.000Z." },
    ModelConfig: { id: "Identifiant fourni à la création, identique au chemin PUT.", provider: "Nom dans MODEL_PROVIDERS_JSON côté serveur.", model: "Identifiant réel chez le fournisseur ; remplacer le placeholder.", promptVersion: "Version installée ; agent-v1 est livrée.", temperature: "De 0 à 2 ; peut être omise dans l’appel IA selon le profil du fournisseur.", active: "Un seul modèle actif par administration pour les traitements." },
    ToolConfig: { name: "Nom d’outil du catalogue v1 ; sert aussi d’identifiant au chemin PUT.", enabled: "Autoriser cet outil pour l’agent.", serverUrl: "Endpoint MCP dans MCP_ALLOWED_URLS.", secretRef: "Nom de référence de secret résolue côté serveur ; jamais la clé API elle-même." },
    ChallengeInput: { procedureId: "Identifiant d’une fiche validated existante.", scopes: "Actions qui seront soumises à l’accord explicite de l’usager." },
    Consent: { challengeId: "id du challenge reçu et encore valide.", accepted: "true seulement après accord explicite au consentText présenté." },
    Procedure: { id: "Identifiant fourni à la création, identique au chemin PUT.", administrationId: "Administration du JWT administrateur.", requiredDocuments: "Documents requis selon la source officielle.", feeFcfa: "Coût en FCFA, entier positif ou nul.", processingDays: "Délai annoncé en jours, entier positif ou nul.", validationStatus: "draft pendant la préparation ; validated après validation métier, pour exposition au Tooling.", source: "Référence de source : procedureId, url, retrievedAt et version.", formSchema: "Description des champs attendus par la démarche, selon le format métier convenu." },
  };
  for (const [schemaName, properties] of Object.entries(fields)) for (const [property, description] of Object.entries(properties)) {
    const field = spec.components.schemas[schemaName]?.properties?.[property];
    if (field) field.description = description;
  }
  spec.tags = [...tags].map(name => ({ name }));
  return spec;
}
