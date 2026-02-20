# Implementation Plan: Allow Adding Specific Skills to an Agent (#7)

## Status: IMPLEMENTED

This plan covers the full implementation of issue #7. The goal is to decouple
skills, tools, and commands from individual agents, centralize them into
top-level directories, and use OpenCode's native `permission:` and `tools:`
config for per-agent runtime scoping.

---

## Design: Permission-Based Runtime Scoping (v2)

### Key Principles

1. **Install ALL resources** — `install.sh` copies every skill, tool, command,
   and agent unconditionally to the target directory.
2. **Scope at runtime** — Each agent's `tools:` config disables tools it
   shouldn't access; `permission.skill:` uses `"*": deny` + allow-list to
   scope skills.
3. **Users customize by editing** — Flip `deny` to `allow` or `false` to
   `true` in `.opencode/agents/<name>.md`.
4. **Future-proof** — New resources installed later are automatically denied
   for all agents (safe default via `"*": deny`).

### Why This Design

- **No naming collision** — Uses OpenCode's native `permission:` and `tools:`
  fields, not custom install-time fields.
- **No install-time logic** — Scoping is entirely at runtime. The installer
  is trivially simple (copy everything).
- **Consistent with OpenCode** — Same pattern as OpenCode's built-in `explore`
  agent which uses `"*": deny` + allow-list.
- **`tools:` boolean config deprecated** — As of OpenCode v1.1.1, the legacy
  `tools:` boolean config is deprecated in favor of `permission:`. We use
  `tools:` only to hide/show tools (not for allow/deny scoping).

---

## Implemented Structure

```
lib-agents/
├── agents/                         # Agent definitions only
│   ├── devops/
│   │   ├── agent.md                # tools: + permission: scoping
│   │   ├── DEPENDS                 # Documentation: git-ops, docs
│   │   └── package.json
│   ├── docs/
│   │   ├── agent.md
│   │   ├── DEPENDS                 # Documentation: git-ops
│   │   └── package.json
│   ├── git-ops/
│   │   ├── agent.md
│   │   └── package.json
│   └── ideate/
│       ├── agent.md
│       ├── DEPENDS                 # Documentation: git-ops, docs
│       └── package.json
├── skills/                         # Centralized: all 8 skills
│   ├── cloudbuild-ops/SKILL.md
│   ├── container-ops/SKILL.md
│   ├── devops-workflow/SKILL.md
│   ├── gcloud-ops/SKILL.md
│   ├── git-pr-workflow/SKILL.md
│   ├── git-release/SKILL.md
│   ├── makefile-ops/SKILL.md
│   └── readme-conventions/SKILL.md
├── tools/                          # Centralized: all 20 tools
│   ├── branch-cleanup.ts
│   ├── cloudbuild.ts
│   ├── devops-preflight.ts
│   ├── gcloud.ts
│   ├── gh-issue.ts
│   ├── gh-pr.ts
│   ├── gh-release.ts
│   ├── gh-review.ts
│   ├── git-branch.ts
│   ├── git-commit.ts
│   ├── git-conflict.ts
│   ├── git-ops-init.ts
│   ├── git-status.ts
│   ├── podman.ts
│   ├── readme-analyze.ts
│   ├── readme-scaffold.ts
│   ├── readme-validate.ts
│   ├── scaffold.ts
│   ├── terraform.ts
│   └── troubleshoot.ts
├── commands/                       # Centralized: all 16 commands
│   ├── brainstorm.md
│   ├── cleanup.md
│   ├── commit.md
│   ├── deploy.md
│   ├── devops.md
│   ├── docs-init.md
│   ├── docs.md
│   ├── git-ops-init.md
│   ├── git-status.md
│   ├── ideate.md
│   ├── infra.md
│   ├── issue.md
│   ├── pr.md
│   ├── release.md
│   ├── review.md
│   └── scaffold.md
└── install.sh                      # Copies EVERYTHING unconditionally
```

---

## Per-Agent Scoping

### Mechanism

Two OpenCode-native config fields handle runtime scoping:

| Field | Purpose | Effect |
|-------|---------|--------|
| `tools:` | Hide/show tools | `tool_name: false` removes the tool from the agent entirely (model cannot see it) |
| `permission.skill:` | Allow/deny skills | `"*": deny` + `skill-name: allow` controls which skills the agent can load |

### Agent Scoping Summary

| Agent | Custom Tools | Skills | Notes |
|-------|-------------|--------|-------|
| **git-ops** | gh-issue, gh-pr, gh-release, gh-review, git-branch, git-commit, git-conflict, git-ops-init, git-status | git-pr-workflow, git-release | write/edit/patch disabled via `tools:` |
| **devops** | branch-cleanup, cloudbuild, devops-preflight, gcloud, podman, scaffold, terraform, troubleshoot | devops-workflow, makefile-ops, container-ops, cloudbuild-ops, gcloud-ops | Delegates git/docs to @git-ops/@docs |
| **docs** | readme-analyze, readme-scaffold, readme-validate | readme-conventions | Delegates git to @git-ops |
| **ideate** | (none — delegates everything) | (none — `skill: false`) | Pure brainstorming agent |

---

## Installer Behavior

`install.sh` installs ALL shared resources unconditionally:

1. **Agent arguments** (`./install.sh git-ops docs`) control which agent.md
   files are installed.
2. **Shared resources** (tools, skills, commands) are ALL installed once,
   regardless of which agents are specified.
3. **DEPENDS** files still drive agent dependency ordering (e.g., installing
   `devops` first installs `git-ops` and `docs`).
4. **`--link` mode** creates symlinks to centralized directories for
   development.

---

## Sub-Issues

| # | Issue | Status |
|---|-------|--------|
| #15 | Centralize skills into top-level `skills/` | Implemented |
| #16 | Centralize tools into top-level `tools/` | Implemented |
| #17 | Centralize commands into top-level `commands/` | Implemented |
| #18 | Update agent.md with `tools:` + `permission:` scoping | Implemented |
| #19 | Simplify `install.sh` to install ALL resources | Implemented |
| #20 | Add `--list-skills/tools/commands` discovery flags | Open (Phase 4) |

Issues #21 and #22 were closed as unnecessary — the v2 design eliminates
the need for selective install CLI flags.
