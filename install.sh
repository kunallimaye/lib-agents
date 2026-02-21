#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# lib-agents installer
# Deploys agent packages to OpenCode config directories
#
# Resources (skills, tools, commands) are centralized in top-level directories
# and ALL are installed unconditionally. Per-agent scoping is handled at runtime
# via OpenCode's native permission: and tools: config in each agent.md.
#
# Usage:
#   ./install.sh <agent-name>... [--project|--global|--link]
#   ./install.sh --all [--project|--global|--link]
#
# Remote usage (pipe via curl):
#   curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops docs
#
# Examples:
#   ./install.sh git-ops                  # Install agent + all shared resources
#   ./install.sh git-ops docs --global    # Install multiple agents globally
#   ./install.sh --all                    # Install all agents to current project
#   ./install.sh --all --global           # Install all agents globally
#   ./install.sh git-ops --link           # Symlink instead of copy (for dev)
# ============================================================================

REPO_URL="https://github.com/kunallimaye/lib-agents.git"
TEMP_DIR=""

# Resolve script location -- handles both local execution and piped via curl
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-/dev/null}")" 2>/dev/null && pwd || echo "")"
AGENTS_DIR="${SCRIPT_DIR:+${SCRIPT_DIR}/agents}"
REPO_ROOT="${SCRIPT_DIR}"
SHARED_RESOURCES_INSTALLED=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# Ensure temp directory is cleaned up on exit
cleanup() {
  if [ -n "${TEMP_DIR}" ] && [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

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
  ok "Downloaded agent definitions to temp directory"
  echo ""
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <agent-name>... [--project|--global|--link]
       $(basename "$0") --all [--project|--global|--link]

Deploy one or more agent packages to your OpenCode configuration.
Can be run locally from a cloned repo or piped directly via curl.

Arguments:
  agent-name    One or more agent names to install (e.g., git-ops docs)

Options:
  --all, -a     Install all available agents
  --project     Install to .opencode/ in the current directory (default)
  --global      Install to ~/.config/opencode/
  --link        Symlink instead of copy (for development, local only)
  --check       Only run prerequisite checks, don't install
  --list        List available agents
  --help        Show this help message

Remote install (pipe via curl):
  curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops docs
  curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --all --global
  curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- --list

Local install:
  $(basename "$0") git-ops                  # Install one agent to current project
  $(basename "$0") git-ops docs             # Install multiple agents
  $(basename "$0") git-ops docs --global    # Install multiple agents globally
  $(basename "$0") --all                    # Install all agents
  $(basename "$0") --all --global           # Install all agents globally
  $(basename "$0") git-ops --link           # Symlink for development
  $(basename "$0") --list                   # List available agents
  $(basename "$0") git-ops docs --check     # Check prerequisites only
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

# Install ALL shared resources (tools, skills, commands) from centralized dirs.
# Called once regardless of how many agents are installed.
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
        local tool_name=$(basename "$tool_file")
        local tool_dest="${target}/tools/${tool_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$tool_file")" "$tool_dest"
          ok "Linked tool -> ${tool_name}"
        else
          cp "$tool_file" "$tool_dest"
          ok "Copied tool -> ${tool_name}"
        fi
      fi
    done
  fi

  # Install ALL commands from top-level commands/
  if [ -d "${REPO_ROOT}/commands" ]; then
    for cmd_file in "${REPO_ROOT}/commands"/*.md; do
      if [ -f "$cmd_file" ]; then
        local cmd_name=$(basename "$cmd_file")
        local cmd_dest="${target}/commands/${cmd_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$cmd_file")" "$cmd_dest"
          ok "Linked command -> ${cmd_name}"
        else
          cp "$cmd_file" "$cmd_dest"
          ok "Copied command -> ${cmd_name}"
        fi
      fi
    done
  fi

  # Install ALL skills from top-level skills/
  if [ -d "${REPO_ROOT}/skills" ]; then
    for skill_dir in "${REPO_ROOT}/skills"/*/; do
      if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
        local skill_name=$(basename "$skill_dir")
        local skill_dest_dir="${target}/skills/${skill_name}"
        mkdir -p "$skill_dest_dir"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "${skill_dir}/SKILL.md")" "${skill_dest_dir}/SKILL.md"
          ok "Linked skill -> ${skill_name}"
        else
          cp "${skill_dir}/SKILL.md" "${skill_dest_dir}/SKILL.md"
          ok "Copied skill -> ${skill_name}"
        fi
      fi
    done
  fi

  # Install ALL prompts from top-level prompts/
  if [ -d "${REPO_ROOT}/prompts" ]; then
    mkdir -p "${target}/prompts"
    for prompt_file in "${REPO_ROOT}/prompts"/*.md; do
      if [ -f "$prompt_file" ]; then
        local prompt_name=$(basename "$prompt_file")
        local prompt_dest="${target}/prompts/${prompt_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$prompt_file")" "$prompt_dest"
          ok "Linked prompt -> ${prompt_name}"
        else
          cp "$prompt_file" "$prompt_dest"
          ok "Copied prompt -> ${prompt_name}"
        fi
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
  fi

  # Install/merge package.json if it exists
  if [ -f "${agent_src}/package.json" ]; then
    local pkg_dest="${target}/package.json"
    if [ -f "$pkg_dest" ]; then
      warn "package.json already exists at ${pkg_dest}. Skipping (merge manually if needed)."
    else
      if [ "$use_link" = true ]; then
        ln -sf "$(realpath "${agent_src}/package.json")" "$pkg_dest"
        ok "Linked package.json -> ${pkg_dest}"
      else
        cp "${agent_src}/package.json" "$pkg_dest"
        ok "Copied package.json -> ${pkg_dest}"
      fi
    fi
  fi

  # Install ALL shared resources (tools, skills, commands, prompts) once
  install_shared_resources "$target" "$use_link"

  # Install project-root config files (AGENTS.md, opencode.json)
  # These go to the project root, not inside .opencode/
  local project_root
  if [ "$mode" = "project" ]; then
    project_root="$(pwd)"
  elif [ "$mode" = "global" ]; then
    project_root="${HOME}/.config/opencode"
  fi

  for root_file in AGENTS.md opencode.json; do
    if [ -f "${REPO_ROOT}/${root_file}" ]; then
      local root_dest="${project_root}/${root_file}"
      if [ -f "$root_dest" ]; then
        warn "${root_file} already exists at ${root_dest}. Skipping."
      else
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "${REPO_ROOT}/${root_file}")" "$root_dest"
          ok "Linked ${root_file} -> project root"
        else
          cp "${REPO_ROOT}/${root_file}" "$root_dest"
          ok "Copied ${root_file} -> project root"
        fi
      fi
    fi
  done

  echo ""
  ok "Agent '${agent_name}' installed!"
  echo ""
  info "Usage in OpenCode TUI:"
  echo "    @${agent_name}  - Invoke the agent directly"

  # List installed commands
  if [ -d "${REPO_ROOT}/commands" ]; then
    for cmd_file in "${REPO_ROOT}/commands"/*.md; do
      if [ -f "$cmd_file" ]; then
        local cmd_name=$(basename "$cmd_file" .md)
        local cmd_desc=$(grep "^description:" "$cmd_file" | head -1 | sed 's/^description:\s*//')
        echo "    /${cmd_name}$(printf '%*s' $((16 - ${#cmd_name})) '')- ${cmd_desc}"
      fi
    done
  fi
  echo ""
}

