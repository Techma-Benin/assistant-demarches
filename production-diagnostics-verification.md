# Production Diagnostics Verification

Date: 6 November 2026

## Scope

Production-only diagnostic instrumentation was added to the gateway and compiled
Node service launch path. Application business logic, authentication behavior,
development commands, deployment capacity, and secrets were not changed.

This is instrumentation for investigating the reported global freeze, not a
claim that its cause has been identified or corrected.

## Diagnostic coverage

- Gateway request arrival, generated correlation IDs, upstream phases, response
  status, completion/cancellation/error, and long-running request snapshots.
- HTTP and native-fetch requests inside the production interface, Backend,
  Tooling, and X-Road processes, using native Node diagnostic channels.
- Incoming gateway/private-service correlation; outgoing calls have separate
  IDs, source labels, redacted targets/routes, and timing.
- Gateway and service heartbeats, per-process CPU/RSS/heap, event-loop delay,
  pending requests, and bounded logging-queue counters.
- Descendant process names/RSS/thread counts and available cgroup memory events.
- Independent, bounded service-response probes.
- Startup stages, readiness durations, child process creation/exit, and shutdown.
- Direct gateway liveness at `/health/live`, separate from startup readiness.

## Automated verification

`node --test scripts/prod/*.test.mjs`: **22 passed, 0 failed**.

Checks covered route/error redaction, correlation IDs, bounded log backpressure,
pending requests and client cancellation, liveness versus readiness, service
probes and timeout behavior, process snapshots, service observers, heartbeats,
existing HTTP/WebSocket proxy behavior, and development/production startup
allowances.

Node syntax checks and `git diff --check` passed.

## Isolated runtime verification

Started the current production launcher with a separate fresh demo database and
the existing compiled application artifacts on loopback port 5000. The new
production Node preloads were exercised by the real compiled services.

Observed:

- Successful startup of the complete simulation.
- HTTP 200 application readiness and gateway liveness.
- A fresh logout POST returning HTTP 303 to the expected same-origin logout
  endpoint.
- Matching gateway and interface request IDs for that logout.
- All five diagnostic sources: gateway, interface, Backend, Tooling, and X-Road.
- One shared boot ID across those sources.
- Heartbeats from all four Node services and the gateway.
- Service probes, descendant process snapshots, and outgoing public-origin
  identity calls.
- A synthetic canary placed in the request query, authorization header, cookie,
  and body was absent from the captured runtime log.
- The production homepage rendered in a screenshot. The capture also reported
  one 404; this was not treated as evidence of the reported global freeze.

An initial smoke assertion ran before the first 15-second service-heartbeat
interval elapsed. After allowing that interval, all heartbeat/correlation
assertions passed without a code change.

## Controlled process-failure verification

Sent SIGTERM only to the isolated test Backend process. The logs recorded its
unexpected exit, including code/signal fields and `expected: false`, followed by
`runtime.shutdown` with reason `backend_exit`.

The launcher then stopped the remaining isolated services. Keycloak's shutdown
was recorded as expected. The isolated stack exited with code 1 as expected for
the injected service failure. No live deployment process was restarted or killed.

## Development and publishing configuration

The old local development supervisors were stopped gracefully and the existing
workflow restarted once with its unchanged command. Workflow logs reported zero
backend compiler errors and green dependency checks. The development homepage
and backend health returned HTTP 200.

After verification, the temporary production listener was stopped and the
validated public mapping was local port 3000 to external port 80 only.
Generated test data/screenshots remain excluded from Git and deployment uploads.

## Privacy and limits

New structured diagnostic records exclude headers, payloads, query strings,
arbitrary path values/filenames, process arguments, raw error messages/stacks,
SQL, and WebSocket message contents. Existing application output is unchanged.
Per-request diagnostics increase log volume; the in-process output queue is
bounded and exposes drop counts.

No new full component compilation was run because compiled application sources
were unchanged; the real launch verification used the new JavaScript observer
modules with the existing production artifacts.

No publishing action was performed. The live deployment does not contain these
new diagnostics until a subsequent publish. The original freeze remains
unexplained, and diagnostics cannot emit while a process is completely blocked
or after it has been killed. Browser-only JavaScript faults and per-query
database tracing are outside this instrumentation.
