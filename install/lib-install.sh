#!/usr/bin/env bash
# install/lib-install.sh — installation primitives: ensure_agents_source,
# usage, list_agents, check_prerequisites, install_shared_resources,
# install_agent, resolve_target, resolve_project_root.
#
# Requires: lib-logging.sh and the following globals to be set by the
# caller before sourcing:
#   SCRIPT_DIR, AGENTS_DIR, REPO_ROOT, REPO_URL, TEMP_DIR
#   SHARED_RESOURCES_INSTALLED, SOURCE_COMMIT
#   MANIFEST_ENTRIES (indexed array), INSTALLED_AGENTS_LIST (indexed array)

[ -n "${LIB_AGENTS_INSTALL_LOADED:-}" ] && return 0
LIB_AGENTS_INSTALL_LOADED=1

# If no local agents directory, download from GitHub
ensure_agents_source() {
  if [ -n "${AGENTS_DIR}" ] && [ -d "${AGENTS_DIR}" ]; then
    return 0
  fi

  if ! command -v git &>/dev/null; then
    err "git is required to download agents. Install from https://git-scm.com"
    exit 1
  fi

  info "No local agent source found. Downloading from GitHub..."
  TEMP_DIR="$(mktemp -d)"
  if ! git clone --depth 1 --quiet "${REPO_URL}" "${TEMP_DIR}"; then
    err "Failed to clone ${REPO_URL}"
    exit 1
  fi
  AGENTS_DIR="${TEMP_DIR}/agents"
  REPO_ROOT="${TEMP_DIR}"
  # shellcheck disable=SC2034  # Consumed by lib-manifest.sh write_manifest()
  SOURCE_COMMIT=$(git -C "${TEMP_DIR}" rev-parse HEAD 2>/dev/null || echo "unknown")
  ok "Downloaded agent definitions to temp directory"
  echo ""
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <agent-name>... [--project|--global|--link]
       $(basename "$0") --all [--project|--global|--link]
       $(basename "$0") --profile <name> [--project|--global|--link]
       $(basename "$0") --status [--project|--global]
       $(basename "$0") --update [--dry-run] [--only=TYPE,...] [--agent=NAME]
       $(basename "$0") --rollback [--project|--global]

Deploy one or more agent packages to your OpenCode configuration.
Can be run locally from a cloned repo or piped directly via curl.

Arguments:
  agent-name    One or more agent names to install (e.g., git-ops docs)

Install Options:
  --all, -a     Install agents from the default profile (shorthand for --profile default)
  --profile <n> Install using a named profile (e.g., default, sol-dev)
  --profiles    List available profiles with descriptions
  --project     Install to .opencode/ in the current directory (default)
  --global      Install to ~/.config/opencode/
  --link        Symlink instead of copy (for development, local only)
  --check       Only run prerequisite checks, don't install
  --list        List available agents
  --help        Show this help message

Update Options:
  --status      Show installed version, latest version, and per-file status
  --update      Update installation to latest version (creates backup first)
                When used with --profile, switches to the specified profile
  --dry-run     Show what --update would change without modifying anything
  --only=TYPE   Update only specific resource types (comma-separated)
                Types: tools, commands, skills, prompts, agents, configs
  --agent=NAME  Update only the specified agent and its resources
  --rollback    Restore the most recent backup

Remote install (pipe via curl):
  curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --profile default
  curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --all --global
  curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --list

Local install:
  $(basename "$0") --profile default         # Install with default profile
  $(basename "$0") --all                     # Same as --profile default
  $(basename "$0") git-ops                   # Install one agent (no profile)
  $(basename "$0") git-ops docs              # Install multiple agents
  $(basename "$0") git-ops docs --global     # Install multiple agents globally
  $(basename "$0") --all --global            # Install all agents globally
  $(basename "$0") git-ops --link            # Symlink for development
  $(basename "$0") --list                    # List available agents
  $(basename "$0") --profiles                # List available profiles
  $(basename "$0") git-ops docs --check      # Check prerequisites only

Profile management:
  $(basename "$0") --profile default         # Install with default profile
  $(basename "$0") --profiles                # List available profiles
  $(basename "$0") --status                  # Show active profile and status
  $(basename "$0") --profile default --update  # Switch to/re-apply profile

Update & status:
  $(basename "$0") --status                  # Show installation status
  $(basename "$0") --update --dry-run        # Preview what would change
  $(basename "$0") --update                  # Update all files
  $(basename "$0") --update --only=skills    # Update only skills
  $(basename "$0") --update --agent=git-ops  # Update only git-ops agent
  $(basename "$0") --rollback                # Restore from latest backup

Sidecar convention:
  AGENTS.local.md   If this file exists in the project root, its contents are
                    appended to AGENTS.md after every install/update. Use it to
                    add project-specific agent instructions without modifying
                    the managed AGENTS.md file.
  opencode.local.json
                    If this file exists, the installer warns you to manually
                    merge it into opencode.json (JSON deep merge in bash is
                    not supported).
EOF
  exit 0
}

