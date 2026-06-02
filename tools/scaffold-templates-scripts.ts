// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// Scripts generators: common.sh, local.sh, container.sh, cloud.sh.

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

// ─── Scripts Generation ──────────────────────────────────────────────

export function generateCommonSh(): string {
  return `#!/usr/bin/env bash
# Common functions sourced by all scripts
# Tier-1 hygiene (issue #140): set -euo pipefail, traps, stable log paths,
# exit-code discipline. Tier-2 detached-orchestration helpers are below.
set -euo pipefail

# ─── Logging ──────────────────────────────────────────────────────────

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

log_info()  { echo -e "\${BLUE}[INFO]\${NC}  $*"; }
log_ok()    { echo -e "\${GREEN}[OK]\${NC}    $*"; }
log_warn()  { echo -e "\${YELLOW}[WARN]\${NC}  $*"; }
log_error() { echo -e "\${RED}[ERROR]\${NC} $*" >&2; }

die() { log_error "$@"; exit 1; }

# ─── Paths ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "\${SCRIPT_DIR}/.." && pwd)"

# Load .env if it exists. .env is the override layer for sensitive values
# (project IDs, billing accounts, emails, API keys). Never committed.
if [[ -f "\${PROJECT_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "\${PROJECT_ROOT}/.env"
  set +a
fi

# ─── Environment Selection ───────────────────────────────────────────
# Priority: CLI env var > .env file > default (staging).
# Environment-axis layering (per #115) is independent of the role axis
# (per #141). A single environment slices through all three roles.
export ENVIRONMENT="\${ENVIRONMENT:-staging}"

# ─── Config.toml Parsing (via Python) ────────────────────────────────
# scripts/config.py parses config.toml with role-axis (defaults +
# orchestration + build + runtime) and environment-axis layering, then
# emits shell exports. Same parser is the source of truth for Terraform
# (via Cloud Build TF_VAR_* substitutions).

if [[ -f "\${PROJECT_ROOT}/config.toml" ]]; then
  log_info "Loading config from config.toml (environment: \${ENVIRONMENT})"
  eval "$(python3 "\${SCRIPT_DIR}/config.py")"
fi

# ─── Defaults (override in .env, config.toml, or environment) ────────

export PROJECT_NAME="\${PROJECT_NAME:-$(basename "\${PROJECT_ROOT}")}"
export IMAGE_NAME="\${IMAGE_NAME:-\${PROJECT_NAME}}"
export IMAGE_TAG="\${IMAGE_TAG:-latest}"

# Three-role topology resolved values.
# Each role can collapse to the same project (90% case) or split.
# config.py resolves env > role > defaults > error.
export ORCH_PROJECT="\${ORCH_PROJECT:-}"
export ORCH_REGION="\${ORCH_REGION:-}"
export BUILD_PROJECT="\${BUILD_PROJECT:-}"
export BUILD_REGION="\${BUILD_REGION:-}"
export RUNTIME_PROJECT="\${RUNTIME_PROJECT:-}"
export RUNTIME_REGION="\${RUNTIME_REGION:-}"

# Legacy aliases for back-compat with downstream snippets that still use
# the pre-role-topology names. Resolve to the matching role.
export GCP_PROJECT="\${GCP_PROJECT:-\${RUNTIME_PROJECT}}"
export GCP_REGION="\${GCP_REGION:-\${RUNTIME_REGION:-us-central1}}"
export CB_PROJECT="\${CB_PROJECT:-\${BUILD_PROJECT}}"

# Resource defaults
export AR_REPO="\${AR_REPO:-\${PROJECT_NAME}}"
export TF_STATE_BUCKET="\${TF_STATE_BUCKET:-}"
export TF_STATE_PREFIX="\${TF_STATE_PREFIX:-\${PROJECT_NAME}/\${ENVIRONMENT}}"
export DOMAIN="\${DOMAIN:-}"
export DNS_PROJECT_ID="\${DNS_PROJECT_ID:-}"
export DNS_MANAGED_ZONE="\${DNS_MANAGED_ZONE:-}"
export DNS_RECORD_NAME="\${DNS_RECORD_NAME:-}"
export MIN_INSTANCES="\${MIN_INSTANCES:-0}"
export MAX_INSTANCES="\${MAX_INSTANCES:-3}"
export INGRESS="\${INGRESS:-all}"

# Service account defaults — agent runs in orchestration project (operator
# CLI identity), builder runs in build project (Cloud Build identity),
# runtime runs in runtime project (Cloud Run app identity).
export AGENT_SA_NAME="\${AGENT_SA_NAME:-\${PROJECT_NAME}-agent}"
export BUILDER_SA_NAME="\${BUILDER_SA_NAME:-\${PROJECT_NAME}-builder}"
export RUNTIME_SA_NAME="\${RUNTIME_SA_NAME:-\${PROJECT_NAME}-runtime}"

# Custom role for the agent SA (curated YAML in cicd/iam/).
# The custom role ID GCP wants is camelCase (no dashes / slashes).
_to_camel() {
  echo "$1" | awk -F'[-_]' '{out=$1; for(i=2;i<=NF;i++) out=out toupper(substr($i,1,1)) substr($i,2); print out}'
}
export DEPLOYER_ROLE_ID="\${DEPLOYER_ROLE_ID:-$(_to_camel "\${PROJECT_NAME}")Deployer}"
export DEPLOYER_ROLE_YAML="\${DEPLOYER_ROLE_YAML:-\${PROJECT_ROOT}/cicd/iam/\${PROJECT_NAME}-deployer-role.yaml}"

# 30-day expiry for the agent → custom-role binding (#141 lesson 2).
# Operator re-runs admin-cloud-init to refresh.
export AGENT_ROLE_EXPIRY_DAYS="\${AGENT_ROLE_EXPIRY_DAYS:-30}"

# Derived SA emails. When all three role projects collapse to one, these
# all live in the same project but have distinct local-parts.
export AGENT_SA_EMAIL="\${AGENT_SA_EMAIL:-\${AGENT_SA_NAME}@\${ORCH_PROJECT:-\${BUILD_PROJECT}}.iam.gserviceaccount.com}"
export BUILDER_SA_EMAIL="\${BUILDER_SA_EMAIL:-\${BUILDER_SA_NAME}@\${BUILD_PROJECT}.iam.gserviceaccount.com}"
export RUNTIME_SA_EMAIL="\${RUNTIME_SA_EMAIL:-\${RUNTIME_SA_NAME}@\${RUNTIME_PROJECT}.iam.gserviceaccount.com}"

# Legacy alias: some downstream snippets still reference CB_SERVICE_ACCOUNT.
# Map it to the builder SA (which is what Cloud Build submits as).
export CB_SERVICE_ACCOUNT="\${CB_SERVICE_ACCOUNT:-\${BUILDER_SA_EMAIL}}"

# ─── Helpers ──────────────────────────────────────────────────────────

require_cmd() {
  command -v "$1" &>/dev/null || die "'$1' is required but not installed."
}

confirm() {
  local prompt="\${1:-Are you sure?} [y/N] "
  read -r -p "\${prompt}" response
  [[ "\${response}" =~ ^[Yy]$ ]]
}

# Print the resolved three-role topology. Used by \`make cloud-help\` and
# preflight. When all three projects collapse to one, the operator sees
# an explicit "collapsed to one project" note so the choice is obvious.
print_topology() {
  local op="\${ORCH_PROJECT:-<unset>}"
  local bp="\${BUILD_PROJECT:-<unset>}"
  local rp="\${RUNTIME_PROJECT:-<unset>}"
  echo "Cloud topology: orchestration=\${op}, build=\${bp}, runtime=\${rp}"
  if [[ "\${op}" == "\${bp}" && "\${bp}" == "\${rp}" && "\${op}" != "<unset>" ]]; then
    echo "               (all three collapsed to one project — fine for personal/hobby use)"
  elif [[ "\${bp}" == "\${rp}" ]]; then
    echo "               (build + runtime collapsed; orchestration split — useful when agent identity lives outside build/runtime)"
  elif [[ "\${op}" == "\${bp}" ]]; then
    echo "               (orchestration + build collapsed; runtime split — production tenancy pattern)"
  else
    echo "               (fully split — production multi-project tenancy)"
  fi
}

# Returns 0 (true) when role_a project equals role_b project.
# Usage: same_project ORCH_PROJECT BUILD_PROJECT && echo collapsed
#
# Uses bash indirect expansion (\${!var}) instead of \`eval\` — avoids the
# class of code-injection risk that \`eval\` on caller-supplied strings
# carries, even though every caller here passes a hardcoded identifier.
same_project() {
  local a_val="\${!1:-}" b_val="\${!2:-}"
  [[ -n "\${a_val}" && "\${a_val}" == "\${b_val}" ]]
}

# ─── Log Capture ─────────────────────────────────────────────────────

LOG_DIR="\${PROJECT_ROOT}/logs"
mkdir -p "\${LOG_DIR}"

# Start capturing all stdout/stderr to a per-run log file.
# Stable path convention (#140 Tier-1): logs/<timestamp>-<action>.log.
# Operators and agents always know where to look after the fact.
# Usage: start_log <action-name>
start_log() {
  local action="\${1:-unknown}"
  LOG_FILE="\${LOG_DIR}/$(date +%Y%m%d-%H%M%S)-\${action}.log"
  # Set SCRIPT_ACTION so the EXIT/INT/TERM/HUP trap handler can name the
  # action in its forensic log line — without this, only detached-orchestrated
  # runs (which set SCRIPT_ACTION inside run_detached_*) had meaningful context.
  SCRIPT_ACTION="\${action}"
  exec > >(tee -a "\${LOG_FILE}") 2>&1
  log_info "Logging to \${LOG_FILE}"
}

# ─── Tier-1 hygiene: trap on EXIT/INT/TERM/HUP ────────────────────────
# The real universal lesson from kunal-labs/dex-arb-agent#136 is that
# any script mutating external state must leave a forensic breadcrumb
# when interrupted. Even a stub handler that logs "interrupted at line N"
# is a huge win when the parent shell disconnects mid-deploy.
#
# Scripts that want richer behavior (recovery file, heartbeat cleanup)
# should override _trap_handler after sourcing common.sh.

_trap_handler() {
  local exit_code="\$1"
  local line_no="\${2:-?}"
  if (( exit_code != 0 )); then
    log_error "Script interrupted (exit=\${exit_code}, line=\${line_no})."
    log_error "Action: \${SCRIPT_ACTION:-unknown}"
    log_error "Log file: \${LOG_FILE:-(none — start_log not called)}"
    # If a heartbeat / checkpoint is active, surface it so the operator
    # knows recovery state may exist.
    if [[ -n "\${HEARTBEAT_FILE:-}" && -f "\${HEARTBEAT_FILE}" ]]; then
      log_error "Heartbeat file: \${HEARTBEAT_FILE} (run 'make cloud-status' for state)"
    fi
    if [[ -n "\${RECOVERY_FILE:-}" ]]; then
      echo "interrupted exit=\${exit_code} line=\${line_no} time=$(date +%s) action=\${SCRIPT_ACTION:-unknown}" \\
        >> "\${RECOVERY_FILE}"
      log_error "Recovery hint written to \${RECOVERY_FILE} (run 'make cloud-recover')"
    fi
  fi
}

trap '_trap_handler $? \${LINENO}' EXIT
trap '_trap_handler 130 \${LINENO}; exit 130' INT
trap '_trap_handler 143 \${LINENO}; exit 143' TERM
trap '_trap_handler 129 \${LINENO}; exit 129' HUP

# ─── Tier-2 detached orchestration helpers (#140 + #141 lesson 3) ─────
#
# Two flavors:
#
#   1. run_detached_cloudbuild  — single atomic remote job.
#      Heartbeat fields: build_id, started_at, last_seen_at, status.
#      tfstate-lock-aware recovery: if the parent dies but the build
#      runs to SUCCESS, the next 'make cloud-status' / 'cloud-recover'
#      can break a stuck tfstate lock and reconcile.
#
#   2. run_detached_stepwise    — N sequential local steps + checkpoint.
#      Checkpoint embeds sha256 of the step list (#141 lesson 3): on
#      resume, mismatch = treat checkpoint as stale and restart from
#      step 1. Step idempotency is a contract; restart-from-1 is safe.
#
# Operator escape hatch: ORCH_FORCE_RESTART=1 invalidates the checkpoint
# unconditionally and starts fresh. Document prominently in cloud.sh
# help text + Makefile.

ORCH_STATE_DIR="\${PROJECT_ROOT}/.orchestration"
mkdir -p "\${ORCH_STATE_DIR}"

# Heartbeat / checkpoint / recovery file paths are per-action.
_orch_paths() {
  local action="\$1"
  HEARTBEAT_FILE="\${ORCH_STATE_DIR}/\${action}.heartbeat"
  CHECKPOINT_FILE="\${ORCH_STATE_DIR}/\${action}.checkpoint"
  RECOVERY_FILE="\${ORCH_STATE_DIR}/\${action}.recovery"
}

# Write a JSON-ish heartbeat line. Append-only; cloud-status reads tail.
_heartbeat_write() {
  local action="\$1" phase="\$2" extra="\${3:-}"
  local now
  now="$(date +%s)"
  printf '{"action":"%s","phase":"%s","ts":%s%s}\\n' \\
    "\${action}" "\${phase}" "\${now}" "\${extra:+,\${extra}}" \\
    >> "\${HEARTBEAT_FILE}"
}

# Compute checkpoint key = sha256 of the step list string. When the step
# list changes between runs, the key changes; a stale checkpoint is
# silently invalidated. Prevents the dex-arb-agent #87 / onchain-markets
# #89 class of bug ("we added two new steps but the checkpoint=6 skipped
# them silently").
_step_list_hash() {
  printf '%s\\n' "$@" | sha256sum | awk '{print $1}'
}

_checkpoint_read() {
  [[ -f "\${CHECKPOINT_FILE}" ]] || { echo ""; return 0; }
  cat "\${CHECKPOINT_FILE}"
}

_checkpoint_write() {
  local hash="\$1" step_idx="\$2"
  printf 'hash=%s\\nstep=%s\\nupdated_at=%s\\n' "\${hash}" "\${step_idx}" "$(date +%s)" \\
    > "\${CHECKPOINT_FILE}"
}

_checkpoint_clear() { rm -f "\${CHECKPOINT_FILE}"; }

# Drive a sequence of idempotent step functions through with checkpoint
# resume + step-list-hash invalidation. The caller passes the action
# name as $1 and the step-function names as $2..$N.
#
# Each step function takes no arguments. Each MUST be idempotent (run
# twice is a no-op the second time). Exit nonzero = halt + leave
# checkpoint at the last-completed step so re-run picks up there.
run_detached_stepwise() {
  local action="\$1"; shift
  local -a steps=("$@")
  local nsteps="\${#steps[@]}"
  (( nsteps > 0 )) || die "run_detached_stepwise: no steps provided"

  _orch_paths "\${action}"
  local current_hash
  current_hash="$(_step_list_hash "\${steps[@]}")"

  local start_step=1
  local prior
  prior="$(_checkpoint_read)"

  if [[ "\${ORCH_FORCE_RESTART:-0}" == "1" ]]; then
    log_warn "ORCH_FORCE_RESTART=1 set — clearing checkpoint and restarting from step 1."
    _checkpoint_clear
  elif [[ -n "\${prior}" ]]; then
    local prior_hash prior_step
    prior_hash="$(echo "\${prior}" | awk -F'=' '/^hash=/ {print $2}')"
    prior_step="$(echo "\${prior}" | awk -F'=' '/^step=/ {print $2}')"
    if [[ "\${prior_hash}" == "\${current_hash}" ]]; then
      start_step=$((prior_step + 1))
      log_info "Resuming from step \${start_step}/\${nsteps} (checkpoint hash matches)."
    else
      log_warn "Checkpoint hash mismatch (step list changed since last run)."
      log_warn "Treating checkpoint as stale — restarting from step 1."
      log_warn "(Override: set ORCH_FORCE_RESTART=1 to silence this. Step idempotency makes restart safe.)"
      _checkpoint_clear
    fi
  fi

  _heartbeat_write "\${action}" "start" "\\"nsteps\\":\${nsteps},\\"start_step\\":\${start_step}"
  SCRIPT_ACTION="\${action}"

  local i=0
  for step_fn in "\${steps[@]}"; do
    i=$((i + 1))
    if (( i < start_step )); then
      log_info "Step \${i}/\${nsteps}: \${step_fn} — skipped (checkpoint)."
      continue
    fi
    log_info "Step \${i}/\${nsteps}: \${step_fn}"
    _heartbeat_write "\${action}" "step" "\\"i\\":\${i},\\"fn\\":\\"\${step_fn}\\""
    if ! "\${step_fn}"; then
      _heartbeat_write "\${action}" "failed" "\\"i\\":\${i},\\"fn\\":\\"\${step_fn}\\""
      die "Step \${i}/\${nsteps} (\${step_fn}) failed. Re-run to resume; ORCH_FORCE_RESTART=1 to restart from scratch."
    fi
    _checkpoint_write "\${current_hash}" "\${i}"
  done

  _heartbeat_write "\${action}" "complete" "\\"nsteps\\":\${nsteps}"
  _checkpoint_clear
  log_ok "Detached run complete: \${action} (\${nsteps} steps)."
}

# Single atomic remote job (Cloud Build). The caller provides the
# gcloud-builds-submit command as a function name. The helper records
# the build_id, heartbeats while it runs, and writes a recovery hint if
# the parent dies. tfstate-lock-aware recovery is out of scope here
# (the runner is expected to use a tfstate backend with the lock TTL
# tuned to the build's max duration).
run_detached_cloudbuild() {
  local action="\$1" submit_fn="\$2"
  _orch_paths "\${action}"
  _heartbeat_write "\${action}" "submit"
  SCRIPT_ACTION="\${action}"
  if ! "\${submit_fn}"; then
    _heartbeat_write "\${action}" "failed"
    die "Cloud Build submit failed for action: \${action}"
  fi
  _heartbeat_write "\${action}" "complete"
}

# Read the most recent heartbeat phase. Used by cloud-status.
heartbeat_status() {
  local action="\$1"
  _orch_paths "\${action}"
  if [[ ! -f "\${HEARTBEAT_FILE}" ]]; then
    echo "NEVER_STARTED"
    return 0
  fi
  local last phase ts now age
  last="$(tail -1 "\${HEARTBEAT_FILE}")"
  phase="$(echo "\${last}" | sed -E 's/.*"phase":"([^"]+)".*/\\1/')"
  ts="$(echo "\${last}" | sed -E 's/.*"ts":([0-9]+).*/\\1/')"
  now="$(date +%s)"
  age=$((now - ts))
  case "\${phase}" in
    complete) echo "COMPLETE (age=\${age}s)" ;;
    failed)   echo "FAILED (age=\${age}s, see \${HEARTBEAT_FILE})" ;;
    start|step|submit)
      if (( age > 600 )); then
        echo "STALLED (phase=\${phase}, age=\${age}s)"
      else
        echo "RUNNING (phase=\${phase}, age=\${age}s)"
      fi
      ;;
    *) echo "UNKNOWN (phase=\${phase})" ;;
  esac
}

# Read the recovery file (written by the EXIT/HUP trap) and emit hints
# to the operator. Used by cloud-recover.
recovery_summary() {
  local action="\$1"
  _orch_paths "\${action}"
  if [[ ! -f "\${RECOVERY_FILE}" ]]; then
    echo "No recovery state for \${action}."
    return 0
  fi
  echo "Recovery state for \${action}:"
  cat "\${RECOVERY_FILE}"
}
`
}

