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

# Profile state
PROFILE_NAME=""
declare -a PROFILE_AGENTS=()
declare -A PROFILE_AGENT_SKILLS=()   # agent -> space-separated skill list
declare -a PROFILE_ALL_SKILLS=()     # UNION of all agent_skills values
PROFILE_DESCRIPTION=""

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
# Profile infrastructure
# ============================================================================

# List available profiles with descriptions
list_profiles() {
  local profiles_dir="${REPO_ROOT}/profiles"
  if [ ! -d "$profiles_dir" ]; then
    err "No profiles directory found at ${profiles_dir}"
    exit 1
  fi

  info "Available profiles:"
  echo ""
  for profile_dir in "${profiles_dir}"/*/; do
    [ -d "$profile_dir" ] || continue
    local pname
    pname=$(basename "$profile_dir")
    local pdesc=""
    if [ -f "${profile_dir}/PROFILE.md" ]; then
      pdesc=$(parse_profile_field "${profile_dir}/PROFILE.md" "description")
    fi
    echo -e "  ${GREEN}${pname}${NC}  ${pdesc}"
  done
  echo ""
  exit 0
}

# Parse a single field from PROFILE.md YAML frontmatter
parse_profile_field() {
  local file="$1"
  local field="$2"
  local in_frontmatter=false
  local value=""

  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$in_frontmatter" = false ]; then
      if [ "$line" = "---" ]; then
        in_frontmatter=true
        continue
      fi
    else
      if [ "$line" = "---" ]; then
        break
      fi
      # Match "field: value" or "field: >-" etc.
      if echo "$line" | grep -q "^${field}:"; then
        value=$(echo "$line" | sed "s/^${field}:[[:space:]]*//" | sed 's/[[:space:]]*$//')
        echo "$value"
        return
      fi
    fi
  done < "$file"
  echo "$value"
}

