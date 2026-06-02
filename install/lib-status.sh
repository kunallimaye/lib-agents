#!/usr/bin/env bash
# install/lib-status.sh — show_status (status command) and
# rollback_installation (rollback command).
#
# Requires: lib-logging.sh, lib-manifest.sh.

[ -n "${LIB_AGENTS_STATUS_LOADED:-}" ] && return 0
LIB_AGENTS_STATUS_LOADED=1

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
  if [ -n "${MANIFEST_PROFILE}" ]; then
    echo -e "  Active profile:    ${CYAN}${MANIFEST_PROFILE}${NC}"
  else
    echo -e "  Active profile:    ${YELLOW}(none)${NC}"
  fi
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
      count_missing=$((count_missing + 1))
    elif [ "$current_hash" = "$stored_hash" ]; then
      status_icon="${GREEN}✓${NC}"
      status_text="clean"
      count_clean=$((count_clean + 1))
    else
      status_icon="${YELLOW}✎${NC}"
      status_text="modified"
      count_modified=$((count_modified + 1))
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
      restored=$((restored + 1))
    fi
  done

  ok "Rollback complete. Restored ${restored} files from backup ${backup_name}."
}
