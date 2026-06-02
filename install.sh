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
#   curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh \
#     | bash -s -- git-ops docs
#
# Examples:
#   ./install.sh git-ops                  # Install agent + all shared resources
#   ./install.sh git-ops docs --global    # Install multiple agents globally
#   ./install.sh --all                    # Install all agents to current project
#   ./install.sh --all --global           # Install all agents globally
#   ./install.sh git-ops --link           # Symlink instead of copy (for dev)
#
# Implementation: this file is the dispatch layer. The bulk of the logic lives
# in install/lib-*.sh sub-scripts which are sourced after a bootstrap that
# handles the curl-piped case (no install/ directory adjacent to the script).
# ============================================================================

REPO_URL="https://github.com/kunallimaye/lib-agents.git"
TEMP_DIR=""

# Resolve script location.
#
# This file can be invoked in three ways:
#   1. Locally:        ./install.sh ...          -> BASH_SOURCE[0] is "./install.sh"
#   2. Local via bash: bash install.sh ...       -> BASH_SOURCE[0] is "install.sh"
#   3. Piped via curl: curl ... | bash -s -- ... -> BASH_SOURCE[0] is empty/missing
#
# When BASH_SOURCE[0] is empty (piped), or when it points to a non-file
# (e.g. a fifo), or when the install/ directory is missing next to it,
# we treat the invocation as "curl-piped" and bootstrap by cloning the repo.
_bash_src="${BASH_SOURCE[0]:-}"
if [ -n "${_bash_src}" ] && [ -f "${_bash_src}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${_bash_src}")" 2>/dev/null && pwd || echo "")"
else
  SCRIPT_DIR=""
fi
AGENTS_DIR="${SCRIPT_DIR:+${SCRIPT_DIR}/agents}"
REPO_ROOT="${SCRIPT_DIR}"
# shellcheck disable=SC2034  # SHARED_RESOURCES_INSTALLED consumed by install/lib-install.sh install_shared_resources()
SHARED_RESOURCES_INSTALLED=false
# shellcheck disable=SC2034  # SOURCE_COMMIT consumed by install/lib-manifest.sh write_manifest()
SOURCE_COMMIT=""

# Profile state
PROFILE_NAME=""
declare -a PROFILE_AGENTS=()
declare -A PROFILE_AGENT_SKILLS=()   # agent -> space-separated skill list
declare -a PROFILE_ALL_SKILLS=()     # UNION of all agent_skills values
# shellcheck disable=SC2034  # PROFILE_DESCRIPTION parsed by install/lib-profiles.sh; reader not yet wired up. Keep so adding a list-profiles consumer is a one-line change.
PROFILE_DESCRIPTION=""

# Manifest state (populated by lib-manifest.sh functions)
declare -a MANIFEST_ENTRIES=()
declare -a INSTALLED_AGENTS_LIST=()

# ============================================================================
# Bootstrap: source library files
#
# Local layout: install/lib-*.sh sits next to this script. Sourcing is direct.
# Curl-piped layout: there is no install/ adjacent. Clone the repo to a temp
# directory and re-exec the local install.sh from the clone so the libs are
# available.
# ============================================================================

INSTALL_LIB_DIR="${SCRIPT_DIR:+${SCRIPT_DIR}/install}"

if [ -z "${INSTALL_LIB_DIR}" ] || [ ! -d "${INSTALL_LIB_DIR}" ]; then
  if [ -t 1 ]; then
    printf '[INFO]  No local install/ directory; cloning %s for bootstrap...\n' "${REPO_URL}"
  fi

  if ! command -v git >/dev/null 2>&1; then
    printf '[ERROR] git is required for the bootstrap clone. Install from https://git-scm.com\n' >&2
    exit 1
  fi

  BOOTSTRAP_TMP="$(mktemp -d)"
  trap 'rm -rf "${BOOTSTRAP_TMP}"' EXIT

  if ! git clone --depth 1 --quiet "${REPO_URL}" "${BOOTSTRAP_TMP}"; then
    printf '[ERROR] Failed to clone %s\n' "${REPO_URL}" >&2
    exit 1
  fi

  # Re-exec install.sh from the clone, forwarding all args. The clone has
  # install/lib-*.sh adjacent, so the next invocation will source normally.
  exec bash "${BOOTSTRAP_TMP}/install.sh" "$@"
