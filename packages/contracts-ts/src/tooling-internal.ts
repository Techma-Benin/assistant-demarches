// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.
export interface paths {
    "/internal/v1/mandates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enregistrer un mandat après clic de l’usager
         * @description Le Tooling vérifie le proofToken (JWKS du Backend, audience techma-mandate, jti = challenge.id), consomme le challenge une seule fois et crée le mandat (1 h).
         */
        post: operations["createMandate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/v1/mandates/{mandateId}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Révoquer un mandat */
        post: operations["revokeMandateInternal"];
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
        ConversationId: string;
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
        MandateId: string;
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
        /** @enum {string} */
        Scope: "requests:write" | "documents:write" | "requests:submit";
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
    createMandate: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Clé de 8 à 128 caractères. Même clé + même corps = même réponse pendant 24 h ; corps différent = 409 IDEMPOTENCY_CONFLICT. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MandateGrant"];
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
    revokeMandateInternal: {
        parameters: {
            query?: never;
            header: {
                /** @description W3C Trace Context. Facultatif : le serveur en crée un s’il est absent. */
                traceparent?: string;
                /** @description Usager propriétaire. */
                "X-User-Ref": components["schemas"]["UserRef"];
                /** @description Clé de 8 à 128 caractères. Même clé + même corps = même réponse pendant 24 h ; corps différent = 409 IDEMPOTENCY_CONFLICT. */
                "Idempotency-Key": string;
            };
            path: {
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
