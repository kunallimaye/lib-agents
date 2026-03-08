# scribe

A codebase-grounded technical content agent for [OpenCode](https://opencode.ai) TUI.

Analyzes your codebase and produces technical content with real code snippets, file path attributions, and "why" commentary. Reads actual source files — never fabricates code. Delegates to the [git-ops](../git-ops/) agent for commit history and release context.

## Content Types

| Type | Description |
|------|-------------|
| Project Overview | What is this project, why does it exist, who is it for |
| Architecture Deep-Dive | Design decisions, tradeoffs, patterns and WHY |
| Feature Spotlight | Zoom into one concept with code and rationale |
| Tutorial/How-to | Step-by-step guide with reproducible code |
| Release Narrative | Diff-driven "what changed and why it matters" |
| Explain | Comprehension mode for understanding, not publishing |

## Tone Presets

| Preset | Audience |
|--------|----------|
| External (default) | Developer blog, intermediate audience |
| Internal | Team wiki, onboarding docs, ADRs |
| Marketing | Landing pages, announcements |

## Model

Pinned to `google/gemini-3.1-pro` for its 1M context window, enabling deep codebase exploration without context pressure.

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- [git-ops agent](../git-ops/) installed (for commit history and release context)

## Install

```bash
# Install to current project (also installs git-ops dependency)
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- scribe

# Install globally
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- scribe --global
```

### Local install (for development)

```bash
./install.sh scribe --link
```

## Usage

### Agent

```
@scribe write a project overview
@scribe architecture deep-dive on the workspace isolation pattern
@scribe feature spotlight on the preflight protocol
@scribe explain how the delegation system works
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/scribe` | Interactive content generation (asks for type, topic, tone) |
| `/scribe overview` | Generate a project overview |
| `/scribe deep-dive` | Architecture deep-dive |
| `/scribe spotlight <topic>` | Feature spotlight on a specific topic |
| `/scribe tutorial <topic>` | Step-by-step tutorial |
| `/scribe release` | Release narrative from recent changes |
| `/scribe explain <topic>` | Comprehension mode explanation |

### Tone flags

Append `--tone=internal` or `--tone=marketing` to any command. Default is `external`.

## Skills

| Skill | Description |
|-------|-------------|
| `blog-conventions` | Content writing conventions, templates, and tone presets |

## Writing Process

1. **Explore** — Read source files, manifests, git history, directory structure
2. **Identify the Story** — Find the narrative arc and key insights
3. **Outline & Checkpoint** — Present outline for user confirmation before writing
4. **Write** — Full content with code snippets and "why" commentary
5. **Output** — Present in conversation; write to file only when asked
