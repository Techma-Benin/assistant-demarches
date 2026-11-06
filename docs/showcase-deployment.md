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

## Production diagnostics

Production logs include structured JSON records with a shared `bootId`, a process
`pid`, and a `source` (`gateway`, `interface`, `backend`, `tooling`, or `xroad`).
This instrumentation is loaded only by the production launcher; development
commands, login behavior, model calls, and business payloads are unchanged.

- Every gateway HTTP request records a generated `requestId`, method, redacted
  route label, upstream connection/request/header phases, status, elapsed time,
  and completion or cancellation. The ID is returned as `X-Request-ID` and
  forwarded to the private Node service.
- Native Node diagnostic channels trace requests inside the compiled services
  and outgoing HTTP/native-fetch calls. Incoming gateway/service records share
  the request ID. Outgoing calls have their own IDs and source/timing; they do
  not claim automatic parent-span correlation.
- `request.pending` reports requests still open after 30 seconds, with their
  current phase and target. An open streaming response can also be long-running;
  this event alone is not proof of a deadlock.
- Gateway and Node-service heartbeats run every 15 seconds. They report process
  memory, CPU measured as a percentage of one core, event-loop delay, active
  requests, and bounded logger backlog/drop counters. The gateway also samples
  descendant process names/RSS/thread counts and cgroup memory/OOM counters when
  the host exposes them. Process arguments are never collected.
- Independent, two-second HTTP probes run every 30 seconds against Backend,
  Tooling, X-Road, Keycloak discovery, and the signed-out interface session route.
  These probes have no browser cookies and do not call the model.
- Startup stages, readiness durations, child PIDs, exit codes/signals, shutdown
  signals, and unexpected runtime failures are recorded. Existing service output
  continues alongside these diagnostic records.
- `/health/live` responds directly from the gateway without querying another
  service. It returns liveness, the current readiness flag, and its request ID;
  `/health/ready` remains the distinct application-startup readiness check.

The new diagnostic records exclude headers, cookies, authorization, query strings,
request/response bodies, raw error messages/stacks, arbitrary filenames/IDs, SQL,
and WebSocket payloads. Routes keep only known static segments; other segments
become `:value`. Logs go to stdout, not a growing application-disk log file.
The output queue is bounded; dropped-log counts are exposed rather than building
an unlimited memory backlog. Full per-request logging increases log volume.

To interpret an incident:

- Heartbeats continue, but a public probe has no matching `request.start`: the
  request was not observed at the gateway; investigate public routing/ingress.
- A matching gateway request waits on `interface` and the interface probe fails:
  investigate that service's heartbeat and outbound-call records.
- A Node-service heartbeat shows pending outbound calls to `public_origin`,
  `keycloak`, `backend`, or `openai`: use those timings to locate the dependency
  wait without exposing its credentials or payload.
- A heartbeat gap/high event-loop delay or an unexpected process exit provides
  different evidence from a single slow request.

These diagnostics are not themselves a fix for the previously reported freeze.
They cannot log while a process is completely blocked/killed, and no matching
entry alone cannot prove a routing fault if the log collector is delayed or
dropping output. Backend health probes are not exhaustive business/dependency
checks, and browser-only JavaScript errors are not captured here.

## Simulation scope

The changes support publishing a simulation through one port. They do not remove demo
credentials, replace simulated identity checks with real SMS, set an OpenAI spending cap,
or certify the application for real users or sensitive data.