fi

# shellcheck source=install/lib-logging.sh
. "${INSTALL_LIB_DIR}/lib-logging.sh"
# shellcheck source=install/lib-profiles.sh
. "${INSTALL_LIB_DIR}/lib-profiles.sh"
# shellcheck source=install/lib-manifest.sh
. "${INSTALL_LIB_DIR}/lib-manifest.sh"
# shellcheck source=install/lib-status.sh
. "${INSTALL_LIB_DIR}/lib-status.sh"
# shellcheck source=install/lib-update.sh
. "${INSTALL_LIB_DIR}/lib-update.sh"
# shellcheck source=install/lib-install.sh
. "${INSTALL_LIB_DIR}/lib-install.sh"

# ============================================================================
# Cleanup on exit
# ============================================================================
cleanup() {
  if [ -n "${TEMP_DIR}" ] && [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

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
DO_STATUS=false
DO_UPDATE=false
DRY_RUN=false
DO_ROLLBACK=false
ONLY_FILTER=""
AGENT_FILTER=""
DO_LIST_PROFILES=false
PROFILE_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      ;;
    --list|-l)
      ensure_agents_source
      list_agents
      ;;
    --profiles)
      DO_LIST_PROFILES=true
      shift
      ;;
    --profile)
      shift
      if [ $# -eq 0 ]; then
        err "--profile requires a profile name"
        exit 1
      fi
      PROFILE_ARG="$1"
      shift
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
    --status)
      DO_STATUS=true
      shift
      ;;
    --update)
      DO_UPDATE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --rollback)
      DO_ROLLBACK=true
      shift
      ;;
    --only=*)
      ONLY_FILTER="${1#--only=}"
      shift
      ;;
    --agent=*)
      AGENT_FILTER="${1#--agent=}"
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

# Refuse --link + --profile (and --link + --all, since --all is shorthand
# for --profile default). Profile-skill injection writes through to the
# installed agent.md file; with --link, that destination is a symlink
# back into the source repo, so the write corrupts the canonical
# lib-agents source tree. See issue #161 and the SYMLINK HAZARD comment
# above inject_profile_skills() in install/lib-profiles.sh.
#
# This guard MUST run before any install action (ensure_agents_source,
# install_shared_resources, install_agent) -- by the time injection
# runs, the symlinks already point into the source tree.
if [ "$USE_LINK" = "link" ] && { [ -n "$PROFILE_ARG" ] || [ "$INSTALL_ALL" = true ]; }; then
  err ""
  err "Cannot combine --link with --profile (or --all)."
  err ""
  err "Reason: profile-skill injection writes to the installed agent.md"
  err "files. With --link, those destinations are symlinks back into the"
  err "lib-agents source repo, so the writes go THROUGH the symlinks and"
  err "corrupt the canonical source tree (issue #161)."
  err ""
  err "Pick one:"
  err "  --link alone                       development, no profile customization"
  err "  --profile NAME --project           real-copy install with profile (recommended)"
  err "  --profile NAME --global            same, installed globally"
  err "  --all --project                    real-copy install with default profile"
  err ""
  exit 2
fi

echo ""
echo "========================================="
echo "  lib-agents installer"
echo "========================================="
echo ""

# Handle --profiles command
if [ "$DO_LIST_PROFILES" = true ]; then
  ensure_agents_source
  list_profiles
fi

# Handle --status command (doesn't require agent names or source)
if [ "$DO_STATUS" = true ]; then
  local_target=$(resolve_target)
  local_project_root=$(resolve_project_root)
  show_status "$local_target" "$local_project_root"
  exit 0
fi

# Handle --rollback command
if [ "$DO_ROLLBACK" = true ]; then
  local_target=$(resolve_target)
  rollback_installation "$local_target"
  exit 0