export function generateLocalSh(pt: ProjectType): string {
  const builds: Record<ProjectType, { init: string; clean: string; build: string; run: string; test: string; lint: string }> = {
    node: {
      init: '  require_cmd node\n  npm install\n  log_ok "Dependencies installed"',
      clean: '  rm -rf node_modules dist .next coverage build out\n  log_ok "Cleaned local artifacts"',
      build: '  npm run build\n  log_ok "Build complete"',
      run: '  npm run dev',
      test: '  npm test\n  log_ok "Tests passed"',
      lint: '  npm run lint 2>/dev/null || npx eslint .\n  log_ok "Lint passed"',
    },
    go: {
      init: '  require_cmd go\n  go mod download\n  log_ok "Dependencies downloaded"',
      clean: '  rm -rf bin/ dist/\n  go clean -cache\n  log_ok "Cleaned local artifacts"',
      build: '  go build -o bin/ ./...\n  log_ok "Build complete"',
      run: '  go run .',
      test: '  go test ./...\n  log_ok "Tests passed"',
      lint: '  golangci-lint run 2>/dev/null || go vet ./...\n  log_ok "Lint passed"',
    },
    python: {
      init: '  require_cmd python3\n  python3 -m venv .venv\n  source .venv/bin/activate\n  pip install -r requirements.txt 2>/dev/null || pip install -e ".[dev]" 2>/dev/null || true\n  log_ok "Virtual environment created and dependencies installed"',
      clean: '  rm -rf .venv __pycache__ .eggs *.egg-info dist build .pytest_cache .mypy_cache\n  find . -name "*.pyc" -delete\n  log_ok "Cleaned local artifacts"',
      build: '  python3 -m build 2>/dev/null || log_warn "No build step configured"\n  log_ok "Build complete"',
      run: '  source .venv/bin/activate 2>/dev/null || true\n  python3 -m "${PROJECT_NAME}" 2>/dev/null || python3 main.py 2>/dev/null || python3 app.py 2>/dev/null || die "Could not determine entry point"',
      test: '  source .venv/bin/activate 2>/dev/null || true\n  python3 -m pytest\n  log_ok "Tests passed"',
      lint: '  source .venv/bin/activate 2>/dev/null || true\n  ruff check . 2>/dev/null || python3 -m flake8 .\n  log_ok "Lint passed"',
    },
    rust: {
      init: '  require_cmd cargo\n  cargo fetch\n  log_ok "Dependencies fetched"',
      clean: '  cargo clean\n  log_ok "Cleaned local artifacts"',
      build: '  cargo build --release\n  log_ok "Build complete"',
      // #141 lesson 5: operator-facing run defaults to --release.
      // Dev profile is fine for `cargo test`, wrong for "operator-facing run this against prod."
      // For dev profile, add `local-run-dev: cargo run` manually.
      run: '  cargo run --release',
      test: '  cargo test\n  log_ok "Tests passed"',
      lint: '  cargo clippy -- -D warnings\n  log_ok "Lint passed"',
    },
    java: {
      init: '  if [[ -f pom.xml ]]; then\n    require_cmd mvn\n    mvn dependency:resolve\n  elif [[ -f build.gradle ]]; then\n    require_cmd gradle\n    gradle dependencies\n  fi\n  log_ok "Dependencies resolved"',
      clean: '  if [[ -f pom.xml ]]; then mvn clean; elif [[ -f build.gradle ]]; then gradle clean; fi\n  log_ok "Cleaned local artifacts"',
      build: '  if [[ -f pom.xml ]]; then mvn package -DskipTests; elif [[ -f build.gradle ]]; then gradle build -x test; fi\n  log_ok "Build complete"',
      run: '  if [[ -f pom.xml ]]; then mvn exec:java; elif [[ -f build.gradle ]]; then gradle run; fi',
      test: '  if [[ -f pom.xml ]]; then mvn test; elif [[ -f build.gradle ]]; then gradle test; fi\n  log_ok "Tests passed"',
      lint: '  if [[ -f pom.xml ]]; then mvn checkstyle:check; elif [[ -f build.gradle ]]; then gradle check; fi\n  log_ok "Lint passed"',
    },
    generic: {
      init: '  log_warn "No project type detected. Customize this script for your project."\n  log_ok "Init complete"',
      clean: '  rm -rf build dist out tmp\n  log_ok "Cleaned local artifacts"',
      build: '  log_warn "No build step configured. Edit scripts/local.sh to add your build command."',
      run: '  log_warn "No run command configured. Edit scripts/local.sh to add your run command."',
      test: '  log_warn "No test command configured. Edit scripts/local.sh to add your test command."',
      lint: '  log_warn "No lint command configured. Edit scripts/local.sh to add your lint command."',
    },
  }

  const b = builds[pt]
  // NOTE: \${b.*} interpolations in the template below are JS template expressions,
  // not bash variables — do NOT escape them with a backslash.
  return `#!/usr/bin/env bash
# Local development operations
# Usage: bash scripts/local.sh {init|clean|build|run|test|lint}

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "\${SCRIPT_DIR}/common.sh"
start_log "local-\${1:-unknown}"

init() {
  log_info "Initializing local dev environment..."
${b.init}
}

clean() {
  log_info "Cleaning local artifacts..."
${b.clean}
}

build() {
  log_info "Building locally..."
${b.build}
}

run() {
  log_info "Running locally..."
${b.run}
}

test() {
  log_info "Running tests..."
${b.test}
}

lint() {
  log_info "Running linter..."
${b.lint}
}

# ─── Dispatch ─────────────────────────────────────────────────────────

case "\${1:-}" in
  init)  init  ;;
  clean) clean ;;
  build) build ;;
  run)   run   ;;
  test)  test  ;;
  lint)  lint  ;;
  *)     die "Usage: $0 {init|clean|build|run|test|lint}" ;;
esac
`
}

