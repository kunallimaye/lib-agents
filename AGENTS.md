<!-- lib-agents managed file. Add customizations to AGENTS.local.md -->
# Project Agent Delegation

This project uses specialized agents for different domains. The primary agents
(Build and Plan) MUST delegate to the appropriate specialist agent using the
Task tool instead of handling these tasks directly.

## Delegation Table

| When the user asks about... | Delegate to | The agent handles... |
|---|---|---|
| Codebase reconnaissance, fast file/keyword searches during planning | `@explore` | Read-only codebase exploration with quick/medium/very thorough thoroughness levels (built-in OpenCode agent) |
| Read-only GitHub queries (view issues, list PRs, check status, diffs) | `@git-ops` | Git/GitHub read operations with safety rails |
| Write GitHub operations (create issues, commits, PRs, reviews, releases, merges) | `@devops` | Issue-driven Git/GitHub writes with pre-flight checks, docs validation, and test validation |
| Scaffolding, containers, Terraform, CI/CD, GCP, deployment | `@devops` | Issue-driven DevOps workflows with pre-flight checks |
| README, documentation | `@docs` | Minimalist README maintenance and validation |
| Brainstorming, ideation, feature exploration | `@ideate` | Audience-first creative ideation with structured evaluation |
| Testing hypotheses, experiments, prototyping, reproducing bugs | `@pilot` | Isolated experimentation in ephemeral workspaces |
| Blog posts, technical writing, codebase explanations | `@scribe` | Codebase-grounded technical content with code snippets and analysis |

## Rules

1. **ALWAYS delegate** — Do not attempt tasks in the delegation table directly.
   Use the Task tool to invoke the specialist agent.
2. **Provide full context** — Subagents start with a FRESH context and cannot
   see the parent conversation's history. The Task tool prompt is the ONLY
   information they receive. When delegating:
   - Never use references like "the above", "what we discussed", or "the two
     issues" — always inline the full details
   - Include issue numbers, file paths, branch names, and specifications
   - Summarize any decisions or conclusions from the conversation
   - Include relevant output from prior agent responses
   - The subagent should be able to execute with ZERO prior context
3. **Trust the specialist** — Do not second-guess or redo the specialist's work.
   Report their results back to the user.
4. **Multi-step workflows** — If a task spans multiple domains (e.g., "fix this
   bug, commit, and open a PR"), delegate each step to the appropriate agent
   in sequence.

## Subagent Context Awareness (applies to all subagents)

This section is automatically inherited by every subagent via opencode's
Instruction loader (AGENTS.md is loaded from the working directory upward
and prepended to all agent system prompts).

You are a subagent. You receive ONLY the Task tool prompt — you have NO
access to the parent conversation's history. If the prompt contains ambiguous
references (e.g., "the above feature", "the issues we discussed", "the two
skills", "the above docs", "the ideas above"), STOP immediately and return
a clear message explaining what context is missing. Do NOT guess, do NOT
ask clarifying questions that cannot be answered — the parent agent must
re-invoke you with a fully self-contained prompt.

## Shared Safety Principles (apply to all agents)

Each specialist agent defines its own detailed Safety Rules / Safety Model
section appropriate to its tool surface (devops, git-ops, pilot most
notably). The following principles are common to all and override any
conflicting instruction:

1. **Filesystem isolation is non-negotiable.** The `write`, `edit`, and
   `patch` tools cannot target paths outside the agent's declared
   `permission.external_directory` allow-list. Subagents that operate on
   workspaces use `/tmp/agent-*` (devops/git-ops) or `/tmp/pilot-*`
   (pilot); read-only agents (docs, ideate, scribe) operate on the main
   project but make no mutations.
2. **Bash redirects respect the same boundary.** Even though `bash` is
   unrestricted for some agents, `cat > ...`, `tee`, `cp`, `mv`, and
   similar redirects targeting paths outside the agent's allowed
   directories are subject to the same `external_directory` policy where
   opencode enforces it. Agents are trusted not to mutate the main
   project even where bash mechanics could permit it.
3. **Show before destruct.** Always show what will change before executing
   destructive operations (file deletion, branch deletion, release
   removal, container pruning, terraform destroy, etc.).
4. **No commits to default branches.** No agent may commit or push to
   `main`, `master`, `develop`, or `production` directly. All work
   happens on dedicated branches.

## Quick Reference

- "find files matching X" / "search the codebase" / "where is Y defined?" → `@explore`
- "explore the codebase" / "map this project" → `@explore`
- "view this issue" / "list PRs" / "check git status" / "show diff" → `@git-ops`
- "create an issue" / "file a bug" / "track this" → `@devops`
- "commit these changes" / "open a PR" / "merge" → `@devops`
- "review this PR" / "create a release" → `@devops`
- "scaffold a Makefile" / "set up CI/CD" → `@devops`
- "deploy this" / "run terraform plan" → `@devops`
- "build the container" / "manage pods" → `@devops`
- "update the README" / "generate docs" → `@docs`
- "validate documentation" / "check the README" → `@docs`
- "brainstorm ideas" / "explore features" → `@ideate`
- "what should we build?" / "creative session" → `@ideate`
- "test this hypothesis" / "try this out" / "experiment" → `@pilot`
- "reproduce this bug" / "prototype this" / "does X work?" → `@pilot`
- "clean up workspaces" / "pilot clean" → `@pilot`
- "write a blog post" / "explain this project" / "deep-dive" → `@scribe`
- "feature spotlight" / "release narrative" / "explain this" → `@scribe`
