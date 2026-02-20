#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# lib-agents installer
# Deploys agent packages to OpenCode config directories
#
# Usage:
#   ./install.sh <agent-name>... [--project|--global|--link]
#   ./install.sh --all [--project|--global|--link]
#
# Remote usage (pipe via curl):
#   curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- git-ops docs
#
# Examples:
#   ./install.sh git-ops                  # Install one agent to current project
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

install_agent() {
  local agent_name="$1"
  local mode="$2"
  local agent_src="${AGENTS_DIR}/${agent_name}"

  if [ ! -d "$agent_src" ]; then
    err "Agent '${agent_name}' not found in ${AGENTS_DIR}/"
    info "Run '$(basename "$0") --list' to see available agents."
    exit 1
  fi

  # Check for dependencies (DEPENDS file in agent directory)
  if [ -f "${agent_src}/DEPENDS" ]; then
    while IFS= read -r dep || [ -n "$dep" ]; do
      dep=$(echo "$dep" | xargs)  # trim whitespace
      [ -z "$dep" ] && continue
      [[ "$dep" == \#* ]] && continue  # skip comments

      # Determine target to check if dependency is already installed
      local dep_target
      case "$mode" in
        project) dep_target="$(pwd)/.opencode" ;;
        global)  dep_target="${HOME}/.config/opencode" ;;
      esac

      if [ ! -f "${dep_target}/agents/${dep}.md" ]; then
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

  info "Installing ${agent_name} to ${target}/"
  echo ""

  # Create target directories
  mkdir -p "${target}/agents"
  mkdir -p "${target}/tools"
  mkdir -p "${target}/commands"

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
      ok "Linked agent definition -> ${agent_dest}"
    else
      cp "${agent_src}/agent.md" "$agent_dest"
      ok "Copied agent definition -> ${agent_dest}"
    fi
  fi

  # Install tools
  if [ -d "${agent_src}/tools" ]; then
    for tool_file in "${agent_src}/tools"/*.ts; do
      if [ -f "$tool_file" ]; then
        local tool_name=$(basename "$tool_file")
        local tool_dest="${target}/tools/${tool_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$tool_file")" "$tool_dest"
          ok "Linked tool -> ${tool_dest}"
        else
          cp "$tool_file" "$tool_dest"
          ok "Copied tool -> ${tool_dest}"
        fi
      fi
    done
  fi

  # Install commands
  if [ -d "${agent_src}/commands" ]; then
    for cmd_file in "${agent_src}/commands"/*.md; do
      if [ -f "$cmd_file" ]; then
        local cmd_name=$(basename "$cmd_file")
        local cmd_dest="${target}/commands/${cmd_name}"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$cmd_file")" "$cmd_dest"
          ok "Linked command -> ${cmd_dest}"
        else
          cp "$cmd_file" "$cmd_dest"
          ok "Copied command -> ${cmd_dest}"
        fi
      fi
    done
  fi

  # Install skills
  if [ -d "${agent_src}/skills" ]; then
    for skill_dir in "${agent_src}/skills"/*/; do
      if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
        local skill_name=$(basename "$skill_dir")
        local skill_dest_dir="${target}/skills/${skill_name}"
        mkdir -p "$skill_dest_dir"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "${skill_dir}/SKILL.md")" "${skill_dest_dir}/SKILL.md"
          ok "Linked skill -> ${skill_dest_dir}/SKILL.md"
        else
          cp "${skill_dir}/SKILL.md" "${skill_dest_dir}/SKILL.md"
          ok "Copied skill -> ${skill_dest_dir}/SKILL.md"
        fi
      fi
    done
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

  echo ""
  ok "Installation complete!"
  echo ""
  info "Usage in OpenCode TUI:"
  echo "    @${agent_name}  - Invoke the agent directly"

  # List installed commands for this agent
  if [ -d "${agent_src}/commands" ]; then
    for cmd_file in "${agent_src}/commands"/*.md; do
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
