# Custom Agent Workflow (Antigravity)

This file defines the workflow and delegation rules for use with advanced AI assistants like Antigravity.

## Core Workflow Rules

1. **Planning Mode**: For any non-trivial task, you must create an `implementation_plan.md` and obtain user approval before execution.
2. **Issue Traceability**: Upon plan approval, you MUST post the approved plan as a comment to the relevant GitHub issue using the `gh` CLI.
3. **Workspace Isolation**: When delegating execution tasks to subagents, always use `Workspace: 'branch'` to create an isolated worktree/branch. Do not operate on the default branch directly.
4. **Tool Usage**: Use standard CLI tools (`gh`, `git`, `terraform`) via `run_command` instead of custom repository-specific tools unless explicitly instructed.

## Subagent Management Rules

When creating subagents using the `define_subagent` tool:
1. **Explicit Tool Grants**: You MUST explicitly list the tools the subagent needs in the `tool_names` array (e.g., `["run_command"]`). Do not rely on default inheritance for execution tools.
2. **Tool Selection**: Grant only the minimum necessary tools for the task (e.g., `run_command` for git/CLI ops).

## Command Approval Guidelines

To operate efficiently in this workspace, follow these defaults for command execution:
1. **Read-Only Operations**: Always set `SafeToAutoRun: true` for read-only commands (e.g., `git status`, `git branch`, `gh issue list`).
2. **Low-Risk Mutations**: For creating branches, staging files, and creating commits, you may set `SafeToAutoRun: true` *provided* the work is part of an approved plan in Planning Mode.
3. **High-Risk Operations**: Operations like `git push` or PR merges must still require explicit user approval, as they affect the remote repository.

## Delegation Table

When handling specific domains, delegate to the appropriate specialist role (via `define_subagent` or by adopting the persona) according to this table:

| Domain / Task | Role | Handles |
|---|---|---|
| Read-only GitHub queries (view issues, list PRs, check status, diffs) | `@git-ops` | Git/GitHub read operations |
| Write GitHub operations (create issues, commits, PRs, reviews, merges) | `@devops` | Issue-driven Git/GitHub writes (may delegate to `@git-ops`) |
| Scaffolding, containers, Terraform, CI/CD, GCP, deployment | `@devops` | Infrastructure and deployment workflows |
| README, documentation | `@docs` | Documentation maintenance and validation |
| Brainstorming, ideation, feature exploration | `@ideate` | Creative ideation with structured evaluation |
| Testing hypotheses, experiments, prototyping, bugs | `@pilot` | Isolated experimentation on a branch workspace |
| Blog posts, technical writing, explanations | `@scribe` | Technical content generation |

## Specialist Role Guidelines

- **`@pilot`**: Spawn a subagent on a branch workspace to run isolated experiments or reproduce bugs. Discard the branch if the experiment fails; create a PR if successful.
- **`@ideate`**: Use for brainstorming (diverge-evaluate-converge). Can be done directly in the main chat or as a subagent.
- **`@git-ops`**: Use `gh` CLI for GitHub operations. Ensure all commits follow conventional commit format.
- **`@devops`**: Use standard tools like `make`, `terraform`, `podman`. Ensure work is linked to an issue.
