---
name: devops-workflow
description: Issue-driven DevOps workflow with pre-flight checks, work execution, and PR lifecycle
---

## What I do

- Define the mandatory pre-flight protocol for all DevOps work
- Guide branch naming conventions for issue-linked branches
- Document the full lifecycle from issue to merged PR
- Provide post-merge cleanup procedures

## When to use me

Use this skill when starting any DevOps task, when unsure about the workflow
order, or when onboarding someone to the issue-driven development process.

## Pre-flight Protocol

Every task follows this sequence before work begins:

```
1. Issue Check     ->  Verify GitHub issue exists and is open
2. Clean Tree      ->  No uncommitted changes in working directory
3. Branch Create   ->  Dedicated branch from default branch
```

All three must PASS before any work begins. If any check fails, stop and
resolve the issue before proceeding.

## Branch Naming Convention

Format: `<type>/<issue-number>-<slug>`

| Type | When to use |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fixes |
| `chore` | Maintenance, dependency updates, config changes |
| `docs` | Documentation changes |
| `refactor` | Code restructuring without behavior change |
| `test` | Adding or updating tests |

Examples:
- `feature/42-add-dark-mode`
- `fix/17-login-timeout`
- `chore/5-update-terraform-provider`
- `docs/23-update-deployment-guide`

Rules:
- Slug is derived from the issue title, kebab-cased, max 40 characters
- Always branch from the default branch (usually `main`)
- One branch per issue, one issue per branch

## Full Lifecycle

```
Issue Created
  |
  v
Pre-flight Checks (issue, clean tree, branch)
  |
  v
Work Execution (containers, infra, troubleshooting)
  |
  v
Test Validation (mandatory — PASS / FAIL / WARN)
  |
  v
Stage & Commit (via @git-ops, conventional commit format)
  |
  v
Create PR (via @git-ops, with "Closes #N" in body)
  |         - Always set delete_branch: true
  v
Review & Merge
  |
  v
Post-merge Cleanup
  - Switch to default branch
  - Pull latest
  - Delete local feature branch
  - git fetch --prune
```

## Test Validation

Test validation is a **mandatory** step between work execution and commit.
It runs automatically via the `validate_tests` tool and MUST NOT be silently
skipped.

### Detection Priority

The tool searches for test infrastructure in this order:

1. `make local-test` — Makefile target (preferred, uses `scripts/local.sh test`)
2. `make test` — Fallback Makefile target
3. **Auto-detect** — Infers test command from project type (e.g., `npm test`,
   `go test ./...`, `python3 -m pytest`, `cargo test`)

### Outcomes

| Result | Meaning | Action |
|--------|---------|--------|
| **PASS** | Tests ran and passed | Proceed to commit |
| **FAIL** | Tests ran and failed | Show output. User must explicitly confirm to skip. |
| **WARN** | No test infrastructure found | User must explicitly confirm to proceed. Suggest tracking issue. |

### Skip Override Rules

- The user **CAN** skip test validation, but **MUST** explicitly confirm.
- The agent **MUST NOT** silently skip or auto-confirm on behalf of the user.
- If tests fail, the prompt must include: "Tests failed. Do you want to skip
  test validation and commit anyway? This is not recommended."
- If no tests exist, the prompt must include: "No test infrastructure was
  found. Do you want to proceed without test validation?"
- Skipping should be the exception, not the norm.

## Commit Message Convention

Use conventional commits: `type(scope): description`

- `feat(container): add multi-stage build for API service`
- `fix(terraform): correct GKE node pool machine type`
- `chore(gcloud): update project IAM bindings`
- `docs(readme): add deployment prerequisites`

## Post-merge Cleanup

After a PR is merged, clean up to prevent branch accumulation.
Use the `/cleanup` command to list and prune stale merged branches:

1. Switch to default branch: `git checkout main`
2. Pull latest: `git pull`
3. Delete local branch: `git branch -d <branch>`
4. Prune remote refs: `git fetch --prune`

This is a separate step from the post-work protocol. Do NOT run cleanup
immediately after PR creation -- wait until the PR is merged.
