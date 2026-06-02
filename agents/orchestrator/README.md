# orchestrator

Planning orchestrator agent for OpenCode. Analyzes problems, constructs
implementation plans, and delegates execution to specialist subagents
via the Task tool.

## Why this exists

OpenCode's built-in `mode: plan` injects a runtime read-only reminder
every turn that overrides prompt-level instructions and forbids Task
delegation. This causes recurring per-session tension where users must
repeatedly authorize delegation that the prompt already authorizes.

This agent uses `mode: primary` instead. The runtime reminder never
fires. Planning discipline (no direct edits) is enforced by the agent's
own tool config (`write: false`, `edit: false`, `patch: false`) and
read-only-scoped bash permissions, not by relying on the leaky plan
mode mechanism.

## Use cases

- Planning-driven development workflows.
- Issue-to-PR orchestration where one orchestrator coordinates multiple
  specialists (devops for infra, docs for documentation, pilot for
  experimentation, etc.).
- Complex multi-step tasks that span multiple specialist domains.

## Behavior

- Reads, analyzes, asks clarifying questions.
- Produces structured implementation plans.
- Delegates via Task to: git-ops, devops, docs, ideate, pilot, scribe.
- Cannot edit files directly (write/edit/patch tools disabled).
- Bash scoped to read-only commands.

## Set as default

In your project's `opencode.json` or in `~/.config/opencode/opencode.json`:

```json
{
  "default_agent": "orchestrator"
}
```

## Dependencies

Pulls in the six specialist subagents (`git-ops`, `devops`, `docs`,
`ideate`, `pilot`, `scribe`) automatically. See `DEPENDS`.

## Provenance

This agent's prompt was originally derived from `prompts/plan.md`
sections 1-5 (commit `1513a07`), verbatim. The "NOTE — runtime-reminder
caveat" section of that source was intentionally omitted — using
`mode: primary` makes the caveat moot.

`prompts/plan.md` was removed in PR #152 after a pilot verification
confirmed opencode's built-in Plan mode does not load that file at
runtime (the lib-agents installed copy was orphaned). See git history
for the original source content. This orchestrator agent is the
recommended planning interface for all setups.
