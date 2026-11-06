# Publishing Failure Investigation

Date: 6 November 2026

## Observed failure

- The latest publishing attempt failed after approximately 20 minutes.
- Its build log entered the automatic package-installation stage (`pnpm install`).
- The final recorded error was:
  `Failed to fetch deployment configuration: UNCAUGHT_ERROR`.
- The available log did not contain an application compiler error or output from the
  configured `build:showcase` command. The cause of the configuration-fetch failure
  is not established by this log.
- Publishing metadata lists a public VM domain but no successful build; that metadata
  does not establish that the application is serving successfully.

## Configuration finding and correction

- The current workspace configuration contained four external port mappings:
  the website plus backend, temporary production-test, and browser-helper ports.
- Replit's publishing documentation limits a published VM to one external port.
- Only the website mapping, local 3000 to external 80, now has an external port.
  Other listed ports have no external mapping.
- The development backend now binds to loopback. The development entry command
  and Run-button command remain unchanged.
- The extra port mappings had reappeared after the earlier configuration work.
  Their exact relationship to the failed configuration-fetch request is unproven.

## Verification

- The replacement `.replit` configuration passed Replit's schema validator.
- After restarting the existing workflow, only one explicit external-port mapping remained.
- Backend health, development homepage, and the interface-to-backend home proxy returned HTTP 200.
- A guest conversation obtained a same-origin WebSocket ticket, and its WebSocket handshake
  succeeded through the interface with the backend bound to loopback.
- Workflow output showed zero backend compilation errors and successful dependency readiness checks.
- `git diff --check` passed.
- Dependencies and production application build logic were not changed.

## Limits

No new publishing attempt was triggered. These checks establish that the port configuration
was corrected and the development preview still functions. They do not establish that the
generic configuration-fetch failure is resolved.
