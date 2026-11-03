// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ConversationId: string;
        /** @description Généré par le client pour dédupliquer les envois. */
        MessageId: string;
        EventId: string;
        /** @description Référence opaque de l’usager, attribuée par le Backend. Jamais fournie par le navigateur ni par le modèle. */
        UserRef: string;
        FileId: string;
        RequestId: string;
        CaseId: string;
        OfficialId: string;
        MandateId: string;
        ChallengeId: string;
        DocumentId: string;
        UploadId: string;
        UnansweredId: string;
        ActivityId: string;
        /** @description Identifiant stable d’une administration du X-Road simulé (ex. justice, anip). */
        AdministrationId: string;
        /** @description Identifiant officiel de la fiche sur service-public.bj. */
        ProcedureId: string;
        /** @enum {string} */
        Locale: "fr";
        /** @enum {string} */
        Channel: "web" | "whatsapp";
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
        RequiredDocument: {
            documentType: string;
            label: string;
            acceptedMimeTypes: ("application/pdf" | "image/jpeg" | "image/png")[];
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
        ProcedurePage: {
            items: components["schemas"]["Procedure"][];
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
        AdministrationList: {
            items: components["schemas"]["Administration"][];
        };
        /** @enum {string} */
        OfficialRole: "agent" | "admin" | "super_admin";
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
        OfficialPage: {
            items: components["schemas"]["Official"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        OfficialInput: {
            /** Format: email */
            email: string;
            displayName: string;
            jobTitle: string;
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
        };
        OfficialCreated: {
            official: components["schemas"]["Official"];
            /** @description Mot de passe Keycloak à changer à la première connexion. Retourné une seule fois. */
            temporaryPassword: string;
        };
        OfficialUpdate: {
            administrationId: components["schemas"]["AdministrationId"] | null;
            role: components["schemas"]["OfficialRole"];
            active: boolean;
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
        ProfileUpdate: {
            displayName: string;
            jobTitle: string;
        };
        AvatarInput: {
            /** Format: uri */
            avatarUrl: string;
        };
        /** @enum {string} */
        Permission: "cases:read" | "cases:act" | "officials:read" | "officials:manage" | "administrations:all";
        Me: {
            official: components["schemas"]["Official"];
            administration: components["schemas"]["Administration"] | null;
            permissions: components["schemas"]["Permission"][];
        };
        /** @enum {string} */
        CaseStatus: "awaiting_payment" | "received" | "in_review" | "information_requested" | "completed" | "rejected";
        /**
         * @description pending = received, in_review, information_requested.
         * @enum {string}
         */
        CaseView: "pending" | "completed" | "rejected" | "all";
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
        InformationRequest: {
            note: string;
            /** Format: date-time */
            requestedAt: string;
            requestedBy: components["schemas"]["OfficialId"];
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
        CasePage: {
            items: components["schemas"]["Case"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        DocumentRef: {
            documentType: string;
            uploadId: components["schemas"]["UploadId"];
        };
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
        CaseResponseInput: {
            message: string;
            /** @description Valeurs du formulaire de la démarche, conformes à Procedure.filing.formSchema. */
            fields: {
                [key: string]: string | number | boolean | null;
            };
            documents: components["schemas"]["DocumentRef"][];
        };
        CaseActionInput: {
            /** @enum {string} */
            action: "claim" | "request_information" | "approve" | "reject";
            /** @description Obligatoire pour request_information et reject. */
            note: string | null;
        };
        PaymentInput: {
            /** @constant */
            method: "mobile_money";
        };
        Upload: {
            id: components["schemas"]["UploadId"];
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png";
            sizeBytes: number;
            /** Format: date-time */
            expiresAt: string;
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
        Dashboard: {
            metrics: components["schemas"]["Metrics"];
            unansweredOpen: number;
        };
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
        ActivityPage: {
            items: components["schemas"]["ActivityEntry"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
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
        UnansweredPage: {
            items: components["schemas"]["UnansweredEntry"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        HomeContent: {
            /** @description Thèmes des administrations connectées. */
            themes: {
                label: string;
                administrationId: components["schemas"]["AdministrationId"];
                administrationName: string;
            }[];
            /** @description Démarches déposables puis les plus demandées. */
            suggestions: {
                procedureId: components["schemas"]["ProcedureId"];
                title: string;
                /** @description true si l’assistant peut déposer le dossier. */
                assisted: boolean;
            }[];
        };
        GuestSession: {
            /** @description JWT invité signé par le Backend. */
            token: string;
            /** Format: date-time */
            expiresAt: string;
        };
        Conversation: {
            id: components["schemas"]["ConversationId"];
            channel: components["schemas"]["Channel"];
            locale: components["schemas"]["Locale"];
            /** @description true si la conversation est rattachée à un compte Keycloak ou à un numéro WhatsApp vérifié. */
            authenticated: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            lastMessageAt: string | null;
        };
        ConversationPage: {
            items: components["schemas"]["Conversation"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        ConversationInput: {
            locale: components["schemas"]["Locale"];
        };
        AttachInput: {
            guestToken: string;
        };
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
        UserMessage: {
            id: components["schemas"]["MessageId"];
            content: components["schemas"]["Content"];
            /** @description Transcription d’un message vocal. */
            transcript: string | null;
            /** Format: date-time */
            sentAt: string;
        };
        /**
         * @description Brouillon côté Tooling. Après submitted, l’état fait foi dans le dossier X-Road (caseId).
         * @enum {string}
         */
        RequestStatus: "draft" | "ready" | "submitted" | "cancelled";
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
        RequestDocument: {
            documentType: string;
            label: string;
            fileId: components["schemas"]["FileId"] | null;
        };
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
        AgentMessage: {
            id: components["schemas"]["MessageId"];
            conversationId: components["schemas"]["ConversationId"];
            blocks: components["schemas"]["Block"][];
            /** Format: date-time */
            createdAt: string;
        };
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
            type: "bj.techma.message.received.v2" | "bj.techma.message.delta.v2" | "bj.techma.message.sent.v2" | "bj.techma.case.updated.v2" | "bj.techma.tool.called.v2" | "bj.techma.mandate.granted.v2" | "bj.techma.mandate.revoked.v2";
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
            kind: "message.delta";
            conversationId: components["schemas"]["ConversationId"];
            /** @description Même identifiant que le message.sent à venir. */
            messageId: components["schemas"]["MessageId"];
            /** @description Morceau du texte du futur bloc text uniquement. Chaîne vide seulement si un signal terminal est indispensable ; le contrat n’exige pas ce delta terminal. */
            delta: string;
            /** @description Ordre 0-based des morceaux pour un même messageId. Facultatif. */
            index?: number;
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
        EventPage: {
            items: components["schemas"]["Event"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        SocketTicket: {
            ticket: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: uri */
            url: string;
        };
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
        /** @enum {string} */
        Scope: "requests:write" | "documents:write" | "requests:submit";
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
        ConsentInput: {
            challengeId: components["schemas"]["ChallengeId"];
            /** @constant */
            accepted: true;
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
        MandateGrant: {
            challenge: components["schemas"]["Challenge"];
            /** Format: date-time */
            acceptedAt: string;
            evidenceRef: string;
        };
        ModelConfig: {
            id: string;
            label: string;
            /**
             * Format: uri
             * @description Point d’accès compatible OpenAI (ex. https://api.groq.com/openai/v1).
             */
            baseUrl: string;
            /** @enum {string} */
            protocol: "chat-completions" | "responses";
            model: string;
            /** @description Nom de la variable d’environnement qui contient la clé. La clé ne transite jamais par l’API. */
            apiKeyRef: string;
            temperature: number;
            /** @description Un seul modèle actif à la fois. */
            active: boolean;
        };
        ModelConfigPage: {
            items: components["schemas"]["ModelConfig"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
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
            type: "oauth-client-credentials";
            /** Format: uri */
            tokenUrl: string;
            clientId: string;
            clientSecretRef: string;
            scope: string | null;
        };
        McpServer: {
            id: string;
            name: string;
            /** Format: uri */
            url: string;
            enabled: boolean;
            auth: components["schemas"]["McpAuth"];
        };
        McpServerPage: {
            items: components["schemas"]["McpServer"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        McpTool: {
            serverId: string;
            name: string;
            description: string;
            inputSchema: Record<string, never>;
            /** @description Désactivé par défaut après découverte. */
            enabled: boolean;
            /** @description Consentement requis ; vrai par défaut après découverte. */
            requiresMandate: boolean;
        };
        McpToolList: {
            items: components["schemas"]["McpTool"][];
            /** Format: date-time */
            discoveredAt: string | null;
        };
        McpToolPermission: {
            enabled: boolean;
            requiresMandate: boolean;
        };
        OperatorStatus: {
            model: {
                id: string;
                label: string;
                reachable: boolean;
            } | null;
            mcpServers: {
                id: string;
                name: string;
                enabled: boolean;
                reachable: boolean;
                toolCount: number;
                /** Format: date-time */
                checkedAt: string;
            }[];
            administrations: components["schemas"]["Administration"][];
        };
        Problem: {
            type: string;
            title: string;
            status: number;
            /** @enum {string} */
            code: "INVALID_REQUEST" | "UNAUTHORIZED" | "LOGIN_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "MANDATE_MISSING" | "MANDATE_EXPIRED" | "MANDATE_REVOKED" | "MANDATE_SCOPE_DENIED" | "REQUEST_INCOMPLETE" | "INVALID_TRANSITION" | "NOT_ASSISTED" | "REPLAY_EXPIRED" | "UNSUPPORTED_MEDIA_TYPE" | "FILE_TOO_LARGE" | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "MCP_AUTH_FAILED" | "MCP_CONNECTION_FAILED" | "MCP_DISCOVERY_FAILED";
            detail: string;
            traceId: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
