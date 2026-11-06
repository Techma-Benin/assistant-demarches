# Runtime Loading Investigation

Date: 6 November 2026  
Scope: Published app and the separate workspace workflow. No application or configuration changes were made.

## Summary

The user confirmed the affected address is the published homepage. The loading
symptom was reproduced through requests from the workspace. The logs do not
establish that logging out caused the original incident.

A subsequent publishing attempt has a confirmed startup blocker: Keycloak exceeds
the three-minute startup deadline, causing the production startup script to exit.
This newer failure must not be treated as proof of the earlier incident's cause.

The workspace development workflow has a separate, explicit startup failure:
PostgreSQL port 54329 and Keycloak port 8081 are already occupied.

## Production state and runtime logs

The deployment service reports a public VM deployment with a successful build at
`https://assistant-demarches.replit.app`.

The successful build began at 10:40:04 UTC and completed at 10:50:30 UTC.
Startup logs showed connection refusal and health-check 500/503 responses between
10:45:01 and 10:49:48 UTC. Next reported ready at 10:49:58, followed by
“Simulation ready” at 10:50:11.

The production telemetry investigation found no error or warning entries from
10:50 to 11:22 UTC, and no runtime entries in the later 11:20–11:23:30 window.
Process uptime around 11:23 was consistent with the original startup, rather than
a newly restarted process.

## Request telemetry

- The earlier aggregate showed 210 requests, 29 classified 4xx, and no 5xx.
- Homepage aggregates included slow responses and 4xx responses.
- Two `/auth/logout` requests were classified 4xx.
- The 11:20–11:23:30 window showed two homepage requests, both classified 4xx,
  with approximately 9.56 seconds average latency.

These aggregates do not provide exact HTTP codes, request IDs, client identities,
or a sequence tying the logout requests to the reported loading failure.

## Live request observations

- A cookie-free GET to `/` around 11:22–11:23 UTC timed out after 30 seconds
  without any response bytes.
- A second homepage request starting at 11:30:56 UTC resolved DNS and completed
  TCP/TLS negotiation in approximately 56 milliseconds, then timed out after
  25 seconds without an HTTP response.
- Subsequent cookie-free GET requests to `/health/ready` and `/auth/logout`
  also completed connection/TLS setup but timed out after 15 seconds without
  response bytes. The logout probe used GET, not the session-changing POST action.

The gateway's readiness route responds directly without invoking the website or
the logout handler. Its failure to respond makes a browser-session-only explanation
insufficient for these probes.

These requests passed through the workspace's internal outbound proxy. They
establish a failure on that request path, but cannot distinguish a deployment
gateway stall from an intermediate proxy/network failure.

## Workspace development workflow

The latest workflow log reports:

> Ports déjà utilisés : postgres (54329), keycloak (8081).

The workflow exits with code 1. This is a confirmed local startup failure, separate
from the deployed VM. It is relevant if the affected address is the development
preview rather than the published URL.

## Logout inspection

The inspected POST handler checks the request origin, reads and clears the session,
and constructs a logout redirect. No service-stop or deployment change appears
in that handler. This inspection does not establish the exact reason for the
observed logout 4xx responses.

## Follow-up: confirmed failure in the newer publishing attempt

A new publishing attempt started at 11:25:43 UTC and failed at 11:37:44 UTC.
Its revision-scoped runtime logs contain:

| Time (UTC) | Observation |
| --- | --- |
| 11:33:49 | `Keycloak n’a pas répondu en 3 minutes.` |
| 11:33:57 | Production startup command exited with status 1. |
| 11:34:00 | Gateway started again, waiting for private services. |
| 11:37:02 | The same three-minute Keycloak timeout occurred. |
| 11:37:03 | Production startup command exited with status 1 again. |
| 11:37:11 | Gateway started again, waiting for private services. |

Repeated homepage health checks returned 503 during these startup attempts.
The Keycloak output showed database/realm initialization still progressing before
the deadline, rather than a logged authentication rejection.

The inspected startup helper imposes a fixed 180-second deadline. Production
waits for Keycloak before starting the backend and website, and a startup exception
exits the overall process. This explains the restart loop in the newer attempt.

The failed attempt's machine configuration was 0.5 vCPU and 2 GB memory.
Resource contention could contribute to slow initialization, but no CPU/memory
measurements or out-of-memory evidence were obtained to establish that cause.

Revision-scoped logs for the earlier successful deployment from 11:00 UTC through
the follow-up query contained only the informational model event at 11:04:52.
They did not reveal the cause of the original homepage timeout.

The first reproduced homepage timeout around 11:22–11:23 preceded the newer
publishing attempt. The later Keycloak startup failure therefore does not,
by itself, explain the original incident or link it to logout.

## Limitations

The affected URL is confirmed; the user's first-failure time remains unknown.
Production request metrics are aggregated and can lag. Some narrow-window metric
queries failed, and CPU/memory datapoints were unavailable.

No restart, session mutation, configuration edit, code change, or publishing action
was performed. The newer deployment's startup blocker is confirmed; the
original loading incident's cause remains unconfirmed.
