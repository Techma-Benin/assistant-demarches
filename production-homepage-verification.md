# Published Homepage Verification

Date: 6 November 2026  
Target: `https://assistant-demarches.replit.app/`

## Publishing versus application readiness

The latest deployment was marked successful at 12:47:16 UTC. Revision-scoped
diagnostic stages show that application startup completed later:

| Stage | Time (UTC) |
| --- | --- |
| PostgreSQL initialization | 12:46:58 |
| Keycloak initialization | 12:47:10 |
| Backend migrations | 12:51:21 |
| Application services | 12:51:33 |
| Interface startup | 12:52:45 |
| Application ready | 12:53:33 |

The launcher reported approximately 400 seconds uptime at readiness. A successful
publish therefore preceded full application readiness by more than six minutes.
This establishes a real startup delay, but does not establish the user's exact
failure time or explain every previously reported freeze.

## Live HTTP observations

Around 12:54 UTC, cookie-free homepage and liveness requests returned HTTP 200 in
approximately 0.3–0.4 seconds. The homepage response contained application HTML,
not the startup status page. Liveness reported `ready: true`; startup readiness
returned HTTP 200 with `status: ok`.

## Browser verification

A fresh desktop browser context loaded the public production URL:

- The header, French headline, question composer, hero photograph, and suggested
  prompts rendered.
- The question input became enabled after the initial settle period.
- Recorded scripts, stylesheets, and the session endpoint returned HTTP 200.
- No failed-request events, remaining pending requests, or JavaScript page
  exceptions were observed after settling.
- Clicking “Comment ça marche” changed the URL to `/#fonctionnement` and reached
  the intended section.
- The settled screenshot was inspected and showed the complete homepage.

One non-blocking resource error was identified: `/favicon.ico` returned 404.
It did not prevent rendering or the tested navigation interaction.

## Request correlation

The browser document request was matched in the new production diagnostics.
Gateway and interface records shared the same request ID and showed HTTP 200
completion at 12:55:36 UTC:

- Interface processing: approximately 16 milliseconds.
- Gateway processing: approximately 22 milliseconds.

This confirms the observed browser request reached and completed through the
deployed gateway and interface. It is not merely an inference from deployment
metadata or a listening port.

## Limits

The blank/frozen homepage was not reproduced in this fresh browser session.
No authenticated operator journey, model request, or mutation was performed.
The user's existing browser state and the previously reported action-triggered
intermittent freeze were not verified.

No application code/configuration, production process, or deployment setting was
changed, and no publishing action was performed during this verification.
