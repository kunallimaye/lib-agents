---
description: Re-check git/GitHub readiness and offer to set up default labels/milestones
agent: git-ops
---

The `git-ops-init` tool already auto-runs on first use of any git-ops tool,
so an explicit `/git-ops-init` invocation is mainly useful for two things:

1. **Force a re-check** (pass `force: true`) after fixing an environment issue
   such as `gh auth login`, a new remote, or freshly installed `gh` CLI.
2. **Set up repository defaults** that the auto-run does not create on its
   own.

Run `git-ops-init` with `force: true` and report the results.

If the report shows no labels or no milestones, ask the user whether to
create defaults via the `git-ops-init_setup` tool:

- Default labels: `bug`, `feature`, `chore`, `priority:high/medium/low`,
  `status:in-progress/blocked`.
- Optionally a starter milestone (ask for a name like `v0.1` and an
  optional due date).

Only call `git-ops-init_setup` after the user explicitly confirms.
