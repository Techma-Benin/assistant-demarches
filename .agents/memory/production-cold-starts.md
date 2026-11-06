---
name: Production cold starts
description: Why the showcase distinguishes a live startup gateway from an application-ready stack
---

Keep gateway liveness separate from application readiness during production cold starts.

**Why:** Publishing's homepage probes exhausted their attempts while the gateway was alive but waiting for the demo identity service. The launcher's shorter identity deadline also terminated realm import before it completed, causing repeated startup attempts. A listening port alone was insufficient when the homepage still returned an unavailable status.

**How to apply:** Preserve an explicit startup status page for homepage probes without claiming that APIs or login are ready. Keep the readiness endpoint unavailable until the actual stack is ready. Production cold-start allowances and prebuilt identity startup must not silently change the existing development startup contract.

A successful publish or completed startup does not establish that a reported global freeze is resolved.

**Why:** Public requests continued to stall even after a revision had logged complete service readiness, without a corresponding application exception. The startup-readiness flag is not continuous end-to-end availability evidence.

**How to apply:** Correlate actual request arrival/completion, current service probes, and process/event-loop heartbeats before declaring recovery. Keep a confirmed startup failure distinct from an earlier or subsequent availability incident.
