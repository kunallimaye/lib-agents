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

CYAN='\033[0;36m'
BOLD='\033[1m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ============================================================================
# Cross-platform SHA-256 hash utility
# ============================================================================
compute_hash() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "MISSING"
    return
  fi
  if command -v shasum &>/dev/null; then
    shasum -a 256 "$file" | cut -d' ' -f1
  elif command -v sha256sum &>/dev/null; then
    sha256sum "$file" | cut -d' ' -f1
  else
    err "No SHA-256 tool found (need shasum or sha256sum)"
    exit 1
  fi
}

# ============================================================================
# Source commit tracking
# ============================================================================
SOURCE_COMMIT=""

get_source_commit() {
  if [ -n "${SOURCE_COMMIT:-}" ]; then
    echo "$SOURCE_COMMIT"
    return
  fi
  git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo "unknown"
}

# ============================================================================
# Manifest infrastructure
# ============================================================================
MANIFEST_FILE=""
declare -a MANIFEST_ENTRIES=()
declare -a INSTALLED_AGENTS_LIST=()

# Classify a file's tier based on its destination path
classify_tier() {
  local filepath="$1"
  case "$filepath" in
    */AGENTS.md|*/opencode.json|*/package.json)
      echo "user"
      ;;
    */agents/*.md)
      echo "agent"
      ;;
    *)
      echo "shared"
      ;;
  esac
}

# Record a file installation into the manifest entries array
record_file() {
  local dest_path="$1"
  local tier="$2"
  local hash
  hash=$(compute_hash "$dest_path")
  MANIFEST_ENTRIES+=("[${tier}] ${dest_path} sha256=${hash}")
}

# Write the manifest lockfile
write_manifest() {
  local target="$1"
  local manifest_path="${target}/.lib-agents.lock"
  local source_commit
  source_commit=$(get_source_commit)
  local installed_at
  installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  local agents_csv
  agents_csv=$(printf '%s,' "${INSTALLED_AGENTS_LIST[@]}" | sed 's/,$//')

  # If manifest already exists, merge with existing entries
  if [ -f "$manifest_path" ]; then
    local existing_agents=""
    existing_agents=$(grep "^installed_agents=" "$manifest_path" 2>/dev/null | cut -d'=' -f2- || true)
    if [ -n "$existing_agents" ]; then
      # Merge agent lists (union)
      local merged_agents="$existing_agents,$agents_csv"
      agents_csv=$(echo "$merged_agents" | tr ',' '\n' | sort -u | tr '\n' ',' | sed 's/,$//')
    fi

    # Merge file entries: keep existing entries not in new entries
    local -a merged_entries=()
    local -A new_paths=()
    for entry in "${MANIFEST_ENTRIES[@]}"; do
      local path
      path=$(echo "$entry" | sed 's/^\[[a-z]*\] //' | sed 's/ sha256=.*//')
      new_paths["$path"]=1
      merged_entries+=("$entry")
    done
    # Add existing entries whose paths are not in the new set
    while IFS= read -r line || [ -n "$line" ]; do
      [[ -z "$line" ]] && continue
      [[ "$line" != \[* ]] && continue
      local existing_path
      existing_path=$(echo "$line" | sed 's/^\[[a-z]*\] //' | sed 's/ sha256=.*//')
      if [ -z "${new_paths[$existing_path]+x}" ]; then
        merged_entries+=("$line")
      fi
    done < <(grep '^\[' "$manifest_path" 2>/dev/null || true)
    MANIFEST_ENTRIES=("${merged_entries[@]}")
  fi

  # Write manifest atomically via temp file
  local tmp_manifest="${manifest_path}.tmp"
  {
    echo "# lib-agents manifest lockfile"
    echo "# Auto-generated by install.sh — do not edit manually"
    echo "source_commit=${source_commit}"
    echo "source_url=${REPO_URL}"
    echo "installed_at=${installed_at}"
    echo "installed_agents=${agents_csv}"
    if [ "${USE_LINK:-}" = "link" ]; then
      echo "mode=link"
    else
      echo "mode=copy"
    fi
    echo ""
    # Sort entries by tier then path
    printf '%s\n' "${MANIFEST_ENTRIES[@]}" | sort
  } > "$tmp_manifest"
  mv "$tmp_manifest" "$manifest_path"
  ok "Manifest written to ${manifest_path}"
}

