export interface paths {
    "/v1/administrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listXroadAdministrations
         * @description Administrations de la simulation, connectées ou non.
         */
        get: operations["listXroadAdministrations"];
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
        /**
         * searchXroadProcedures
         * @description Catalogue des démarches. `query` cherche dans le titre et le résumé ; `administrationId` filtre par administration.
         */
        get: operations["searchXroadProcedures"];
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
        /**
         * getXroadProcedure
         * @description Fiche complète : pièces, frais, délai, formulaire.
         */
        get: operations["getXroadProcedure"];
        put?: never;
        post?: never;
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
         * listXroadCases
         * @description Dossiers visibles par l'agent `X-Official-Id`. `view=pending` : `in_review` ; `view=completed` : `completed`. Plus ancien en premier pour `pending`, plus récent en premier sinon.
         */
        get: operations["listXroadCases"];
        put?: never;
        /**
         * createXroadCase
         * @description Dépôt d'un dossier pour l'usager `X-Applicant-Ref`. L'administration cible est celle de la démarche. 201 avec `awaiting_payment` si la démarche a des frais, sinon `received`. Même `requestId` déjà déposé : 409.
         */
        post: operations["createXroadCase"];
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
        /**
         * getXroadCase
         * @description Un dossier. Exactement un des en-têtes : `X-Applicant-Ref` (client `tooling-xroad`) ou `X-Official-Id` (client `backend-xroad`). Dossier d'un autre usager ou d'une autre administration : 404.
         */
        get: operations["getXroadCase"];
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
         * payXroadCase
         * @description Paiement simulé des frais. Seulement depuis `awaiting_payment` ; le dossier passe à `received`. Aucun paiement réel, référence `SIM-PAY-…`.
         */
        post: operations["payXroadCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cases/{caseId}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * decideXroadCase
         * @description Décision sur un dossier `in_review` : `approve` → `completed` (`completedBy: administration`), `reject` → `rejected`. Autre état : 409 `INVALID_TRANSITION`. Exactement un des en-têtes : `X-Official-Id` (client `backend-xroad`, scope `xroad:administer`, agent de l'administration du dossier) ou `X-Actor-Ref` (client `tooling-xroad`, scope `xroad:decide`, décision prise dans la console d'administration et relayée par le Tooling, qui a vérifié le département). Les deux, ou aucun : 400.
         */
        post: operations["decideXroadCase"];
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
        /**
         * downloadXroadIssuedDocument
         * @description Document délivré, au format PDF, marqué comme simulation. Mêmes en-têtes et règles de visibilité que `getXroadCase`.
         */
        get: operations["downloadXroadIssuedDocument"];
        put?: never;
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
        /**
         * listXroadOfficials
         * @description Agents visibles par `X-Official-Id` : son administration pour `admin`, toutes pour `super_admin`, lui seul pour `agent`. Sans `X-Official-Id`, tous les agents : sert uniquement à l'écran « se connecter en tant que » de la démonstration.
         */
        get: operations["listXroadOfficials"];
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
         * getXroadCurrentOfficial
         * @description Profil de l'agent `X-Official-Id`.
         */
        get: operations["getXroadCurrentOfficial"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/officials/{officialId}/assignment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * assignXroadOfficial
         * @description Affectation d'un agent à une administration et à un rôle. Réservé à `super_admin`, sinon 403. `super_admin` exige `administrationId: null`, les autres rôles une administration.
         */
        put: operations["assignXroadOfficial"];
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
        /**
         * getXroadMetrics
         * @description Indicateurs des dossiers de l'administration de `X-Official-Id`, ou de `administrationId` pour `super_admin` (toutes si absent).
         */
        get: operations["getXroadMetrics"];
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
        UserRef: string;
        RequestId: string;
        FileId: string;
        Problem: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            detail: string;
            /** @enum {string} */
            code: "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "MANDATE_MISSING" | "MANDATE_EXPIRED" | "MANDATE_REVOKED" | "MANDATE_SCOPE_DENIED" | "REQUEST_INCOMPLETE" | "INVALID_TRANSITION" | "UPSTREAM_UNAVAILABLE" | "RATE_LIMITED" | "UNSUPPORTED_MEDIA_TYPE" | "FILE_TOO_LARGE" | "REPLAY_EXPIRED";
            traceId: string;
        };
        Source: {
            procedureId: string;
            /** Format: uri */
            url: string;
            /** Format: date-time */
            retrievedAt: string;
            version: string;
        };
        Procedure: {
            id: string;
            title: string;
            administrationId: string;
            summary: string;
            requiredDocuments: string[];
            /** @description Montant en FCFA quand la fiche officielle en donne un seul sans condition ; sinon null et voir official. */
            feeFcfa: number | null;
            /** @description Délai en jours quand la fiche officielle en donne un seul sans condition ; sinon null et voir official. */
            processingDays: number | null;
            source: components["schemas"]["Source"];
            /** @enum {string} */
            validationStatus: "draft" | "validated";
            formSchema: {
                [key: string]: unknown;
            };
            /** @description Fiche officielle du Portail national des services publics (service-public.bj), recopiée sans réécriture. Fait foi sur feeFcfa et processingDays. */
            official?: {
                serviceId: string;
                target: string | null;
                authority: string | null;
                /** @description Canal tel que publié par le portail officiel (texte exact, Markdown d'origine). */
                inPerson: {
                    fee: string | null;
                    delay: string | null;
                    documents: string | null;
                    process: string | null;
                    where: string | null;
                    /** Format: uri */
                    url: string | null;
                } | null;
                /** @description Canal tel que publié par le portail officiel (texte exact, Markdown d'origine). */
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
            };
            /** @description true : l'assistant peut déposer le dossier (dépôt simulé via le X-Road). Absent ou false : information seulement, orienter l'usager vers source.url. */
            assistedFiling?: boolean;
        };
        ProcedurePage: {
            items: components["schemas"]["Procedure"][];
            nextCursor: string | null;
        };
        AdministrationId: string;
        CaseId: string;
        OfficialId: string;
        IssuedDocumentId: string;
        Administration: {
            id: components["schemas"]["AdministrationId"];
            name: string;
            shortName: string;
            themes: string[];
            connection: {
                /** @enum {string} */
                status: "connected" | "not_connected";
                /** Format: date-time */
                since: string | null;
            };
        };
        AdministrationPage: {
            items: components["schemas"]["Administration"][];
            nextCursor: string | null;
        };
        /** @enum {string} */
        OfficialRole: "agent" | "admin" | "super_admin";
        Official: {
            id: components["schemas"]["OfficialId"];
            displayName: string;
            jobTitle: string;
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
            /** Format: uri */
            avatarUrl: string | null;
        };
        OfficialPage: {
            items: components["schemas"]["Official"][];
            nextCursor: string | null;
        };
        OfficialAssignment: {
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
        };
        /** @enum {string} */
        CaseStatus: "awaiting_payment" | "received" | "in_review" | "completed" | "rejected";
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
        CaseDocument: {
            documentType: string;
            fileId: components["schemas"]["FileId"];
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png";
            sizeBytes: number;
        };
        CasePayment: {
            amountFcfa: number;
            /** @enum {string} */
            status: "not_required" | "pending" | "paid";
            /** @enum {string|null} */
            method: "mobile_money" | null;
            reference: string | null;
            /** Format: date-time */
            paidAt: string | null;
        };
        Case: {
            id: components["schemas"]["CaseId"];
            reference: string;
            /** @constant */
            simulated: true;
            procedureId: string;
            administrationId: components["schemas"]["AdministrationId"];
            requestId: components["schemas"]["RequestId"];
            applicantRef: components["schemas"]["UserRef"];
            status: components["schemas"]["CaseStatus"];
            fields: {
                [key: string]: string | number | boolean | null;
            };
            documents: components["schemas"]["CaseDocument"][];
            payment: components["schemas"]["CasePayment"];
            steps: components["schemas"]["CaseStep"][];
            issuedDocuments: components["schemas"]["XroadIssuedDocument"][];
            /** @enum {string|null} */
            completedBy: "assistant" | "administration" | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CasePage: {
            items: components["schemas"]["Case"][];
            nextCursor: string | null;
        };
        CaseInput: {
            requestId: components["schemas"]["RequestId"];
            procedureId: string;
            fields: {
                [key: string]: string | number | boolean | null;
            };
            documents: components["schemas"]["CaseDocument"][];
        };
        PaymentInput: {
            /** @constant */
            method: "mobile_money";
        };
        CaseDecision: {
            /** @enum {string} */
            decision: "approve" | "reject";
            note: string | null;
        };
        AdministrationMetrics: {
            administrationId: components["schemas"]["AdministrationId"] | null;
            casesTotal: number;
            casesPending: number;
            casesCompleted: number;
            casesCompletedByAssistant: number;
            casesRejected: number;
            medianProcessingHours: number | null;
            topProcedures: {
                procedureId: string;
                title: string;
                count: number;
            }[];
        };
        XroadIssuedDocument: {
            id: components["schemas"]["IssuedDocumentId"];
            title: string;
            /** @constant */
            mimeType: "application/pdf";
            /** Format: date-time */
            issuedAt: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listXroadAdministrations: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdministrationPage"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    searchXroadProcedures: {
        parameters: {
            query?: {
                query?: string;
                administrationId?: components["schemas"]["AdministrationId"];
                cursor?: string;
                limit?: number;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProcedurePage"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getXroadProcedure: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                procedureId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Procedure"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listXroadCases: {
        parameters: {
            query?: {
                administrationId?: components["schemas"]["AdministrationId"];
                view?: "pending" | "completed" | "all";
                cursor?: string;
                limit?: number;
            };
            header: {
                traceparent: string;
                "X-Official-Id": components["schemas"]["OfficialId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CasePage"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createXroadCase: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
                "X-Applicant-Ref": components["schemas"]["UserRef"];
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
            /** @description Dossier déposé */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Case"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getXroadCase: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "X-Applicant-Ref"?: components["schemas"]["UserRef"];
                "X-Official-Id"?: components["schemas"]["OfficialId"];
            };
            path: {
                caseId: components["schemas"]["CaseId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Case"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    payXroadCase: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
                "X-Applicant-Ref": components["schemas"]["UserRef"];
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
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Case"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    decideXroadCase: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
                "X-Official-Id"?: components["schemas"]["OfficialId"];
                /** @description Référence opaque de l'agent de la console (sujet OIDC), transmise par le Tooling. */
                "X-Actor-Ref"?: string;
            };
            path: {
                caseId: components["schemas"]["CaseId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseDecision"];
            };
        };
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Case"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    downloadXroadIssuedDocument: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "X-Applicant-Ref"?: components["schemas"]["UserRef"];
                "X-Official-Id"?: components["schemas"]["OfficialId"];
            };
            path: {
                caseId: components["schemas"]["CaseId"];
                documentId: components["schemas"]["IssuedDocumentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": string;
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listXroadOfficials: {
        parameters: {
            query?: {
                administrationId?: components["schemas"]["AdministrationId"];
                cursor?: string;
                limit?: number;
            };
            header: {
                traceparent: string;
                "X-Official-Id"?: components["schemas"]["OfficialId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfficialPage"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getXroadCurrentOfficial: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "X-Official-Id": components["schemas"]["OfficialId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Official"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    assignXroadOfficial: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
                "X-Official-Id": components["schemas"]["OfficialId"];
            };
            path: {
                officialId: components["schemas"]["OfficialId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfficialAssignment"];
            };
        };
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Official"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getXroadMetrics: {
        parameters: {
            query?: {
                administrationId?: components["schemas"]["AdministrationId"];
            };
            header: {
                traceparent: string;
                "X-Official-Id": components["schemas"]["OfficialId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdministrationMetrics"];
                };
            };
            /** @description Erreur RFC 9457 ; voir CONTRACTS.md pour les codes HTTP */
            default: {
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
