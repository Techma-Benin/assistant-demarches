---
name: Public simulation scope
description: User's showcase intent and boundaries for publishing and development changes
---

The user considers the whole project a simulation, intended to show anyone with its link how it works. Do not treat it as a real administrative service or silently expand the work into replacing simulated business integrations.

**Why:** The user explicitly said the whole project is a simulation and chose access for anyone with the link.

**How to apply:** Describe deployments as simulations, keep real personal data out, and distinguish deployment support from security hardening for real users. The user declined broad public-demo hardening but later authorized the minimal code/configuration changes for production startup, same-origin live updates, and production URLs.

Development must remain startable with the existing `pnpm dev` command and Run button; production runtime and demo state must be separate.

**Why:** The user asked whether publishing changes could be production-only and approved implementation on that basis.

**How to apply:** Preserve development entry points and existing data. If host constraints require a shared networking adaptation, explain it explicitly rather than claiming absolutely no development behavior changed.