# Read an existing manifest into associative arrays
# Sets: MANIFEST_HASHES[path]=hash, MANIFEST_TIERS[path]=tier, MANIFEST_COMMIT, MANIFEST_URL, MANIFEST_AT, MANIFEST_AGENTS_CSV, MANIFEST_MODE
declare -A MANIFEST_HASHES=()
declare -A MANIFEST_TIERS=()
MANIFEST_COMMIT=""
MANIFEST_URL=""
MANIFEST_AT=""
MANIFEST_AGENTS_CSV=""
MANIFEST_MODE=""

read_manifest() {
  local manifest_path="$1"
  MANIFEST_HASHES=()
  MANIFEST_TIERS=()
  MANIFEST_COMMIT=""
  MANIFEST_URL=""
  MANIFEST_AT=""
  MANIFEST_AGENTS_CSV=""
  MANIFEST_MODE=""

  if [ ! -f "$manifest_path" ]; then
    return 1
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and empty lines
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue

    # Parse header fields
    case "$line" in
      source_commit=*)
        MANIFEST_COMMIT="${line#source_commit=}"
        ;;
      source_url=*)
        MANIFEST_URL="${line#source_url=}"
        ;;
      installed_at=*)
        MANIFEST_AT="${line#installed_at=}"
        ;;
      installed_agents=*)
        MANIFEST_AGENTS_CSV="${line#installed_agents=}"
        ;;
      mode=*)
        MANIFEST_MODE="${line#mode=}"
        ;;
      \[*)
        # Parse file entry: [tier] path sha256=hash
        local tier path hash
        tier=$(echo "$line" | sed 's/^\[\([a-z]*\)\].*/\1/')
        path=$(echo "$line" | sed 's/^\[[a-z]*\] //' | sed 's/ sha256=.*//')
        hash=$(echo "$line" | sed 's/.*sha256=//')
        MANIFEST_HASHES["$path"]="$hash"
        MANIFEST_TIERS["$path"]="$tier"
        ;;
    esac
  done < "$manifest_path"
  return 0
}

