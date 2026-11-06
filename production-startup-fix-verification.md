# Production Startup Fix Verification

Date: 6 November 2026

## History consolidation

- Fetched the remote branch before identifying the unpushed range.
- Consolidated nine unpushed commits into three.
- Confirmed the consolidated HEAD had exactly the same file tree as before consolidation.
- Retained the original history in a local backup ref.
- Did not push or rewrite the remote branch.
- The startup correction and this report are included in the third local commit.

## Startup correction

Production uses the already-built, optimized Keycloak image, allows ten minutes
for realm initialization, and streams Keycloak output immediately. Development
retains `start-dev` and its three-minute allowance.

Discovery requests have individual deadlines, and a terminated identity process
fails readiness without waiting out the entire startup allowance.

During startup, homepage GET/HEAD requests return a clearly labelled, uncached
startup page. This allows the host's homepage startup probe to reach the gateway.
Application readiness remains separate: `/health/ready` and APIs return 503 until
services are ready.

## Automated checks

`node --test scripts/prod/*.test.mjs`: **11 passed, 0 failed**.

Coverage includes:

- Production URL and environment isolation.
- HTTP proxy, identity-route allowlist, and same-origin WebSocket upgrades.
- Startup homepage liveness while API/readiness requests remain unavailable.
- The unchanged three-minute development allowance.
- Successful simulated identity startup after the development deadline.
- Explicit failure at the longer production deadline.
- Aborting hung discovery requests and detecting terminated child processes.

Node syntax checks and `git diff --check` passed.

## Isolated production runtime

Started the updated production launcher with a fresh, separate demo database on
loopback port 5000, using the existing compiled application builds and optimized
Keycloak image. The compiled application code and build commands were unchanged.

Observed:

- The homepage displayed “Starting the simulation” during initialization.
- `/health/ready` initially returned HTTP 503 with `status: starting`.
- Keycloak streamed initialization output and completed its realm import.
- Keycloak reported startup in approximately 30.2 seconds on the workspace machine.
- All application services subsequently became ready.
- `/health/ready` returned HTTP 200 with `status: ok`.
- OIDC discovery returned the expected same-origin login and logout endpoints.
- A fresh, cookie-free logout POST with the correct Origin returned HTTP 303
  to the same-origin Keycloak logout endpoint.
- Backend diagnostics reported PostgreSQL, Keycloak/JWKS, Tooling, nine MCP
  tools, X-Road, and model configuration as available.
- A screenshot rendered the production homepage successfully.

The temporary production stack was stopped after verification. Its generated
database and screenshot are excluded from Git and publishing uploads.

## Development and publishing configuration

Stopped the old development supervisors gracefully, then restarted the existing
workflow once with its unchanged command. Development PostgreSQL and Keycloak
started successfully; the homepage and backend health returned HTTP 200.

After all test listeners stopped and development started, the validated publishing
port configuration contained only local port 3000 mapped to external port 80.

## Limits

- No publishing action or production restart was performed.
- Workspace startup timing is not a benchmark of the smaller production VM.
- The original pre-republish loading incident and its proposed connection to
  operator logout remain unproven.
- The logout probe did not perform an authenticated operator login/logout journey.
- The screenshot capture logged one 404 without identifying its resource;
  the homepage itself rendered.
