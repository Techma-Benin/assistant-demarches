export interface paths {
    "/v1/admin/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listAdminModels */
        get: operations["listAdminModels"];
        put?: never;
        /**
         * Créer une configuration models
         * @description admin:write. Identifiant fourni dans le corps (name pour tools). 409 INVALID_TRANSITION si déjà présent. Rejeu Idempotency-Key 24 h sans nouvelle écriture.
         */
        post: operations["createAdminModels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/models/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lire une configuration models
         * @description admin:read. 404 si absent ou appartenant à une autre administration.
         */
        get: operations["getAdminModels"];
        /** updateAdminModels */
        put: operations["updateAdminModels"];
        post?: never;
        /**
         * Supprimer une configuration models
         * @description admin:write. Idempotency-Key obligatoire : même clé rejoue 204 pendant 24 h sans supprimer une éventuelle recréation ; autre clé sur ressource absente donne 404. Aucun effacement de dossiers ou audit. Fiche référencée dans les projections locales demandes/mandats/challenges : 409 INVALID_TRANSITION. Références Tooling non encore projetées non détectables. Supprimer le dernier modèle actif ou un outil requis peut rendre les prochains traitements indisponibles.
         */
        delete: operations["deleteAdminModels"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/tools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listAdminTools
         * @deprecated
         * @description Compatibilité historique seulement : utiliser /v1/admin/mcp-servers et les permissions des actions découvertes.
         */
        get: operations["listAdminTools"];
        put?: never;
        /**
         * Créer une configuration tools
         * @deprecated
         * @description admin:write. Identifiant fourni dans le corps (name pour tools). 409 INVALID_TRANSITION si déjà présent. Rejeu Idempotency-Key 24 h sans nouvelle écriture. Compatibilité historique seulement : utiliser /v1/admin/mcp-servers et les permissions des actions découvertes.
         */
        post: operations["createAdminTools"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/tools/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lire une configuration tools
         * @deprecated
         * @description admin:read. 404 si absent ou appartenant à une autre administration. Compatibilité historique seulement : utiliser /v1/admin/mcp-servers et les permissions des actions découvertes.
         */
        get: operations["getAdminTools"];
        /**
         * updateAdminTools
         * @deprecated
         * @description Compatibilité historique seulement : utiliser /v1/admin/mcp-servers et les permissions des actions découvertes.
         */
        put: operations["updateAdminTools"];
        post?: never;
        /**
         * Supprimer une configuration tools
         * @deprecated
         * @description admin:write. Idempotency-Key obligatoire : même clé rejoue 204 pendant 24 h sans supprimer une éventuelle recréation ; autre clé sur ressource absente donne 404. Aucun effacement de dossiers ou audit. Fiche référencée dans les projections locales demandes/mandats/challenges : 409 INVALID_TRANSITION. Références Tooling non encore projetées non détectables. Supprimer le dernier modèle actif ou un outil requis peut rendre les prochains traitements indisponibles. Compatibilité historique seulement : utiliser /v1/admin/mcp-servers et les permissions des actions découvertes.
         */
        delete: operations["deleteAdminTools"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/procedures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listAdminProcedures */
        get: operations["listAdminProcedures"];
        put?: never;
        /**
         * Créer une configuration procedures
         * @description admin:write. Identifiant fourni dans le corps (name pour tools). 409 INVALID_TRANSITION si déjà présent. Rejeu Idempotency-Key 24 h sans nouvelle écriture. Identifiant de fiche globalement unique, y compris entre administrations (API privée Tooling).
         */
        post: operations["createAdminProcedures"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/procedures/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lire une configuration procedures
         * @description admin:read. 404 si absent ou appartenant à une autre administration.
         */
        get: operations["getAdminProcedures"];
        /** updateAdminProcedures */
        put: operations["updateAdminProcedures"];
        post?: never;
        /**
         * Supprimer une configuration procedures
         * @description admin:write. Idempotency-Key obligatoire : même clé rejoue 204 pendant 24 h sans supprimer une éventuelle recréation ; autre clé sur ressource absente donne 404. Aucun effacement de dossiers ou audit. Fiche référencée dans les projections locales demandes/mandats/challenges : 409 INVALID_TRANSITION. Références Tooling non encore projetées non détectables. Supprimer le dernier modèle actif ou un outil requis peut rendre les prochains traitements indisponibles.
         */
        delete: operations["deleteAdminProcedures"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listAdminConversations */
        get: operations["listAdminConversations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listAdminAudit */
        get: operations["listAdminAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getAdminMetrics */
        get: operations["getAdminMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/mcp-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lister les connexions MCP */
        get: operations["listAdminMcpServers"];
        put?: never;
        /** Ajouter un serveur MCP */
        post: operations["createAdminMcpServer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/mcp-servers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulter une connexion MCP */
        get: operations["getAdminMcpServer"];
        /** Modifier ou activer une connexion MCP */
        put: operations["updateAdminMcpServer"];
        post?: never;
        /** Supprimer une connexion et ses permissions */
        delete: operations["deleteAdminMcpServer"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/mcp-servers/{id}/discover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Découvrir ou actualiser les actions du serveur MCP */
        post: operations["discoverAdminMcpServer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/mcp-servers/{id}/tools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lister les actions découvertes par serveur */
        get: operations["listAdminMcpTools"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/mcp-servers/{id}/tools/{toolName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Activer ou désactiver une action découverte */
        put: operations["updateAdminMcpToolPermission"];
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
        ConversationId: string;
        UserRef: string;
        MessageId: string;
        RequestId: string;
        FileId: string;
        MandateId: string;
        ChallengeId: string;
        EventId: string;
        /** @enum {string} */
        Locale: "fr" | "fon" | "yo";
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
        /** @enum {string} */
        RequestStatus: "draft" | "ready" | "awaiting_user_validation" | "submitted" | "processing" | "completed" | "rejected" | "cancelled" | "blocked";
        Request: {
            id: components["schemas"]["RequestId"];
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            procedureId: string;
            status: components["schemas"]["RequestStatus"];
            fields: {
                [key: string]: string | number | boolean | null;
            };
            fileIds: components["schemas"]["FileId"][];
            /** Format: uri */
            officialLink: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        File: {
            id: components["schemas"]["FileId"];
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png" | "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/webm";
            sizeBytes: number;
            /** Format: date-time */
            expiresAt: string;
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
        /** @enum {string} */
        Scope: "requests:write" | "documents:write" | "requests:submit";
        Mandate: {
            id: components["schemas"]["MandateId"];
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            procedureId: string;
            scopes: components["schemas"]["Scope"][];
            /** @enum {string} */
            status: "active" | "revoked" | "expired";
            /** Format: date-time */
            expiresAt: string;
        };
        ChallengeInput: {
            procedureId: string;
            scopes: components["schemas"]["Scope"][];
        };
        Challenge: {
            id: components["schemas"]["ChallengeId"];
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            procedureId: string;
            scopes: components["schemas"]["Scope"][];
            consentText: string;
            /** Format: date-time */
            expiresAt: string;
            /** @description JWT signé du challenge en production ; opaque pour Interface et le modèle. */
            proofToken: string;
        };
        Consent: {
            challengeId: components["schemas"]["ChallengeId"];
            /** @constant */
            accepted: true;
        };
        ConversationInput: {
            /** @enum {string} */
            channel: "whatsapp" | "web" | "mobile";
            locale: components["schemas"]["Locale"];
        };
        Conversation: {
            id: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            /** @enum {string} */
            channel: "whatsapp" | "web" | "mobile";
            locale: components["schemas"]["Locale"];
            /** Format: date-time */
            createdAt: string;
        };
        Content: {
            /** @constant */
            type: "text";
            text: string;
        } | {
            /** @enum {string} */
            type: "audio" | "image" | "file";
            fileId: components["schemas"]["FileId"];
        } | {
            /** @constant */
            type: "interaction";
            actionId: string;
            value?: string;
        };
        MessageInput: {
            id: components["schemas"]["MessageId"];
            content: components["schemas"]["Content"];
            /** Format: date-time */
            sentAt: string;
        };
        MessageAccepted: {
            messageId: components["schemas"]["MessageId"];
            conversationId: components["schemas"]["ConversationId"];
            /** @constant */
            status: "accepted";
        };
        Block: {
            /** @constant */
            type: "text";
            text: string;
            sources: components["schemas"]["Source"][];
        } | {
            /** @constant */
            type: "buttons";
            items: {
                id: string;
                label: string;
            }[];
        } | {
            /** @constant */
            type: "form";
            id: string;
            fields: {
                name: string;
                label: string;
                required: boolean;
                /** @enum {string} */
                type: "text" | "number" | "date";
            }[];
        } | {
            /** @constant */
            type: "fileRequest";
            documentType: string;
            label: string;
            acceptedMimeTypes: string[];
        } | {
            /** @constant */
            type: "statusCard";
            request: components["schemas"]["Request"];
        };
        AgentMessage: {
            id: components["schemas"]["MessageId"];
            conversationId: components["schemas"]["ConversationId"];
            blocks: components["schemas"]["Block"][];
            /** Format: date-time */
            createdAt: string;
        };
        ToolContext: {
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            mandateId?: components["schemas"]["MandateId"];
            traceId: string;
        };
        ModelConfig: {
            id: string;
            provider: string;
            model: string;
            promptVersion: string;
            temperature: number;
            active: boolean;
        };
        ToolConfig: {
            name: string;
            enabled: boolean;
            /** Format: uri */
            serverUrl: string;
            secretRef: string;
        };
        Metrics: {
            conversationCount: number;
            p95LatencyMs: number;
            sourcedAnswerRate: number;
            errorCount: number;
        };
        AuditEntry: {
            id: string;
            actorRef: string;
            action: string;
            resourceId: string;
            /** Format: date-time */
            at: string;
            traceId: string;
        };
        EventData: {
            /** @constant */
            kind: "message.received";
            conversationId: components["schemas"]["ConversationId"];
            messageId: components["schemas"]["MessageId"];
        } | {
            /** @constant */
            kind: "message.sent";
            conversationId: components["schemas"]["ConversationId"];
            message: components["schemas"]["AgentMessage"];
        } | {
            /** @constant */
            kind: "request.created";
            request: components["schemas"]["Request"];
        } | {
            /** @constant */
            kind: "request.status_changed";
            requestId: components["schemas"]["RequestId"];
            conversationId: components["schemas"]["ConversationId"];
            from: components["schemas"]["RequestStatus"];
            to: components["schemas"]["RequestStatus"];
            /** Format: date-time */
            at: string;
        } | {
            /** @enum {string} */
            kind: "mandate.granted" | "mandate.revoked";
            mandate: components["schemas"]["Mandate"];
        } | {
            /** @constant */
            kind: "tool.called";
            toolName: string;
            conversationId: components["schemas"]["ConversationId"];
            /** @enum {string} */
            outcome: "success" | "error";
            code: string;
        } | {
            /** @constant */
            kind: "configuration.changed";
            /** @enum {string} */
            resource: "models" | "tools" | "procedures";
            resourceId: string;
            actorRef: string;
            /**
             * @description Opération de configuration ; facultative pour compatibilité avec les événements antérieurs.
             * @enum {string}
             */
            operation?: "created" | "updated" | "deleted";
        } | {
            /** @constant */
            kind: "request.snapshot";
            request: components["schemas"]["DepartmentRequest"];
            actorRef?: string;
            action?: string;
        };
        Event: {
            /** @constant */
            specversion: "1.0";
            id: components["schemas"]["EventId"];
            /** @enum {string} */
            source: "urn:techma:backend" | "urn:techma:tooling" | "urn:techma:interface";
            /** @enum {string} */
            type: "bj.techma.message.received.v1" | "bj.techma.message.sent.v1" | "bj.techma.request.created.v1" | "bj.techma.request.status_changed.v1" | "bj.techma.mandate.granted.v1" | "bj.techma.mandate.revoked.v1" | "bj.techma.tool.called.v1" | "bj.techma.configuration.changed.v1" | "bj.techma.request.snapshot.v1";
            /** Format: date-time */
            time: string;
            /** @constant */
            datacontenttype: "application/json";
            traceparent: string;
            data: components["schemas"]["EventData"];
        };
        EventPage: {
            items: components["schemas"]["Event"][];
            nextCursor: string | null;
        };
        SocketTicket: {
            ticket: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: uri */
            url: string;
        };
        MandateGrant: {
            challenge: components["schemas"]["Challenge"];
            /** Format: date-time */
            acceptedAt: string;
            evidenceRef: string;
        };
        Verification: {
            fileId: components["schemas"]["FileId"];
            /** @enum {string} */
            status: "pending" | "valid" | "invalid";
            reasons: string[];
        };
        ModelConfigPage: {
            items: components["schemas"]["ModelConfig"][];
            nextCursor: string | null;
        };
        ToolConfigPage: {
            items: components["schemas"]["ToolConfig"][];
            nextCursor: string | null;
        };
        ProcedurePage: {
            items: components["schemas"]["Procedure"][];
            nextCursor: string | null;
        };
        ConversationPage: {
            items: components["schemas"]["Conversation"][];
            nextCursor: string | null;
        };
        AuditEntryPage: {
            items: components["schemas"]["AuditEntry"][];
            nextCursor: string | null;
        };
        FileAccess: {
            file: components["schemas"]["File"];
            userRef: components["schemas"]["UserRef"];
        };
        McpAuth: {
            /** @constant */
            type: "none";
        } | {
            /** @constant */
            type: "bearer";
            secretRef: string;
        } | {
            /** @constant */
            type: "headers";
            headers: {
                [key: string]: string;
            };
        } | {
            /** @constant */
            type: "oauth-client-credentials";
            /** Format: uri */
            tokenUrl: string;
            clientId: string;
            clientSecretRef: string;
            scope?: string;
            audience?: string;
        };
        McpServer: {
            id: string;
            name: string;
            /** Format: uri */
            url: string;
            enabled: boolean;
            /** @constant */
            transport: "streamable-http";
            auth: components["schemas"]["McpAuth"];
            /** @enum {unknown} */
            policy: "generic" | "techma";
        };
        McpServerPage: {
            items: components["schemas"]["McpServer"][];
            nextCursor: string | null;
        };
        McpToolPermission: {
            enabled: boolean;
            requiresMandate: boolean;
        };
        McpDiscoveredTool: {
            name: string;
            description?: string;
            inputSchema?: Record<string, never>;
            outputSchema?: Record<string, never>;
            enabled: boolean;
            requiresMandate: boolean;
            available: boolean;
            modelName: string;
        } & {
            [key: string]: unknown;
        };
        McpToolPage: {
            items: components["schemas"]["McpDiscoveredTool"][];
            nextCursor: string | null;
        };
        AdminCommand: {
            /** @enum {string} */
            action: "claim" | "request_information" | "approve" | "reject" | "resume";
            revision: number;
            reason?: string;
        };
        BlockingReason: {
            code: string;
            detail: string;
            /** Format: date-time */
            at: string;
        };
        PaymentState: {
            /** @enum {string} */
            status: "not_required" | "pending" | "paid" | "failed" | "cancelled" | "refunded";
            amountFcfa: number;
            /** @constant */
            currency: "XOF";
            reference?: string;
        };
        IssuedDocument: {
            fileId: components["schemas"]["FileId"];
            name: string;
            /** @enum {string} */
            mimeType: "application/pdf" | "image/png" | "image/jpeg";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            simulation: boolean;
        };
        FieldEvidence: {
            field: string;
            /** @enum {string} */
            source: "user" | "document" | "registry";
            reference?: string;
            confirmed: boolean;
        };
        RequestProgress: {
            step: number;
            total: number;
            label: string;
        };
        DepartmentRequest: {
            id: components["schemas"]["RequestId"];
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            procedureId: string;
            status: components["schemas"]["RequestStatus"];
            fields: {
                [key: string]: string | number | boolean | null;
            };
            fileIds: components["schemas"]["FileId"][];
            /** Format: uri */
            officialLink: string | null;
            /** Format: date-time */
            updatedAt: string;
            administrationId: string;
            title: string;
            revision: number;
            /** Format: date-time */
            createdAt: string;
            simulation: boolean;
            /** Format: date-time */
            submittedAt?: string;
            /** Format: date-time */
            completedAt?: string;
            /** @enum {string} */
            completedBy?: "ai" | "human";
            receiptRef?: string;
            assignedTo?: string | null;
            /** Format: date-time */
            dueAt?: string;
            blocking?: components["schemas"]["BlockingReason"];
            payment?: components["schemas"]["PaymentState"];
            documents?: components["schemas"]["IssuedDocument"][];
            progress?: components["schemas"]["RequestProgress"];
            evidence?: components["schemas"]["FieldEvidence"][];
        };
        AdminWorkItem: {
            id: components["schemas"]["RequestId"];
            procedureId: string;
            status: components["schemas"]["RequestStatus"];
            fields: {
                [key: string]: string | number | boolean | null;
            };
            fileIds: components["schemas"]["FileId"][];
            /** Format: uri */
            officialLink: string | null;
            /** Format: date-time */
            updatedAt: string;
            administrationId: string;
            title: string;
            revision: number;
            /** Format: date-time */
            createdAt: string;
            simulation: boolean;
            /** Format: date-time */
            submittedAt?: string;
            /** Format: date-time */
            completedAt?: string;
            /** @enum {string} */
            completedBy?: "ai" | "human";
            receiptRef?: string;
            assignedTo?: string | null;
            /** Format: date-time */
            dueAt?: string;
            blocking?: components["schemas"]["BlockingReason"];
            payment?: components["schemas"]["PaymentState"];
            documents?: components["schemas"]["IssuedDocument"][];
            progress?: components["schemas"]["RequestProgress"];
            evidence?: components["schemas"]["FieldEvidence"][];
        };
        Department: {
            id: string;
            name: string;
            code?: string;
            active: boolean;
            revision: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        DepartmentInput: {
            id: string;
            name: string;
            code?: string;
            active?: boolean;
        };
        DepartmentUpdate: {
            name: string;
            code?: string;
            active: boolean;
            revision: number;
        };
        AdminMembership: {
            departmentId: string;
            /** @enum {string} */
            role: "agent" | "admin";
            active: boolean;
        };
        AdminMembershipInput: {
            departmentId: string;
            /** @enum {string} */
            role: "agent" | "admin";
            active?: boolean;
        };
        AdminUser: {
            subject: string;
            displayName: string;
            /** Format: email */
            email?: string;
            /** Format: uri */
            photoUrl?: string;
            active: boolean;
            superAdmin: boolean;
            memberships: components["schemas"]["AdminMembership"][];
            revision: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminUserInput: {
            subject: string;
            displayName: string;
            /** Format: email */
            email?: string;
            /** Format: uri */
            photoUrl?: string;
            superAdmin?: boolean;
            memberships: components["schemas"]["AdminMembershipInput"][];
        };
        AdminUserUpdate: {
            displayName?: string;
            /** Format: email */
            email?: string | null;
            /** Format: uri */
            photoUrl?: string | null;
            active?: boolean;
            superAdmin?: boolean;
            memberships?: components["schemas"]["AdminMembershipInput"][];
            revision: number;
        };
        AdminProfileUpdate: {
            displayName: string;
            /** Format: email */
            email?: string | null;
            /** Format: uri */
            photoUrl?: string | null;
            revision: number;
        };
        AdminProfile: {
            subject: string;
            displayName: string;
            /** Format: email */
            email?: string;
            /** Format: uri */
            photoUrl?: string;
            active: boolean;
            superAdmin: boolean;
            memberships: components["schemas"]["AdminMembership"][];
            revision: number;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            updatedAt?: string;
            departmentIds: string[];
            permissions: string[];
            /** @constant */
            identityProvider: "oidc";
            /** @constant */
            directorySource: "backend-demo-adapter";
        };
        DepartmentPage: {
            items: components["schemas"]["Department"][];
            nextCursor: string | null;
        };
        AdminUserPage: {
            items: components["schemas"]["AdminUser"][];
            nextCursor: string | null;
        };
        AdminWorkItemPage: {
            items: components["schemas"]["AdminWorkItem"][];
            nextCursor: string | null;
        };
        Dashboard: {
            departmentId: string;
            period: {
                /** Format: date-time */
                from: string;
                /** Format: date-time */
                to: string;
            };
            received: number;
            pending: number;
            blocked: number;
            completed: number;
            completedByAi: number;
            rejected: number;
            overdue: number;
            unanswered: number;
            medianProcessingMs: number | null;
            channels: {
                channel: string;
                count: number;
            }[];
            mostRequested: {
                title: string;
                count: number;
            }[];
        };
        ActivityEntry: {
            id: string;
            requestId: components["schemas"]["RequestId"];
            revision: number;
            actorRef: string | null;
            action: string;
            outcome: string;
            traceId: string;
            /** Format: date-time */
            at: string;
        };
        UnansweredEntry: {
            id: string;
            conversationId: components["schemas"]["ConversationId"];
            messageId: components["schemas"]["MessageId"];
            reason: string;
            /** @enum {string} */
            status: "open" | "resolved";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            resolvedAt: string | null;
        };
        ActivityEntryPage: {
            items: components["schemas"]["ActivityEntry"][];
            nextCursor: string | null;
        };
        UnansweredEntryPage: {
            items: components["schemas"]["UnansweredEntry"][];
            nextCursor: string | null;
        };
        ResolutionResult: {
            id: string;
            /** @constant */
            status: "resolved";
        };
        InternalAdminCommand: {
            /** @enum {string} */
            action: "claim" | "request_information" | "approve" | "reject" | "resume";
            revision: number;
            reason?: string;
            departmentId: string;
            actorRef: string;
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
    listAdminModels: {
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
                    "application/json": components["schemas"]["ModelConfigPage"];
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
    createAdminModels: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelConfig"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelConfig"];
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
    getAdminModels: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
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
                    "application/json": components["schemas"]["ModelConfig"];
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
    updateAdminModels: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelConfig"];
            };
        };
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelConfig"];
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
    deleteAdminModels: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuration supprimée ; réponse sans corps. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    listAdminTools: {
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
                    "application/json": components["schemas"]["ToolConfigPage"];
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
    createAdminTools: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolConfig"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolConfig"];
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
    getAdminTools: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
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
                    "application/json": components["schemas"]["ToolConfig"];
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
    updateAdminTools: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolConfig"];
            };
        };
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolConfig"];
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
    deleteAdminTools: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuration supprimée ; réponse sans corps. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    listAdminProcedures: {
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
    createAdminProcedures: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Procedure"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
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
    getAdminProcedures: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
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
    updateAdminProcedures: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Procedure"];
            };
        };
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
    deleteAdminProcedures: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuration supprimée ; réponse sans corps. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    listAdminConversations: {
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
                    "application/json": components["schemas"]["ConversationPage"];
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
    listAdminAudit: {
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
                    "application/json": components["schemas"]["AuditEntryPage"];
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
    getAdminMetrics: {
        parameters: {
            query?: never;
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
                    "application/json": components["schemas"]["Metrics"];
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
    listAdminMcpServers: {
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
                    "application/json": components["schemas"]["McpServerPage"];
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
    createAdminMcpServer: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["McpServer"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["McpServer"];
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
    getAdminMcpServer: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
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
                    "application/json": components["schemas"]["McpServer"];
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
    updateAdminMcpServer: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["McpServer"];
            };
        };
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["McpServer"];
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
    deleteAdminMcpServer: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    discoverAdminMcpServer: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
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
                    "application/json": components["schemas"]["McpToolPage"];
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
    listAdminMcpTools: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
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
                    "application/json": components["schemas"]["McpToolPage"];
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
    updateAdminMcpToolPermission: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
                toolName: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["McpToolPermission"];
            };
        };
        responses: {
            /** @description Succès */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["McpDiscoveredTool"];
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
