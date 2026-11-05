// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.
export interface paths {
    "/v1/home": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Contenu de l’accueil (thèmes et suggestions)
         * @description Sans authentification. Calculé depuis le X-Road simulé : thèmes des administrations connectées, démarches déposables et les plus demandées.
         */
        get: operations["getHome"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/guest-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ouvrir une session invitée
         * @description Sans authentification. Limité par adresse IP. Le jeton dure 24 h.
         */
        post: operations["createGuestSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/identity/npi": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Démarrer la connexion par NPI (simulée)
         * @description Sans authentification. Disponible seulement si le Backend est lancé avec NPI_SIMULATED_LOGIN=on, sinon 404. Le NPI est transmis une seule fois ici, jamais dans la conversation. Le défi dure 5 minutes.
         */
        post: operations["createNpiChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/identity/npi/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Vérifier le code reçu et ouvrir la session (simulée)
         * @description Sans authentification (le défi tient lieu de jeton). Disponible seulement si NPI_SIMULATED_LOGIN=on, sinon 404. En simulation, tout code numérique est accepté. La session dure 12 h et compte comme un usager connecté.
         */
        post: operations["verifyNpiChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Conversations de la personne courante */
        get: operations["listConversations"];
        put?: never;
        /** Démarrer une conversation web */
        post: operations["createConversation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/attach": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rattacher les conversations invitées au compte connecté
         * @description Connexion requise. Transfère au compte Keycloak les conversations et pièces du jeton invité fourni, sans perte d’historique. Rejouable.
         */
        post: operations["attachConversation"];
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
        /**
         * Envoyer un message
         * @description Dédupliqué par message.id. La réponse arrive par le flux : éventuellement des message.delta (texte live), puis message.sent (AgentMessage complet).
         */
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
        /**
         * Historique et reprise (repli du WebSocket)
         * @description Sans curseur : historique des messages complets (message.received et message.sent) ; pas de message.delta (évite un déluge de jetons au rechargement). Avec curseur, après abonnement : les événements suivants, y compris les message.delta live. Au plus 100 par page.
         */
        get: operations["listEvents"];
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
        /**
         * Ticket WebSocket à usage unique (60 s)
         * @description Connexion ensuite sur ticket.url (?ticket=…&cursor=evt_…). Le serveur pousse un Event JSON par trame. message.delta n’est livré qu’en direct (trames WebSocket et GET …/events avec curseur après abonnement), jamais dans l’historique sans curseur. message.sent clôture la réponse.
         */
        post: operations["createSocketTicket"];
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
        /**
         * Accepter le consentement présenté dans un bloc consent
         * @description Connexion requise. Déclenché uniquement par le clic de l’usager, jamais par le modèle.
         */
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
        /**
         * Retirer un consentement
         * @description Effet immédiat sur les actions suivantes.
         */
        post: operations["revokeMandate"];
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
        /**
         * Déposer une pièce ou un message vocal
         * @description Corps binaire, 10 Mio maximum. Le contenu n’est jamais transmis au modèle. Pièces conservées 24 h si elles ne sont pas rattachées à un dossier.
         */
        post: operations["uploadFile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transcriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Transcrire un vocal sans l’envoyer
         * @description Le fichier audio doit avoir été déposé par l’usager avec POST /v1/files. Aucun message n’est créé et le modèle n’est pas appelé : l’usager relit et corrige le texte, puis l’envoie comme message text. Le fichier suit la conservation de 24 h.
         */
        post: operations["transcribeAudio"];
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
         * Mes démarches (dossiers déposés)
         * @description Connexion requise. Lu en direct dans le X-Road simulé pour l’usager courant.
         */
        get: operations["listMyCases"];
        put?: never;
        post?: never;
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
        /** Un de mes dossiers */
        get: operations["getMyCase"];
        put?: never;
        post?: never;
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
        /** Télécharger un document de mon dossier */
        get: operations["downloadMyCaseDocument"];
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
        AttachInput: {
            guestToken: string;
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
        ConsentInput: {
            challengeId: components["schemas"]["ChallengeId"];
            /** @constant */
            accepted: true;
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
        ConversationId: string;
        ConversationInput: {
            locale: components["schemas"]["Locale"];
        };
        ConversationPage: {
            items: components["schemas"]["Conversation"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
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
        EventId: string;
        EventPage: {
            items: components["schemas"]["Event"][];
            /** @description Curseur opaque de la page suivante ; null en fin de liste. */
            nextCursor: string | null;
        };
        File: {
            id: components["schemas"]["FileId"];
            /** @enum {string} */
            mimeType: "application/pdf" | "image/jpeg" | "image/png" | "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/webm";
            sizeBytes: number;
            /** Format: date-time */
            expiresAt: string;
        };
        FileId: string;
        GuestSession: {
            /** @description JWT invité signé par le Backend. */
            token: string;
            /** Format: date-time */
            expiresAt: string;
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
        InformationRequest: {
            note: string;
            /** Format: date-time */
            requestedAt: string;
            requestedBy: components["schemas"]["OfficialId"];
        };
        /** @enum {string} */
        Locale: "fr";
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
        MessageAccepted: {
            messageId: components["schemas"]["MessageId"];
            conversationId: components["schemas"]["ConversationId"];
            /** @constant */
            status: "accepted";
        };
        /** @description Généré par le client pour dédupliquer les envois. */
        MessageId: string;
        MessageInput: {
            id: components["schemas"]["MessageId"];
            content: components["schemas"]["Content"];
            /** Format: date-time */
            sentAt: string;
        };
        NpiChallenge: {
            /** @description Jeton de défi signé, valable 5 minutes. Ne donne accès à aucune route. */
            challengeToken: string;
            /** Format: date-time */
            expiresAt: string;
            /** @description Vrai tant que le code n’est pas réellement envoyé par SMS. */
            simulated: boolean;
        };
        NpiChallengeInput: {
            /** @description Numéro personnel d’identification, chiffres seulement. */
            npi: string;
        };
        NpiSession: {
            /** @description JWT usager connecté signé par le Backend, 12 h. */
            token: string;
            /** Format: date-time */
            expiresAt: string;
            simulated: boolean;
        };
        NpiVerifyInput: {
            challengeToken: string;
            code: string;
        };
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
        SocketTicket: {
            ticket: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: uri */
            url: string;
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
        Transcription: {
            /** @description Texte transcrit du vocal, à relire et corriger par l’usager avant envoi. */
            text: string;
        };
        TranscriptionInput: {
            fileId: components["schemas"]["FileId"];
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
    getHome: {
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
                    "application/json": components["schemas"]["HomeContent"];
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
    createGuestSession: {
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
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GuestSession"];
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
    createNpiChallenge: {
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
                "application/json": components["schemas"]["NpiChallengeInput"];
            };
        };
        responses: {
            /** @description Succès. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NpiChallenge"];
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
            /** @description Défi invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Connexion par NPI simulée désactivée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Trop de tentatives depuis cette adresse (RATE_LIMITED), avec Retry-After. */
            429: {
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
    verifyNpiChallenge: {
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
                "application/json": components["schemas"]["NpiVerifyInput"];
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NpiSession"];
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
            /** @description Défi expiré ou invalide (UNAUTHORIZED). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Connexion par NPI simulée désactivée (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Trop de tentatives depuis cette adresse (RATE_LIMITED), avec Retry-After. */
            429: {
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
    listConversations: {
        parameters: {
            query?: {
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
                    "application/json": components["schemas"]["ConversationPage"];
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
    createConversation: {
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
                "application/json": components["schemas"]["ConversationInput"];
            };
        };
        responses: {
            /** @description Succès. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Conversation"];
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
    attachConversation: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttachInput"];
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Conversation"];
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
    sendMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
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
            /** @description Succès. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageAccepted"];
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
    listEvents: {
        parameters: {
            query?: {
                /** @description Identifiant du dernier événement reçu. */
                cursor?: string;
            };
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
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
                    "application/json": components["schemas"]["EventPage"];
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
    createSocketTicket: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Succès. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SocketTicket"];
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
    grantMandate: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsentInput"];
            };
        };
        responses: {
            /** @description Succès. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mandate"];
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
    revokeMandate: {
        parameters: {
            query?: never;
            header?: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
            };
            path: {
                conversationId: components["schemas"]["ConversationId"];
                mandateId: components["schemas"]["MandateId"];
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
                    "application/json": components["schemas"]["Mandate"];
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
    uploadFile: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Type du fichier. */
                "X-File-Mime-Type": "application/pdf" | "image/jpeg" | "image/png" | "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/webm";
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
                    "application/json": components["schemas"]["File"];
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
    transcribeAudio: {
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
                "application/json": components["schemas"]["TranscriptionInput"];
            };
        };
        responses: {
            /** @description Succès. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transcription"];
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
            /** @description Fichier inconnu ou appartenant à un autre usager (NOT_FOUND). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Fichier audio ou transcription trop long (FILE_TOO_LARGE). */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Le fichier n’est pas un audio pris en charge (UNSUPPORTED_MEDIA_TYPE). */
            415: {
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
    listMyCases: {
        parameters: {
            query?: {
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
    getMyCase: {
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
    downloadMyCaseDocument: {
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
