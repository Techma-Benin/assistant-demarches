export interface paths {
    "/v1/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** createConversation */
        post: operations["createConversation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** sendMessage */
        post: operations["sendMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listConversationEvents */
        get: operations["listConversationEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/socket-ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** createSocketTicket */
        post: operations["createSocketTicket"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/mandate-challenges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** createMandateChallenge */
        post: operations["createMandateChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/mandates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** grantMandate */
        post: operations["grantMandate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/mandates/{mandateId}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** revokeMandate */
        post: operations["revokeMandate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/requests/{requestId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getRequest */
        get: operations["getRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** uploadFile */
        post: operations["uploadFile"];
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
        RequestStatus: "draft" | "ready" | "awaiting_user_validation" | "submitted" | "processing" | "completed" | "rejected" | "cancelled";
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
            mimeType: "application/pdf" | "image/jpeg" | "image/png" | "audio/ogg" | "audio/mpeg" | "audio/mp4";
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
        };
        Event: {
            /** @constant */
            specversion: "1.0";
            id: components["schemas"]["EventId"];
            /** @enum {string} */
            source: "urn:techma:backend" | "urn:techma:tooling" | "urn:techma:interface";
            /** @enum {string} */
            type: "bj.techma.message.received.v1" | "bj.techma.message.sent.v1" | "bj.techma.request.created.v1" | "bj.techma.request.status_changed.v1" | "bj.techma.mandate.granted.v1" | "bj.techma.mandate.revoked.v1" | "bj.techma.tool.called.v1" | "bj.techma.configuration.changed.v1";
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
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    createConversation: {
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
                "application/json": components["schemas"]["ConversationInput"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Conversation"];
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
    sendMessage: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageInput"];
            };
        };
        responses: {
            /** @description Succès */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageAccepted"];
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
    listConversationEvents: {
        parameters: {
            query?: {
                cursor?: string;
            };
            header: {
                traceparent: string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
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
                    "application/json": components["schemas"]["EventPage"];
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
    createSocketTicket: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SocketTicket"];
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
    createMandateChallenge: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChallengeInput"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Challenge"];
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
    grantMandate: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Consent"];
            };
        };
        responses: {
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mandate"];
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
    revokeMandate: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
                mandateId: components["schemas"]["MandateId"];
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
                    "application/json": components["schemas"]["Mandate"];
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
    getRequest: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
            };
            path: {
                requestId: components["schemas"]["RequestId"];
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
                    "application/json": components["schemas"]["Request"];
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
    uploadFile: {
        parameters: {
            query?: never;
            header: {
                traceparent: string;
                "Idempotency-Key": string;
                "X-File-Mime-Type": "application/pdf" | "image/jpeg" | "image/png" | "audio/ogg" | "audio/mpeg" | "audio/mp4";
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
            /** @description Succès */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["File"];
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
