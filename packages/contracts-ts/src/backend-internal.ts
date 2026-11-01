// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.
export interface paths {
    "/internal/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publier un événement (case.updated, tool.called, mandate.*)
         * @description Scope events:publish. 202 après persistance ; même id = sans effet. Le Backend notifie l’usager (web et WhatsApp) à chaque case.updated.
         */
        post: operations["publishEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/v1/files/{fileId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Vérifier la propriété et la validité d’une pièce
         * @description Scope files:read. 404 si la pièce n’appartient pas à X-User-Ref.
         */
        get: operations["getFileAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/v1/files/{fileId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lire le contenu d’une pièce pour la transmettre au X-Road
         * @description Scope files:read. Jamais appelé pour le modèle.
         */
        get: operations["getFileContent"];
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
        /** @description Identifiant stable d’une administration du X-Road simulé (ex. justice, anip). */
        AdministrationId: string;
        AgentMessage: {
            id: components["schemas"]["MessageId"];
            conversationId: components["schemas"]["ConversationId"];
            blocks: components["schemas"]["Block"][];
            /** Format: date-time */
            createdAt: string;
        };
        Block: {
            /** @constant */
            type: "text";
            text: string;
            /** @description Obligatoire et non vide pour toute information administrative. */
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
            requestId: components["schemas"]["RequestId"];
            documentType: string;
            label: string;
            acceptedMimeTypes: string[];
            received: boolean;
        } | {
            /** @constant */
            type: "loginRequired";
            reason: string;
        } | {
            /** @constant */
            type: "consent";
            challenge: components["schemas"]["Challenge"];
        } | {
            /** @constant */
            type: "requestCard";
            request: components["schemas"]["Request"];
        } | {
            /** @constant */
            type: "caseCard";
            case: components["schemas"]["Case"];
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
        Challenge: {
            id: components["schemas"]["ChallengeId"];
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            procedureId: components["schemas"]["ProcedureId"];
            scopes: components["schemas"]["Scope"][];
            /** @description Texte affiché tel quel par l’Interface. */
            consentText: string;
            /** Format: date-time */
            expiresAt: string;
            /** @description JWT RS256 signé par le Backend, opaque pour l’Interface et le modèle. */
            proofToken: string;
        };
        ChallengeId: string;
        /** @enum {string} */
        Channel: "web" | "whatsapp";
        Content: {
            /** @constant */
            type: "text";
            text: string;
        } | {
            /** @constant */
            type: "audio";
            fileId: components["schemas"]["FileId"];
        } | {
            /** @constant */
            type: "file";
            fileId: components["schemas"]["FileId"];
            /** @description Réponse à un bloc fileRequest ; null pour une pièce libre. */
            documentType: string | null;
        } | {
            /** @constant */
            type: "interaction";
            actionId: string;
            value: string | null;
        };
        ConversationId: string;
        DocumentId: string;
        Event: {
            /** @constant */
            specversion: "1.0";
            id: components["schemas"]["EventId"];
            /** @enum {string} */
            source: "urn:techma:backend" | "urn:techma:tooling";
            /**
             * @description Toujours bj.techma.{data.kind}.v2.
             * @enum {string}
             */
            type: "bj.techma.message.received.v2" | "bj.techma.message.sent.v2" | "bj.techma.case.updated.v2" | "bj.techma.tool.called.v2" | "bj.techma.mandate.granted.v2" | "bj.techma.mandate.revoked.v2";
            /** Format: date-time */
            time: string;
            /** @constant */
            datacontenttype: "application/json";
            data: components["schemas"]["EventData"];
        };
        EventData: {
            /** @constant */
            kind: "message.received";
            conversationId: components["schemas"]["ConversationId"];
            message: components["schemas"]["UserMessage"];
        } | {
            /** @constant */
            kind: "message.sent";
            conversationId: components["schemas"]["ConversationId"];
            message: components["schemas"]["AgentMessage"];
        } | {
            /** @constant */
            kind: "case.updated";
            conversationId: components["schemas"]["ConversationId"];
            case: components["schemas"]["Case"];
        } | {
            /** @constant */
            kind: "tool.called";
            conversationId: components["schemas"]["ConversationId"];
            toolName: string;
            /** @enum {string} */
            outcome: "success" | "error";
            code: string;
        } | {
            /** @enum {string} */
            kind: "mandate.granted" | "mandate.revoked";
            mandate: components["schemas"]["Mandate"];
        };
        EventId: string;
        File: {
            id: components["schemas"]["FileId"];
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png" | "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/webm";
            sizeBytes: number;
            /** Format: date-time */
            expiresAt: string;
        };
        FileAccess: {
            file: components["schemas"]["File"];
            userRef: components["schemas"]["UserRef"];
        };
        FileId: string;
        InformationRequest: {
            note: string;
            /** Format: date-time */
            requestedAt: string;
            requestedBy: components["schemas"]["OfficialId"];
        };
        Mandate: {
            id: components["schemas"]["MandateId"];
            conversationId: components["schemas"]["ConversationId"];
            userRef: components["schemas"]["UserRef"];
            procedureId: components["schemas"]["ProcedureId"];
            scopes: components["schemas"]["Scope"][];
            /** @enum {string} */
            status: "active" | "revoked" | "expired";
            /** Format: date-time */
            expiresAt: string;
        };
        MandateId: string;
        /** @description Généré par le client pour dédupliquer les envois. */
        MessageId: string;
        OfficialId: string;
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
        Request: {
            id: components["schemas"]["RequestId"];
            conversationId: components["schemas"]["ConversationId"];
            procedureId: components["schemas"]["ProcedureId"];
            title: string;
            administrationId: components["schemas"]["AdministrationId"];
            status: components["schemas"]["RequestStatus"];
            fields: components["schemas"]["RequestField"][];
            documents: components["schemas"]["RequestDocument"][];
            /** @description Champs et pièces encore requis avant dépôt. */
            missing: string[];
            caseId: components["schemas"]["CaseId"] | null;
            /** Format: date-time */
            updatedAt: string;
        };
        RequestDocument: {
            documentType: string;
            label: string;
            fileId: components["schemas"]["FileId"] | null;
        };
        RequestField: {
            name: string;
            label: string;
            value: string | number | boolean | null;
            /**
             * @description Provenance affichée dans le panneau « vos informations ».
             * @enum {string|null}
             */
            source: "answer" | "document" | null;
        };
        RequestId: string;
        /**
         * @description Brouillon côté Tooling. Après submitted, l’état fait foi dans le dossier X-Road (caseId).
         * @enum {string}
         */
        RequestStatus: "draft" | "ready" | "submitted" | "cancelled";
        /** @enum {string} */
        Scope: "requests:write" | "documents:write" | "requests:submit";
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
        UserMessage: {
            id: components["schemas"]["MessageId"];
            content: components["schemas"]["Content"];
            /** @description Transcription d’un message vocal. */
            transcript: string | null;
            /** Format: date-time */
            sentAt: string;
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
    publishEvent: {
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
                "application/json": components["schemas"]["Event"];
            };
        };
        responses: {
            /** @description Succès. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Event"];
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
    getFileAccess: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager propriétaire attendu. */
                "X-User-Ref": components["schemas"]["UserRef"];
            };
            path: {
                fileId: components["schemas"]["FileId"];
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
                    "application/json": components["schemas"]["FileAccess"];
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
    getFileContent: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager propriétaire attendu. */
                "X-User-Ref": components["schemas"]["UserRef"];
            };
            path: {
                fileId: components["schemas"]["FileId"];
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
                    "application/octet-stream": string;
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
}