# Generate a manifest for an existing installation (migration path)
generate_manifest_for_existing() {
  local target="$1"
  local project_root="$2"

  info "No manifest found. Generating manifest for existing installation..."
  MANIFEST_ENTRIES=()
  INSTALLED_AGENTS_LIST=()

  # Scan agent definitions
  if [ -d "${target}/agents" ]; then
    for f in "${target}/agents"/*.md; do
      [ -f "$f" ] || continue
      local agent_name
      agent_name=$(basename "$f" .md)
      INSTALLED_AGENTS_LIST+=("$agent_name")
      record_file "$f" "agent"
    done
  fi

  # Scan tools
  if [ -d "${target}/tools" ]; then
    for f in "${target}/tools"/*.ts; do
      [ -f "$f" ] || continue
      record_file "$f" "shared"
    done
  fi

  # Scan commands
  if [ -d "${target}/commands" ]; then
    for f in "${target}/commands"/*.md; do
      [ -f "$f" ] || continue
      record_file "$f" "shared"
    done
  fi

  # Scan skills
  if [ -d "${target}/skills" ]; then
    for skill_dir in "${target}/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      if [ -f "${skill_dir}/SKILL.md" ]; then
        record_file "${skill_dir}/SKILL.md" "shared"
      fi
    done
  fi

  # Scan prompts
  if [ -d "${target}/prompts" ]; then
    for f in "${target}/prompts"/*.md; do
      [ -f "$f" ] || continue
      record_file "$f" "shared"
    done
  fi

  # Scan user-tier root files
  for root_file in AGENTS.md opencode.json; do
    if [ -f "${project_root}/${root_file}" ]; then
      record_file "${project_root}/${root_file}" "user"
    fi
  done
  if [ -f "${target}/package.json" ]; then
    record_file "${target}/package.json" "user"
  fi

  # Write manifest with migration markers
  local manifest_path="${target}/.lib-agents.lock"
  local installed_at
  installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  local agents_csv
  agents_csv=$(printf '%s,' "${INSTALLED_AGENTS_LIST[@]}" | sed 's/,$//')

  local tmp_manifest="${manifest_path}.tmp"
  {
    echo "# lib-agents manifest lockfile"
    echo "# Auto-generated by install.sh — do not edit manually"
    echo "source_commit=unknown (migrated)"
    echo "source_url=${REPO_URL}"
    echo "installed_at=${installed_at} (migrated)"
    echo "installed_agents=${agents_csv}"
    echo "mode=copy"
    echo ""
    printf '%s\n' "${MANIFEST_ENTRIES[@]}" | sort
  } > "$tmp_manifest"
  mv "$tmp_manifest" "$manifest_path"
  ok "Generated manifest for existing installation (migrated)"
  info "Run '--status' to review tracked files."
}

# ============================================================================
# Status command
# ============================================================================
show_status() {
  local target="$1"
  local project_root="$2"
  local manifest_path="${target}/.lib-agents.lock"

  if [ ! -f "$manifest_path" ]; then
    generate_manifest_for_existing "$target" "$project_root"
  fi

  read_manifest "$manifest_path"

  echo ""
  echo -e "${BOLD}lib-agents installation status${NC}"
  echo "==============================="
  echo ""
  echo -e "  Installed commit:  ${CYAN}${MANIFEST_COMMIT}${NC}"
  echo -e "  Source URL:        ${MANIFEST_URL}"
  echo -e "  Installed at:      ${MANIFEST_AT}"
  echo -e "  Installed agents:  ${MANIFEST_AGENTS_CSV}"
  echo -e "  Install mode:      ${MANIFEST_MODE}"
  echo ""

  # Try to fetch latest commit from remote
  local latest_commit="unknown"
  if command -v git &>/dev/null; then
    latest_commit=$(git ls-remote "${MANIFEST_URL}" HEAD 2>/dev/null | cut -f1 || echo "unknown")
  fi
  if [ "$latest_commit" != "unknown" ] && [ -n "$latest_commit" ]; then
    if [ "${MANIFEST_COMMIT}" = "${latest_commit}" ]; then
      echo -e "  Latest commit:     ${GREEN}${latest_commit} (up to date)${NC}"
    else
      echo -e "  Latest commit:     ${YELLOW}${latest_commit} (update available)${NC}"
    fi
  else
    echo -e "  Latest commit:     ${YELLOW}unable to fetch${NC}"
  fi
  echo ""

  # Per-file status
  echo -e "${BOLD}  File Status:${NC}"
  echo "  ─────────────────────────────────────────────────────"

  local count_clean=0 count_modified=0 count_missing=0

  # Sort paths for display
  local -a sorted_paths=()
  for path in "${!MANIFEST_HASHES[@]}"; do
    sorted_paths+=("$path")
  done
  IFS=$'\n' sorted_paths=($(sort <<<"${sorted_paths[*]}")); unset IFS

  for path in "${sorted_paths[@]}"; do
    local stored_hash="${MANIFEST_HASHES[$path]}"
    local tier="${MANIFEST_TIERS[$path]}"
    local current_hash
    current_hash=$(compute_hash "$path")

    local status_icon status_text
    if [ "$current_hash" = "MISSING" ]; then
      status_icon="${RED}✗${NC}"
      status_text="missing"
      ((count_missing++))
    elif [ "$current_hash" = "$stored_hash" ]; then
      status_icon="${GREEN}✓${NC}"
      status_text="clean"
      ((count_clean++))
    else
      status_icon="${YELLOW}✎${NC}"
      status_text="modified"
      ((count_modified++))
    fi

    # Shorten path for display
    local display_path="$path"
    display_path="${display_path#$(pwd)/}"

    printf "  %b %-10s [%-6s] %s\n" "$status_icon" "$status_text" "$tier" "$display_path"
  done

  echo ""
  echo "  ─────────────────────────────────────────────────────"
  echo -e "  Total: ${#sorted_paths[@]} files  |  ${GREEN}✓ ${count_clean} clean${NC}  |  ${YELLOW}✎ ${count_modified} modified${NC}  |  ${RED}✗ ${count_missing} missing${NC}"
  echo ""
}

# ============================================================================
# Phase B: Backup infrastructure
# ============================================================================
backup_installation() {
  local target="$1"
  local manifest_path="${target}/.lib-agents.lock"
  local backup_base="${target}/.backup"
  local timestamp
  timestamp=$(date -u +"%Y%m%dT%H%M%S" 2>/dev/null || date +"%Y%m%dT%H%M%S")
  local backup_dir="${backup_base}/${timestamp}"

  mkdir -p "$backup_dir"

  # Copy all manifest-tracked files preserving directory structure
  if [ -f "$manifest_path" ]; then
    read_manifest "$manifest_path"
    for path in "${!MANIFEST_HASHES[@]}"; do
      if [ -f "$path" ]; then
        local rel_path="${path#${target}/}"
        # Handle files outside target (e.g., AGENTS.md in project root)
        if [ "$rel_path" = "$path" ]; then
          rel_path=$(basename "$path")
        fi
        local dest_dir
        dest_dir=$(dirname "${backup_dir}/${rel_path}")
        mkdir -p "$dest_dir"
        cp "$path" "${backup_dir}/${rel_path}"
      fi
    done
    # Also backup the manifest itself
    cp "$manifest_path" "${backup_dir}/.lib-agents.lock"
  fi

  ok "Backup created at ${backup_dir}"

  # Prune old backups (keep last 3)
  prune_backups "$backup_base" 3
}

prune_backups() {
  local backup_base="$1"
  local keep="${2:-3}"

  if [ ! -d "$backup_base" ]; then
    return
  fi

  local -a backups=()
  for d in "${backup_base}"/*/; do
    [ -d "$d" ] && backups+=("$d")
  done

  # Sort by name (timestamps sort lexicographically)
  IFS=$'\n' backups=($(sort <<<"${backups[*]}")); unset IFS

  local count=${#backups[@]}
  if [ "$count" -gt "$keep" ]; then
    local to_remove=$((count - keep))
    for ((i = 0; i < to_remove; i++)); do
      rm -rf "${backups[$i]}"
      info "Pruned old backup: $(basename "${backups[$i]}")"
    done
  fi
}

# ============================================================================
# Phase B: Three-way file classification
# ============================================================================
# Returns: unchanged | auto-update | already-current | conflict | new | removed-upstream
classify_file_action() {
  local installed_hash="$1"
  local current_hash="$2"
  local new_hash="$3"

  if [ "$installed_hash" = "$new_hash" ]; then
    echo "unchanged"
  elif [ "$installed_hash" = "$current_hash" ]; then
    echo "auto-update"
  elif [ "$current_hash" = "$new_hash" ]; then
    echo "already-current"
  else
    echo "conflict"
  fi
}

# Show diff between two files
show_diff() {
  local file_a="$1"
  local file_b="$2"
  if command -v diff &>/dev/null; then
    diff --color=auto -u "$file_a" "$file_b" 2>/dev/null || true
  fi
}

# Write upstream sidecar file for user-tier conflicts
write_upstream_sidecar() {
  local dest_path="$1"
  local source_path="$2"
  local sidecar_path="${dest_path}.upstream"
  cp "$source_path" "$sidecar_path"
  warn "Conflict in user-tier file. Upstream version written to: ${sidecar_path}"
  info "Compare with: diff ${dest_path} ${sidecar_path}"
}

# Interactive prompt for conflict resolution
prompt_user() {
  local filepath="$1"
  # If not interactive (piped via curl), default to skip
  if [ ! -t 0 ]; then
    echo "skip"
    return
  fi
  echo ""
  echo -e "${YELLOW}Conflict:${NC} ${filepath}"
  echo "  [k] Keep yours  [u] Use upstream  [s] Skip"
  read -r -p "  Choice [k/u/s] (default: s): " choice
  case "${choice,,}" in
    k) echo "keep" ;;
    u) echo "upstream" ;;
    *) echo "skip" ;;
  esac
}