export function generateContainerSh(pt: ProjectType): string {
  const port =
    pt === "node"
      ? "3000"
      : pt === "go"
        ? "8080"
        : pt === "python"
          ? "8000"
          : pt === "java"
            ? "8080"
            : "8080"

  return `#!/usr/bin/env bash
# Container development operations (Podman)
# Usage: bash scripts/container.sh {init|clean|build|run}

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "\${SCRIPT_DIR}/common.sh"
start_log "container-\${1:-unknown}"

CONTAINER_PORT="\${CONTAINER_PORT:-${port}}"
HOST_PORT="\${HOST_PORT:-\${CONTAINER_PORT}}"

init() {
  log_info "Initializing container environment..."
  require_cmd podman
  # Pull base image to warm cache
  podman pull "$(head -1 "\${PROJECT_ROOT}/cicd/Dockerfile" | awk '{print $2}')" 2>/dev/null || true
  log_ok "Container environment ready"
}

clean() {
  log_info "Cleaning containers and images..."
  podman stop "\${PROJECT_NAME}" 2>/dev/null || true
  podman rm "\${PROJECT_NAME}" 2>/dev/null || true
  podman rmi "\${IMAGE_NAME}:\${IMAGE_TAG}" 2>/dev/null || true
  log_ok "Cleaned containers and images"
}

build() {
  log_info "Building container image..."
  require_cmd podman
  podman build \\
    -f "\${PROJECT_ROOT}/cicd/Dockerfile" \\
    -t "\${IMAGE_NAME}:\${IMAGE_TAG}" \\
    "\${PROJECT_ROOT}"
  log_ok "Image built: \${IMAGE_NAME}:\${IMAGE_TAG}"
}

run() {
  log_info "Running container..."
  require_cmd podman
  podman run --rm \\
    --name "\${PROJECT_NAME}" \\
    -p "\${HOST_PORT}:\${CONTAINER_PORT}" \\
    "\${IMAGE_NAME}:\${IMAGE_TAG}"
}

# ─── Dispatch ─────────────────────────────────────────────────────────

case "\${1:-}" in
  init)  init  ;;
  clean) clean ;;
  build) build ;;
  run)   run   ;;
  *)     die "Usage: $0 {init|clean|build|run}" ;;
esac
`
}

