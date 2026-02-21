# Project Agent Delegation

This project uses specialized agents for different domains. The primary agents
(Build and Plan) MUST delegate to the appropriate specialist agent using the
Task tool instead of handling these tasks directly.

## Delegation Table

| When the user asks about... | Delegate to | The agent handles... |
|---|---|---|
| Issues, PRs, commits, branches, reviews, releases | `@git-ops` | All Git and GitHub operations with safety rails and conventional commits |
| Scaffolding, containers, Terraform, CI/CD, GCP, deployment | `@devops` | Issue-driven DevOps workflows with pre-flight checks |
| README, documentation | `@docs` | Minimalist README maintenance and validation |
| Brainstorming, ideation, feature exploration | `@ideate` | Audience-first creative ideation with structured evaluation |

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

## Quick Reference

- "create an issue" / "file a bug" / "track this" → `@git-ops`
- "commit these changes" / "open a PR" / "merge" → `@git-ops`
- "review this PR" / "create a release" → `@git-ops`
- "scaffold a Makefile" / "set up CI/CD" → `@devops`
- "deploy this" / "run terraform plan" → `@devops`
- "build the container" / "manage pods" → `@devops`
- "update the README" / "generate docs" → `@docs`
- "validate documentation" / "check the README" → `@docs`
- "brainstorm ideas" / "explore features" → `@ideate`
- "what should we build?" / "creative session" → `@ideate`