list_agents() {
  info "Available agents:"
  echo ""
  for dir in "${AGENTS_DIR}"/*/; do
    if [ -d "$dir" ]; then
      name=$(basename "$dir")
      desc=""
      if [ -f "${dir}/agent.md" ]; then
        desc=$(grep -A1 "^description:" "${dir}/agent.md" | tail -1 | sed 's/^  //' | head -c 80)
      fi
      echo -e "  ${GREEN}${name}${NC}  ${desc}"
    fi
  done
  echo ""
  exit 0
}

check_prerequisites() {
  local agent_name="$1"
  local all_ok=true

  info "Checking prerequisites for ${agent_name}..."
  echo ""

  # git
  if command -v git &>/dev/null; then
    ok "git installed: $(git --version | sed 's/git version //')"
  else
    err "git is not installed. Install from https://git-scm.com"
    all_ok=false
  fi

  # Check if in a git repo (for --project installs)
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    ok "Inside git repository"
  else
    warn "Not inside a git repository. Git tools require a repo."
  fi

  # gh CLI
  if command -v gh &>/dev/null; then
    ok "gh CLI installed: $(gh --version | head -1 | sed 's/gh version //' | cut -d' ' -f1)"
  else
    warn "gh CLI not installed. GitHub operations require it."
    warn "Install from https://cli.github.com"
    all_ok=false
  fi

  # gh auth
  if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null; then
      ok "gh CLI authenticated"
    else
      warn "gh CLI not authenticated. Run: gh auth login"
      all_ok=false
    fi
  fi

  # bun (required by OpenCode for TypeScript tools)
  if command -v bun &>/dev/null; then
    ok "bun installed: $(bun --version)"
  else
    warn "bun not installed. OpenCode uses bun for TypeScript tools."
    warn "Install from https://bun.sh"
  fi

  echo ""
  if [ "$all_ok" = true ]; then
    ok "All prerequisites met."
  else
    warn "Some prerequisites are missing. The agent will work with reduced functionality."
  fi
  echo ""

  return 0
}

# Install shared resources (tools, skills, commands) from centralized dirs.
# Called once regardless of how many agents are installed.
# When a profile is active, only installs skills from PROFILE_ALL_SKILLS.
install_shared_resources() {
  local target="$1"
  local use_link="$2"

  if [ "$SHARED_RESOURCES_INSTALLED" = true ]; then
    return 0
  fi

  info "Installing shared resources..."
  echo ""

  # Create target directories
  mkdir -p "${target}/tools"
  mkdir -p "${target}/commands"

  # Install ALL tools from top-level tools/
  if [ -d "${REPO_ROOT}/tools" ]; then
    for tool_file in "${REPO_ROOT}/tools"/*.ts; do
      if [ -f "$tool_file" ]; then
        local tool_name
        tool_name=$(basename "$tool_file")
        local tool_dest="${target}/tools/${tool_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$tool_file")" "$tool_dest"
          ok "Linked tool -> ${tool_name}"
        else
          cp "$tool_file" "$tool_dest"
          ok "Copied tool -> ${tool_name}"
        fi
        record_file "$tool_dest" "shared"
      fi
    done
  fi

  # Install ALL commands from top-level commands/
  if [ -d "${REPO_ROOT}/commands" ]; then
    for cmd_file in "${REPO_ROOT}/commands"/*.md; do
      if [ -f "$cmd_file" ]; then
        local cmd_name
        cmd_name=$(basename "$cmd_file")
        local cmd_dest="${target}/commands/${cmd_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$cmd_file")" "$cmd_dest"
          ok "Linked command -> ${cmd_name}"
        else
          cp "$cmd_file" "$cmd_dest"
          ok "Copied command -> ${cmd_name}"
        fi
        record_file "$cmd_dest" "shared"
      fi
    done
  fi

  # Install skills — selective when profile is active, all otherwise
  if [ -d "${REPO_ROOT}/skills" ]; then
    if [ -n "${PROFILE_NAME:-}" ] && [ ${#PROFILE_ALL_SKILLS[@]} -gt 0 ]; then
      # Profile mode: install only skills from UNION(agent_skills)
      info "Profile '${PROFILE_NAME}': installing ${#PROFILE_ALL_SKILLS[@]} of $(ls -d "${REPO_ROOT}/skills"/*/ 2>/dev/null | wc -l | xargs) skills"
      for skill_name in "${PROFILE_ALL_SKILLS[@]}"; do
        local skill_dir="${REPO_ROOT}/skills/${skill_name}"
        if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
          local skill_dest_dir="${target}/skills/${skill_name}"
          mkdir -p "$skill_dest_dir"
          if [ "$use_link" = true ]; then
            ln -sf "$(realpath "${skill_dir}/SKILL.md")" "${skill_dest_dir}/SKILL.md"
            ok "Linked skill -> ${skill_name}"
          else
            cp "${skill_dir}/SKILL.md" "${skill_dest_dir}/SKILL.md"
            ok "Copied skill -> ${skill_name}"
          fi
          record_file "${skill_dest_dir}/SKILL.md" "shared"
        fi
      done
    elif [ -n "${PROFILE_NAME:-}" ] && [ ${#PROFILE_ALL_SKILLS[@]} -eq 0 ]; then
      # Profile with no skills (unlikely but handle gracefully)
      info "Profile '${PROFILE_NAME}': no skills to install"
    else
      # No profile: install ALL skills
      for skill_dir in "${REPO_ROOT}/skills"/*/; do
        if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
          local skill_name
          skill_name=$(basename "$skill_dir")
          local skill_dest_dir="${target}/skills/${skill_name}"
          mkdir -p "$skill_dest_dir"
          if [ "$use_link" = true ]; then
            ln -sf "$(realpath "${skill_dir}/SKILL.md")" "${skill_dest_dir}/SKILL.md"
            ok "Linked skill -> ${skill_name}"
          else
            cp "${skill_dir}/SKILL.md" "${skill_dest_dir}/SKILL.md"
            ok "Copied skill -> ${skill_name}"
          fi
          record_file "${skill_dest_dir}/SKILL.md" "shared"
        fi
      done
    fi
  fi

  # Install ALL prompts from top-level prompts/
  if [ -d "${REPO_ROOT}/prompts" ]; then
    mkdir -p "${target}/prompts"
    for prompt_file in "${REPO_ROOT}/prompts"/*.md; do
      if [ -f "$prompt_file" ]; then
        local prompt_name
        prompt_name=$(basename "$prompt_file")
        local prompt_dest="${target}/prompts/${prompt_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$prompt_file")" "$prompt_dest"
          ok "Linked prompt -> ${prompt_name}"
        else
          cp "$prompt_file" "$prompt_dest"
          ok "Copied prompt -> ${prompt_name}"
        fi
        record_file "$prompt_dest" "shared"
      fi
    done
  fi

  echo ""
  SHARED_RESOURCES_INSTALLED=true
}

install_agent() {
  local agent_name="$1"
  local mode="$2"
  local agent_src="${AGENTS_DIR}/${agent_name}"

  if [ ! -d "$agent_src" ]; then
    err "Agent '${agent_name}' not found in ${AGENTS_DIR}/"
    info "Run '$(basename "$0") --list' to see available agents."
    exit 1
  fi

  # Determine target directory
  local target
  case "$mode" in
    project)
      target="$(pwd)/.opencode"
      ;;
    global)
      target="${HOME}/.config/opencode"
      ;;
    *)
      err "Unknown mode: ${mode}"
      exit 1
      ;;
  esac

  # Check for dependencies (DEPENDS file in agent directory)
  if [ -f "${agent_src}/DEPENDS" ]; then
    while IFS= read -r dep || [ -n "$dep" ]; do
      dep=$(echo "$dep" | xargs)  # trim whitespace
      [ -z "$dep" ] && continue
      [[ "$dep" == \#* ]] && continue  # skip comments

      if [ ! -f "${target}/agents/${dep}.md" ]; then
        info "Agent '${agent_name}' depends on '${dep}'. Installing dependency..."
        install_agent "$dep" "$mode" "${3:-}"
        echo ""
        info "Continuing with ${agent_name} installation..."
        echo ""
      else
        ok "Dependency '${dep}' already installed"
      fi
    done < "${agent_src}/DEPENDS"
  fi

  # Track this agent in the installed list (deduplicate)
  local already_tracked=false
  for a in "${INSTALLED_AGENTS_LIST[@]}"; do
    if [ "$a" = "$agent_name" ]; then
      already_tracked=true
      break
    fi
  done
  if [ "$already_tracked" = false ]; then
    INSTALLED_AGENTS_LIST+=("$agent_name")
  fi

  info "Installing ${agent_name} to ${target}/"
  echo ""

  # Create target directories
  mkdir -p "${target}/agents"

  local use_link=false
  if [ "${3:-}" = "link" ]; then
    if [ -n "${TEMP_DIR}" ]; then
      warn "Cannot use --link with remote install (temp directory is ephemeral). Falling back to copy."
    else
      use_link=true
      info "Using symlinks (development mode)"
    fi
  fi

  # Install agent definition
  if [ -f "${agent_src}/agent.md" ]; then
    local agent_dest="${target}/agents/${agent_name}.md"
    if [ "$use_link" = true ]; then
      ln -sf "$(realpath "${agent_src}/agent.md")" "$agent_dest"
      ok "Linked agent definition -> ${agent_name}.md"
    else
      cp "${agent_src}/agent.md" "$agent_dest"
      ok "Copied agent definition -> ${agent_name}.md"
    fi
    record_file "$agent_dest" "agent"
  fi

  # Install/merge package.json if it exists
  if [ -f "${agent_src}/package.json" ]; then
    local pkg_dest="${target}/package.json"
    if [ -f "$pkg_dest" ]; then
      warn "package.json already exists at ${pkg_dest}. Skipping (merge manually if needed)."
      record_file "$pkg_dest" "user"
    else
      if [ "$use_link" = true ]; then
        ln -sf "$(realpath "${agent_src}/package.json")" "$pkg_dest"
        ok "Linked package.json -> ${pkg_dest}"
      else
        cp "${agent_src}/package.json" "$pkg_dest"
        ok "Copied package.json -> ${pkg_dest}"
      fi
      record_file "$pkg_dest" "user"
    fi
  fi

  # Install ALL shared resources (tools, skills, commands, prompts) once
  install_shared_resources "$target" "$use_link"

  # Install project-root config files (AGENTS.md)
  # These go to the project root, not inside .opencode/
  local project_root
  if [ "$mode" = "project" ]; then
    project_root="$(pwd)"
  elif [ "$mode" = "global" ]; then
    project_root="${HOME}/.config/opencode"
  fi

  # Single-element list today; extension point for future root-level
  # user files (e.g. AGENTS.local.md). See also lib-manifest.sh,
  # lib-update.sh.
  # shellcheck disable=SC2043  # Intentional single-iteration list for forward extensibility
  for root_file in AGENTS.md; do
    if [ -f "${REPO_ROOT}/${root_file}" ]; then
      local root_dest="${project_root}/${root_file}"
      if [ -f "$root_dest" ]; then
        warn "${root_file} already exists at ${root_dest}. Skipping."
        record_file "$root_dest" "user"
      else
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "${REPO_ROOT}/${root_file}")" "$root_dest"
          ok "Linked ${root_file} -> project root"
        else
          cp "${REPO_ROOT}/${root_file}" "$root_dest"
          ok "Copied ${root_file} -> project root"
        fi
        record_file "$root_dest" "user"
      fi
    fi
  done

  # Apply sidecar convention (AGENTS.local.md, opencode.local.json)
  apply_sidecar_convention "$project_root"

  echo ""
  ok "Agent '${agent_name}' installed!"
  echo ""
  info "Usage in OpenCode TUI:"
  echo "    @${agent_name}  - Invoke the agent directly"

  # List installed commands
  if [ -d "${REPO_ROOT}/commands" ]; then
    for cmd_file in "${REPO_ROOT}/commands"/*.md; do
      if [ -f "$cmd_file" ]; then
        local cmd_name cmd_desc
        cmd_name=$(basename "$cmd_file" .md)
        cmd_desc=$(grep "^description:" "$cmd_file" | head -1 | sed 's/^description:\s*//')
        echo "    /${cmd_name}$(printf '%*s' $((16 - ${#cmd_name})) '')- ${cmd_desc}"
      fi
    done
  fi
  echo ""
}

# resolve_target / resolve_project_root were near main() in the original
# layout; collocated here for symmetry with install paths.
resolve_target() {
  case "$MODE" in
    project) echo "$(pwd)/.opencode" ;;
    global)  echo "${HOME}/.config/opencode" ;;
  esac
}

resolve_project_root() {
  case "$MODE" in
    project) echo "$(pwd)" ;;
    global)  echo "${HOME}/.config/opencode" ;;
  esac
}
