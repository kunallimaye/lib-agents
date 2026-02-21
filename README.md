# lib-agents

Collection of AI agents for the [OpenCode](https://opencode.ai) TUI.

Each agent is a self-contained package with custom tools, slash commands, skills, and an agent definition that can be installed into any project or globally.

## Available Agents

| Agent | Description | Dependencies |
|-------|-------------|--------------|
| [git-ops](agents/git-ops/) | Git/GitHub operations -- issue CRUD, branches, commits, PRs, code reviews, releases, conflict resolution | `gh` CLI |
| [docs](agents/docs/) | Minimalist README.md maintenance -- analyze, generate, validate, and update project documentation | git-ops |
| [devops](agents/devops/) | Issue-driven DevOps workflows -- Makefile scaffolding, Podman containers, Terraform IaC, Cloud Build CI/CD, GCP operations | git-ops, docs |
| [ideate](agents/ideate/) | Audience-centered creative brainstorming -- diverge-evaluate-converge ideation with multiple perspective lenses | git-ops, docs |

## Quick Start

Install an agent into your current project (no clone needed):

```bash
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops
```

Install multiple agents at once:

```bash
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops docs
```

Install all agents:

```bash
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --all
```

Install globally (available in all projects):

```bash
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --all --global
```

### Local install (for development)

Clone the repo and use `--link` so changes reflect immediately:

```bash
git clone https://github.com/kunallimaye/lib-agents.git
cd /path/to/your/project
/path/to/lib-agents/install.sh git-ops --link
```

## Updating

Check your installation status and available updates:

```bash
./install.sh --status
```

Preview what an update would change (no modifications):

```bash
./install.sh --update --dry-run
```

Update all files (creates automatic backup first):

```bash
./install.sh --update
```

Update only specific resource types or a single agent:

```bash
./install.sh --update --only=skills,tools
./install.sh --update --agent=git-ops
```

Rollback to the previous version:

```bash
./install.sh --rollback
```

Remote update via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --status
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --update
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --update --dry-run
```

### Sidecar convention

Create `AGENTS.local.md` in your project root for customizations that persist across updates — its contents are automatically appended to `AGENTS.md` after every install or update.

### How updates work

- **Manifest lockfile** (`.opencode/.lib-agents.lock`) tracks installed version, files, and SHA-256 hashes
- **Unmodified files** are auto-updated; **modified files** prompt for conflict resolution
- **User-owned files** (`AGENTS.md`, `opencode.json`) are never auto-overwritten
- **Backups** are saved to `.opencode/.backup/<timestamp>/` before each update (last 3 kept)

## How It Works

Each agent package in `agents/` contains:

```
agents/<name>/
  agent.md          # Agent definition (mode, prompt, tools, permissions)
  package.json      # Dependencies (if any)
  DEPENDS           # Other agents this one depends on (one per line)
  tools/            # Custom TypeScript tools (executed by OpenCode via Bun)
  commands/         # Slash commands (e.g., /issue, /pr, /commit)
  skills/           # On-demand SKILL.md files for workflow guidance
```

Agents can depend on other agents. When you install an agent, dependencies are installed automatically.

The `install.sh` script copies (or symlinks) these files into the appropriate OpenCode config directories:

- **Project-level** (`--project`): `.opencode/` in the current directory
- **Global** (`--global`): `~/.config/opencode/`
- **Development** (`--link`): Symlinks so changes in the repo reflect immediately

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- [Bun](https://bun.sh) runtime (used by OpenCode for TypeScript tools)
- Agent-specific prerequisites (e.g., `gh` CLI for git-ops)

## Contributing

To add a new agent:

1. Create a new directory under `agents/`
2. Add an `agent.md` with frontmatter (description, mode, tools, permissions)
3. Add custom tools in `tools/` as TypeScript files using `@opencode-ai/plugin`
4. Add slash commands in `commands/` as markdown files
5. Add skills in `skills/<name>/SKILL.md` if needed
6. Add a `DEPENDS` file if the agent requires other agents
7. Update this README

## License

Apache License 2.0
