#!/usr/bin/env bash
# install/lib-update.sh — backup_installation, prune_backups,
# classify_file_action, write_upstream_sidecar, prompt_user,
# update_installation, should_include_type, apply_sidecar_convention.
#
# Requires: lib-logging.sh, lib-manifest.sh, lib-profiles.sh.

[ -n "${LIB_AGENTS_UPDATE_LOADED:-}" ] && return 0
LIB_AGENTS_UPDATE_LOADED=1

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
  if [ "${#backups[@]}" -gt 0 ]; then
    mapfile -t backups < <(printf '%s\n' "${backups[@]}" | sort)
  fi

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
        local dest
        dest="${target}/tools/$(basename "$f")"
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
        local dest
        dest="${target}/commands/$(basename "$f")"
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
        local dest
        dest="${target}/prompts/$(basename "$f")"
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
    # Single-element list today; extension point for future root-level
    # user files (e.g. AGENTS.local.md). See also lib-install.sh,
    # lib-manifest.sh.
    # shellcheck disable=SC2043  # Intentional single-iteration list for forward extensibility
    for root_file in AGENTS.md; do
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
      count_new=$((count_new + 1))
    else
      local installed_hash="${MANIFEST_HASHES[$dest]}"
      local current_hash
      current_hash=$(compute_hash "$dest")
      local action
      action=$(classify_file_action "$installed_hash" "$current_hash" "$new_hash")
      FILE_ACTIONS["$dest"]="$action"
      case "$action" in
        unchanged) count_unchanged=$((count_unchanged + 1)) ;;
        auto-update) count_auto=$((count_auto + 1)) ;;
        already-current) count_current=$((count_current + 1)) ;;
        conflict) count_conflict=$((count_conflict + 1)) ;;
      esac
    fi
  done

  # Check for files removed upstream
  for path in "${!MANIFEST_HASHES[@]}"; do
    if [ -z "${NEW_FILES[$path]+x}" ]; then
      # Determine the file's resource type from its path
      local file_type=""
      case "$path" in
        */tools/*)    file_type="tools" ;;
        */commands/*) file_type="commands" ;;
        */skills/*)   file_type="skills" ;;
        */prompts/*)  file_type="prompts" ;;
        */agents/*)   file_type="agents" ;;
        *)            file_type="configs" ;;
      esac
      # Skip files whose type is outside the --only filter scope
      if [ -n "$only_filter" ] && ! should_include_type "$file_type" "$only_filter"; then
        continue
      fi
      local tier="${MANIFEST_TIERS[$path]}"
      FILE_ACTIONS["$path"]="removed-upstream"
      count_removed=$((count_removed + 1))
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

  # Apply sidecar convention after update
  apply_sidecar_convention "$project_root"

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
# Sidecar convention: AGENTS.local.md and opencode.local.json
# ============================================================================
AGENTS_MD_MANAGED_COMMENT="<!-- lib-agents managed file. Add customizations to AGENTS.local.md -->"

# Apply sidecar convention after install/update:
# - Prepend managed-file comment to AGENTS.md
# - Append AGENTS.local.md contents if it exists
# - Warn about opencode.local.json (JSON deep merge is impractical in bash)
apply_sidecar_convention() {
  local project_root="$1"
  local agents_md="${project_root}/AGENTS.md"

  if [ ! -f "$agents_md" ]; then
    return
  fi

  # Prepend managed-file comment if not already present
  if ! head -1 "$agents_md" | grep -qF "lib-agents managed file"; then
    local tmp_agents="${agents_md}.tmp"
    {
      echo "$AGENTS_MD_MANAGED_COMMENT"
      cat "$agents_md"
    } > "$tmp_agents"
    mv "$tmp_agents" "$agents_md"
  fi

  # Append AGENTS.local.md if it exists
  local local_agents="${project_root}/AGENTS.local.md"
  if [ -f "$local_agents" ]; then
    # Strip any previously appended local content (between markers)
    local marker_start="<!-- BEGIN AGENTS.local.md -->"
    local marker_end="<!-- END AGENTS.local.md -->"
    if grep -qF "$marker_start" "$agents_md"; then
      # Remove old local content between markers
      sed -i "/$marker_start/,/$marker_end/d" "$agents_md"
    fi
    # Append local content with markers
    {
      echo ""
      echo "$marker_start"
      cat "$local_agents"
      echo ""
      echo "$marker_end"
    } >> "$agents_md"
    ok "Appended AGENTS.local.md customizations to AGENTS.md"
  fi

  # Warn about opencode.local.json
  local local_opencode="${project_root}/opencode.local.json"
  if [ -f "$local_opencode" ]; then
    warn "opencode.local.json detected. JSON deep merge is not supported by the installer."
    info "Please manually merge ${local_opencode} into ${project_root}/opencode.json"
  fi
}

