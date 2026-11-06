---
name: pnpm bootstrapping
description: A publishing package-install failure caused by system pnpm self-switching versus the Corepack-managed development command
---

Keep Corepack responsible for selecting the repository-pinned pnpm version, rather than enabling pnpm's separate self-switching mechanism.

**Why:** The platform pnpm binary repeatedly tried to bootstrap the pinned pnpm through child `pnpm add` calls, eventually aborting even on a version query. The Corepack shim worked. Disabling pnpm's own version management let the platform binary perform a frozen workspace install while preserving the Corepack pin for development and builds.

**How to apply:** When publishing fails before application compilation, test the actual platform binary as well as the Corepack shim; a successful shim command does not validate the automatic installer's command. Do not remove the version pin or upgrade application dependencies to work around this bootstrap issue.
