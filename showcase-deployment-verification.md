# Showcase Deployment Verification

Date: 6 November 2026

## Scope

Verification covered the existing development preview and a separate production-mode
simulation started locally on port 5000. No public deployment was made.

## Results

- `pnpm build:showcase` completed: backend, Tooling, X-Road, and the optimized Next build
  compiled successfully; the portable Java/Keycloak runtime was prepared with PostgreSQL support.
- Production configuration/gateway tests: 6 passed. They covered canonical origins,
  environment isolation, HTTP bodies and cookies, identity-route restrictions,
  startup status, and WebSocket ticket/cursor/Origin forwarding and rejection.
- Existing development environment tests: 5 passed.
- Admin profile component tests: 10 passed after a nullable-value capture fix needed
  for the production TypeScript build.
- The unchanged development command restarted successfully. Its full existing diagnostic
  passed, including dependency readiness, generated assistant replies, same-origin preview
  WebSocket connections, and ordered streaming events.
- The isolated production-mode stack started its own PostgreSQL databases and Keycloak
  instance, then served the compiled application through one gateway port.
- A production-mode API/WebSocket smoke test created a guest session and conversation
  through the interface, obtained a ticket for the same public port, and received
  `message.received`, `message.delta`, and `message.sent` with a generated assistant reply.
- Gateway readiness and proxied Techma OIDC discovery returned HTTP 200.
  The public Keycloak admin path returned HTTP 404.
- A browser test completed demo-agent login through `/keycloak`, returned through
  `/auth/callback`, and displayed the signed-in `/admin` console. Captured browser URLs
  remained on the gateway port, with no redirects to private service ports or the
  development preview domain. No failed browser requests were reported during that journey.
- A screenshot of the production-mode public landing page showed the expected interface.
- After the production origin was supplied, the launcher configuration validated it as
  `https://assistant-demarches.replit.app`, normalized the trailing slash, and used the same
  origin for the interface, backend public URL, and Keycloak issuer. The gateway port
  validated as 3000. This was configuration validation, not a live-domain availability check.

## Browser-test qualification

The tester's overall verdict was **failure** because it was also asked to confirm a dashboard
populated with case records. The signed-in dashboard showed zero counts and empty lists.
This was a fresh, isolated showcase database without seeded administrative cases; the login
and callback portions succeeded. A populated-case scenario was not verified.

## Limits

- There is no successful published build or live HTTPS-domain verification.
- The local runtime/browser checks used loopback HTTP before the production origin was supplied.
- This is not a security audit. Demo accounts, simulated NPI login, and simulated
  administrative/payment integrations remain in place.
- Local deployment state is disposable and is not a durable production database.
- The public-page screenshot's console contained one unidentified HTTP 404, also
  observed before these changes; no visual failure was apparent.