# ============================================================================
# Main
# ============================================================================

# Parse arguments
if [ $# -eq 0 ]; then
  usage
fi

AGENT_NAMES=()
MODE="project"
USE_LINK=""
CHECK_ONLY=false
INSTALL_ALL=false

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      ;;
    --list|-l)
      ensure_agents_source
      list_agents
      ;;
    --project)
      MODE="project"
      shift
      ;;
    --global)
      MODE="global"
      shift
      ;;
    --link)
      USE_LINK="link"
      shift
      ;;
    --check)
      CHECK_ONLY=true
      shift
      ;;
    --all|-a)
      INSTALL_ALL=true
      shift
      ;;
    -*)
      err "Unknown option: $1"
      echo ""
      usage
      ;;
    *)
      AGENT_NAMES+=("$1")
      shift
      ;;
  esac
done

echo ""
echo "========================================="
echo "  lib-agents installer"
echo "========================================="
echo ""

# Download agent source if not available locally
ensure_agents_source

# Populate agent list from --all if requested
if [ "$INSTALL_ALL" = true ]; then
  for dir in "${AGENTS_DIR}"/*/; do
    [ -d "$dir" ] && AGENT_NAMES+=("$(basename "$dir")")
  done
fi

if [ ${#AGENT_NAMES[@]} -eq 0 ]; then
  err "At least one agent name is required (or use --all)."
  echo ""
  usage
fi

# Process each agent
for AGENT_NAME in "${AGENT_NAMES[@]}"; do
  check_prerequisites "$AGENT_NAME"

  if [ "$CHECK_ONLY" = true ]; then
    continue
  fi

  install_agent "$AGENT_NAME" "$MODE" "$USE_LINK"
done

if [ "$CHECK_ONLY" = true ]; then
  exit 0
fi
