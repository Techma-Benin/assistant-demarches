---
name: Production cold starts
description: Why the showcase distinguishes a live startup gateway from an application-ready stack
---

Keep gateway liveness separate from application readiness during production cold starts.

**Why:** Publishing's homepage probes exhausted their attempts while the gateway was alive but waiting for the demo identity service. The launcher's shorter identity deadline also terminated realm import before it completed, causing repeated startup attempts. A listening port alone was insufficient when the homepage still returned an unavailable status.

**How to apply:** Preserve an explicit startup status page for homepage probes without claiming that APIs or login are ready. Keep the readiness endpoint unavailable until the actual stack is ready. Production cold-start allowances and prebuilt identity startup must not silently change the existing development startup contract.
