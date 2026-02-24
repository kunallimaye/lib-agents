# git-ops

A Git/GitHub operations agent for [OpenCode](https://opencode.ai) TUI.

Provides structured tools for issue management, branch operations, commits, pull requests, code reviews, releases, and conflict resolution -- all accessible through custom tools, slash commands, and an `@git-ops` subagent.

## Prerequisites

- **git** - any recent version
- **[gh CLI](https://cli.github.com)** - v2.0+ (required for GitHub operations)
- **gh authenticated** - run `gh auth login`
- **[bun](https://bun.sh)** - required by OpenCode for TypeScript tools

## Install

Run this from your project directory:

```bash
# Install to current project
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops

# Install globally (available in all projects)
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops --global

# Check prerequisites only
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops --check
```

### Local install (for development)

If you've cloned the `lib-agents` repo:

```bash
# Symlink for development (changes in the repo reflect immediately)
./install.sh git-ops --link

# Copy to current project
./install.sh git-ops --project
```

## Usage

### Agent

Invoke the agent directly in the OpenCode TUI:

```
@git-ops list all open issues labeled "bug"
@git-ops create a feature request for dark mode support
@git-ops show me the status of PR #42
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/git-ops-init` | Check environment readiness, set up default labels/milestones |
| `/issue` | Create, list, or manage issues |
| `/issue add dark mode support` | Create an issue from a description |
| `/issue 42` | View issue #42 |
| `/commit` | Stage changes and create a conventional commit |
| `/pr` | Create a PR from the current branch |
| `/review 42` | Review PR #42's code changes |
| `/release` | Create a release with auto-generated notes |
| `/git-status` | Comprehensive repository status overview |

### Skills

The agent includes two on-demand skills that provide detailed workflow guidance:

- **git-release** - Semantic versioning and changelog generation workflow
- **git-pr-workflow** - PR creation and review best practices

These load automatically when the agent needs them, or you can reference them via:

```
@git-ops use the git-release skill to prepare a new release
```

## Tools Reference

### Environment

| Tool | Description |
|------|-------------|
| `git-ops-init` | Environment check (auto-runs on first use) |
| `git-ops-init_setup` | Create default labels and milestones |

### Issue Management

| Tool | Description |
|------|-------------|
| `gh-issue_create` | Create a new issue |
| `gh-issue_list` | List issues with filters (state, labels, milestone, assignee) |
| `gh-issue_view` | View issue details with comments |
| `gh-issue_update` | Update title, body, labels, milestone, assignees |
| `gh-issue_close` | Close an issue with optional reason |
| `gh-issue_reopen` | Reopen a closed issue |
| `gh-issue_comment` | Add a comment to an issue |

### Branch Management

| Tool | Description |
|------|-------------|
| `git-branch_create` | Create a new branch |
| `git-branch_switch_branch` | Switch to an existing branch |
| `git-branch_delete_branch` | Delete a branch (protects main/master) |
| `git-branch_list` | List branches (local or all) |
| `git-branch_rename` | Rename a branch |
| `git-branch_current` | Show current branch name |

### Commit Workflows

| Tool | Description |
|------|-------------|
| `git-commit_stage` | Stage files for commit |
| `git-commit_commit` | Create a commit |
| `git-commit_amend` | Amend last commit (warns if pushed) |
| `git-commit_unstage` | Unstage files |
| `git-commit_diff_staged` | Show staged changes diff |

### Pull Requests

| Tool | Description |
|------|-------------|
| `gh-pr_create` | Create a PR |
| `gh-pr_list` | List PRs with filters |
| `gh-pr_view` | View PR details |
| `gh-pr_merge` | Merge a PR (merge/squash/rebase) |
| `gh-pr_close` | Close a PR |
| `gh-pr_checkout` | Check out a PR branch locally |

### Code Review

| Tool | Description |
|------|-------------|
| `gh-review_diff` | Get PR diff |
| `gh-review_approve` | Approve a PR |
| `gh-review_request_changes` | Request changes on a PR |
| `gh-review_comment_on_pr` | Leave a review comment |
| `gh-review_list_reviews` | List existing reviews |

### Releases

| Tool | Description |
|------|-------------|
| `gh-release_create` | Create a release |
| `gh-release_list` | List releases |
| `gh-release_view` | View release details |
| `gh-release_delete_release` | Delete a release |
| `gh-release_generate_notes` | Generate release notes from commits |

### Repository Status

| Tool | Description |
|------|-------------|
| `git-status_status` | Working tree status |
| `git-status_log` | Commit log |
| `git-status_diff` | Show diffs |
| `git-status_blame` | Git blame for a file |
| `git-status_stash_list` | List stashes |
| `git-status_stash_push` | Stash changes |
| `git-status_stash_pop` | Pop latest stash |

### Conflict Resolution

| Tool | Description |
|------|-------------|
| `git-conflict_detect` | Detect merge conflicts and list conflicted files |
| `git-conflict_show` | Show conflict markers in a file |
| `git-conflict_abort_merge` | Abort an in-progress merge |

## Safety

The agent enforces several safety rules:

- Protected branches (main, master, develop, production) cannot be deleted without explicit `force: true`
- Commits that have been pushed cannot be amended
- Destructive operations (close, delete, merge) require confirmation
- The agent cannot edit files directly (write/edit/patch tools are disabled)
- Bash commands are restricted to `git *` and `gh *` patterns only

## Default Labels

When you run `/git-ops-init` and choose to set up defaults, these labels are created:

| Label | Color | Description |
|-------|-------|-------------|
| `bug` | Red | Something isn't working |
| `feature` | Green | New feature or request |
| `chore` | Yellow | Maintenance or technical debt |
| `priority:high` | Dark Red | High priority |
| `priority:medium` | Orange | Medium priority |
| `priority:low` | Blue | Low priority |
| `status:in-progress` | Purple | Currently being worked on |
| `status:blocked` | Dark Red | Blocked by something |