export function generateCloudSh(): string {
  return `#!/usr/bin/env bash
# Cloud runtime operations — three-role topology (orchestration / build / runtime)
#
# Operator interface is the Makefile; this script is the implementation.
# Never invoke this script directly — go through 'make <target>' so logging,
# trap handlers, and the heartbeat/checkpoint machinery engage.
#
# Verbs (role-aware vocabulary, #141 lesson 6):
#
#   help                — print resolved three-role topology
#   admin-cloud-init    — Owner-tier 8-step bootstrap (run as Owner once)
#   admin-cloud-destroy — symmetric teardown (preserves TF state + AR by default)
#   cloud-preflight     — read-only audit (per-role-aware messaging)
#   cloud-infra         — TF apply via Cloud Build (builder SA in build project)
#   cloud-app-deploy    — image build + Cloud Run revision swap
#   cloud-app-promote   — semver tag + deploy to non-staging runtime (VERSION + IMAGE required)
#   cloud-app-undeploy  — revert Cloud Run to placeholder image
#   cloud-clean         — TF destroy (runtime resources only)
#   cloud-status        — read heartbeat: RUNNING | STALLED | COMPLETE | NEVER_STARTED
#   cloud-recover       — read EXIT/HUP recovery file, complete teardown
#
# Operator escape hatch:
#   ORCH_FORCE_RESTART=1 — invalidates stepwise checkpoint, restarts from step 1.
#                          Step idempotency is a contract; restart-from-1 is safe.

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "\${SCRIPT_DIR}/common.sh"
start_log "cloud-\${1:-unknown}"

# Build Cloud Build substitutions from config. Carries the three-role
# topology to Terraform via TF_VAR_* env (see cloudbuild-apply.yaml).
_tf_substitutions() {
  local subs="_REGION=\${RUNTIME_REGION:-\${GCP_REGION}}"
  [[ -n "\${TF_STATE_BUCKET}" ]] && subs="\${subs},_TF_STATE_BUCKET=\${TF_STATE_BUCKET}"
  [[ -n "\${TF_STATE_PREFIX}" ]] && subs="\${subs},_TF_STATE_PREFIX=\${TF_STATE_PREFIX}"
  subs="\${subs},_SERVICE_NAME=\${PROJECT_NAME}"
  subs="\${subs},_DOMAIN=\${DOMAIN}"
  subs="\${subs},_DNS_PROJECT_ID=\${DNS_PROJECT_ID}"
  subs="\${subs},_DNS_MANAGED_ZONE=\${DNS_MANAGED_ZONE}"
  subs="\${subs},_DNS_RECORD_NAME=\${DNS_RECORD_NAME}"
  subs="\${subs},_MIN_INSTANCES=\${MIN_INSTANCES}"
  subs="\${subs},_MAX_INSTANCES=\${MAX_INSTANCES}"
  subs="\${subs},_BUILDER_SA_EMAIL=\${BUILDER_SA_EMAIL}"
  subs="\${subs},_RUNTIME_SA_NAME=\${RUNTIME_SA_NAME}"
  subs="\${subs},_ORCH_PROJECT_ID=\${ORCH_PROJECT}"
  subs="\${subs},_BUILD_PROJECT_ID=\${BUILD_PROJECT}"
  subs="\${subs},_RUNTIME_PROJECT_ID=\${RUNTIME_PROJECT}"
  subs="\${subs},_INGRESS=\${INGRESS}"
  echo "\${subs}"
}

# Resolve the caller's gcloud quota project once and cache it in
# CALLER_PROJECT. Used by _grant_role to decide whether a grant is
# cross-project (caller's quota project ≠ target).
#
# Why this matters: the --billing-project flag routes the API call's
# quota+billing to the target project, which is required when the
# caller's quota project differs from the target (otherwise an org
# policy can reject with "no billing project"). The previous
# implementation compared against ORCH_PROJECT, which only matched
# the caller's project by coincidence in fully-collapsed topologies.
# In split-orch topologies (or any case where \`gcloud config\` points
# at a project other than ORCH_PROJECT), the branch misfired —
# missing the flag for genuine cross-project grants, or adding it
# unnecessarily for local grants.
_resolve_caller_project() {
  if [[ -z "\${CALLER_PROJECT:-}" ]]; then
    CALLER_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
    if [[ -z "\${CALLER_PROJECT}" ]]; then
      die "Unable to detect caller's gcloud project. Run 'gcloud config set project <id>' first."
    fi
    log_info "  caller project (gcloud quota): \${CALLER_PROJECT}"
  fi
}

# Cross-project IAM grant helper. Each grant in admin-cloud-init may target
# the local project (caller's quota project) or a different one (cross-project).
# The behavior is uniform — branch on caller-vs-target for the operator
# warning message and the --billing-project flag.
_grant_role() {
  local target_project="\$1" member="\$2" role="\$3"
  _resolve_caller_project
  local extra_flag=""
  if [[ "\${target_project}" != "\${CALLER_PROJECT}" ]]; then
    extra_flag="--billing-project=\${target_project}"
    log_info "  cross-project grant: \${role} on \${target_project} for \${member}"
  fi
  # shellcheck disable=SC2086
  gcloud projects add-iam-policy-binding "\${target_project}" \\
    \${extra_flag} \\
    --member="\${member}" \\
    --role="\${role}" \\
    --condition=None \\
    --quiet
}

_require_topology() {
  [[ -z "\${ORCH_PROJECT}" ]]    && die "ORCH_PROJECT not set. Fill [gcp.defaults].project or [gcp.orchestration].project in config.toml."
  [[ -z "\${BUILD_PROJECT}" ]]   && die "BUILD_PROJECT not set. Fill [gcp.defaults].project or [gcp.build].project in config.toml."
  [[ -z "\${RUNTIME_PROJECT}" ]] && die "RUNTIME_PROJECT not set. Fill [gcp.defaults].project or [gcp.runtime].project in config.toml."
}

# ─── help ─────────────────────────────────────────────────────────────

help_cmd() {
  print_topology
  echo ""
  echo "Operator interface: see 'make help' (the Makefile is the operator surface."
  echo "                    Never invoke scripts/cloud.sh directly.)"
  echo ""
  echo "Escape hatch: ORCH_FORCE_RESTART=1 invalidates the stepwise checkpoint"
  echo "              and restarts the run from step 1. Always safe (step"
  echo "              idempotency is a contract)."
}

# ─── admin-cloud-init ─────────────────────────────────────────────────
# Owner-tier 8-step bootstrap. Runs in the orchestration project as Owner.
# Cross-project-aware: each grant branches on local-vs-cross-project.
# Stepwise checkpointed via run_detached_stepwise — re-run resumes; the
# step-list hash invalidates stale checkpoints automatically (#141 lesson 3).
# All steps are idempotent.

_step_enable_apis() {
  local apis=(
    "serviceusage.googleapis.com"
    "iam.googleapis.com"
    "cloudresourcemanager.googleapis.com"
    "cloudbuild.googleapis.com"
    "artifactregistry.googleapis.com"
    "run.googleapis.com"
    "storage.googleapis.com"
    "logging.googleapis.com"
  )
  # API enable is per-project (each role's project that owns resources).
  # Build, runtime, AND orchestration need APIs — orchestration needs
  # iam.googleapis.com + cloudresourcemanager.googleapis.com so the
  # agent SA management and custom-role creation steps work.
  # We enable the full set on each distinct project for simplicity —
  # idempotent and cheap. Dedup by value across all three roles.
  local projects=("\${BUILD_PROJECT}")
  same_project BUILD_PROJECT RUNTIME_PROJECT || projects+=("\${RUNTIME_PROJECT}")
  if ! same_project ORCH_PROJECT BUILD_PROJECT \\
      && ! same_project ORCH_PROJECT RUNTIME_PROJECT; then
    projects+=("\${ORCH_PROJECT}")
  fi
  for p in "\${projects[@]}"; do
    log_info "  enabling APIs on \${p}..."
    for api in "\${apis[@]}"; do
      gcloud services enable "\${api}" --project="\${p}" --quiet
    done
  done
}

_step_create_ar_repo() {
  if gcloud artifacts repositories describe "\${AR_REPO}" \\
      --location="\${BUILD_REGION:-\${GCP_REGION}}" \\
      --project="\${BUILD_PROJECT}" &>/dev/null; then
    log_ok "  AR repo already exists: \${AR_REPO} in \${BUILD_PROJECT}"
    return 0
  fi
  gcloud artifacts repositories create "\${AR_REPO}" \\
    --repository-format=docker \\
    --location="\${BUILD_REGION:-\${GCP_REGION}}" \\
    --description="Container images for \${PROJECT_NAME}" \\
    --project="\${BUILD_PROJECT}" \\
    --quiet
}

_step_create_tfstate_bucket() {
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET not set."
  if gcloud storage buckets describe "gs://\${TF_STATE_BUCKET}" --project="\${BUILD_PROJECT}" &>/dev/null; then
    log_ok "  TF state bucket already exists: gs://\${TF_STATE_BUCKET}"
    return 0
  fi
  gcloud storage buckets create "gs://\${TF_STATE_BUCKET}" \\
    --project="\${BUILD_PROJECT}" \\
    --location="\${BUILD_REGION:-\${GCP_REGION}}" \\
    --uniform-bucket-level-access \\
    --quiet
}

_step_create_builder_sa() {
  if gcloud iam service-accounts describe "\${BUILDER_SA_EMAIL}" --project="\${BUILD_PROJECT}" &>/dev/null; then
    log_ok "  Builder SA already exists: \${BUILDER_SA_EMAIL}"
    return 0
  fi
  gcloud iam service-accounts create "\${BUILDER_SA_NAME}" \\
    --display-name="\${PROJECT_NAME} Builder (Cloud Build)" \\
    --project="\${BUILD_PROJECT}" \\
    --quiet
}

_step_create_custom_role() {
  [[ -f "\${DEPLOYER_ROLE_YAML}" ]] || die "Custom role YAML missing: \${DEPLOYER_ROLE_YAML}. Re-run /scaffold to generate it."
  # Custom role lives on the orchestration project (where the agent identity lives).
  if gcloud iam roles describe "\${DEPLOYER_ROLE_ID}" --project="\${ORCH_PROJECT}" &>/dev/null; then
    log_info "  Custom role exists — updating from YAML..."
    gcloud iam roles update "\${DEPLOYER_ROLE_ID}" \\
      --project="\${ORCH_PROJECT}" \\
      --file="\${DEPLOYER_ROLE_YAML}" \\
      --quiet
  else
    log_info "  Creating custom role from YAML..."
    gcloud iam roles create "\${DEPLOYER_ROLE_ID}" \\
      --project="\${ORCH_PROJECT}" \\
      --file="\${DEPLOYER_ROLE_YAML}" \\
      --quiet
  fi
}

_step_create_agent_sa_and_bind() {
  # Create agent SA (operator identity) in orchestration project.
  if ! gcloud iam service-accounts describe "\${AGENT_SA_EMAIL}" --project="\${ORCH_PROJECT}" &>/dev/null; then
    gcloud iam service-accounts create "\${AGENT_SA_NAME}" \\
      --display-name="\${PROJECT_NAME} Agent (operator identity)" \\
      --project="\${ORCH_PROJECT}" \\
      --quiet
  else
    log_ok "  Agent SA already exists: \${AGENT_SA_EMAIL}"
  fi

  # Bind agent SA to custom role on orchestration project with 30-day expiry.
  # Expiry condition forces graceful credential rotation (re-run admin-cloud-init).
  #
  # Guard against empty AGENT_ROLE_EXPIRY_DAYS: BSD date (macOS) silently
  # emits 'now' when the relative offset is empty, which would bind the
  # role with an already-expired condition. common.sh sets a default of 30,
  # but be explicit about the failure mode if it ever gets cleared.
  [[ -n "\${AGENT_ROLE_EXPIRY_DAYS}" ]] || die "AGENT_ROLE_EXPIRY_DAYS is empty. Set it in config.toml ([gcp.orchestration].agent_role_expiry_days) or .env, or accept the 30-day default in common.sh."
  local expiry_ts
  expiry_ts="$(date -u -d "+\${AGENT_ROLE_EXPIRY_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \\
    || date -u -v+\${AGENT_ROLE_EXPIRY_DAYS}d '+%Y-%m-%dT%H:%M:%SZ')"
  local condition_title="agent-role-expiry-\${AGENT_ROLE_EXPIRY_DAYS}d"
  log_info "  binding agent SA → custom role with expiry \${expiry_ts}"
  gcloud projects add-iam-policy-binding "\${ORCH_PROJECT}" \\
    --member="serviceAccount:\${AGENT_SA_EMAIL}" \\
    --role="projects/\${ORCH_PROJECT}/roles/\${DEPLOYER_ROLE_ID}" \\
    --condition="expression=request.time < timestamp(\\"\${expiry_ts}\\"),title=\${condition_title},description=Auto-expires; re-run admin-cloud-init to refresh." \\
    --quiet
}

_step_grant_agent_actas_builder() {
  # Agent SA needs iam.serviceAccountUser on the builder SA so it can
  # pass --service-account=<builder> to gcloud builds submit.
  gcloud iam service-accounts add-iam-policy-binding "\${BUILDER_SA_EMAIL}" \\
    --project="\${BUILD_PROJECT}" \\
    --member="serviceAccount:\${AGENT_SA_EMAIL}" \\
    --role="roles/iam.serviceAccountUser" \\
    --condition=None \\
    --quiet
}

_step_grant_builder_roles() {
  # The 6 predefined roles the builder SA holds. Scoped to what TF
  # actually needs to construct resources (NO projectIamAdmin, NO
  # serviceUsageAdmin — those would defeat the agent's least-privilege model).
  #
  # Each grant targets the runtime project (where TF builds things), with
  # one grant on the build project for storage admin (TF state + Cloud
  # Build staging bucket). Cross-project-aware: branches on local-vs-cross.
  local builder_roles_runtime=(
    "roles/run.admin"
    "roles/artifactregistry.admin"
    "roles/iam.serviceAccountUser"
    "roles/iam.serviceAccountAdmin"
    "roles/logging.logWriter"
  )
  local builder_member="serviceAccount:\${BUILDER_SA_EMAIL}"

  log_info "  granting builder SA 5 functional roles on runtime project (\${RUNTIME_PROJECT})"
  for role in "\${builder_roles_runtime[@]}"; do
    _grant_role "\${RUNTIME_PROJECT}" "\${builder_member}" "\${role}"
  done

  # Storage admin lives on the build project (TF state bucket + Cloud
  # Build staging bucket are both there).
  log_info "  granting builder SA storage.admin on build project (\${BUILD_PROJECT})"
  _grant_role "\${BUILD_PROJECT}" "\${builder_member}" "roles/storage.admin"

  # DNS admin if a DNS project is configured. Cross-project-aware.
  if [[ -n "\${DNS_PROJECT_ID}" ]]; then
    log_info "  granting builder SA dns.admin on DNS project (\${DNS_PROJECT_ID})"
    _grant_role "\${DNS_PROJECT_ID}" "\${builder_member}" "roles/dns.admin"
  fi
}

admin_cloud_init() {
  log_info "Owner-tier bootstrap (\${ENVIRONMENT})..."
  print_topology
  require_cmd gcloud
  _require_topology
  _resolve_caller_project
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set."

  if [[ "\${CONFIRM:-}" != "yes" ]]; then
    confirm "Proceed with 8-step bootstrap?" || { log_warn "Aborted."; exit 0; }
  fi

  run_detached_stepwise "admin-cloud-init" \\
    _step_enable_apis \\
    _step_create_ar_repo \\
    _step_create_tfstate_bucket \\
    _step_create_builder_sa \\
    _step_create_custom_role \\
    _step_create_agent_sa_and_bind \\
    _step_grant_agent_actas_builder \\
    _step_grant_builder_roles

  log_ok "admin-cloud-init complete."
  log_info "Next: 'make cloud-preflight' to verify, then 'make cloud-infra' to provision runtime resources."
}

# ─── admin-cloud-destroy ──────────────────────────────────────────────
# Symmetric to admin-cloud-init. Preserves TF state bucket + AR repo by
# default (those are too destructive to remove without explicit confirm).
# Set DESTROY_STATE_BUCKET=yes / DESTROY_AR_REPO=yes to include them.

_step_destroy_grant_builder_roles() {
  local builder_roles_runtime=(
    "roles/run.admin"
    "roles/artifactregistry.admin"
    "roles/iam.serviceAccountUser"
    "roles/iam.serviceAccountAdmin"
    "roles/logging.logWriter"
  )
  local builder_member="serviceAccount:\${BUILDER_SA_EMAIL}"
  for role in "\${builder_roles_runtime[@]}"; do
    gcloud projects remove-iam-policy-binding "\${RUNTIME_PROJECT}" \\
      --member="\${builder_member}" \\
      --role="\${role}" \\
      --quiet 2>/dev/null || true
  done
  gcloud projects remove-iam-policy-binding "\${BUILD_PROJECT}" \\
    --member="\${builder_member}" \\
    --role="roles/storage.admin" \\
    --quiet 2>/dev/null || true
}

_step_destroy_agent_actas_builder() {
  gcloud iam service-accounts remove-iam-policy-binding "\${BUILDER_SA_EMAIL}" \\
    --project="\${BUILD_PROJECT}" \\
    --member="serviceAccount:\${AGENT_SA_EMAIL}" \\
    --role="roles/iam.serviceAccountUser" \\
    --quiet 2>/dev/null || true
}

_step_destroy_agent_sa() {
  gcloud iam service-accounts delete "\${AGENT_SA_EMAIL}" --project="\${ORCH_PROJECT}" --quiet 2>/dev/null || true
}

_step_destroy_custom_role() {
  gcloud iam roles delete "\${DEPLOYER_ROLE_ID}" --project="\${ORCH_PROJECT}" --quiet 2>/dev/null || true
}

_step_destroy_builder_sa() {
  gcloud iam service-accounts delete "\${BUILDER_SA_EMAIL}" --project="\${BUILD_PROJECT}" --quiet 2>/dev/null || true
}

_step_destroy_tfstate_bucket() {
  if [[ "\${DESTROY_STATE_BUCKET:-no}" == "yes" ]]; then
    log_warn "  DESTROY_STATE_BUCKET=yes — removing gs://\${TF_STATE_BUCKET}"
    gcloud storage rm -r "gs://\${TF_STATE_BUCKET}" --project="\${BUILD_PROJECT}" --quiet 2>/dev/null || true
  else
    log_info "  preserving TF state bucket gs://\${TF_STATE_BUCKET} (set DESTROY_STATE_BUCKET=yes to remove)"
  fi
}

_step_destroy_ar_repo() {
  if [[ "\${DESTROY_AR_REPO:-no}" == "yes" ]]; then
    log_warn "  DESTROY_AR_REPO=yes — removing AR repo \${AR_REPO}"
    gcloud artifacts repositories delete "\${AR_REPO}" \\
      --location="\${BUILD_REGION:-\${GCP_REGION}}" \\
      --project="\${BUILD_PROJECT}" --quiet 2>/dev/null || true
  else
    log_info "  preserving AR repo \${AR_REPO} (set DESTROY_AR_REPO=yes to remove)"
  fi
}

admin_cloud_destroy() {
  log_warn "Owner-tier teardown of bootstrap (\${ENVIRONMENT})..."
  print_topology
  require_cmd gcloud
  _require_topology

  if [[ "\${CONFIRM:-}" != "yes" ]]; then
    confirm "Proceed with destructive teardown of agent/builder SAs and IAM bindings?" \\
      || { log_warn "Aborted."; exit 0; }
  fi

  run_detached_stepwise "admin-cloud-destroy" \\
    _step_destroy_grant_builder_roles \\
    _step_destroy_agent_actas_builder \\
    _step_destroy_agent_sa \\
    _step_destroy_custom_role \\
    _step_destroy_builder_sa \\
    _step_destroy_tfstate_bucket \\
    _step_destroy_ar_repo

  log_ok "admin-cloud-destroy complete."
}

# ─── cloud-preflight ──────────────────────────────────────────────────
# Read-only audit. Verifies bootstrap state across all three roles with
# per-role-aware messaging. Never mutates.

cloud_preflight() {
  log_info "Cloud preflight audit (read-only)..."
  print_topology
  require_cmd gcloud
  _require_topology

  local errors=0
  local checks=0

  # APIs (sample one critical API per project where resources live)
  for p in "\${BUILD_PROJECT}" "\${RUNTIME_PROJECT}"; do
    checks=$((checks + 1))
    if gcloud services list --enabled --project="\${p}" --filter="config.name=run.googleapis.com" --format="value(config.name)" 2>/dev/null | grep -q "run.googleapis.com"; then
      log_ok "  APIs enabled on \${p} (run.googleapis.com sentinel ✓)"
    else
      log_error "  APIs not enabled on \${p} — run 'make admin-cloud-init'"
      errors=$((errors + 1))
    fi
  done

  # AR repo exists in build project
  checks=$((checks + 1))
  if gcloud artifacts repositories describe "\${AR_REPO}" \\
      --location="\${BUILD_REGION:-\${GCP_REGION}}" \\
      --project="\${BUILD_PROJECT}" &>/dev/null; then
    log_ok "  AR repo exists: \${AR_REPO} in \${BUILD_PROJECT}"
  else
    log_error "  AR repo missing: \${AR_REPO} in \${BUILD_PROJECT}"
    errors=$((errors + 1))
  fi

  # TF state bucket exists in build project
  checks=$((checks + 1))
  if [[ -n "\${TF_STATE_BUCKET}" ]] && gcloud storage buckets describe "gs://\${TF_STATE_BUCKET}" --project="\${BUILD_PROJECT}" &>/dev/null; then
    log_ok "  TF state bucket exists: gs://\${TF_STATE_BUCKET} in \${BUILD_PROJECT}"
  else
    log_error "  TF state bucket missing: gs://\${TF_STATE_BUCKET:-<unset>}"
    errors=$((errors + 1))
  fi

  # Builder SA exists in build project
  checks=$((checks + 1))
  if gcloud iam service-accounts describe "\${BUILDER_SA_EMAIL}" --project="\${BUILD_PROJECT}" &>/dev/null; then
    log_ok "  Builder SA exists: \${BUILDER_SA_EMAIL}"
  else
    log_error "  Builder SA missing: \${BUILDER_SA_EMAIL}"
    errors=$((errors + 1))
  fi

  # Builder SA has expected 5 roles on runtime project
  checks=$((checks + 1))
  local builder_member="serviceAccount:\${BUILDER_SA_EMAIL}"
  local policy
  policy="$(gcloud projects get-iam-policy "\${RUNTIME_PROJECT}" --format=json 2>/dev/null || echo '{}')"
  local missing_roles=()
  for role in "roles/run.admin" "roles/artifactregistry.admin" "roles/iam.serviceAccountUser" "roles/iam.serviceAccountAdmin" "roles/logging.logWriter"; do
    # grep for the quoted role string in the JSON IAM policy.
    if ! grep -q "\\\"\${role}\\\"" <<<"\${policy}"; then
      missing_roles+=("\${role}")
    fi
  done
  if (( \${#missing_roles[@]} == 0 )); then
    log_ok "  Builder SA has all 5 functional roles on runtime project (\${RUNTIME_PROJECT})"
  else
    log_error "  Builder SA missing roles on \${RUNTIME_PROJECT}: \${missing_roles[*]}"
    errors=$((errors + 1))
  fi

  # Agent SA exists in orchestration project
  checks=$((checks + 1))
  if gcloud iam service-accounts describe "\${AGENT_SA_EMAIL}" --project="\${ORCH_PROJECT}" &>/dev/null; then
    log_ok "  Agent SA exists: \${AGENT_SA_EMAIL}"
  else
    log_warn "  Agent SA missing: \${AGENT_SA_EMAIL} (run 'make admin-cloud-init')"
    errors=$((errors + 1))
  fi

  # Custom role exists on orchestration project
  checks=$((checks + 1))
  if gcloud iam roles describe "\${DEPLOYER_ROLE_ID}" --project="\${ORCH_PROJECT}" &>/dev/null; then
    log_ok "  Custom role exists: \${DEPLOYER_ROLE_ID} in \${ORCH_PROJECT}"
  else
    log_warn "  Custom role missing: \${DEPLOYER_ROLE_ID} in \${ORCH_PROJECT}"
    errors=$((errors + 1))
  fi

  echo ""
  if (( errors == 0 )); then
    log_ok "Preflight passed: \${checks}/\${checks} checks OK."
    return 0
  fi
  log_error "Preflight failed: \${errors}/\${checks} checks failed."
  return 1
}

# ─── cloud-infra ──────────────────────────────────────────────────────
# TF apply via Cloud Build. Builder SA runs in the build project and
# provisions runtime-project resources (Cloud Run, runtime SA, LB/DNS).

cloud_infra() {
  log_info "Provisioning runtime infrastructure (\${ENVIRONMENT})..."
  require_cmd gcloud
  _require_topology
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET not set."

  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${BUILD_PROJECT}" \\
    --service-account="projects/\${BUILD_PROJECT}/serviceAccounts/\${BUILDER_SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions)" \\
    --quiet

  log_ok "Infrastructure ready (\${ENVIRONMENT})"
}

# ─── cloud-app-deploy ─────────────────────────────────────────────────
# Build image (tagged :latest + :sha-<commit>) and swap Cloud Run revision.

cloud_app_deploy() {
  log_info "Build + deploy application (\${ENVIRONMENT})..."
  require_cmd gcloud
  _require_topology
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET not set."

  local short_sha
  short_sha="$(git -C "\${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo manual)"
  local image_base="\${BUILD_REGION:-\${GCP_REGION}}-docker.pkg.dev/\${BUILD_PROJECT}/\${AR_REPO}/\${PROJECT_NAME}"

  log_info "Step 1/2: build + push image"
  log_info "  Image: \${image_base}:latest"
  log_info "  Image: \${image_base}:sha-\${short_sha}"
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${BUILD_PROJECT}" \\
    --service-account="projects/\${BUILD_PROJECT}/serviceAccounts/\${BUILDER_SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild.yaml" \\
    --substitutions="_IMAGE_NAME=\${image_base},_SHORT_SHA=\${short_sha}" \\
    --quiet

  log_info "Step 2/2: swap Cloud Run revision"
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${BUILD_PROJECT}" \\
    --service-account="projects/\${BUILD_PROJECT}/serviceAccounts/\${BUILDER_SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions),_IMAGE=\${image_base}:latest" \\
    --quiet

  log_ok "Application deployed (sha-\${short_sha})"
}

# ─── cloud-app-promote ────────────────────────────────────────────────
# Tag a specific image with a semver and deploy to a non-staging runtime.
# Requires VERSION=vX.Y.Z and IMAGE=<full-uri> (the source image to promote).

cloud_app_promote() {
  log_info "Promoting image to \${ENVIRONMENT}..."
  require_cmd gcloud
  _require_topology
  [[ "\${ENVIRONMENT}" == "staging" ]] && die "Cannot promote to staging. Use cloud-app-deploy instead."
  [[ -z "\${VERSION:-}" ]] && die "VERSION is required (e.g., VERSION=v1.0.0)"
  [[ -z "\${IMAGE:-}" ]] && die "IMAGE is required (full URI of source image, e.g., IMAGE=us-central1-docker.pkg.dev/<build-project>/<repo>/<svc>:sha-abc123f)"

  # Source image must live in BUILD_PROJECT's AR — that's where the
  # cross-project runtime-SA read binding points (see main.tf).
  local expected_prefix="\${BUILD_REGION:-\${GCP_REGION}}-docker.pkg.dev/\${BUILD_PROJECT}/\${AR_REPO}/"
  if [[ "\${IMAGE}" != "\${expected_prefix}"* ]]; then
    die "IMAGE must start with '\${expected_prefix}' (got: \${IMAGE}). Source images must live in BUILD_PROJECT's Artifact Registry."
  fi

  log_info "Step 1/2: Tagging image as \${VERSION}..."
  gcloud artifacts docker tags add "\${IMAGE}" "\${IMAGE%%:*}:\${VERSION}"
  log_ok "Tagged \${IMAGE} as \${VERSION}"

  local versioned_image="\${IMAGE%%:*}:\${VERSION}"
  log_info "Step 2/2: Deploying \${versioned_image} to \${ENVIRONMENT}..."
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${BUILD_PROJECT}" \\
    --service-account="projects/\${BUILD_PROJECT}/serviceAccounts/\${BUILDER_SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions),_IMAGE=\${versioned_image}" \\
    --quiet

  log_ok "Promoted \${VERSION} to \${ENVIRONMENT}"
}

# ─── cloud-app-undeploy ───────────────────────────────────────────────

cloud_app_undeploy() {
  log_info "Undeploying (\${ENVIRONMENT}, reverting to placeholder)..."
  require_cmd gcloud
  _require_topology

  # Sentinel string — main.tf substitutes the Cloud Run hello-world image
  # when it sees this value.
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${BUILD_PROJECT}" \\
    --service-account="projects/\${BUILD_PROJECT}/serviceAccounts/\${BUILDER_SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions),_IMAGE=__placeholder__" \\
    --quiet

  log_ok "Application undeployed (Cloud Run reverted to placeholder)"
}

# ─── cloud-clean ──────────────────────────────────────────────────────
# TF destroy. Removes runtime resources (Cloud Run, runtime SA, LB/DNS).
# Does NOT remove bootstrap state (use admin-cloud-destroy for that).

cloud_clean() {
  log_warn "Tearing down runtime infrastructure (\${ENVIRONMENT})..."
  require_cmd gcloud
  _require_topology

  if [[ "\${CONFIRM:-}" != "yes" ]]; then
    confirm "Destroy runtime infrastructure for \${ENVIRONMENT}?" \\
      || { log_warn "Aborted."; exit 0; }
  fi

  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${BUILD_PROJECT}" \\
    --service-account="projects/\${BUILD_PROJECT}/serviceAccounts/\${BUILDER_SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=destroy,$(_tf_substitutions)" \\
    --quiet

  log_ok "Runtime infrastructure destroyed."
}

# ─── cloud-status / cloud-recover ─────────────────────────────────────

cloud_status() {
  # Show heartbeat for the most-likely active actions. cloud-status is
  # diagnostic; it never mutates.
  for action in admin-cloud-init admin-cloud-destroy cloud-infra cloud-clean cloud-app-deploy; do
    printf '  %-22s %s\\n' "\${action}" "$(heartbeat_status "\${action}")"
  done
}

cloud_recover() {
  echo "Recovery state for all known actions:"
  for action in admin-cloud-init admin-cloud-destroy cloud-infra cloud-clean cloud-app-deploy; do
    echo ""
    echo "[\${action}]"
    recovery_summary "\${action}"
  done
}

# Compatibility: legacy verbs from the pre-#141 scaffold. Stub out with a
# helpful message rather than silently breaking downstream Makefiles that
# someone forgot to update. This is the only back-compat — config and TF
# are clean breaks.
_legacy_stub() {
  local old="\$1" new="\$2"
  die "Verb '\${old}' has been removed. Use 'make \${new}' (three-role topology, #141)."
}

# ─── Dispatch ─────────────────────────────────────────────────────────

case "\${1:-}" in
  help|cloud-help)        help_cmd ;;
  admin-cloud-init)       admin_cloud_init ;;
  admin-cloud-destroy)    admin_cloud_destroy ;;
  cloud-preflight)        cloud_preflight ;;
  cloud-infra)            cloud_infra ;;
  cloud-app-deploy)       cloud_app_deploy ;;
  cloud-app-promote)      cloud_app_promote ;;
  cloud-app-undeploy)     cloud_app_undeploy ;;
  cloud-clean)            cloud_clean ;;
  cloud-status)           cloud_status ;;
  cloud-recover)          cloud_recover ;;
  # Removed legacy verbs (#141 — breaking change). Stub with a clear redirect.
  init)         _legacy_stub init admin-cloud-init ;;
  init-prod)    _legacy_stub init-prod admin-cloud-init ;;
  infra)        _legacy_stub infra cloud-infra ;;
  app-deploy)   _legacy_stub app-deploy cloud-app-deploy ;;
  app-promote)  _legacy_stub app-promote cloud-app-promote ;;
  app-undeploy) _legacy_stub app-undeploy cloud-app-undeploy ;;
  clean)        _legacy_stub clean cloud-clean ;;
   *) die "Usage: $0 {help|admin-cloud-init|admin-cloud-destroy|cloud-preflight|cloud-infra|cloud-app-deploy|cloud-app-promote|cloud-app-undeploy|cloud-clean|cloud-status|cloud-recover}" ;;
esac
`
}

