// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.
export interface paths {
    "/v1/administrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Administrations (connectées ou non) */
        get: operations["xroadListAdministrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/procedures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recherche classée dans le catalogue officiel */
        get: operations["xroadSearchProcedures"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/procedures/{procedureId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fiche complète */
        get: operations["xroadGetProcedure"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Transmettre une pièce avant dépôt
         * @description Scope xroad:apply. Pièce conservée 1 h si elle n’est pas rattachée à un dossier.
         */
        post: operations["xroadUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dossiers visibles
         * @description Avec X-Applicant-Ref : ceux de l’usager. Avec X-Official-Subject : ceux des administrations de l’agent, filtrés par view.
         */
        get: operations["xroadListCases"];
        put?: never;
        /**
         * Déposer un dossier
         * @description Scope xroad:apply. Refusé (409 NOT_ASSISTED) si la démarche n’a pas de filing. Frais > 0 → awaiting_payment, sinon received puis instruction automatique selon la règle de la démarche.
         */
        post: operations["xroadCreateCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases/{caseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Un dossier */
        get: operations["xroadGetCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases/{caseId}/payment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Paiement simulé
         * @description Une seule fois par dossier.
         */
        post: operations["xroadPayCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases/{caseId}/responses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Répondre à une demande de complément
         * @description information_requested → in_review.
         */
        post: operations["xroadRespondToCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases/{caseId}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Action d’un agent
         * @description Scope xroad:administer. Mêmes transitions que la console.
         */
        post: operations["xroadActOnCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases/{caseId}/documents/{documentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Télécharger une pièce ou un document délivré */
        get: operations["xroadDownloadDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/officials/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Agent correspondant au sub
         * @description 404 si le sub n’est inscrit dans aucune administration.
         */
        get: operations["xroadGetMe"];
        /** Modifier son profil */
        put: operations["xroadUpdateMe"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/officials/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Enregistrer l’URL de la photo */
        put: operations["xroadSetAvatar"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/officials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Agents visibles par l’agent connecté */
        get: operations["xroadListOfficials"];
        put?: never;
        /**
         * Inscrire un agent (super_admin)
         * @description Le Backend crée d’abord le compte Keycloak, puis inscrit son sub ici.
         */
        post: operations["xroadCreateOfficial"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/officials/{officialId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Affectation, rôle, activation */
        put: operations["xroadUpdateOfficial"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Indicateurs d’une administration */
        get: operations["xroadGetMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Journal des dossiers */
        get: operations["xroadListActivity"];
        put?: never;
        post?: never;
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
        AvatarInput: {
            /** Format: uri */
            avatarUrl: string;
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
        CaseInput: {
            requestId: components["schemas"]["RequestId"];
            procedureId: components["schemas"]["ProcedureId"];
            channel: components["schemas"]["Channel"];
            /** @description Valeurs du formulaire de la démarche, conformes à Procedure.filing.formSchema. */
            fields: {
                [key: string]: string | number | boolean | null;
            };
            documents: components["schemas"]["DocumentRef"][];
        };
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
        CaseResponseInput: {
            message: string;
            /** @description Valeurs du formulaire de la démarche, conformes à Procedure.filing.formSchema. */
            fields: {
                [key: string]: string | number | boolean | null;
            };
            documents: components["schemas"]["DocumentRef"][];
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
        DocumentId: string;
        DocumentRef: {
            documentType: string;
            uploadId: components["schemas"]["UploadId"];
        };
        Filing: {
            /** @description Cas couverts par le dépôt via l’assistant ; les autres cas suivent la fiche officielle. */
            scope: string;
            /** @description JSON Schema 2020-12 des champs du dossier. */
            formSchema: Record<string, never>;
            requiredDocuments: components["schemas"]["RequiredDocument"][];
            feeFcfa: number;
            processingDays: number | null;
        };
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
        OfficialId: string;
        OfficialPage: {
            items: components["schemas"]["Official"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        OfficialRegistration: {
            subject: string;
            /** Format: email */
            email: string;
            displayName: string;
            jobTitle: string;
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
        };
        /** @enum {string} */
        OfficialRole: "agent" | "admin" | "super_admin";
        OfficialUpdate: {
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
            active: boolean;
        };
        PaymentInput: {
            /** @constant */
            method: "mobile_money";
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
        Procedure: {
            id: components["schemas"]["ProcedureId"];
            title: string;
            administrationId: components["schemas"]["AdministrationId"];
            summary: string;
            target: string | null;
            authority: string | null;
            /** @description Montant unique publié par la fiche, sinon null (voir inPerson/online). */
            feeFcfa: number | null;
            processingDays: number | null;
            /** @description Texte officiel du canal « sur place », sans réécriture. */
            inPerson: {
                fee: string | null;
                delay: string | null;
                documents: string | null;
                process: string | null;
                where: string | null;
                /** Format: uri */
                url: string | null;
            } | null;
            /** @description Texte officiel du canal « en ligne », sans réécriture. */
            online: {
                fee: string | null;
                delay: string | null;
                documents: string | null;
                process: string | null;
                where: string | null;
                /** Format: uri */
                url: string | null;
            } | null;
            hours: string | null;
            source: components["schemas"]["Source"];
            /** @description Présent si l’assistant peut déposer le dossier ; null = information seulement. */
            filing: components["schemas"]["Filing"] | null;
        };
        /** @description Identifiant officiel de la fiche sur service-public.bj. */
        ProcedureId: string;
        ProcedurePage: {
            items: components["schemas"]["Procedure"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        ProfileUpdate: {
            displayName: string;
            jobTitle: string;
        };
        RequestId: string;
        RequiredDocument: {
            documentType: string;
            label: string;
            acceptedMimeTypes: ("application/pdf" | "image/jpeg" | "image/png")[];
        };
        Source: {
            procedureId: components["schemas"]["ProcedureId"];
            /**
             * Format: uri
             * @description Fiche publique sur service-public.bj.
             */
            url: string;
            /**
             * Format: date-time
             * @description Date de collecte de la fiche.
             */
            retrievedAt: string;
        };
        Upload: {
            id: components["schemas"]["UploadId"];
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png";
            sizeBytes: number;
            /** Format: date-time */
            expiresAt: string;
        };
        UploadId: string;
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
    xroadListAdministrations: {
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
    xroadSearchProcedures: {
        parameters: {
            query?: {
                /** @description Texte libre. */
                query?: string;
                /** @description Filtre. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description true = seulement les démarches déposables. */
                assisted?: boolean;
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
                    "application/json": components["schemas"]["ProcedurePage"];
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
    xroadGetProcedure: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                procedureId: components["schemas"]["ProcedureId"];
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
                    "application/json": components["schemas"]["Procedure"];
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
    xroadUpload: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager pour le compte duquel agit le client (userRef du Backend). */
                "X-Applicant-Ref": components["schemas"]["UserRef"];
                /** @description Type. */
                "X-File-Mime-Type": "application/pdf" | "image/jpeg" | "image/png";
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
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Upload"];
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
    xroadListCases: {
        parameters: {
            query?: {
                /** @description Filtre (super_admin). */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Filtre administration. */
                view?: components["schemas"]["CaseView"];
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Vue usager (exclusif avec X-Official-Subject). */
                "X-Applicant-Ref"?: components["schemas"]["UserRef"];
                /** @description Vue administration (exclusif avec X-Applicant-Ref). */
                "X-Official-Subject"?: string;
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
    xroadCreateCase: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager pour le compte duquel agit le client (userRef du Backend). */
                "X-Applicant-Ref": components["schemas"]["UserRef"];
                /** @description Clé de 8 à 128 caractères. Même clé + même corps = même réponse pendant 24 h ; corps différent = 409 IDEMPOTENCY_CONFLICT. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseInput"];
            };
        };
        responses: {
            /** @description Succès. */
            201: {
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
    xroadGetCase: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Vue usager (exclusif avec X-Official-Subject). */
                "X-Applicant-Ref"?: components["schemas"]["UserRef"];
                /** @description Vue administration (exclusif avec X-Applicant-Ref). */
                "X-Official-Subject"?: string;
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
    xroadPayCase: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager pour le compte duquel agit le client (userRef du Backend). */
                "X-Applicant-Ref": components["schemas"]["UserRef"];
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
                "application/json": components["schemas"]["PaymentInput"];
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
    xroadRespondToCase: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager pour le compte duquel agit le client (userRef du Backend). */
                "X-Applicant-Ref": components["schemas"]["UserRef"];
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
                "application/json": components["schemas"]["CaseResponseInput"];
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
    xroadActOnCase: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
    xroadDownloadDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Vue usager (exclusif avec X-Official-Subject). */
                "X-Applicant-Ref"?: components["schemas"]["UserRef"];
                /** @description Vue administration (exclusif avec X-Applicant-Ref). */
                "X-Official-Subject"?: string;
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
    xroadGetMe: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
    xroadUpdateMe: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
    xroadSetAvatar: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AvatarInput"];
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
    xroadListOfficials: {
        parameters: {
            query?: {
                /** @description Filtre. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
    xroadCreateOfficial: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
                /** @description Clé de 8 à 128 caractères. Même clé + même corps = même réponse pendant 24 h ; corps différent = 409 IDEMPOTENCY_CONFLICT. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfficialRegistration"];
            };
        };
        responses: {
            /** @description Succès. */
            201: {
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
    xroadUpdateOfficial: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
    xroadGetMetrics: {
        parameters: {
            query?: {
                /** @description Obligatoire pour un super_admin. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Début inclus. */
                from?: string;
                /** @description Fin exclue. */
                to?: string;
            };
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
                    "application/json": components["schemas"]["Metrics"];
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
    xroadListActivity: {
        parameters: {
            query?: {
                /** @description Filtre. */
                administrationId?: components["schemas"]["AdministrationId"];
                /** @description Filtre. */
                caseId?: components["schemas"]["CaseId"];
                /** @description Curseur opaque retourné par la page précédente. */
                cursor?: string;
                /** @description Taille de page. */
                limit?: number;
            };
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description sub Keycloak de l’agent connecté, transmis par le Backend. */
                "X-Official-Subject": string;
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
}