# Parse PROFILE.md YAML frontmatter
# Sets: PROFILE_NAME, PROFILE_DESCRIPTION, PROFILE_AGENTS, PROFILE_AGENT_SKILLS, PROFILE_ALL_SKILLS
parse_profile() {
  local profile_path="$1"

  if [ ! -f "$profile_path" ]; then
    err "Profile file not found: ${profile_path}"
    exit 1
  fi

  PROFILE_NAME=""
  PROFILE_DESCRIPTION=""
  PROFILE_AGENTS=()
  PROFILE_AGENT_SKILLS=()
  PROFILE_ALL_SKILLS=()

  local in_frontmatter=false
  local current_section=""     # "agents" | "agent_skills"
  local current_agent=""       # current agent key under agent_skills
  local -A all_skills_set=()   # for deduplication

  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$in_frontmatter" = false ]; then
      if [ "$line" = "---" ]; then
        in_frontmatter=true
        continue
      fi
    else
      if [ "$line" = "---" ]; then
        break
      fi

      # Skip empty lines and comments
      [[ -z "$line" ]] && continue
      [[ "$line" == \#* ]] && continue

      # Top-level fields (no leading whitespace)
      if [[ "$line" =~ ^[a-z] ]]; then
        current_section=""
        current_agent=""

        if [[ "$line" =~ ^name:\ *(.*) ]]; then
          PROFILE_NAME="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^description:\ *(.*) ]]; then
          PROFILE_DESCRIPTION="${BASH_REMATCH[1]}"
        elif [[ "$line" == "agents:" ]]; then
          current_section="agents"
        elif [[ "$line" == "agent_skills:" ]]; then
          current_section="agent_skills"
        fi
        continue
      fi

      # List items under agents: (  - agent-name)
      if [ "$current_section" = "agents" ]; then
        if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
          local agent_name="${BASH_REMATCH[1]}"
          agent_name=$(echo "$agent_name" | xargs)  # trim
          PROFILE_AGENTS+=("$agent_name")
        fi
        continue
      fi

      # agent_skills section
      if [ "$current_section" = "agent_skills" ]; then
        # Agent key line (  agent-name:) — may have [] for empty list
        if [[ "$line" =~ ^[[:space:]]+([a-z][a-z0-9-]*):(.*)$ ]]; then
          current_agent="${BASH_REMATCH[1]}"
          local rest="${BASH_REMATCH[2]}"
          rest=$(echo "$rest" | xargs)
          # Handle inline empty list: "build: []"
          if [ "$rest" = "[]" ]; then
            PROFILE_AGENT_SKILLS["$current_agent"]=""
          fi
          continue
        fi
        # Skill list item (    - skill-name)
        if [ -n "$current_agent" ] && [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
          local skill_name="${BASH_REMATCH[1]}"
          skill_name=$(echo "$skill_name" | xargs)  # trim
          local existing="${PROFILE_AGENT_SKILLS[$current_agent]:-}"
          if [ -n "$existing" ]; then
            PROFILE_AGENT_SKILLS["$current_agent"]="${existing} ${skill_name}"
          else
            PROFILE_AGENT_SKILLS["$current_agent"]="${skill_name}"
          fi
          all_skills_set["$skill_name"]=1
        fi
        continue
      fi
    fi
  done < "$profile_path"

  # Build PROFILE_ALL_SKILLS from the union set
  for skill in "${!all_skills_set[@]}"; do
    PROFILE_ALL_SKILLS+=("$skill")
  done

  # Sort for deterministic output
  IFS=$'\n' PROFILE_ALL_SKILLS=($(sort <<<"${PROFILE_ALL_SKILLS[*]}")); unset IFS
}

# Validate that all agents and skills referenced in the profile exist
validate_profile() {
  local errors=0

  # Validate agents
  for agent in "${PROFILE_AGENTS[@]}"; do
    if [ ! -d "${AGENTS_DIR}/${agent}" ]; then
      err "Profile references nonexistent agent: '${agent}'"
      errors=$((errors + 1))
    fi
  done

  # Validate skills
  for skill in "${PROFILE_ALL_SKILLS[@]}"; do
    if [ ! -d "${REPO_ROOT}/skills/${skill}" ]; then
      err "Profile references nonexistent skill: '${skill}'"
      errors=$((errors + 1))
    fi
  done

  # Validate agent_skills keys that are agents (not build/plan) exist in agents list
  for agent in "${!PROFILE_AGENT_SKILLS[@]}"; do
    if [ "$agent" = "build" ] || [ "$agent" = "plan" ]; then
      continue  # orchestrators don't have agent.md
    fi
    local found=false
    for a in "${PROFILE_AGENTS[@]}"; do
      if [ "$a" = "$agent" ]; then
        found=true
        break
      fi
    done
    if [ "$found" = false ]; then
      err "agent_skills references agent '${agent}' not listed in agents:"
      errors=$((errors + 1))
    fi
  done

  if [ "$errors" -gt 0 ]; then
    err "Profile validation failed with ${errors} error(s)"
    exit 1
  fi

  ok "Profile '${PROFILE_NAME}' validated (${#PROFILE_AGENTS[@]} agents, ${#PROFILE_ALL_SKILLS[@]} skills)"
}

# Read skill description from SKILL.md frontmatter
get_skill_description() {
  local skill_name="$1"
  local skill_md="${REPO_ROOT}/skills/${skill_name}/SKILL.md"
  if [ -f "$skill_md" ]; then
    parse_profile_field "$skill_md" "description"
  else
    echo "(no description)"
  fi
}

# Inject profile skills into an installed agent.md
# Adds permission.skill entries and appends Profile Skills section
inject_profile_skills() {
  local agent_md="$1"
  local agent_name="$2"
  local profile_name="$3"

  if [ ! -f "$agent_md" ]; then
    return
  fi

  local skills_str="${PROFILE_AGENT_SKILLS[$agent_name]:-}"
  if [ -z "$skills_str" ]; then
    return
  fi

  # Read the agent's existing base skills from source (to know what's already allowed)
  local -A existing_skills=()
  local in_frontmatter=false
  local in_skill_section=false
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$in_frontmatter" = false ]; then
      if [ "$line" = "---" ]; then
        in_frontmatter=true
        continue
      fi
    else
      if [ "$line" = "---" ]; then
        break
      fi
      # Detect skill: section under permission:
      if [[ "$line" =~ ^[[:space:]]+skill: ]]; then
        in_skill_section=true
        continue
      fi
      # Exit skill section on non-indented or different section
      if [ "$in_skill_section" = true ]; then
        if [[ "$line" =~ ^[[:space:]]{4}[a-z\"*] ]]; then
          # Parse skill permission line: "    skill-name: allow"
          local sname
          sname=$(echo "$line" | sed 's/^[[:space:]]*//' | sed 's/:.*//' | sed 's/"//g')
          existing_skills["$sname"]=1
        else
          if [[ ! "$line" =~ ^[[:space:]]*$ ]]; then
            in_skill_section=false
          fi
        fi
      fi
    fi
  done < "$agent_md"

  # Determine which skills need to be added (not already in base)
  local -a new_skills=()
  for skill in $skills_str; do
    if [ -z "${existing_skills[$skill]+x}" ]; then
      new_skills+=("$skill")
    fi
  done

  if [ ${#new_skills[@]} -eq 0 ]; then
    return
  fi

  # Inject permission.skill entries into frontmatter
  # Find the closing --- of frontmatter and the last skill: entry before it
  local tmp_file="${agent_md}.tmp"
  local injected=false
  local in_fm=false
  local in_sk=false
  local last_skill_line=""

  # Strategy: find the last "allow" or "deny" line in the skill: section,
  # and insert new entries after it
  while IFS= read -r line || [ -n "$line" ]; do
    echo "$line"

    if [ "$in_fm" = false ]; then
      if [ "$line" = "---" ]; then
        in_fm=true
      fi
      continue
    fi

    if [ "$line" = "---" ]; then
      break
    fi

    if [[ "$line" =~ ^[[:space:]]+skill: ]]; then
      in_sk=true
      continue
    fi

    if [ "$in_sk" = true ]; then
      if [[ "$line" =~ ^[[:space:]]{4}[a-z\"*] ]]; then
        last_skill_line="$line"
      else
        if [[ ! "$line" =~ ^[[:space:]]*$ ]]; then
          # We've left the skill section — inject before this line
          if [ "$injected" = false ]; then
            for skill in "${new_skills[@]}"; do
              echo "    ${skill}: allow"
            done
            injected=true
          fi
          in_sk=false
        fi
      fi
    fi
  done < "$agent_md" > /dev/null

  # Now do the actual file rewrite
  {
    local in_fm2=false
    local in_sk2=false
    local injected2=false
    local past_frontmatter=false

    while IFS= read -r line || [ -n "$line" ]; do
      if [ "$past_frontmatter" = true ]; then
        echo "$line"
        continue
      fi

      if [ "$in_fm2" = false ]; then
        echo "$line"
        if [ "$line" = "---" ]; then
          in_fm2=true
        fi
        continue
      fi

      # Closing frontmatter
      if [ "$line" = "---" ]; then
        # If we haven't injected yet (skill section was at the end)
        if [ "$injected2" = false ] && [ "$in_sk2" = true ]; then
          for skill in "${new_skills[@]}"; do
            echo "    ${skill}: allow"
          done
          injected2=true
        fi
        echo "$line"
        past_frontmatter=true
        continue
      fi

      if [[ "$line" =~ ^[[:space:]]+skill: ]]; then
        in_sk2=true
        echo "$line"
        continue
      fi

      if [ "$in_sk2" = true ]; then
        if [[ "$line" =~ ^[[:space:]]{4}[a-z\"*] ]]; then
          echo "$line"
        else
          if [[ ! "$line" =~ ^[[:space:]]*$ ]]; then
            # Leaving skill section — inject new skills
            if [ "$injected2" = false ]; then
              for skill in "${new_skills[@]}"; do
                echo "    ${skill}: allow"
              done
              injected2=true
            fi
            in_sk2=false
            echo "$line"
          else
            echo "$line"
          fi
        fi
      else
        echo "$line"
      fi
    done < "$agent_md"

    # Append Profile Skills section
    echo ""
    echo "<!-- BEGIN profile:${profile_name} -->"
    echo "## Profile Skills (${profile_name})"
    echo ""
    echo "Additional skills available from your active profile. Load the relevant"
    echo "skill when the task involves its domain."
    echo ""
    echo "| Skill | Description |"
    echo "|-------|-------------|"
    for skill in "${new_skills[@]}"; do
      local desc
      desc=$(get_skill_description "$skill")
      echo "| \`${skill}\` | ${desc} |"
    done
    echo "<!-- END profile:${profile_name} -->"
  } > "$tmp_file"

  mv "$tmp_file" "$agent_md"
}

# Strip old profile markers from an installed file
strip_profile_markers() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return
  fi

  # Remove profile skills section (<!-- BEGIN profile:* --> to <!-- END profile:* -->)
  if grep -q "<!-- BEGIN profile:" "$file" 2>/dev/null; then
    sed -i '/<!-- BEGIN profile:/,/<!-- END profile:/d' "$file"
  fi
}

# Strip profile-injected permission.skill entries from an agent.md
# This is done by comparing against the source agent.md
strip_profile_permissions() {
  local installed_md="$1"
  local source_md="$2"

  if [ ! -f "$installed_md" ] || [ ! -f "$source_md" ]; then
    return
  fi

  # Re-copy the source agent.md to reset permissions
  cp "$source_md" "$installed_md"
}

# Apply prompt overlays from profile
apply_prompt_overlays() {
  local target="$1"
  local profile_dir="$2"
  local profile_name="$3"

  for prompt_name in build plan; do
    local overlay="${profile_dir}/prompts/${prompt_name}.md"
    local dest="${target}/prompts/${prompt_name}.md"

    if [ ! -f "$overlay" ] || [ ! -f "$dest" ]; then
      continue
    fi

    # Strip old overlay if present
    if grep -q "<!-- BEGIN profile:" "$dest" 2>/dev/null; then
      sed -i '/<!-- BEGIN profile:/,/<!-- END profile:/d' "$dest"
    fi

    # Append overlay with markers
    {
      echo ""
      echo "<!-- BEGIN profile:${profile_name} -->"
      cat "$overlay"
      echo ""
      echo "<!-- END profile:${profile_name} -->"
    } >> "$dest"

    ok "Applied prompt overlay: ${prompt_name}.md"
  done
}

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
declare -a MANIFEST_ENTRIES=()
declare -a INSTALLED_AGENTS_LIST=()

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
    if [ -n "${PROFILE_NAME:-}" ]; then
      echo "profile=${PROFILE_NAME}"
    fi
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
MANIFEST_PROFILE=""

read_manifest() {
  local manifest_path="$1"
  MANIFEST_HASHES=()
  MANIFEST_TIERS=()
  MANIFEST_COMMIT=""
  MANIFEST_URL=""
  MANIFEST_AT=""
  MANIFEST_AGENTS_CSV=""
  MANIFEST_MODE=""
  MANIFEST_PROFILE=""

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
      profile=*)
        MANIFEST_PROFILE="${line#profile=}"
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
       $(basename "$0") --profile <name> [--project|--global|--link]
       $(basename "$0") --status [--project|--global]
       $(basename "$0") --update [--dry-run] [--only=TYPE,...] [--agent=NAME]
       $(basename "$0") --rollback [--project|--global]

Deploy one or more agent packages to your OpenCode configuration.
Can be run locally from a cloned repo or piped directly via curl.

Arguments:
  agent-name    One or more agent names to install (e.g., git-ops docs)

Install Options:
  --all, -a     Install all available agents (shorthand for --profile default)
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

    # Reset shared resources flag to force reinstall
    SHARED_RESOURCES_INSTALLED=false
    MANIFEST_ENTRIES=()
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
