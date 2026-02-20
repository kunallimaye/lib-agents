# Implementation Plan: Allow Adding Specific Skills to an Agent (#7)

## Overview

This plan covers the full implementation of issue #7 and its 8 sub-issues
(#15-#22). The goal is to decouple skills, tools, and commands from individual
agents, centralize them into top-level directories, and let each agent declare
its resources via frontmatter — enabling users to customize what gets installed.

Issue #18 raises a critical design decision (the `tools:` naming collision)
that must be resolved before any frontmatter work begins.

---

## Current State

```
agents/
├── devops/
│   ├── agent.md              # No resource frontmatter
│   ├── commands/             # 5 commands (cleanup, deploy, devops, infra, scaffold)
│   ├── DEPENDS               # git-ops, docs
│   ├── package.json
│   ├── skills/               # 5 skills (cloudbuild-ops, container-ops, devops-workflow, gcloud-ops, makefile-ops)
│   └── tools/                # 8 tools (.ts files)
├── docs/
│   ├── agent.md
│   ├── commands/             # 2 commands (docs, docs-init)
│   ├── DEPENDS               # git-ops
│   ├── package.json
│   ├── skills/               # 1 skill (readme-conventions)
│   └── tools/                # 3 tools (.ts files)
├── git-ops/
│   ├── agent.md              # Has existing `tools:` field (OpenCode runtime config)
│   ├── commands/             # 6 commands (commit, git-ops-init, git-status, issue, pr, release, review)
│   ├── package.json
│   ├── skills/               # 2 skills (git-pr-workflow, git-release)
│   └── tools/                # 9 tools (.ts files)
└── ideate/
    ├── agent.md
    ├── commands/             # 2 commands (brainstorm, ideate)
    ├── DEPENDS               # git-ops, docs
    └── package.json
```

**Totals:** 8 skills, 20 tools, 16 commands (note: git-ops has 7 commands, not 6 — review.md is the 7th)

**install.sh** currently walks `agents/<name>/skills/`, `agents/<name>/tools/`,
and `agents/<name>/commands/` directories to discover and install resources.

---

## Target State

```
skills/                         # NEW: top-level, shared across agents
├── cloudbuild-ops/SKILL.md
├── container-ops/SKILL.md
├── devops-workflow/SKILL.md
├── gcloud-ops/SKILL.md
├── git-pr-workflow/SKILL.md
├── git-release/SKILL.md
├── makefile-ops/SKILL.md
└── readme-conventions/SKILL.md

tools/                          # NEW: top-level, shared across agents
├── branch-cleanup.ts
├── cloudbuild.ts
├── devops-preflight.ts
├── gcloud.ts
├── gh-issue.ts
├── gh-pr.ts
├── gh-release.ts
├── gh-review.ts
├── git-branch.ts
├── git-commit.ts
├── git-conflict.ts
├── git-ops-init.ts
├── git-status.ts
├── podman.ts
├── readme-analyze.ts
├── readme-scaffold.ts
├── readme-validate.ts
├── scaffold.ts
├── terraform.ts
└── troubleshoot.ts

commands/                       # NEW: top-level, shared across agents
├── brainstorm.md
├── cleanup.md
├── commit.md
├── deploy.md
├── devops.md
├── docs.md
├── docs-init.md
├── git-ops-init.md
├── git-status.md
├── ideate.md
├── infra.md
├── issue.md
├── pr.md
├── release.md
├── review.md
└── scaffold.md

agents/                         # SLIMMED: only agent.md, DEPENDS, package.json
├── devops/
│   ├── agent.md              # Now has install: { skills, tools, commands }
│   ├── DEPENDS
│   └── package.json
├── docs/
│   ├── agent.md
│   ├── DEPENDS
│   └── package.json
├── git-ops/
│   ├── agent.md              # Existing tools: (OpenCode) + new install: block
│   └── package.json
└── ideate/
    ├── agent.md
    ├── DEPENDS
    └── package.json
```

---

## Critical Design Decision: `tools:` Naming Collision (#18)

### The Problem

`git-ops/agent.md` already uses `tools:` as an OpenCode runtime config:

```yaml
tools:
  write: false
  edit: false
  patch: false
```

The new feature needs a `tools:` field to list tool files for installation:

```yaml
tools:
  - gh-issue
  - gh-pr
  - ...
```

These are two different things — one is a map (OpenCode runtime), the other
is a list (install-time resources). They cannot coexist under the same key.

### Recommendation: Option 2 — Nest under `install:` block

```yaml
---
# OpenCode runtime config (unchanged)
tools:
  write: false
  edit: false
  patch: false

# Install-time resource declarations (new)
install:
  skills:
    - git-pr-workflow
    - git-release
  tools:
    - gh-issue
    - gh-pr
    - gh-release
    - gh-review
    - git-branch
    - git-commit
    - git-conflict
    - git-ops-init
    - git-status
  commands:
    - commit
    - git-ops-init
    - git-status
    - issue
    - pr
    - release
    - review
---
```

**Why Option 2:**

1. **No collision** — `install:` is a distinct namespace from `tools:`
2. **Consistent naming** — all three resource types use their natural names
   (`skills`, `tools`, `commands`) without prefixes
3. **Extensible** — future install-time config (e.g., `install.hooks`,
   `install.post_install`) nests naturally
4. **Self-documenting** — the `install:` block clearly signals "these are
   install-time declarations, not runtime config"
5. **Simpler parsing** — `parse_frontmatter_list` targets `install.skills`,
   `install.tools`, `install.commands` — unambiguous

**Why NOT the other options:**

- **Option 1** (`install_skills:`, `install_tools:`, `install_commands:`) —
  verbose, inconsistent with YAML conventions, harder to extend
- **Option 3** (rename only `tools:`) — inconsistent; users would wonder why
  `skills:` and `commands:` are top-level but `tools:` is different

---

## Implementation Phases

### Phase 1: File Moves (#15, #16, #17)

**Dependencies:** None — can start immediately
**Risk:** Low — pure file moves, no logic changes
**Order:** All three can be done in parallel or in a single PR

#### #15 — Centralize skills into `skills/`

```bash
# Create top-level directory
mkdir -p skills/

# Move all 8 skill directories
mv agents/devops/skills/cloudbuild-ops   skills/
mv agents/devops/skills/container-ops    skills/
mv agents/devops/skills/devops-workflow  skills/
mv agents/devops/skills/gcloud-ops       skills/
mv agents/devops/skills/makefile-ops     skills/
mv agents/git-ops/skills/git-pr-workflow skills/
mv agents/git-ops/skills/git-release     skills/
mv agents/docs/skills/readme-conventions skills/

# Remove empty directories
rmdir agents/devops/skills agents/git-ops/skills agents/docs/skills
```

**Verification:** `ls skills/*/SKILL.md` should list 8 files.

#### #16 — Centralize tools into `tools/`

```bash
mkdir -p tools/

# Move all 20 tool files
mv agents/devops/tools/*.ts   tools/
mv agents/git-ops/tools/*.ts  tools/
mv agents/docs/tools/*.ts     tools/

# Remove empty directories
rmdir agents/devops/tools agents/git-ops/tools agents/docs/tools
```

**Verification:** `ls tools/*.ts | wc -l` should be 20. No name collisions
(already confirmed — all 20 tool names are unique).

#### #17 — Centralize commands into `commands/`

```bash
mkdir -p commands/

# Move all 16 command files
mv agents/devops/commands/*.md   commands/
mv agents/git-ops/commands/*.md  commands/
mv agents/docs/commands/*.md     commands/
mv agents/ideate/commands/*.md   commands/

# Remove empty directories
rmdir agents/devops/commands agents/git-ops/commands agents/docs/commands agents/ideate/commands
```

**Verification:** `ls commands/*.md | wc -l` should be 16. No name collisions
(already confirmed).

#### Phase 1 Acceptance Criteria

- [ ] Top-level `skills/`, `tools/`, `commands/` directories exist
- [ ] All 8 skills, 20 tools, 16 commands are in their new locations
- [ ] No `agents/*/skills/`, `agents/*/tools/`, `agents/*/commands/` remain
- [ ] `agents/*/agent.md`, `agents/*/DEPENDS`, `agents/*/package.json` untouched
- [ ] `install.sh` is NOT yet updated (will break — that's expected, Phase 3 fixes it)

**Note:** After Phase 1, `install.sh` will be broken because it still looks
for resources under `agents/<name>/`. This is intentional — Phase 2 adds the
frontmatter, and Phase 3 updates the installer. If you need a working installer
between phases, do Phase 1 + 2 + 3 in a single PR.

---

### Phase 2: Agent Frontmatter (#18)

**Dependencies:** Phase 1 (files must be moved first, or at least the naming
convention must be decided)
**Risk:** Medium — must handle the `tools:` collision correctly

#### Changes per agent

**`agents/devops/agent.md`** — Add `install:` block to frontmatter:

```yaml
---
description: >
  DevOps operations agent...
mode: subagent
temperature: 0.1
install:
  skills:
    - devops-workflow
    - makefile-ops
    - container-ops
    - cloudbuild-ops
    - gcloud-ops
  tools:
    - branch-cleanup
    - cloudbuild
    - devops-preflight
    - gcloud
    - podman
    - scaffold
    - terraform
    - troubleshoot
  commands:
    - cleanup
    - deploy
    - devops
    - infra
    - scaffold
permission:
  bash:
    ...
---
```

**`agents/git-ops/agent.md`** — Add `install:` block, keep existing `tools:`:

```yaml
---
description: >
  Performs Git and GitHub operations...
mode: subagent
temperature: 0.1
tools:
  write: false
  edit: false
  patch: false
install:
  skills:
    - git-pr-workflow
    - git-release
  tools:
    - gh-issue
    - gh-pr
    - gh-release
    - gh-review
    - git-branch
    - git-commit
    - git-conflict
    - git-ops-init
    - git-status
  commands:
    - commit
    - git-ops-init
    - git-status
    - issue
    - pr
    - release
    - review
permission:
  bash:
    ...
---
```

**`agents/docs/agent.md`** — Add `install:` block:

```yaml
---
install:
  skills:
    - readme-conventions
  tools:
    - readme-analyze
    - readme-scaffold
    - readme-validate
  commands:
    - docs
    - docs-init
---
```

**`agents/ideate/agent.md`** — Add `install:` block with empty lists:

```yaml
---
install:
  skills: []
  tools: []
  commands:
    - brainstorm
    - ideate
---
```

#### Phase 2 Acceptance Criteria

- [ ] All 4 agent.md files have `install:` block in frontmatter
- [ ] `git-ops/agent.md` retains its existing `tools:` (OpenCode runtime) field
- [ ] Empty lists use `[]` syntax explicitly
- [ ] No changes to agent.md body content (only frontmatter)

---

### Phase 3: Installer Update (#19)

**Dependencies:** Phase 1 + Phase 2
**Risk:** High — this is the core logic change; must maintain backward compat

#### Key Changes to `install.sh`

1. **Add `parse_frontmatter_list` function** — Extracts YAML list values from
   the `install:` block in agent frontmatter.

2. **Update `ensure_agents_source`** — When cloning from GitHub, the temp
   directory now includes top-level `skills/`, `tools/`, `commands/` dirs.
   Set `REPO_ROOT` to point to the repo root (not just `agents/`).

3. **Replace directory-walking install with frontmatter-driven install:**

   **Before (current):**
   ```bash
   # Walks agents/<name>/tools/*.ts
   for tool_file in "${agent_src}/tools"/*.ts; do ...
   ```

   **After (new):**
   ```bash
   # Reads install.tools from frontmatter, installs from top-level tools/
   for tool in $(parse_frontmatter_list "$agent_md" "tools"); do
     install_tool_from_repo "$tool" "${repo_root}/tools"
   done
   ```

4. **Fallback behavior** — If an agent has no `install:` block, fall back to
   the old directory-walking behavior for backward compatibility during
   migration.

#### `parse_frontmatter_list` Implementation

```bash
# Parse a list field from the install: block in agent frontmatter
# Usage: parse_frontmatter_list <agent.md> <field>
# Example: parse_frontmatter_list agents/devops/agent.md tools
parse_frontmatter_list() {
  local agent_md="$1"
  local field="$2"

  # Extract frontmatter (between --- markers)
  local frontmatter
  frontmatter=$(sed -n '/^---$/,/^---$/p' "$agent_md" | sed '1d;$d')

  # Check if install: block exists
  if ! echo "$frontmatter" | grep -q "^install:"; then
    return 0
  fi

  # Extract the install.<field> list
  # Handles both inline [] and multi-line - item format
  echo "$frontmatter" | \
    sed -n "/^install:/,/^[a-z]/p" | \
    sed -n "/^  ${field}:/,/^  [a-z]/p" | \
    grep '^\s*-' | \
    sed 's/^\s*-\s*//'
}
```

#### New Install Functions

```bash
install_skill_from_repo() {
  local skill_name="$1"
  local skills_src="$2"  # e.g., /path/to/repo/skills
  local skill_src_dir="${skills_src}/${skill_name}"

  if [ ! -d "$skill_src_dir" ] || [ ! -f "${skill_src_dir}/SKILL.md" ]; then
    warn "Skill '${skill_name}' not found in ${skills_src}/. Skipping."
    return 0
  fi

  local skill_dest_dir="${target}/skills/${skill_name}"
  mkdir -p "$skill_dest_dir"
  if [ "$use_link" = true ]; then
    ln -sf "$(realpath "${skill_src_dir}/SKILL.md")" "${skill_dest_dir}/SKILL.md"
    ok "Linked skill -> ${skill_dest_dir}/SKILL.md"
  else
    cp "${skill_src_dir}/SKILL.md" "${skill_dest_dir}/SKILL.md"
    ok "Copied skill -> ${skill_dest_dir}/SKILL.md"
  fi
}

install_tool_from_repo() {
  local tool_name="$1"
  local tools_src="$2"  # e.g., /path/to/repo/tools
  local tool_file="${tools_src}/${tool_name}.ts"

  if [ ! -f "$tool_file" ]; then
    warn "Tool '${tool_name}' not found at ${tool_file}. Skipping."
    return 0
  fi

  local tool_dest="${target}/tools/${tool_name}.ts"
  if [ "$use_link" = true ]; then
    ln -sf "$(realpath "$tool_file")" "$tool_dest"
    ok "Linked tool -> ${tool_dest}"
  else
    cp "$tool_file" "$tool_dest"
    ok "Copied tool -> ${tool_dest}"
  fi
}

install_command_from_repo() {
  local cmd_name="$1"
  local cmds_src="$2"  # e.g., /path/to/repo/commands
  local cmd_file="${cmds_src}/${cmd_name}.md"

  if [ ! -f "$cmd_file" ]; then
    warn "Command '${cmd_name}' not found at ${cmd_file}. Skipping."
    return 0
  fi

  local cmd_dest="${target}/commands/${cmd_name}.md"
  if [ "$use_link" = true ]; then
    ln -sf "$(realpath "$cmd_file")" "$cmd_dest"
    ok "Linked command -> ${cmd_dest}"
  else
    cp "$cmd_file" "$cmd_dest"
    ok "Copied command -> ${cmd_dest}"
  fi
}
```

#### Updated `install_agent` Function

```bash
install_agent_resources() {
  local agent_name="$1"
  local agent_md="${AGENTS_DIR}/${agent_name}/agent.md"
  local repo_root="${SCRIPT_DIR:-${TEMP_DIR}}"

  # Check if agent has install: block in frontmatter
  local has_install_block=false
  if grep -q "^install:" <(sed -n '/^---$/,/^---$/p' "$agent_md"); then
    has_install_block=true
  fi

  if [ "$has_install_block" = true ]; then
    # NEW: Frontmatter-driven install from centralized directories
    info "Installing resources from frontmatter declarations..."

    # Skills
    for skill in $(parse_frontmatter_list "$agent_md" "skills"); do
      install_skill_from_repo "$skill" "${repo_root}/skills"
    done

    # Tools
    for tool in $(parse_frontmatter_list "$agent_md" "tools"); do
      install_tool_from_repo "$tool" "${repo_root}/tools"
    done

    # Commands
    for cmd in $(parse_frontmatter_list "$agent_md" "commands"); do
      install_command_from_repo "$cmd" "${repo_root}/commands"
    done
  else
    # FALLBACK: Legacy directory-walking install
    warn "No install: block found in ${agent_md}. Using legacy directory scan."
    # ... existing code for walking agents/<name>/skills|tools|commands/ ...
  fi
}
```

#### Updated `ensure_agents_source`

```bash
ensure_agents_source() {
  if [ -n "${AGENTS_DIR}" ] && [ -d "${AGENTS_DIR}" ]; then
    # SCRIPT_DIR already points to repo root
    return 0
  fi

  # ... existing clone logic ...
  AGENTS_DIR="${TEMP_DIR}/agents"
  # NEW: SCRIPT_DIR must point to repo root for centralized dirs
  SCRIPT_DIR="${TEMP_DIR}"
  ok "Downloaded agent definitions to temp directory"
}
```

#### Phase 3 Acceptance Criteria

- [ ] `parse_frontmatter_list` correctly extracts `install.skills`, `install.tools`, `install.commands`
- [ ] Resources are installed from top-level `skills/`, `tools/`, `commands/`
- [ ] Fallback to legacy directory-walking works for agents without `install:` block
- [ ] `DEPENDS` resolution still works (dependency agents install their own resources)
- [ ] `--link` mode works with centralized directories
- [ ] Remote install (`curl | bash`) works — temp clone includes top-level dirs
- [ ] Installed output in `.opencode/` is identical to current behavior
- [ ] Edge cases handled: missing resources warn but don't fail, empty lists skip cleanly

---

### Phase 4: CLI Discovery & Customization (#20, #21, #22)

**Dependencies:** Phase 3
**Risk:** Low-Medium — additive features, no breaking changes

#### #20 — Discovery flags (`--list-skills`, `--list-tools`, `--list-commands`)

Add three new flags that scan the top-level directories and display available
resources with descriptions.

**Implementation approach:**

```bash
list_skills() {
  info "Available skills:"
  echo ""
  for skill_dir in "${REPO_ROOT}/skills"/*/; do
    if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
      local name=$(basename "$skill_dir")
      local desc=$(grep "^description:" "${skill_dir}/SKILL.md" | head -1 | sed 's/^description:\s*//' | head -c 80)
      printf "  ${GREEN}%-20s${NC} %s\n" "$name" "$desc"
    fi
  done
  echo ""
  exit 0
}

# Similar for list_tools (parse description from .ts exports) and list_commands
```

**New CLI flags:**
- `--list-skills` — Lists all 8 skills with descriptions from SKILL.md frontmatter
- `--list-tools` — Lists all 20 tools with descriptions from .ts file exports
- `--list-commands` — Lists all 16 commands with descriptions from .md frontmatter

#### #21 — Independent resource install (`--skill`, `--tool`, `--command`)

Allow installing individual resources without an agent context.

**New CLI flags (repeatable):**
- `--skill <name>` — Install a skill from `skills/<name>/`
- `--tool <name>` — Install a tool from `tools/<name>.ts`
- `--command <name>` — Install a command from `commands/<name>.md`

**Implementation approach:**

```bash
# New arrays for standalone resource installs
STANDALONE_SKILLS=()
STANDALONE_TOOLS=()
STANDALONE_COMMANDS=()

# In argument parser:
--skill)   STANDALONE_SKILLS+=("$2"); shift 2 ;;
--tool)    STANDALONE_TOOLS+=("$2"); shift 2 ;;
--command) STANDALONE_COMMANDS+=("$2"); shift 2 ;;

# After agent installs, process standalone resources:
for skill in "${STANDALONE_SKILLS[@]}"; do
  install_skill_from_repo "$skill" "${REPO_ROOT}/skills"
done
# ... same for tools and commands
```

**Combinable with agent install:**
```bash
./install.sh git-ops --skill devops-workflow  # Agent + extra skill
./install.sh --skill git-release              # Standalone skill only
```

#### #22 — Per-agent customization (`--add-*`, `--skip-*`, `--all-*`)

Allow users to customize which resources are installed for a specific agent.

**New CLI flags:**
- `--add-skill <name>`, `--add-tool <name>`, `--add-command <name>` — Add extra resources
- `--skip-skill <name>`, `--skip-tool <name>`, `--skip-command <name>` — Skip defaults
- `--all-skills`, `--all-tools`, `--all-commands` — Install all available resources

**Implementation approach:**

```bash
# Arrays for customization
ADD_SKILLS=(); SKIP_SKILLS=()
ADD_TOOLS=();  SKIP_TOOLS=()
ADD_CMDS=();   SKIP_CMDS=()
ALL_SKILLS=false; ALL_TOOLS=false; ALL_CMDS=false

# In install_agent_resources, wrap the frontmatter loop:
for skill in $(parse_frontmatter_list "$agent_md" "skills"); do
  if is_in_list "$skill" "${SKIP_SKILLS[@]}"; then
    warn "Skipping skill: ${skill}"
    continue
  fi
  install_skill_from_repo "$skill" "${repo_root}/skills"
done

# Install extras
for skill in "${ADD_SKILLS[@]}"; do
  install_skill_from_repo "$skill" "${repo_root}/skills"
done

# Handle --all-skills
if [ "$ALL_SKILLS" = true ]; then
  for skill_dir in "${repo_root}/skills"/*/; do
    install_skill_from_repo "$(basename "$skill_dir")" "${repo_root}/skills"
  done
fi
```

#### Phase 4 Acceptance Criteria

- [ ] `--list-skills`, `--list-tools`, `--list-commands` display formatted output
- [ ] `--skill`, `--tool`, `--command` install standalone resources
- [ ] Standalone installs work with both `--project` and `--global`
- [ ] `--add-*` installs extra resources on top of agent defaults
- [ ] `--skip-*` excludes resources from agent defaults (with warning)
- [ ] `--all-*` installs every available resource of that type
- [ ] `usage()` help text updated with all new flags and examples
- [ ] All flags work with `--link` mode

---

## Recommended Execution Order

### Option A: Single Large PR (Recommended for this repo)

Since the repo is small and the changes are tightly coupled, do Phases 1-3
in a single PR to avoid a broken intermediate state:

1. Move files (Phase 1: #15, #16, #17)
2. Add frontmatter (Phase 2: #18)
3. Update installer (Phase 3: #19)
4. Test end-to-end
5. Single PR that closes #15, #16, #17, #18, #19

Then a second PR for Phase 4:

6. Add discovery flags (#20)
7. Add standalone install (#21)
8. Add customization flags (#22)
9. Single PR that closes #20, #21, #22

### Option B: Sequential PRs (Safer but slower)

If you prefer smaller, reviewable PRs:

1. **PR 1:** Phase 1 (#15, #16, #17) — file moves only
   - `install.sh` will be broken after this PR
   - Mitigate by also including the fallback logic in `install.sh`
2. **PR 2:** Phase 2 (#18) — frontmatter additions
3. **PR 3:** Phase 3 (#19) — installer rewrite
4. **PR 4:** Phase 4 (#20, #21, #22) — CLI enhancements

### Recommendation

**Go with Option A.** The repo has a single maintainer, the changes are
interdependent, and a broken intermediate state (install.sh can't find
resources after file moves) is worse than a larger PR.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `tools:` naming collision breaks OpenCode | High (if not handled) | High | Use `install:` block (Option 2) |
| `install.sh` breaks during migration | Medium | High | Do Phases 1-3 in single PR |
| Remote install (`curl \| bash`) breaks | Medium | High | Test with temp clone after changes |
| YAML parsing edge cases in bash | Medium | Medium | Test with empty lists, missing fields |
| `DEPENDS` resolution breaks | Low | High | Test dependency chain: devops -> git-ops, docs |
| File name collisions in centralized dirs | None | N/A | Already verified: 0 overlaps across all types |

---

## Testing Checklist

After implementation, verify:

1. **Local install:** `./install.sh git-ops --project` installs correct resources
2. **Global install:** `./install.sh --all --global` installs all resources
3. **Link mode:** `./install.sh devops --link` creates symlinks to centralized dirs
4. **Dependency chain:** `./install.sh devops` also installs git-ops and docs resources
5. **Remote install:** `curl -fsSL ... | bash -s -- git-ops` works from GitHub
6. **Idempotent:** Running install twice produces identical output
7. **Output parity:** Installed `.opencode/` structure matches pre-migration output
8. **Discovery:** `--list-skills`, `--list-tools`, `--list-commands` show correct output
9. **Standalone:** `--skill git-release` installs just that skill
10. **Customization:** `--skip-skill gcloud-ops` excludes it, `--add-skill git-release` adds it

---

## Open Items

1. **Resolve #18 naming collision** — This plan recommends `install:` block
   (Option 2). Confirm with repo owner before proceeding.

2. **README updates** — After implementation, update `README.md` to document:
   - New repo structure
   - New CLI flags
   - How to add a new skill/tool/command

3. **Agent README files** — The per-agent `README.md` files in
   `agents/devops/README.md`, `agents/git-ops/README.md`, `agents/docs/README.md`
   may need updates to reflect that resources are no longer co-located.