# ============================================================================
# Phase B: Update orchestrator
# ============================================================================
update_installation() {
  local target="$1"
  local project_root="$2"
  local dry_run="${3:-false}"
  local only_filter="${4:-}"
  local agent_filter="${5:-}"
  local manifest_path="${target}/.lib-agents.lock"

  # Ensure we have agent source
  ensure_agents_source

  if [ ! -f "$manifest_path" ]; then
    generate_manifest_for_existing "$target" "$project_root"
  fi

  read_manifest "$manifest_path"

  # Collect all files from new source
  declare -A NEW_FILES=()     # path -> source_path
  declare -A NEW_TIERS=()     # path -> tier
  declare -A NEW_HASHES=()    # path -> hash

  # Determine use_link from manifest
  local use_link=false
  if [ "${MANIFEST_MODE}" = "link" ] || [ "${USE_LINK:-}" = "link" ]; then
    use_link=true
  fi

  # Scan new source: tools
  if should_include_type "tools" "$only_filter"; then
    if [ -d "${REPO_ROOT}/tools" ]; then
      for f in "${REPO_ROOT}/tools"/*.ts; do
        [ -f "$f" ] || continue
        local dest="${target}/tools/$(basename "$f")"
        NEW_FILES["$dest"]="$f"
        NEW_TIERS["$dest"]="shared"
        NEW_HASHES["$dest"]=$(compute_hash "$f")
      done
    fi
  fi

  # Scan new source: commands
  if should_include_type "commands" "$only_filter"; then
    if [ -d "${REPO_ROOT}/commands" ]; then
      for f in "${REPO_ROOT}/commands"/*.md; do
        [ -f "$f" ] || continue
        local dest="${target}/commands/$(basename "$f")"
        NEW_FILES["$dest"]="$f"
        NEW_TIERS["$dest"]="shared"
        NEW_HASHES["$dest"]=$(compute_hash "$f")
      done
    fi
  fi

  # Scan new source: skills
  if should_include_type "skills" "$only_filter"; then
    if [ -d "${REPO_ROOT}/skills" ]; then
      for skill_dir in "${REPO_ROOT}/skills"/*/; do
        [ -d "$skill_dir" ] || continue
        if [ -f "${skill_dir}/SKILL.md" ]; then
          local skill_name
          skill_name=$(basename "$skill_dir")
          local dest="${target}/skills/${skill_name}/SKILL.md"
          NEW_FILES["$dest"]="${skill_dir}/SKILL.md"
          NEW_TIERS["$dest"]="shared"
          NEW_HASHES["$dest"]=$(compute_hash "${skill_dir}/SKILL.md")
        fi
      done
    fi
  fi

  # Scan new source: prompts
  if should_include_type "prompts" "$only_filter"; then
    if [ -d "${REPO_ROOT}/prompts" ]; then
      for f in "${REPO_ROOT}/prompts"/*.md; do
        [ -f "$f" ] || continue
        local dest="${target}/prompts/$(basename "$f")"
        NEW_FILES["$dest"]="$f"
        NEW_TIERS["$dest"]="shared"
        NEW_HASHES["$dest"]=$(compute_hash "$f")
      done
    fi
  fi

  # Scan new source: agents
  if should_include_type "agents" "$only_filter"; then
    if [ -d "${AGENTS_DIR}" ]; then
      for agent_dir in "${AGENTS_DIR}"/*/; do
        [ -d "$agent_dir" ] || continue
        local agent_name
        agent_name=$(basename "$agent_dir")
        # Apply agent filter if specified
        if [ -n "$agent_filter" ] && [ "$agent_name" != "$agent_filter" ]; then
          continue
        fi
        if [ -f "${agent_dir}/agent.md" ]; then
          local dest="${target}/agents/${agent_name}.md"
          NEW_FILES["$dest"]="${agent_dir}/agent.md"
          NEW_TIERS["$dest"]="agent"
          NEW_HASHES["$dest"]=$(compute_hash "${agent_dir}/agent.md")
        fi
      done
    fi
  fi

  # Scan new source: root config files (user tier)
  if should_include_type "configs" "$only_filter"; then
    for root_file in AGENTS.md opencode.json; do
      if [ -f "${REPO_ROOT}/${root_file}" ]; then
        local dest="${project_root}/${root_file}"
        NEW_FILES["$dest"]="${REPO_ROOT}/${root_file}"
        NEW_TIERS["$dest"]="user"
        NEW_HASHES["$dest"]=$(compute_hash "${REPO_ROOT}/${root_file}")
      fi
    done
  fi

  # Classify each file's action
  declare -A FILE_ACTIONS=()
  local count_unchanged=0 count_auto=0 count_conflict=0 count_new=0 count_removed=0 count_current=0

  # Check files in new source
  for dest in "${!NEW_FILES[@]}"; do
    local new_hash="${NEW_HASHES[$dest]}"
    local tier="${NEW_TIERS[$dest]}"

    if [ -z "${MANIFEST_HASHES[$dest]+x}" ]; then
      # File not in manifest — it's new
      FILE_ACTIONS["$dest"]="new"
      ((count_new++))
    else
      local installed_hash="${MANIFEST_HASHES[$dest]}"
      local current_hash
      current_hash=$(compute_hash "$dest")
      local action
      action=$(classify_file_action "$installed_hash" "$current_hash" "$new_hash")
      FILE_ACTIONS["$dest"]="$action"
      case "$action" in
        unchanged) ((count_unchanged++)) ;;
        auto-update) ((count_auto++)) ;;
        already-current) ((count_current++)) ;;
        conflict) ((count_conflict++)) ;;
      esac
    fi
  done

  # Check for files removed upstream
  for path in "${!MANIFEST_HASHES[@]}"; do
    if [ -z "${NEW_FILES[$path]+x}" ]; then
      # Only flag if the type is included in the filter
      local tier="${MANIFEST_TIERS[$path]}"
      FILE_ACTIONS["$path"]="removed-upstream"
      ((count_removed++))
    fi
  done

  # Display summary
  echo ""
  echo -e "${BOLD}Update Summary${NC}"
  echo "═══════════════════════════════════════════════════════"
  echo -e "  ${GREEN}Auto-update:${NC}      ${count_auto} files"
  echo -e "  ${YELLOW}Conflicts:${NC}        ${count_conflict} files"
  echo -e "  ${CYAN}New:${NC}              ${count_new} files"
  echo -e "  Unchanged:        ${count_unchanged} files"
  echo -e "  Already current:  ${count_current} files"
  echo -e "  ${RED}Removed upstream:${NC} ${count_removed} files"
  echo "═══════════════════════════════════════════════════════"
  echo ""

  if [ "$dry_run" = true ]; then
    echo -e "${BOLD}Dry-run mode — no changes will be made${NC}"
    echo ""

    # Show details for actionable files
    for dest in "${!FILE_ACTIONS[@]}"; do
      local action="${FILE_ACTIONS[$dest]}"
      local display_path="${dest#$(pwd)/}"
      case "$action" in
        auto-update)
          echo -e "  ${GREEN}↑${NC} auto-update: ${display_path}"
          ;;
        conflict)
          local tier="${NEW_TIERS[$dest]:-${MANIFEST_TIERS[$dest]:-unknown}}"
          echo -e "  ${YELLOW}!${NC} conflict [${tier}]: ${display_path}"
          ;;
        new)
          echo -e "  ${CYAN}+${NC} new: ${display_path}"
          ;;
        removed-upstream)
          echo -e "  ${RED}-${NC} removed upstream: ${display_path}"
          ;;
      esac
    done
    echo ""
    return 0
  fi

  # Real update — create backup first
  if [ $((count_auto + count_conflict + count_new)) -gt 0 ]; then
    backup_installation "$target"
    echo ""
  else
    info "No changes to apply."
    return 0
  fi

  # Apply updates
  MANIFEST_ENTRIES=()
  INSTALLED_AGENTS_LIST=()

  # Re-read manifest for agents list
  if [ -n "$MANIFEST_AGENTS_CSV" ]; then
    IFS=',' read -ra INSTALLED_AGENTS_LIST <<< "$MANIFEST_AGENTS_CSV"
  fi

  for dest in "${!FILE_ACTIONS[@]}"; do
    local action="${FILE_ACTIONS[$dest]}"
    local display_path="${dest#$(pwd)/}"

    case "$action" in
      unchanged|already-current)
        # Keep existing manifest entry
        local tier="${MANIFEST_TIERS[$dest]:-${NEW_TIERS[$dest]:-shared}}"
        local hash
        hash=$(compute_hash "$dest")
        MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
        ;;
      auto-update)
        local source_path="${NEW_FILES[$dest]}"
        local tier="${NEW_TIERS[$dest]}"
        mkdir -p "$(dirname "$dest")"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$source_path")" "$dest"
        else
          cp "$source_path" "$dest"
        fi
        local hash
        hash=$(compute_hash "$dest")
        MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
        ok "Updated: ${display_path}"
        ;;
      new)
        local source_path="${NEW_FILES[$dest]}"
        local tier="${NEW_TIERS[$dest]}"
        mkdir -p "$(dirname "$dest")"
        if [ "$use_link" = true ]; then
          ln -sf "$(realpath "$source_path")" "$dest"
        else
          cp "$source_path" "$dest"
        fi
        local hash
        hash=$(compute_hash "$dest")
        MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
        ok "Installed new: ${display_path}"
        ;;
      conflict)
        local source_path="${NEW_FILES[$dest]}"
        local tier="${NEW_TIERS[$dest]:-${MANIFEST_TIERS[$dest]:-shared}}"
        if [ "$tier" = "user" ]; then
          # User-tier: write sidecar, don't overwrite
          write_upstream_sidecar "$dest" "$source_path"
          local hash
          hash=$(compute_hash "$dest")
          MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
        else
          # Shared/agent tier: prompt user
          local choice
          choice=$(prompt_user "$display_path")
          case "$choice" in
            upstream)
              if [ "$use_link" = true ]; then
                ln -sf "$(realpath "$source_path")" "$dest"
              else
                cp "$source_path" "$dest"
              fi
              local hash
              hash=$(compute_hash "$dest")
              MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
              ok "Updated (user chose upstream): ${display_path}"
              ;;
            keep)
              local hash
              hash=$(compute_hash "$dest")
              MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
              info "Kept user version: ${display_path}"
              ;;
            skip)
              local hash
              hash=$(compute_hash "$dest")
              MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
              info "Skipped: ${display_path}"
              ;;
          esac
        fi
        ;;
      removed-upstream)
        local tier="${MANIFEST_TIERS[$dest]:-shared}"
        if [ -f "$dest" ]; then
          warn "Removed upstream but still exists locally: ${display_path}"
          info "Remove manually if no longer needed."
          local hash
          hash=$(compute_hash "$dest")
          MANIFEST_ENTRIES+=("[${tier}] ${dest} sha256=${hash}")
        fi
        ;;
    esac
  done

  # Write updated manifest
  local source_commit
  source_commit=$(get_source_commit)
  local installed_at
  installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  local agents_csv
  agents_csv=$(printf '%s,' "${INSTALLED_AGENTS_LIST[@]}" | sed 's/,$//')

  local tmp_manifest="${target}/.lib-agents.lock.tmp"
  {
    echo "# lib-agents manifest lockfile"
    echo "# Auto-generated by install.sh — do not edit manually"
    echo "source_commit=${source_commit}"
    echo "source_url=${REPO_URL}"
    echo "installed_at=${installed_at}"
    echo "installed_agents=${agents_csv}"
    if [ "$use_link" = true ]; then
      echo "mode=link"
    else
      echo "mode=copy"
    fi
    echo ""
    printf '%s\n' "${MANIFEST_ENTRIES[@]}" | sort
  } > "$tmp_manifest"
  mv "$tmp_manifest" "${target}/.lib-agents.lock"

  echo ""
  ok "Update complete. Manifest updated."
}

