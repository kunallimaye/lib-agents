#!/usr/bin/env bash
# install/lib-profiles.sh — profile parsing, validation, skill injection,
# prompt overlays.  Requires: lib-logging.sh and the following globals to
# be set by the caller before sourcing:
#   REPO_ROOT, AGENTS_DIR
#   PROFILE_NAME, PROFILE_DESCRIPTION (strings)
#   PROFILE_AGENTS (indexed array)
#   PROFILE_AGENT_SKILLS (associative array; agent -> space-separated skills)
#   PROFILE_ALL_SKILLS (indexed array; UNION of all skills)

[ -n "${LIB_AGENTS_PROFILES_LOADED:-}" ] && return 0
LIB_AGENTS_PROFILES_LOADED=1

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
          # shellcheck disable=SC2034  # Parsed for future profile-listing UX; currently no reader. Keep the parse so adding a reader is a one-line change.
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
  if [ "${#PROFILE_ALL_SKILLS[@]}" -gt 0 ]; then
    mapfile -t PROFILE_ALL_SKILLS < <(printf '%s\n' "${PROFILE_ALL_SKILLS[@]}" | sort)
  fi
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
        # Still inside the skill: section; keep scanning. (Previously
        # captured the line into `last_skill_line`, but nothing read it.)
        :
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

  # plan.md was removed in PR #152 (orphan at runtime); only build remains.
  # Loop kept (vs collapsing to a single block) as an extension point for
  # future overlayable prompt files.
  # shellcheck disable=SC2043  # Intentional single-iteration list for forward extensibility
  for prompt_name in build; do
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