fi

# Handle --update command (with optional --profile for switching)
if [ "$DO_UPDATE" = true ]; then
  local_target=$(resolve_target)
  local_project_root=$(resolve_project_root)

  # If --profile is specified with --update, do a profile switch
  if [ -n "$PROFILE_ARG" ]; then
    ensure_agents_source
    switch_profile_path="${REPO_ROOT}/profiles/${PROFILE_ARG}/PROFILE.md"
    if [ ! -f "$switch_profile_path" ]; then
      err "Profile '${PROFILE_ARG}' not found. Use --profiles to list available profiles."
      exit 1
    fi
    parse_profile "$switch_profile_path"
    validate_profile

    info "Switching to profile '${PROFILE_NAME}'..."

    # Clean old profile artifacts from installed agent.md files
    if [ -d "${local_target}/agents" ]; then
      for agent_md in "${local_target}/agents"/*.md; do
        [ -f "$agent_md" ] || continue
        switch_agent_name=$(basename "$agent_md" .md)
        # Reset agent.md to source version
        if [ -f "${AGENTS_DIR}/${switch_agent_name}/agent.md" ]; then
          cp "${AGENTS_DIR}/${switch_agent_name}/agent.md" "$agent_md"
        fi
      done
    fi

    # Strip old profile markers from prompts
    for prompt_file in "${local_target}/prompts"/*.md; do
      [ -f "$prompt_file" ] || continue
      strip_profile_markers "$prompt_file"
      # Re-copy base prompt
      switch_prompt_name=$(basename "$prompt_file")
      if [ -f "${REPO_ROOT}/prompts/${switch_prompt_name}" ]; then
        cp "${REPO_ROOT}/prompts/${switch_prompt_name}" "$prompt_file"
      fi
    done

    # Remove old skills directory and reinstall
    if [ -d "${local_target}/skills" ]; then
      rm -rf "${local_target}/skills"
    fi

    # Reset shared resources flag to force reinstall. All three are
    # cross-module globals (lib-install.sh, lib-manifest.sh, lib-update.sh)
    # which shellcheck cannot see when scanning install.sh in isolation.
    # shellcheck disable=SC2034  # SHARED_RESOURCES_INSTALLED consumed by lib-install.sh
    SHARED_RESOURCES_INSTALLED=false
    # shellcheck disable=SC2034  # MANIFEST_ENTRIES consumed by lib-manifest.sh, lib-update.sh
    MANIFEST_ENTRIES=()
    # shellcheck disable=SC2034  # INSTALLED_AGENTS_LIST consumed by lib-manifest.sh, lib-update.sh
    INSTALLED_AGENTS_LIST=()

    # Install agents from profile
    for agent_name in "${PROFILE_AGENTS[@]}"; do
      install_agent "$agent_name" "$MODE" "$USE_LINK"
    done

    # Apply profile modifications to installed agent.md files
    for agent_name in "${!PROFILE_AGENT_SKILLS[@]}"; do
      if [ "$agent_name" = "build" ] || [ "$agent_name" = "plan" ]; then
        continue
      fi
      switch_agent_md="${local_target}/agents/${agent_name}.md"
      inject_profile_skills "$switch_agent_md" "$agent_name" "$PROFILE_NAME"
    done

    # Apply prompt overlays
    switch_profile_dir="${REPO_ROOT}/profiles/${PROFILE_ARG}"
    apply_prompt_overlays "$local_target" "$switch_profile_dir" "$PROFILE_NAME"

    # Apply sidecar convention
    apply_sidecar_convention "$(resolve_project_root)"

    # Write manifest
    write_manifest "$local_target"

    echo ""
    ok "Profile switched to '${PROFILE_NAME}'"
    exit 0
  fi

  # Standard update (no profile switch)
  update_installation "$local_target" "$local_project_root" "$DRY_RUN" "$ONLY_FILTER" "$AGENT_FILTER"
  exit 0
fi

# Validate --dry-run is only used with --update
if [ "$DRY_RUN" = true ]; then
  err "--dry-run can only be used with --update"
  exit 1
fi

# Download agent source if not available locally
ensure_agents_source

# Handle --profile install (fresh install with profile)
if [ -n "$PROFILE_ARG" ]; then
  profile_path="${REPO_ROOT}/profiles/${PROFILE_ARG}/PROFILE.md"
  if [ ! -f "$profile_path" ]; then
    err "Profile '${PROFILE_ARG}' not found. Use --profiles to list available profiles."
    exit 1
  fi

  parse_profile "$profile_path"
  validate_profile

  info "Installing with profile '${PROFILE_NAME}' (${#PROFILE_AGENTS[@]} agents, ${#PROFILE_ALL_SKILLS[@]} skills)"
  echo ""

  # Install agents from profile
  for agent_name in "${PROFILE_AGENTS[@]}"; do
    check_prerequisites "$agent_name"

    if [ "$CHECK_ONLY" = true ]; then
      continue
    fi

    install_agent "$agent_name" "$MODE" "$USE_LINK"
  done

  if [ "$CHECK_ONLY" = true ]; then
    exit 0
  fi

  profile_target=$(resolve_target)

  # Apply profile modifications to installed agent.md files
  for agent_name in "${!PROFILE_AGENT_SKILLS[@]}"; do
    # Skip orchestrators (build/plan) — they don't have agent.md
    if [ "$agent_name" = "build" ] || [ "$agent_name" = "plan" ]; then
      continue
    fi
    agent_md="${profile_target}/agents/${agent_name}.md"
    inject_profile_skills "$agent_md" "$agent_name" "$PROFILE_NAME"
  done

  # Apply prompt overlays
  profile_dir="${REPO_ROOT}/profiles/${PROFILE_ARG}"
  apply_prompt_overlays "$profile_target" "$profile_dir" "$PROFILE_NAME"

  # Write manifest
  write_manifest "$profile_target"
  exit 0
fi

# Populate agent list from --all if requested (shorthand for --profile default)
if [ "$INSTALL_ALL" = true ]; then
  # --all is now shorthand for --profile default
  profile_path="${REPO_ROOT}/profiles/default/PROFILE.md"
  if [ -f "$profile_path" ]; then
    parse_profile "$profile_path"
    validate_profile

    info "Installing with profile '${PROFILE_NAME}' (${#PROFILE_AGENTS[@]} agents, ${#PROFILE_ALL_SKILLS[@]} skills)"
    echo ""

    for agent_name in "${PROFILE_AGENTS[@]}"; do
      check_prerequisites "$agent_name"

      if [ "$CHECK_ONLY" = true ]; then
        continue
      fi

      install_agent "$agent_name" "$MODE" "$USE_LINK"
    done

    if [ "$CHECK_ONLY" = true ]; then
      exit 0
    fi

    profile_target=$(resolve_target)

    # Apply profile modifications to installed agent.md files
    for agent_name in "${!PROFILE_AGENT_SKILLS[@]}"; do
      if [ "$agent_name" = "build" ] || [ "$agent_name" = "plan" ]; then
        continue
      fi
      agent_md="${profile_target}/agents/${agent_name}.md"
      inject_profile_skills "$agent_md" "$agent_name" "$PROFILE_NAME"
    done

    # Apply prompt overlays
    profile_dir="${REPO_ROOT}/profiles/default"
    apply_prompt_overlays "$profile_target" "$profile_dir" "$PROFILE_NAME"

    # Write manifest
    write_manifest "$profile_target"
    exit 0
  else
    # Fallback: no default profile, install all agents without profile
    for dir in "${AGENTS_DIR}"/*/; do
      [ -d "$dir" ] && AGENT_NAMES+=("$(basename "$dir")")
    done
  fi
fi

if [ ${#AGENT_NAMES[@]} -eq 0 ]; then
  err "At least one agent name is required (or use --all / --profile <name>)."
  echo ""
  usage
fi

# Process each agent (non-profile mode)
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

# Write manifest after all agents are installed
local_target=$(resolve_target)
write_manifest "$local_target"