# Helper: check if a resource type should be included based on --only filter
should_include_type() {
  local type="$1"
  local filter="$2"
  if [ -z "$filter" ]; then
    return 0  # No filter = include all
  fi
  echo ",$filter," | grep -q ",$type," && return 0
  return 1
}

# ============================================================================
# Phase C: Rollback
# ============================================================================
rollback_installation() {
  local target="$1"
  local backup_base="${target}/.backup"

  if [ ! -d "$backup_base" ]; then
    err "No backups found at ${backup_base}"
    exit 1
  fi

  # Find the most recent backup
  local latest_backup=""
  for d in "${backup_base}"/*/; do
    [ -d "$d" ] && latest_backup="$d"
  done

  if [ -z "$latest_backup" ]; then
    err "No backup directories found"
    exit 1
  fi

  local backup_name
  backup_name=$(basename "$latest_backup")
  info "Rolling back to backup: ${backup_name}"

  # Restore manifest from backup
  if [ -f "${latest_backup}/.lib-agents.lock" ]; then
    cp "${latest_backup}/.lib-agents.lock" "${target}/.lib-agents.lock"
  fi

  # Restore all files from backup
  read_manifest "${target}/.lib-agents.lock"
  local restored=0
  for path in "${!MANIFEST_HASHES[@]}"; do
    local rel_path="${path#${target}/}"
    if [ "$rel_path" = "$path" ]; then
      rel_path=$(basename "$path")
    fi
    local backup_file="${latest_backup}/${rel_path}"
    if [ -f "$backup_file" ]; then
      mkdir -p "$(dirname "$path")"
      cp "$backup_file" "$path"
      ((restored++))
    fi
  done

  ok "Rollback complete. Restored ${restored} files from backup ${backup_name}."
}

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
  SOURCE_COMMIT=$(git -C "${TEMP_DIR}" rev-parse HEAD 2>/dev/null || echo "unknown")
  ok "Downloaded agent definitions to temp directory"
  echo ""
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <agent-name>... [--project|--global|--link]
       $(basename "$0") --all [--project|--global|--link]
       $(basename "$0") --status [--project|--global]
       $(basename "$0") --update [--dry-run] [--only=TYPE,...] [--agent=NAME]
       $(basename "$0") --rollback [--project|--global]

Deploy one or more agent packages to your OpenCode configuration.
Can be run locally from a cloned repo or piped directly via curl.

Arguments:
  agent-name    One or more agent names to install (e.g., git-ops docs)

Install Options:
  --all, -a     Install all available agents
  --project     Install to .opencode/ in the current directory (default)
  --global      Install to ~/.config/opencode/
  --link        Symlink instead of copy (for development, local only)
  --check       Only run prerequisite checks, don't install
  --list        List available agents
  --help        Show this help message

Update Options:
  --status      Show installed version, latest version, and per-file status
  --update      Update installation to latest version (creates backup first)
  --dry-run     Show what --update would change without modifying anything
  --only=TYPE   Update only specific resource types (comma-separated)
                Types: tools, commands, skills, prompts, agents, configs
  --agent=NAME  Update only the specified agent and its resources
  --rollback    Restore the most recent backup

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

Update & status:
  $(basename "$0") --status                 # Show installation status
  $(basename "$0") --update --dry-run       # Preview what would change
  $(basename "$0") --update                 # Update all files
  $(basename "$0") --update --only=skills   # Update only skills
  $(basename "$0") --update --agent=git-ops # Update only git-ops agent
  $(basename "$0") --rollback               # Restore from latest backup
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
        record_file "$tool_dest" "shared"
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
        record_file "$cmd_dest" "shared"
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
        record_file "${skill_dest_dir}/SKILL.md" "shared"
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
DO_STATUS=false
DO_UPDATE=false
DRY_RUN=false
DO_ROLLBACK=false
ONLY_FILTER=""
AGENT_FILTER=""

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

echo ""
echo "========================================="
echo "  lib-agents installer"
echo "========================================="
echo ""

# Determine target directory for status/update/rollback commands
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

# Handle --update command
if [ "$DO_UPDATE" = true ]; then
  local_target=$(resolve_target)
  local_project_root=$(resolve_project_root)
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

# Write manifest after all agents are installed
local_target=$(resolve_target)
write_manifest "$local_target"
