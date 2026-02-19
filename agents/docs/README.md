# docs

A documentation agent for [OpenCode](https://opencode.ai) TUI.

Maintains minimalist README.md files. Analyzes your project, generates clean documentation, validates existing READMEs, and delegates all TODOs/bugs/improvements to the [git-ops](../git-ops/) agent as GitHub issues.

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- [git-ops agent](../git-ops/) installed (for issue delegation)

## Install

```bash
# Install to current project (also installs git-ops dependency)
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- docs

# Install globally
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- docs --global
```

### Local install (for development)

```bash
./install.sh docs --link
```

## Usage

### Agent

```
@docs analyze this project and generate a README
@docs validate the current README
@docs update the README to reflect recent changes
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/docs` | Generate, update, or validate README.md |
| `/docs generate` | Analyze project and create a new README |
| `/docs validate` | Check existing README for issues |
| `/docs update` | Refresh README to match current project state |
| `/docs-init` | Full project analysis + README generation from scratch |

### How it delegates to git-ops

When the docs agent finds issues during analysis or validation, it does NOT add TODO lists to the README. Instead, it calls `@git-ops` to create GitHub issues:

- **Bugs found** (broken build scripts, missing files) -> `bug` label
- **Missing features** (no tests, no CI) -> `feature` label
- **Improvements** (outdated deps, code quality) -> `chore` label
- **Documentation gaps** (API docs, architecture) -> `feature` + `priority:low`

This keeps the README clean and the project backlog in GitHub Issues where it belongs.

## Tools Reference

| Tool | Description |
|------|-------------|
| `readme-analyze` | Analyze project structure, stack, manifests, and history |
| `readme-validate` | Validate README against actual project state |
| `readme-scaffold` | Generate a minimalist README scaffold from project analysis |

## Skills

| Skill | Description |
|-------|-------------|
| `readme-conventions` | Best practices for minimalist README.md files |

## README Philosophy

The docs agent follows these principles:

1. **One screen rule** -- README should fit on one screen when possible
2. **Copy-paste quickstart** -- New dev running in under 2 minutes
3. **No aspirational content** -- Document what exists, not what's planned
4. **Link, don't inline** -- Point to detailed docs, don't duplicate them
5. **Version-aware prerequisites** -- Specify minimum versions
