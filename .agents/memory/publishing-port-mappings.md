---
name: Publishing port mappings
description: Workspace preview/test listeners can leave mappings that conflict with a single-port published VM
---

Check external-port mappings after preview/test servers have run, not only when initially configuring publishing. Keep private backend listeners on loopback and their port entries without an external mapping.

**Why:** Extra external mappings for backend and temporary test/helper servers reappeared after the single-gateway publishing configuration had been prepared. Replit's configuration replacement normalized explicit false `exposeLocalhost` settings away but retained private entries without an `externalPort`.

**How to apply:** Audit the effective configuration immediately before recommending a publishing retry. Do not blame a generic publishing error on extra ports without supporting log evidence; correct the independently established configuration problem and distinguish it from an unproven root cause.
