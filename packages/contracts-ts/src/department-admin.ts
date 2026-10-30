export interface paths {
    "/v1/admin/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getAdminProfile
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["getAdminProfile"];
        /**
         * updateAdminProfile
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        put: operations["updateAdminProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/departments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listDepartments
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["listDepartments"];
        put?: never;
        /**
         * createDepartment
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        post: operations["createDepartment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/departments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * updateDepartment
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        put: operations["updateDepartment"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listAdminUsers
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["listAdminUsers"];
        put?: never;
        /**
         * createAdminUser
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        post: operations["createAdminUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/users/{subject}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * updateAdminUser
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        put: operations["updateAdminUser"];
        post?: never;
        /**
         * deactivateAdminUser
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        delete: operations["deactivateAdminUser"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/work-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listWorkItems
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["listWorkItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/work-items/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getWorkItem
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["getWorkItem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/work-items/{id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * actOnWorkItem
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        post: operations["actOnWorkItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/work-items/{id}/documents/{fileId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * downloadAdminDocument
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["downloadAdminDocument"];
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
        /**
         * getDepartmentDashboard
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["getDepartmentDashboard"];
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
        /**
         * listDepartmentActivity
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["listDepartmentActivity"];
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
        /**
         * listUnanswered
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
        get: operations["listUnanswered"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/unanswered/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * resolveUnanswered
         * @description JWT signé et droits du département requis. Voir docs/backend-pivot-api.md. Les essais peuvent modifier les données.
         */
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
            feeFcfa: number;
            processingDays: number;
            source: components["schemas"]["Source"];
            /** @enum {string} */
            validationStatus: "draft" | "validated";
            formSchema: {
                [key: string]: unknown;
            };
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
    getAdminProfile: {
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
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProfile"];
                };
            };
            /** @description Erreur contrôlée */
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
    updateAdminProfile: {
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
                "application/json": components["schemas"]["AdminProfileUpdate"];
            };
        };
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProfile"];
                };
            };
            /** @description Erreur contrôlée */
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
    listDepartments: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DepartmentPage"];
                };
            };
            /** @description Erreur contrôlée */
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
    createDepartment: {
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
                "application/json": components["schemas"]["DepartmentInput"];
            };
        };
        responses: {
            /** @description Opération réussie */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Department"];
                };
            };
            /** @description Erreur contrôlée */
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
    updateDepartment: {
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
                "application/json": components["schemas"]["DepartmentUpdate"];
            };
        };
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Department"];
                };
            };
            /** @description Erreur contrôlée */
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
    listAdminUsers: {
        parameters: {
            query?: {
                departmentId?: string;
                limit?: number;
                cursor?: string;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserPage"];
                };
            };
            /** @description Erreur contrôlée */
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
    createAdminUser: {
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
                "application/json": components["schemas"]["AdminUserInput"];
            };
        };
        responses: {
            /** @description Opération réussie */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description Erreur contrôlée */
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
    updateAdminUser: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                subject: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserUpdate"];
            };
        };
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description Erreur contrôlée */
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
    deactivateAdminUser: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                subject: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Erreur contrôlée */
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
    listWorkItems: {
        parameters: {
            query?: {
                departmentId?: string;
                limit?: number;
                cursor?: string;
                status?: string;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminWorkItemPage"];
                };
            };
            /** @description Erreur contrôlée */
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
    getWorkItem: {
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
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminWorkItem"];
                };
            };
            /** @description Erreur contrôlée */
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
    actOnWorkItem: {
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
                "application/json": components["schemas"]["AdminCommand"];
            };
        };
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminWorkItem"];
                };
            };
            /** @description Erreur contrôlée */
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
    downloadAdminDocument: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                id: string;
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                    "application/pdf": string;
                    "image/png": string;
                    "image/jpeg": string;
                };
            };
            /** @description Erreur contrôlée */
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
    getDepartmentDashboard: {
        parameters: {
            query?: {
                departmentId?: string;
                from?: string;
                to?: string;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Dashboard"];
                };
            };
            /** @description Erreur contrôlée */
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
    listDepartmentActivity: {
        parameters: {
            query?: {
                departmentId?: string;
                limit?: number;
                cursor?: string;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityEntryPage"];
                };
            };
            /** @description Erreur contrôlée */
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
    listUnanswered: {
        parameters: {
            query?: {
                departmentId?: string;
                limit?: number;
                cursor?: string;
            };
            header: {
                traceparent: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnansweredEntryPage"];
                };
            };
            /** @description Erreur contrôlée */
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
    resolveUnanswered: {
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
            /** @description Opération réussie */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResolutionResult"];
                };
            };
            /** @description Erreur contrôlée */
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
