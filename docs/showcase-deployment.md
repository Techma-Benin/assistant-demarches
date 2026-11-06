# Publishing the simulated showcase

This is an interactive simulation, not a real administrative service. Existing demo accounts,
simulated NPI login, X-Road, and payments remain unchanged. Do not enter real personal data.
Public model requests consume the configured provider's API quota.

## Development

Continue using the existing Run button or `pnpm dev`. Internal development ports, databases,
and files are unchanged. In Replit preview, WebSocket traffic now goes through the interface's
`/v1/stream` rewrite instead of requiring a second public port.

## Production commands

- Build: `pnpm build:showcase`
- Run: `pnpm start:showcase`
- Deployment type: one Reserved VM, with only the gateway exposed publicly.
- The gateway listens on `0.0.0.0:$PORT` (default 5000).
- Replit's production `PORT` is configured as 3000 to match the existing 3000-to-80
  mapping. The development workflow still uses that mapping as before.
- Browser HTTP requests go to the production Next server. `/v1/stream` upgrades go to
  the backend. Only the Techma realm and login resources are proxied under `/keycloak`;
  Keycloak admin/master routes are not public.
- Internal processes listen on loopback. Backend, Tooling, X-Road, and Next use compiled
  builds, not development watchers. Keycloak uses `start --optimized` with its own
  PostgreSQL database; its optimized image is prepared during the build.
- Any unexpected application-service exit stops the whole stack so the VM supervisor can restart it.
- `/health/ready` returns 503 during startup and 200 once the application services respond.
- During startup, homepage GET/HEAD requests return an explicit, uncached startup
  page with HTTP 200, allowing the host's root startup probe to reach the gateway.
  The page refreshes every three seconds. APIs remain unavailable with 503 until
  the stack is ready; the startup page does not indicate application readiness.
- Production allows Keycloak ten minutes to initialize/import its demo realm and
  streams its logs immediately. Individual discovery probes time out after two
  seconds. Development retains `start-dev` and its three-minute startup allowance.

## Environment

Set these in **production**, not development:

| Variable | Purpose |
| --- | --- |
| `SHOWCASE_PUBLIC_URL` | Exact published HTTPS origin, without a path or trailing route. Never use the development preview URL. |
| `MODEL_PROVIDER` | Existing model provider, currently `openai`. |
| `MODEL_API_KEY` | Provider key, supplied through Replit Secrets; ensure it is available to the deployment. |
| `PORT` | Gateway port; normally supplied by the host or left at 5000. |
| `SHOWCASE_DATA_DIR` | Optional alternate location for the demo's local state. |

The launcher fails explicitly if `SHOWCASE_PUBLIC_URL` is missing or invalid. For a first
publish, copy the chosen publishing URL from the Publishing tool into this variable.
The same origin drives login callbacks, logout URLs, CORS, token issuers, and WebSocket URLs.
Local HTTP origins are accepted only for loopback verification.

## Data and build isolation

Production builds use `.next-showcase`, leaving the development `.next` build alone.
Infrastructure downloads are prepared during build in `.local/showcase-runtime`.
The deployment installs the full locked dependency set, including build tools and the
repository's embedded PostgreSQL package; it does not prune those packages before startup.
Demo PostgreSQL, uploads, and generated signing/session keys live under `.local/showcase-data`,
not development's state directories. A published app's filesystem is not durable storage:
republishing can reset demo records, uploads, keys, and sessions. This setup intentionally
does not migrate the project's existing database to a different database service.
Workspace database files, uploads, and keys are excluded from the deployment source upload.

## Scope

The changes support publishing a simulation through one port. They do not remove demo
credentials, replace simulated identity checks with real SMS, set an OpenAI spending cap,
or certify the application for real users or sensitive data.
