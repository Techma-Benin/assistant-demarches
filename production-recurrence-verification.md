# Production availability recurrence — 2026-11-06

## Scope

Read-only investigation of the renewed homepage failure reported after the user confirmed that the homepage had recovered. No application code, deployment settings, secrets, processes, or production state were changed. No restart or republish was performed.

## Deployment

- URL: https://assistant-demarches.replit.app/
- Deployment metadata: public Reserved VM, current build successful.
- Build: `e812d593-43da-4c3e-99ce-476324ff64e8`.
- Previously observed boot: `4a21191b-7cf6-42cb-9acc-f3ece6d734c4`.

## Directly reproduced failure

Four parallel, unauthenticated GET requests started at **13:21:15 UTC**:

| Path | Result |
| --- | --- |
| `/` | Timeout after approximately 25 seconds; zero response bytes |
| `/health/live` | Timeout after approximately 25 seconds; zero response bytes |
| `/health/ready` | Timeout after approximately 25 seconds; zero response bytes |
| `/api/session` | Timeout after approximately 25 seconds; zero response bytes |

Curl reported status `000`, meaning no HTTP response was obtained, not an HTTP status returned by the application. No response headers or request IDs were received.

Source inspection confirms `/health/live` is handled directly by the gateway without waiting for the private interface. The failure therefore is not limited to rendering the homepage or retrieving a browser session.

## Investigation findings

The production telemetry investigation returned the following evidence:

- The same deployment previously served the homepage successfully at **12:55:36 UTC**: gateway request `2da19f61-2e93-4759-94be-219a0b5662b8` completed in 22 ms; interface processing completed in 16 ms.
- The latest retrieved gateway heartbeat was **13:11:43.109 UTC**. It reported ready state, event-loop maximum/P99 of 22 ms, gateway RSS 57 MB, heap 12 MB, no active or pending HTTP requests, and zero queued or dropped diagnostic log lines.
- Gateway/interface/backend health probes were successful around **13:11:27 UTC**.
- The latest retrieved related runtime/request log was **13:11:46.675 UTC**. No log entry correlating the 13:21 requests was found.
- No later boot, process-exit, shutdown, or OOM entry was returned through the bounded follow-up ending **13:23:25 UTC**.
- The final gateway heartbeat exposed an empty cgroup-memory object. It does not provide evidence of zero OOM events.
- Platform CPU utilization reached **79.1% of the allocated limit at 13:19:25 UTC**, then **95.9% at 13:20:25 UTC**.
- The investigation reported memory near 81% through approximately 13:12 UTC, but no memory samples in the later failure window. Memory at the actual timeout time is unknown.
- A fresh platform query showed continuously advancing instance uptime through **13:23:25 UTC**. An apparent plateau in an earlier query was a query-window artifact and is not evidence of a VM freeze.

## Conclusions and limits

The production failure was independently reproduced. It is not merely a browser-only report, and the earlier successful startup does not explain this recurrence.

Elevated CPU coincided with the failure window and is evidence of resource pressure, but does not establish causation. There is no demonstrated OOM, process crash, restart, or diagnostic logging backpressure.

The available evidence cannot determine whether the unanswered requests reached the gateway, or distinguish a gateway scheduling/event-loop problem from a hosting/ingress problem. Missing runtime logs do not prove a process stopped.

Available deployment telemetry exposes application logs and aggregate metrics, not provider-host lifecycle events or per-request ingress traces. No such trace was available to this investigation.
