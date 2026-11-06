# Published Build and Runtime Verification

Date: 6 November 2026  
Scope: Read-only investigation of the current published simulation.

## Actual publishing evidence

The latest successful publishing attempt started at 11:51:36 UTC and was marked
successful at 11:57:10 UTC.

Its build logs explicitly contain:

- `@techma/backend ... build` running `node scripts/build.mjs`.
- `@techma/tooling ... build` running `tsc -p tsconfig.json`.
- `@techma/xroad-sim ... build` running `tsc -p tsconfig.json`.
- `@techma/interface ... build` running `next build`.
- Next reporting successful compilation.
- Keycloak reporting persisted build configuration.
- `Showcase production build complete.`

Thus the published build did run the component build commands. This is distinct
from the previous local startup verification, which reused compiled artifacts
because only launcher code changed.

## Runtime configuration

The publishing run command is `node scripts/prod/start.mjs`, not `pnpm dev`.
The launcher starts the Backend, Tooling, and X-Road compiled `dist` entry points
and starts Next with `next start`. Service environments set `NODE_ENV=production`.

Keycloak starts with `start --optimized`, not `start-dev`. Infrastructure helper
files located under `scripts/dev` are shared by the production launcher with
separate production settings; their directory name does not imply development
server mode.

## Revision-scoped runtime observations

The production telemetry investigation found:

| Time (UTC) | Observation |
| --- | --- |
| 11:57:03 | PostgreSQL ready |
| 11:59:56 | Keycloak ready |
| 12:00:41 | X-Road ready |
| 12:01:18 | Tooling ready |
| 12:01:33 | Backend readiness checks green |
| 12:01:45 | Next ready |
| 12:02:03 | Simulation ready |

The current revision therefore progressed beyond the startup status page.
No post-readiness application errors, process failure, or out-of-memory event
were identified in the examined telemetry.

## Remaining loading symptom

Post-readiness endpoint metrics reported unusually long latencies, including the
homepage, image/photo requests, and a conversation request. These aggregates do
not identify an individual stalled request or prove its cause.

Cookie-free requests from the workspace to both `/` and `/health/ready` completed
DNS/TCP/TLS setup but timed out without HTTP response bytes after 12 seconds.
A separate HTTPS-client check from the execution sandbox also exceeded a
15-second deadline for both routes.

Since the gateway handles `/health/ready` directly, a problem exclusively in
Next page rendering or browser session state does not explain all these
observations. The evidence does not establish whether the stall is inside the
gateway or along the public routing path.

## Resource observations

The configured VM has 0.5 vCPU and 2 GB memory.
For the examined 12:02–12:19 window:

- CPU averaged 55.9% of the allocated limit and peaked at 95.9%.
- Memory averaged 68.1% and peaked at 78.6%.

These measurements support possible transient CPU pressure, but do not establish
sustained saturation, throttling, or memory exhaustion.

## Limits

No code, configuration, deployment capacity, secrets, or production process was
changed. No publishing action was performed. The build/mode question is resolved;
the cause of the continuing public loading failure is not established.
