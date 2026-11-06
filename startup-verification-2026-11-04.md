# Startup Verification — 4 November 2026

## Environment and startup

- Node.js 22.23.4 and the repository-pinned pnpm 10.20.0 were used.
- `pnpm install --frozen-lockfile` completed successfully; the lockfile was unchanged.
- The configured `Start application` workflow started the local PostgreSQL instance, Keycloak, backend, tooling service, X-Road simulator, and Next.js interface.
- The three local PostgreSQL databases initialized and the backend migration command completed.
- The interface returned HTTP 200. Backend, tooling, and X-Road health endpoints returned HTTP 200.

## Authentication and integration checks

- Keycloak health, OIDC discovery, and the backend's OIDC/JWKS readiness check succeeded.
- A local authorization-code login completed: Keycloak returned an authorization code, the interface callback exchanged it, and the application issued a session cookie.
- The backend's tooling, MCP, X-Road, and database readiness checks succeeded.
- The application-level diagnostic exercised guest-session creation, conversation creation, message acceptance, the interface-to-backend proxy, and the browser WebSocket event flow.

## Remaining observations

- `pnpm dev:check` reported two failures: model readiness and receiving a generated assistant reply. `MODEL_API_KEY` was absent, so the assistant returned its no-model fallback.
- A login request made with the Replit preview hostname redirects to `127.0.0.1:3000`, while the local Keycloak issuer is `127.0.0.1:8081`. The complete login test therefore confirms local authentication, not authentication from an external preview browser.
- Next.js logged that cross-origin HMR requests from the Replit preview hostname were blocked by `allowedDevOrigins`.
- The browser console showed one resource with HTTP 404; the captured console entry did not identify its URL.

## Scope

- No application source files were changed.
- No deployment was performed.
