// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.
export interface paths {
    "/v1/admin/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Profil, administration et permissions */
        get: operations["getMe"];
        /** Modifier son nom et sa fonction */
        put: operations["updateMe"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Changer sa photo
         * @description JPEG ou PNG, 2 Mio maximum. Le Backend stocke l’image et met à jour avatarUrl.
         */
        put: operations["updateMyAvatar"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/avatars/{officialId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Photo d’un agent */
        get: operations["getAvatar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/administrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Administrations visibles
         * @description Toutes pour un super_admin (y compris non connectées), sinon la sienne.
         */
        get: operations["listAdministrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/officials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Agents visibles */
        get: operations["listOfficials"];
        put?: never;
        /**
         * Créer un agent (compte Keycloak + affectation)
         * @description super_admin uniquement.
         */
        post: operations["createOfficial"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/officials/{officialId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Changer l’affectation, le rôle ou désactiver
         * @description super_admin pour tout agent ; admin pour les agents de son administration, sans pouvoir élargir ses propres droits.
         */
        put: operations["updateOfficial"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dossiers (En attente, Complété, Rejeté) */
        get: operations["listCases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/cases/{caseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Détail d’un dossier */
        get: operations["getCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/cases/{caseId}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prendre en charge, demander un complément, approuver, rejeter
         * @description Transitions : claim (received|in_review → in_review), request_information (in_review → information_requested, note obligatoire), approve (in_review → completed, document délivré), reject (in_review|information_requested → rejected, note obligatoire).
         */
        post: operations["actOnCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/cases/{caseId}/documents/{documentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Télécharger une pièce ou un document délivré */
        get: operations["downloadCaseDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Vue d’ensemble d’une administration */
        get: operations["getDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Journal des actions sur les dossiers */
        get: operations["listActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/unanswered": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Questions sans réponse (thème et motif, sans texte) */
        get: operations["listUnanswered"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/unanswered/{unansweredId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Marquer comme résolu */
        post: operations["resolveUnanswered"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ActivityEntry: {
            id: components["schemas"]["ActivityId"];
            caseId: components["schemas"]["CaseId"];
            caseReference: string;
            administrationId: components["schemas"]["AdministrationId"];
            /** @enum {string} */
            actor: "assistant" | "applicant" | "administration";
            officialId: components["schemas"]["OfficialId"] | null;
            /** @enum {string} */
            action: "case.created" | "case.paid" | "step.completed" | "case.claimed" | "information.requested" | "information.provided" | "case.approved" | "case.rejected" | "document.issued";
            note: string | null;
            /** Format: date-time */
            at: string;
        };
        ActivityId: string;
        ActivityPage: {
            items: components["schemas"]["ActivityEntry"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        Administration: {
            id: components["schemas"]["AdministrationId"];
            name: string;
            shortName: string;
            /** @description Thèmes affichés à l’accueil usager. */
            themes: string[];
            connection: {
                /** @enum {string} */
                status: "connected" | "not_connected";
                /** Format: date-time */
                since: string | null;
            };
        };
        /** @description Identifiant stable d’une administration du X-Road simulé (ex. justice, anip). */
        AdministrationId: string;
        AdministrationList: {
            items: components["schemas"]["Administration"][];
        };
        Case: {
            id: components["schemas"]["CaseId"];
            reference: string;
            /** @constant */
            simulated: true;
            procedureId: components["schemas"]["ProcedureId"];
            title: string;
            administrationId: components["schemas"]["AdministrationId"];
            applicantRef: components["schemas"]["UserRef"];
            requestId: components["schemas"]["RequestId"];
            channel: components["schemas"]["Channel"];
            status: components["schemas"]["CaseStatus"];
            /** @description Valeurs du formulaire de la démarche, conformes à Procedure.filing.formSchema. */
            fields: {
                [key: string]: string | number | boolean | null;
            };
            documents: components["schemas"]["CaseDocument"][];
            payment: components["schemas"]["CasePayment"];
            steps: components["schemas"]["CaseStep"][];
            /** @description Renseigné tant que status = information_requested. */
            informationRequest: components["schemas"]["InformationRequest"] | null;
            claimedBy: components["schemas"]["OfficialId"] | null;
            /** @enum {string|null} */
            completedBy: "assistant" | "administration" | null;
            decisionNote: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CaseActionInput: {
            /** @enum {string} */
            action: "claim" | "request_information" | "approve" | "reject";
            /** @description Obligatoire pour request_information et reject. */
            note: string | null;
        };
        CaseDocument: {
            id: components["schemas"]["DocumentId"];
            /**
             * @description submitted = pièce de l’usager ; issued = document délivré par l’administration (simulation).
             * @enum {string}
             */
            kind: "submitted" | "issued";
            documentType: string;
            name: string;
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png";
            sizeBytes: number;
            /** Format: date-time */
            createdAt: string;
        };
        CaseId: string;
        CasePage: {
            items: components["schemas"]["Case"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        CasePayment: {
            amountFcfa: number;
            /** @enum {string} */
            status: "not_required" | "pending" | "paid";
            reference: string | null;
            /** Format: date-time */
            paidAt: string | null;
            /** @constant */
            simulated: true;
        };
        /** @enum {string} */
        CaseStatus: "awaiting_payment" | "received" | "in_review" | "information_requested" | "completed" | "rejected";
        CaseStep: {
            id: string;
            label: string;
            /** @enum {string} */
            state: "done" | "blocked" | "pending";
            /** @enum {string} */
            actor: "assistant" | "applicant" | "administration";
            note: string | null;
            /** Format: date-time */
            at: string | null;
        };
        /**
         * @description pending = received, in_review, information_requested.
         * @enum {string}
         */
        CaseView: "pending" | "completed" | "rejected" | "all";
        /** @enum {string} */
        Channel: "web" | "whatsapp";
        Dashboard: {
            metrics: components["schemas"]["Metrics"];
            unansweredOpen: number;
        };
        DocumentId: string;
        InformationRequest: {
            note: string;
            /** Format: date-time */
            requestedAt: string;
            requestedBy: components["schemas"]["OfficialId"];
        };
        Me: {
            official: components["schemas"]["Official"];
            administration: components["schemas"]["Administration"] | null;
            permissions: components["schemas"]["Permission"][];
        };
        Metrics: {
            administrationId: components["schemas"]["AdministrationId"] | null;
            period: {
                /** Format: date-time */
                from: string;
                /** Format: date-time */
                to: string;
            };
            received: number;
            pending: number;
            informationRequested: number;
            completed: number;
            completedByAssistant: number;
            rejected: number;
            medianProcessingHours: number | null;
            byChannel: {
                channel: components["schemas"]["Channel"];
                count: number;
            }[];
            topProcedures: {
                procedureId: components["schemas"]["ProcedureId"];
                title: string;
                count: number;
            }[];
        };
        Official: {
            id: components["schemas"]["OfficialId"];
            /** @description Identifiant Keycloak (claim sub) de la personne. */
            subject: string;
            /** Format: email */
            email: string;
            displayName: string;
            jobTitle: string;
            /** @description null pour un super_admin. */
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
            /** Format: uri */
            avatarUrl: string | null;
            active: boolean;
        };
        OfficialCreated: {
            official: components["schemas"]["Official"];
            /** @description Mot de passe Keycloak à changer à la première connexion. Retourné une seule fois. */
            temporaryPassword: string;
        };
        OfficialId: string;
        OfficialInput: {
            /** Format: email */
            email: string;
            displayName: string;
            jobTitle: string;
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
        };
        OfficialPage: {
            items: components["schemas"]["Official"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        /** @enum {string} */
        OfficialRole: "agent" | "admin" | "super_admin";
        OfficialUpdate: {
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
            active: boolean;
        };
        /** @enum {string} */
        Permission: "cases:read" | "cases:act" | "officials:read" | "officials:manage" | "administrations:all";
        Problem: {
            type: string;
            title: string;
            status: number;
            /** @enum {string} */
            code: "INVALID_REQUEST" | "UNAUTHORIZED" | "LOGIN_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "MANDATE_MISSING" | "MANDATE_EXPIRED" | "MANDATE_REVOKED" | "MANDATE_SCOPE_DENIED" | "REQUEST_INCOMPLETE" | "INVALID_TRANSITION" | "NOT_ASSISTED" | "REPLAY_EXPIRED" | "UNSUPPORTED_MEDIA_TYPE" | "FILE_TOO_LARGE" | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "MCP_AUTH_FAILED" | "MCP_CONNECTION_FAILED" | "MCP_DISCOVERY_FAILED";
            detail: string;
            traceId: string;
        };
        /** @description Identifiant officiel de la fiche sur service-public.bj. */
        ProcedureId: string;
        ProfileUpdate: {
            displayName: string;
            jobTitle: string;
        };
        RequestId: string;
        UnansweredEntry: {
            id: components["schemas"]["UnansweredId"];
            /** @description null si aucune administration n’a pu être rattachée (visible du super admin seulement). */
            administrationId: components["schemas"]["AdministrationId"] | null;
            theme: string | null;
            /** @enum {string} */
            reason: "no_procedure_found" | "no_source" | "model_unavailable" | "tool_failed";
            /** @enum {string} */
            status: "open" | "resolved";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            resolvedAt: string | null;
        };
        UnansweredId: string;
        UnansweredPage: {
            items: components["schemas"]["UnansweredEntry"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        /** @description Référence opaque de l’usager, attribuée par le Backend. Jamais fournie par le navigateur ni par le modèle. */
        UserRef: string;
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getMe: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateMe: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileUpdate"];
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Official"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateMyAvatar: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description image/jpeg ou image/png */
                "X-File-Mime-Type": "image/jpeg" | "image/png";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Official"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getAvatar: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                officialId: components["schemas"]["OfficialId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Ressource absente ou hors de portée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listAdministrations: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdministrationList"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listOfficials: {
        parameters: {
            query?: {
                /** @description Obligatoire pour un super_admin ; ignoré (forcé) pour un agent ou admin rattaché. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfficialPage"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createOfficial: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfficialInput"];
            };
        };
        responses: {
            /** @description Succès. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfficialCreated"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Conflit d’état (CONFLICT, INVALID_TRANSITION, IDEMPOTENCY_CONFLICT). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateOfficial: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                officialId: components["schemas"]["OfficialId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfficialUpdate"];
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Official"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Ressource absente ou hors de portée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Conflit d’état (CONFLICT, INVALID_TRANSITION, IDEMPOTENCY_CONFLICT). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCases: {
        parameters: {
            query: {
                /** @description Obligatoire pour un super_admin ; ignoré (forcé) pour un agent ou admin rattaché. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Filtre. */
                view: components["schemas"]["CaseView"];
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CasePage"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCase: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                caseId: components["schemas"]["CaseId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Case"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Ressource absente ou hors de portée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    actOnCase: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Clé de 8 à 128 caractères. Même clé + même corps = même réponse pendant 24 h ; corps différent = 409 IDEMPOTENCY_CONFLICT. */
                "Idempotency-Key": string;
            };
            path: {
                caseId: components["schemas"]["CaseId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseActionInput"];
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Case"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Ressource absente ou hors de portée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Conflit d’état (CONFLICT, INVALID_TRANSITION, IDEMPOTENCY_CONFLICT). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    downloadCaseDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                caseId: components["schemas"]["CaseId"];
                documentId: components["schemas"]["DocumentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": string;
                    "image/jpeg": string;
                    "image/png": string;
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Ressource absente ou hors de portée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getDashboard: {
        parameters: {
            query?: {
                /** @description Obligatoire pour un super_admin ; ignoré (forcé) pour un agent ou admin rattaché. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Début (inclus), défaut : il y a 30 jours. */
                from?: string;
                /** @description Fin (exclue), défaut : maintenant. */
                to?: string;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Dashboard"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listActivity: {
        parameters: {
            query?: {
                /** @description Obligatoire pour un super_admin ; ignoré (forcé) pour un agent ou admin rattaché. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Limiter à un dossier. */
                caseId?: components["schemas"]["CaseId"];
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityPage"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listUnanswered: {
        parameters: {
            query?: {
                /** @description Obligatoire pour un super_admin ; ignoré (forcé) pour un agent ou admin rattaché. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Filtre. */
                status?: "open" | "resolved";
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnansweredPage"];
                };
            };
            /** @description Requête invalide (INVALID_REQUEST). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resolveUnanswered: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                unansweredId: components["schemas"]["UnansweredId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnansweredEntry"];
                };
            };
            /** @description Authentification absente ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Droit insuffisant (FORBIDDEN). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Ressource absente ou hors de portée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Conflit d’état (CONFLICT, INVALID_TRANSITION, IDEMPOTENCY_CONFLICT). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Dépendance indisponible (UPSTREAM_UNAVAILABLE), avec Retry-After. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
