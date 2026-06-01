import { tool } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

// ─── Project Detection ───────────────────────────────────────────────

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

function detectProject(root: string): ProjectType {
  if (existsSync(join(root, "package.json"))) return "node"
  if (existsSync(join(root, "go.mod"))) return "go"
  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "requirements.txt"))
  )
    return "python"
  if (existsSync(join(root, "Cargo.toml"))) return "rust"
  if (
    existsSync(join(root, "pom.xml")) ||
    existsSync(join(root, "build.gradle"))
  )
    return "java"
  return "generic"
}

function projectLabel(pt: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    node: "Node.js/TypeScript",
    go: "Go",
    python: "Python",
    rust: "Rust",
    java: "Java",
    generic: "Generic",
  }
  return labels[pt]
}

// ─── File Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function safeWrite(
  path: string,
  content: string,
  force: boolean,
): string {
  if (existsSync(path) && !force) {
    return `  SKIP: ${path} (already exists)`
  }
  ensureDir(join(path, ".."))
  writeFileSync(path, content)
  return `  CREATED: ${path}`
}

// ─── Makefile Generation ─────────────────────────────────────────────

function generateMakefile(_pt: ProjectType): string {
  return `.PHONY: help \\
  local-init local-clean local-build local-run local-test local-lint \\
  container-init container-clean container-build container-run \\
  cloud-help admin-cloud-init admin-cloud-destroy \\
  cloud-preflight cloud-infra cloud-app-deploy \\
  cloud-app-promote cloud-app-undeploy cloud-clean \\
  cloud-status cloud-recover \\
  logs-list logs-last logs-clean

help: ## Show this help
\t@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \\
\t  awk 'BEGIN {FS = ":.*?## "}; {printf "  \\033[36m%-22s\\033[0m %s\\n", $$1, $$2}'

# ─── Local Development ───────────────────────────────────────────────

local-init: ## Initialize local dev environment
\t@bash scripts/local.sh init

local-clean: ## Clean local build artifacts
\t@bash scripts/local.sh clean

local-build: ## Build the project locally
\t@bash scripts/local.sh build

local-run: ## Run the project locally
\t@bash scripts/local.sh run

local-test: ## Run tests locally
\t@bash scripts/local.sh test

local-lint: ## Run linter locally
\t@bash scripts/local.sh lint

# ─── Container Development ───────────────────────────────────────────

container-init: ## Pull/build base images
\t@bash scripts/container.sh init

container-clean: ## Remove containers and images
\t@bash scripts/container.sh clean

container-build: ## Build container image
\t@bash scripts/container.sh build

container-run: ## Run container locally
\t@bash scripts/container.sh run

# ─── Cloud Runtime (three-role topology: orchestration / build / runtime) ──

cloud-help: ## Print the resolved three-role topology (orchestration/build/runtime)
\t@bash scripts/cloud.sh help

admin-cloud-init: ## Owner-tier bootstrap: APIs, AR, TF state, builder SA, custom role, agent SA grants. Run as Owner.
\t@bash scripts/cloud.sh admin-cloud-init

admin-cloud-destroy: ## Owner-tier teardown of bootstrap (preserves TF state bucket + AR repo by default)
\t@bash scripts/cloud.sh admin-cloud-destroy

cloud-preflight: ## Read-only audit: APIs ✓, AR ✓, builder SA roles ✓ (per-role-aware messaging)
\t@bash scripts/cloud.sh cloud-preflight

cloud-infra: ## TF apply via Cloud Build (builder SA in build project, provisions runtime-project resources)
\t@bash scripts/cloud.sh cloud-infra

cloud-app-deploy: ## Image build + Cloud Run revision swap (current ENVIRONMENT)
\t@bash scripts/cloud.sh cloud-app-deploy

cloud-app-promote: ## Tag + deploy to non-staging runtime. Requires VERSION=vX.Y.Z and IMAGE=<full-uri>
\t@bash scripts/cloud.sh cloud-app-promote

cloud-app-undeploy: ## Revert Cloud Run to placeholder image (keeps infra)
\t@bash scripts/cloud.sh cloud-app-undeploy

cloud-clean: ## Tear down runtime infrastructure (terraform destroy via Cloud Build)
\t@bash scripts/cloud.sh cloud-clean

# ─── Detached Orchestration (cloud-status / cloud-recover) ──
# These targets read state written by run_detached_with_heartbeat in
# scripts/common.sh. See AGENTS.local.md for the convention.

cloud-status: ## Show detached-orchestration status: RUNNING | STALLED | COMPLETE | NEVER_STARTED
\t@bash scripts/cloud.sh cloud-status

cloud-recover: ## Read EXIT/HUP trap recovery file and complete teardown
\t@bash scripts/cloud.sh cloud-recover

# ─── Logs ─────────────────────────────────────────────────────────────

logs-list: ## List recent log files
\t@ls -lt logs/*.log 2>/dev/null | head -20 || echo "No log files found"

logs-last: ## Show the most recent log file
\t@ls -t logs/*.log 2>/dev/null | head -1 | xargs cat 2>/dev/null || echo "No log files found"

logs-clean: ## Remove all log files
\t@rm -rf logs/*.log && echo "Cleaned log files" || true

# ─── Operator notes ──────────────────────────────────────────────────
# - ORCH_FORCE_RESTART=1 on any admin-cloud-* / cloud-* target invalidates
#   the stepwise checkpoint and restarts the run from step 1. Step
#   idempotency is a contract; restart is always safe.
# - Every Make target is a thin wrapper around scripts/. Never invoke
#   the scripts directly — go through \`make <target>\` so logging, trap
#   handlers, and the heartbeat/checkpoint machinery engage.
`
}

// ─── Scripts Generation ──────────────────────────────────────────────

function generateCommonSh(): string {
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
same_project() {
  local a_val b_val
  a_val="$(eval "echo \\\${$1:-}")"
  b_val="$(eval "echo \\\${$2:-}")"
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

function generateLocalSh(pt: ProjectType): string {
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

function generateContainerSh(pt: ProjectType): string {
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

function generateCloudSh(): string {
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

# Cross-project IAM grant helper. Each grant in admin-cloud-init may target
# the local project (current role) or a different one (cross-project). The
# behavior is uniform — branch on local-vs-cross-project for the operator
# warning message and the --billing-project flag.
_grant_role() {
  local target_project="\$1" member="\$2" role="\$3"
  local extra_flag=""
  if [[ "\${target_project}" != "\${ORCH_PROJECT}" ]]; then
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
  # Build project needs build-time APIs; runtime needs runtime APIs.
  # We enable the full set on each distinct project for simplicity —
  # idempotent and cheap.
  local projects=()
  projects+=("\${BUILD_PROJECT}")
  same_project BUILD_PROJECT RUNTIME_PROJECT || projects+=("\${RUNTIME_PROJECT}")
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

// ─── Container Files Generation ─────────────────────────────────────

function generateDockerfile(pt: ProjectType): string {
  const dockerfiles: Record<ProjectType, string> = {
    node: `# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./
EXPOSE 3000
USER appuser
CMD ["node", "dist/index.js"]
`,
    go: `# Stage 1: Build
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bin/server .

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/bin/server /server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
`,
    python: `# Stage 1: Build
FROM python:3.12-slim AS builder
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app
RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -m appuser
COPY --from=builder --chown=appuser:appgroup /opt/venv /opt/venv
COPY --from=builder --chown=appuser:appgroup /app .
ENV PATH="/opt/venv/bin:$PATH"
EXPOSE 8000
USER appuser
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
    rust: `# Stage 1: Build
FROM rust:1.77-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/target/release/app /app
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app"]
`,
    java: `# Stage 1: Build
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml ./
RUN mvn dependency:resolve
COPY . .
RUN mvn package -DskipTests

# Stage 2: Runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY --from=builder --chown=appuser:appgroup /app/target/*.jar app.jar
EXPOSE 8080
USER appuser
CMD ["java", "-jar", "app.jar"]
`,
    generic: `FROM alpine:3.19
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["sh", "-c", "echo 'Replace this with your application command'"]
`,
  }
  return dockerfiles[pt]
}

function generateDockerignore(pt: ProjectType): string {
  const common = `.git
.gitignore
.env
.env.*
*.md
LICENSE
.DS_Store
tmp/
.cache/
cicd/terraform/
cicd/cloudbuild*.yaml
`
  const extras: Record<ProjectType, string> = {
    node: `node_modules/
dist/
coverage/
.next/
.nuxt/
`,
    go: `bin/
vendor/
`,
    python: `__pycache__/
*.pyc
.venv/
venv/
.eggs/
*.egg-info/
.pytest_cache/
.mypy_cache/
`,
    rust: `target/
`,
    java: `target/
build/
.gradle/
`,
    generic: `build/
out/
`,
  }
  return common + extras[pt]
}

// ─── Cloud Build Generation ─────────────────────────────────────────

function generateCloudbuildYaml(): string {
  return `# Main build pipeline: build image and push to Artifact Registry
# Triggered by: push to main branch or manual submission via cloud-app-deploy
steps:
  # Build container image (tagged :latest and :sha-<commit>)
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-f'
      - 'cicd/Dockerfile'
      - '-t'
      - '\${_IMAGE_NAME}:latest'
      - '-t'
      - '\${_IMAGE_NAME}:sha-\${_SHORT_SHA}'
      - '.'

  # Push all tags to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - '--all-tags'
      - '\${_IMAGE_NAME}'

images:
  - '\${_IMAGE_NAME}:latest'
  - '\${_IMAGE_NAME}:sha-\${_SHORT_SHA}'

substitutions:
  _IMAGE_NAME: 'us-central1-docker.pkg.dev/\${PROJECT_ID}/app/app'
  # Note: _SHORT_SHA has no default. Cloud Build auto-populates \$SHORT_SHA
  # for trigger-driven builds; for manual \`gcloud builds submit\`, the
  # caller MUST pass \`--substitutions=_SHORT_SHA=<sha>\` (which
  # scripts/cloud.sh::app_deploy does). Forcing a missing-substitution
  # error here is preferable to silently tagging images :sha-unknown
  # and overwriting one another across builds.

options:
  logging: CLOUD_LOGGING_ONLY
`
}

function _tfEnvBlock(): string {
  // Shared TF_VAR_* env block for both plan and apply pipelines.
  // Three-role topology: each role's project + region is passed
  // through. When all three resolve to the same value, the provider
  // aliases become functional duplicates (zero overhead).
  return `      - 'TF_VAR_orchestration_project_id=\${_ORCH_PROJECT_ID}'
      - 'TF_VAR_orchestration_region=\${_REGION}'
      - 'TF_VAR_build_project_id=\${_BUILD_PROJECT_ID}'
      - 'TF_VAR_build_region=\${_REGION}'
      - 'TF_VAR_runtime_project_id=\${_RUNTIME_PROJECT_ID}'
      - 'TF_VAR_runtime_region=\${_REGION}'
      - 'TF_VAR_service_name=\${_SERVICE_NAME}'
      - 'TF_VAR_image=\${_IMAGE}'
      - 'TF_VAR_domain=\${_DOMAIN}'
      - 'TF_VAR_min_instances=\${_MIN_INSTANCES}'
      - 'TF_VAR_max_instances=\${_MAX_INSTANCES}'
      - 'TF_VAR_builder_sa_email=\${_BUILDER_SA_EMAIL}'
      - 'TF_VAR_runtime_sa_name=\${_RUNTIME_SA_NAME}'
      - 'TF_VAR_ar_repo=\${_SERVICE_NAME}'
      - 'TF_VAR_dns_project_id=\${_DNS_PROJECT_ID}'
      - 'TF_VAR_dns_managed_zone=\${_DNS_MANAGED_ZONE}'
      - 'TF_VAR_dns_record_name=\${_DNS_RECORD_NAME}'
      - 'TF_VAR_ingress=\${_INGRESS}'`
}

function _tfSubstitutionsBlock(defaultAction: string): string {
  return `  _TF_ACTION: '${defaultAction}'
  _TF_STATE_BUCKET: ''
  _TF_STATE_PREFIX: 'app'
  _REGION: 'us-central1'
  _SERVICE_NAME: 'app'
  _IMAGE: ''
  _DOMAIN: ''
  _MIN_INSTANCES: '0'
  _MAX_INSTANCES: '3'
  _BUILDER_SA_EMAIL: ''
  _RUNTIME_SA_NAME: 'app-runtime'
  _DNS_PROJECT_ID: ''
  _DNS_MANAGED_ZONE: ''
  _DNS_RECORD_NAME: ''
  _ORCH_PROJECT_ID: ''
  _BUILD_PROJECT_ID: ''
  _RUNTIME_PROJECT_ID: ''
  _INGRESS: 'all'`
}

function generateCloudbuildPlanYaml(): string {
  return `# Terraform plan pipeline (three-role topology, #141)
# Triggered by: pull request events
# Runs terraform init + plan and outputs the plan for review.
# Builder SA runs in build project; provisions runtime-project resources.
steps:
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
${_tfEnvBlock()}

substitutions:
${_tfSubstitutionsBlock('plan')}

options:
  logging: CLOUD_LOGGING_ONLY
`
}

function generateCloudbuildApplyYaml(): string {
  return `# Terraform apply pipeline (three-role topology, #141)
# Triggered by: merge to main branch.
# Runs terraform init + apply (or destroy) with auto-approve.
# Builder SA runs in build project; provisions runtime-project resources.
steps:
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-auto-approve'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
${_tfEnvBlock()}

substitutions:
${_tfSubstitutionsBlock('apply')}

options:
  logging: CLOUD_LOGGING_ONLY
`
}

// ─── Terraform Generation ────────────────────────────────────────────

function generateTfProviders(): string {
  return `terraform {
  required_version = ">= 1.14"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# ─── Three-role provider aliases (issue #141) ────────────────────────
#
# Each role gets a named provider alias. When all three roles resolve to
# the same project (the 90% case), the aliases are functionally
# identical — zero overhead. Splitting one or more roles later is a
# config edit (TF_VAR_<role>_project_id), not a refactor.
#
# Resources opt into the alias for the role whose project owns them:
#
#   - Runtime resources (google_service_account.runtime,
#     google_cloud_run_v2_service.app, LB/DNS in runtime project,
#     run.invoker bindings) use provider = google.runtime.
#   - Cross-project reads of build-project resources (AR repo)
#     use provider = google.build.
#   - Orchestration-project resources (if any: future agent SA
#     management from TF, etc.) use provider = google.orchestration.
#
# Default (un-aliased) google provider points at the runtime project —
# matches the common case where most resources live there.

provider "google" {
  project = var.runtime_project_id
  region  = var.runtime_region
}

provider "google-beta" {
  project = var.runtime_project_id
  region  = var.runtime_region
}

provider "google" {
  alias   = "orchestration"
  project = var.orchestration_project_id
  region  = var.orchestration_region
}

provider "google" {
  alias   = "build"
  project = var.build_project_id
  region  = var.build_region
}

provider "google" {
  alias   = "runtime"
  project = var.runtime_project_id
  region  = var.runtime_region
}

# DNS provider alias — scoped to the (separate) DNS project that owns
# the managed zone. Used only by resources in dns.tf when the LB+DNS
# stack is enabled. Safe to leave configured with an empty project_id
# when disabled — no resources reference it in that case.
provider "google" {
  alias   = "dns"
  project = var.dns_project_id
}
`
}

function generateTfBackend(): string {
  return `# State is stored in GCS. Backend config values are passed via
# Cloud Build substitutions (-backend-config flags).
terraform {
  backend "gcs" {
    # bucket and prefix are set via -backend-config in cloudbuild YAML
  }
}
`
}

function generateTfVariables(): string {
  return `# ─── Three-role topology (issue #141) ────────────────────────────────
# Each role's project + region is a separate variable. When all three
# resolve to the same value, the role split is invisible at the TF level
# (the provider aliases become functional duplicates). Splitting later
# is just a TF_VAR_<role>_project_id change.

variable "orchestration_project_id" {
  description = "Orchestration project — where the agent SA lives (operator identity)."
  type        = string
}

variable "orchestration_region" {
  description = "Region for orchestration-project resources (rare; provided for symmetry)."
  type        = string
  default     = "us-central1"
}

variable "build_project_id" {
  description = "Build project — hosts the builder SA, Cloud Build, Artifact Registry, TF state bucket."
  type        = string
}

variable "build_region" {
  description = "Region for build-project resources (AR repo, TF state bucket)."
  type        = string
  default     = "us-central1"
}

variable "runtime_project_id" {
  description = "Runtime project — hosts the runtime SA and Cloud Run service. Also the default provider's project."
  type        = string
}

variable "runtime_region" {
  description = "Region for runtime-project resources (Cloud Run, LB/DNS)."
  type        = string
  default     = "us-central1"
}

# ─── Service config ──────────────────────────────────────────────────

variable "service_name" {
  description = "Name of the Cloud Run service and related resources."
  type        = string
  default     = "app"
}

variable "image" {
  description = "Container image to deploy. When empty (or the __placeholder__ sentinel), Cloud Run uses the upstream hello-world image until cloud-app-deploy is run."
  type        = string
  default     = ""
}

variable "domain" {
  description = "Custom domain for the external HTTPS LB. Leave empty to skip the LB+DNS stack."
  type        = string
  default     = ""
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances."
  type        = number
  default     = 3
}

variable "ingress" {
  description = "Cloud Run ingress mode. 'all' allows public *.run.app traffic. 'internal-and-cloud-load-balancing' locks ingress to the external HTTPS LB / internal VPC sources."
  type        = string
  default     = "all"
}

# ─── Service accounts ────────────────────────────────────────────────

variable "builder_sa_email" {
  description = "Builder SA email (Cloud Build identity that runs this Terraform). Created by admin-cloud-init. Referenced for cross-project AR reader binding."
  type        = string
}

variable "runtime_sa_name" {
  description = "Short name for the Cloud Run runtime service account. Created by Terraform in the runtime project."
  type        = string
  default     = "app-runtime"
}

variable "ar_repo" {
  description = "Artifact Registry repository ID in the build project (created by admin-cloud-init; read by TF via data source)."
  type        = string
  default     = "app"
}

# ─── DNS / LB stack (opt-in) ─────────────────────────────────────────

variable "dns_project_id" {
  description = "GCP project ID hosting the Cloud DNS managed zone (separate per env). Empty disables LB+DNS stack."
  type        = string
  default     = ""
}

variable "dns_managed_zone" {
  description = "GCP resource name (not DNS name) of the existing managed zone, e.g. 'kunall-demo-altostrat-com'."
  type        = string
  default     = ""
}

variable "dns_record_name" {
  description = "FQDN with trailing dot for the A record, e.g. 'app.example.com.'."
  type        = string
  default     = ""
}
`
}

function generateTfMain(): string {
  return `# ─── Resource construction only (issue #141 lesson 1) ────────────────
#
# This Terraform NEVER does any of the following:
#
#   * Enable APIs (google_project_service).  --> admin-cloud-init does this.
#   * Grant project-wide IAM to the builder SA.  --> admin-cloud-init does this.
#   * Create the Artifact Registry repo.  --> admin-cloud-init does this.
#   * Create the Terraform state bucket.  --> admin-cloud-init does this.
#
# Why: doing any of those above requires the builder SA to hold
# \`projectIamAdmin\` and \`serviceUsageAdmin\` — which defeats the
# agent's least-privilege custom-role model. The agent can impersonate
# the builder via Cloud Build, so anything granted to the builder
# becomes part of the agent's effective authority.
#
# Generated TF works with a builder SA that holds ONLY the 6 predefined
# functional roles (see scripts/cloud.sh::_step_grant_builder_roles).
#
# Pre-existing build-project resources (AR repo) are read via \`data\`
# sources. This makes the dependency on admin-cloud-init explicit at
# PLAN time: a missing repo fails with a clear "data source not found"
# error, instead of a confusing IAM error at apply time.

# ─── Pre-existing AR repo (read-only) ────────────────────────────────
#
# Created by admin-cloud-init in the build project. Referenced by:
#   - The cross-project runtime-SA reader binding below.
#   - LB/DNS outputs (image URI computation).

data "google_artifact_registry_repository" "app" {
  provider      = google.build
  project       = var.build_project_id
  location      = var.build_region
  repository_id = var.ar_repo
}

# ─── Runtime SA: Cloud Run application identity ─────────────────────
#
# Created in the runtime project. This IS owned by Terraform — it's an
# application-identity resource, not a deploy-plane resource.

resource "google_service_account" "runtime" {
  provider     = google.runtime
  account_id   = var.runtime_sa_name
  display_name = "\${var.service_name} Cloud Run Runtime"
  project      = var.runtime_project_id
}

# ─── Cloud Run Service ───────────────────────────────────────────────

resource "google_cloud_run_v2_service" "app" {
  provider = google.runtime
  project  = var.runtime_project_id
  name     = var.service_name
  location = var.runtime_region
  labels   = { app = var.service_name }

  # Ingress mode is configurable. Set var.ingress to
  # "internal-and-cloud-load-balancing" to lock down the service so the
  # external HTTPS LB (serverless NEG) and internal VPC sources are the
  # only entry points; direct *.run.app hits then return 403. Default
  # "all" leaves the public *.run.app URL reachable.
  ingress = var.ingress == "internal-and-cloud-load-balancing" ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email
    labels          = { app = var.service_name }

    containers {
      # The \`__placeholder__\` sentinel is passed by \`cloud.sh cloud-app-undeploy\`
      # to revert the service to the upstream hello-world image without
      # tearing down the Cloud Run resource. We treat it (and the empty
      # string, for safety) the same as "no image specified".
      image = (var.image == "" || var.image == "__placeholder__") ? "us-docker.pkg.dev/cloudrun/container/hello:latest" : var.image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# ─── IAM: Allow unauthenticated access (public service) ─────────────
# Bound on Terraform's own resource (the Cloud Run service), not on the
# project. Remove this block if the service should require authentication.

resource "google_cloud_run_v2_service_iam_member" "public" {
  provider = google.runtime
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Cross-project AR access (when runtime != build project) ────────
#
# When the runtime project differs from the build project (production
# tenancy pattern), the runtime SA needs read access to the build
# project's AR repo to pull images. Bound on the AR repo (Terraform's
# resource visibility via the data source), not on the project.
#
# When runtime == build, the binding is skipped — runtime SA already has
# implicit access by virtue of living in the same project as the repo.

locals {
  cross_project_ar = var.runtime_project_id != var.build_project_id
}

resource "google_artifact_registry_repository_iam_member" "runtime_ar_reader" {
  count      = local.cross_project_ar ? 1 : 0
  provider   = google.build
  project    = var.build_project_id
  location   = var.build_region
  repository = data.google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:\${google_service_account.runtime.email}"
}
`
}

function generateTfOutputs(): string {
  return `output "service_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.app.uri
}

output "runtime_sa_email" {
  description = "Runtime SA email (Cloud Run app identity)."
  value       = google_service_account.runtime.email
}

output "artifact_registry_repo" {
  description = "Artifact Registry repository URL (in the build project)."
  value       = "\${var.build_region}-docker.pkg.dev/\${var.build_project_id}/\${data.google_artifact_registry_repository.app.repository_id}"
}

output "topology" {
  description = "Resolved three-role topology — useful for cloud-help output."
  value = {
    orchestration = var.orchestration_project_id
    build         = var.build_project_id
    runtime       = var.runtime_project_id
  }
}

# ─── External HTTPS LB / DNS outputs ─────────────────────────────────
# Empty when the LB+DNS stack is disabled (i.e. dns_* vars are unset).

output "lb_ip" {
  description = "Reserved global IPv4 address for the external HTTPS LB"
  value       = local.enable_lb ? google_compute_global_address.lb_ip[0].address : ""
}

output "dns_fqdn" {
  description = "FQDN served by the LB"
  value       = local.enable_lb ? var.dns_record_name : ""
}

output "ssl_cert_name" {
  description = <<-EOT
    Name of the Google-managed SSL cert. The status attribute isn't
    directly readable from the Terraform resource, so check it via gcloud:

      gcloud compute ssl-certificates describe <name> --global \\
        --format='value(managed.status)'

    Watch for ACTIVE. Provisioning is asynchronous and typically takes
    15-60 min after the A record resolves to the LB IP.
  EOT
  value       = local.enable_lb ? google_compute_managed_ssl_certificate.app[0].name : ""
}
`
}

function generateTfLb(): string {
  return `# ─── External HTTPS Load Balancer in front of Cloud Run ──────────────
#
# All resources here live in the RUNTIME project (var.runtime_project_id)
# and use provider = google.runtime. They're gated by local.enable_lb.
#
# To disable the LB+DNS stack, leave the four gating variables empty
# (var.domain, var.dns_project_id, var.dns_managed_zone, var.dns_record_name).
#
# To force traffic through the LB only, set var.ingress to
# "internal-and-cloud-load-balancing" — then direct *.run.app hits return
# 403 and the LB becomes the only public entry point.

locals {
  enable_lb = (
    var.dns_project_id != "" &&
    var.dns_managed_zone != "" &&
    var.dns_record_name != "" &&
    var.domain != ""
  )
}

# 1. Reserved global IPv4 — the anycast IP advertised in DNS.
resource "google_compute_global_address" "lb_ip" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-lb-ip"
  project  = var.runtime_project_id
}

# 2. Serverless NEG → Cloud Run. The NEG itself is free.
resource "google_compute_region_network_endpoint_group" "cloud_run_neg" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.runtime_region
  project               = var.runtime_project_id

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }
}

# 3. Backend service. No health check needed for serverless NEGs.
resource "google_compute_backend_service" "app" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-backend"
  project               = var.runtime_project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run_neg[0].id
  }
}

# 4. URL map for HTTPS traffic — routes everything to the backend.
resource "google_compute_url_map" "https" {
  count           = local.enable_lb ? 1 : 0
  provider        = google.runtime
  name            = "\${var.service_name}-https"
  project         = var.runtime_project_id
  default_service = google_compute_backend_service.app[0].id
}

# 5. Google-managed SSL cert (classic). Provisioning is asynchronous.
resource "google_compute_managed_ssl_certificate" "app" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-cert"
  project  = var.runtime_project_id

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# 6. Target HTTPS proxy.
resource "google_compute_target_https_proxy" "app" {
  count            = local.enable_lb ? 1 : 0
  provider         = google.runtime
  name             = "\${var.service_name}-https-proxy"
  project          = var.runtime_project_id
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
}

# 7. Forwarding rule (443) — binds the reserved IP to the HTTPS proxy.
resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-https-fr"
  project               = var.runtime_project_id
  target                = google_compute_target_https_proxy.app[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# 8. URL map that 301-redirects all HTTP traffic to HTTPS.
resource "google_compute_url_map" "http_redirect" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-http-redirect"
  project  = var.runtime_project_id

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

# 9. Target HTTP proxy for the redirect URL map.
resource "google_compute_target_http_proxy" "app" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-http-proxy"
  project  = var.runtime_project_id
  url_map  = google_compute_url_map.http_redirect[0].id
}

# 10. Forwarding rule (80) — same reserved IP, different port.
resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-http-fr"
  project               = var.runtime_project_id
  target                = google_compute_target_http_proxy.app[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
`
}

function generateTfDns(): string {
  return `# ─── DNS A record (in separate DNS project) ──────────────────────────
#
# Writes a single A record into a pre-existing managed zone owned by a
# different GCP project (var.dns_project_id). The builder SA must hold
# roles/dns.admin on that project — granted by admin-cloud-init.
# Terraform never owns the zone itself, only the record set.

resource "google_dns_record_set" "app" {
  count    = local.enable_lb ? 1 : 0
  provider = google.dns

  project      = var.dns_project_id
  managed_zone = var.dns_managed_zone
  name         = var.dns_record_name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ip[0].address]
}
`
}

// ─── Config Files Generation ────────────────────────────────────────

function generateConfigPy(): string {
  return `#!/usr/bin/env python3
"""Parse config.toml (role-axis + environment-axis) and emit shell exports.

Resolution order (#141): env > role > defaults > error.

Schema (#141):

    [gcp.defaults]          # required catch-all (the 90% case)
    project = "..."
    region  = "..."

    [gcp.orchestration]     # role override, empty => inherit defaults
    project = ""
    region  = ""

    [gcp.build]             # role override
    project = ""
    region  = ""

    [gcp.runtime]           # role override
    project = ""
    region  = ""

Environment-axis layering (#115) is layered ON TOP of the role axis:

    [gcp.production.runtime]
    project = "acme-prod"   # only overrides runtime in production

The active environment is selected via ENVIRONMENT env var (default: staging).

The .env file is read by scripts/common.sh (NOT here); .env values
override everything below at the shell level via export precedence.

Same parser is the source of truth for shell scripts and Terraform.
Terraform sees the resolved values as TF_VAR_* env vars set in the
Cloud Build apply config.
"""

import os
import sys

try:
    import tomllib
except ModuleNotFoundError:
    try:
        import tomli as tomllib  # Python < 3.11 fallback
    except ModuleNotFoundError:
        print(
            "ERROR: config.py requires Python 3.11+ (for stdlib tomllib) "
            "or the 'tomli' package on older Python.\\n"
            "Fix: upgrade Python to 3.11+ OR run: pip install tomli",
            file=sys.stderr,
        )
        sys.exit(1)


def _resolve(config: dict, env: str, role: str, key: str, default=None):
    """Resolve a key with precedence: env-role > role > env > defaults > default.

    Lookups (first hit wins):
      [gcp.<env>.<role>].<key>
      [gcp.<role>].<key>
      [gcp.<env>].<key>
      [gcp.defaults].<key>
    """
    gcp = config.get('gcp', {})
    candidates = [
        gcp.get(env, {}).get(role, {}).get(key),
        gcp.get(role, {}).get(key),
        gcp.get(env, {}).get(key),
        gcp.get('defaults', {}).get(key),
    ]
    for v in candidates:
        if v not in (None, ''):
            return v
    return default


def _emit(name: str, value):
    """Shell-quote a value and emit \`KEY='value'\` for eval."""
    if value is None:
        value = ''
    s = str(value).replace("'", "'\\\\''")
    print(f"{name}='{s}'")


def main():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config.toml')
    if not os.path.exists(config_path):
        # No config.toml? Quiet exit — scripts/common.sh handles defaults.
        return

    with open(config_path, 'rb') as f:
        config = tomllib.load(f)

    env = os.environ.get('ENVIRONMENT', 'staging')

    # ─── Project-level ─────────────────────────────────────────
    project = config.get('project', {})
    project_name = project.get('name', 'app')

    _emit('ENVIRONMENT', env)
    _emit('PROJECT_NAME', project_name)

    # ─── Three-role topology ──────────────────────────────────
    # Resolve each role's project + region with env > role > defaults precedence.
    # Defaults must be set; otherwise resolution returns '' and the bash
    # layer dies with a clear error.
    orch_project    = _resolve(config, env, 'orchestration', 'project', '')
    orch_region     = _resolve(config, env, 'orchestration', 'region',  '')
    build_project   = _resolve(config, env, 'build',         'project', '')
    build_region    = _resolve(config, env, 'build',         'region',  '')
    runtime_project = _resolve(config, env, 'runtime',       'project', '')
    runtime_region  = _resolve(config, env, 'runtime',       'region',  '')

    if not _resolve(config, env, 'defaults', 'project'):
        # The role axis tolerates empty roles ONLY when defaults is set.
        # Surface this loudly: a single typo in [gcp.defaults] would
        # silently produce three empty role projects.
        print(
            "echo 'ERROR: [gcp.defaults].project is required in config.toml "
            "(role-axis topology requires a catch-all default)' >&2",
            file=sys.stdout,
        )
        print("exit 1", file=sys.stdout)
        sys.exit(1)

    _emit('ORCH_PROJECT',    orch_project)
    _emit('ORCH_REGION',     orch_region)
    _emit('BUILD_PROJECT',   build_project)
    _emit('BUILD_REGION',    build_region)
    _emit('RUNTIME_PROJECT', runtime_project)
    _emit('RUNTIME_REGION',  runtime_region)

    # Legacy aliases for back-compat with snippets that still use the
    # pre-role-topology names. Map to the most likely role.
    _emit('GCP_PROJECT', runtime_project)
    _emit('GCP_REGION',  runtime_region or 'us-central1')
    _emit('CB_PROJECT',  build_project)

    # ─── Resource & deployment knobs (env > defaults) ──────────
    _emit('DOMAIN',           _resolve(config, env, 'runtime', 'domain',           ''))
    _emit('DNS_PROJECT_ID',   _resolve(config, env, 'runtime', 'dns_project_id',   ''))
    _emit('DNS_MANAGED_ZONE', _resolve(config, env, 'runtime', 'dns_managed_zone', ''))
    _emit('DNS_RECORD_NAME',  _resolve(config, env, 'runtime', 'dns_record_name',  ''))
    _emit('MIN_INSTANCES',    _resolve(config, env, 'runtime', 'min_instances', '0'))
    _emit('MAX_INSTANCES',    _resolve(config, env, 'runtime', 'max_instances', '3'))
    _emit('CPU',              _resolve(config, env, 'runtime', 'cpu',    '1'))
    _emit('MEMORY',           _resolve(config, env, 'runtime', 'memory', '512Mi'))
    _emit('INGRESS',          _resolve(config, env, 'runtime', 'ingress', 'all'))

    # ─── Service accounts ──────────────────────────────────────
    # Agent SA in orchestration project, builder SA in build project,
    # runtime SA in runtime project. Names default to <project-name>-<role>.
    agent_sa_name   = _resolve(config, env, 'orchestration', 'agent_sa',   f'{project_name}-agent')
    builder_sa_name = _resolve(config, env, 'build',         'builder_sa', f'{project_name}-builder')
    runtime_sa_name = _resolve(config, env, 'runtime',       'runtime_sa', f'{project_name}-runtime')

    _emit('AGENT_SA_NAME',   agent_sa_name)
    _emit('BUILDER_SA_NAME', builder_sa_name)
    _emit('RUNTIME_SA_NAME', runtime_sa_name)

    _emit('AGENT_SA_EMAIL',   f'{agent_sa_name}@{orch_project}.iam.gserviceaccount.com')
    _emit('BUILDER_SA_EMAIL', f'{builder_sa_name}@{build_project}.iam.gserviceaccount.com')
    _emit('RUNTIME_SA_EMAIL', f'{runtime_sa_name}@{runtime_project}.iam.gserviceaccount.com')

    # Legacy: CB_SERVICE_ACCOUNT used to mean "builder SA email".
    _emit('CB_SERVICE_ACCOUNT', f'{builder_sa_name}@{build_project}.iam.gserviceaccount.com')

    # ─── Custom role ID ────────────────────────────────────────
    # GCP custom role IDs must be camelCase (no dashes/underscores).
    def _camel(name: str) -> str:
        parts = name.replace('_', '-').split('-')
        return parts[0] + ''.join(p[:1].upper() + p[1:] for p in parts[1:])

    deployer_role_id = _resolve(
        config, env, 'orchestration', 'deployer_role_id',
        f'{_camel(project_name)}Deployer',
    )
    _emit('DEPLOYER_ROLE_ID', deployer_role_id)

    # ─── AR repo + TF state ────────────────────────────────────
    _emit('AR_REPO',         _resolve(config, env, 'build', 'ar_repo', project_name))
    _emit('TF_STATE_BUCKET', _resolve(config, env, 'build', 'state_bucket', ''))
    # TF state prefix is auto-derived; rarely overridden.
    _emit('TF_STATE_PREFIX', f'{project_name}/{env}')

    # ─── Agent role expiry (days) ─────────────────────────────
    _emit('AGENT_ROLE_EXPIRY_DAYS', _resolve(config, env, 'orchestration', 'agent_role_expiry_days', '30'))


if __name__ == '__main__':
    main()
`
}

function generateConfigTomlExample(): string {
  return `# Project Configuration — three-role topology (#141)
#
# Copy this file to config.toml and fill in your values.
# config.toml is gitignored — never commit it.
# .env layered on top for sensitive overrides (see .env.example).
#
# Resolution order (handled by scripts/config.py):
#   env-var > [gcp.<env>.<role>] > [gcp.<role>] > [gcp.<env>] > [gcp.defaults] > error
#
# The role axis (orchestration / build / runtime) is primary; the
# environment axis (staging / production) layers on top.
#
# 90% case: fill in [gcp.defaults].project only. All three roles
# collapse onto one project — fine for personal/hobby use.
#
# Split case: set [gcp.runtime].project to a separate prod project
# while keeping orchestration + build on the dev project.

[project]
name = "app"

# ─── REQUIRED: catch-all defaults ──────────────────────────────────
#
# Every role inherits from here when its own section is empty.
# Set project + region; everything else has sensible defaults.

[gcp.defaults]
project = "your-gcp-project-id"
region  = "us-central1"

# ─── Role-axis sections ────────────────────────────────────────────
#
# Each role can override the defaults. Empty = inherit. The three roles
# play distinct parts in the deploy lifecycle:
#
#   orchestration — where humans/agents *issue* commands. Hosts the
#                   agent SA that runs daily deploys + operator CLI
#                   tools. The custom role (cicd/iam/*-deployer-role.yaml)
#                   is created here.
#   build         — where CI runs. Hosts the builder SA, Cloud Build,
#                   Artifact Registry, Terraform state bucket.
#   runtime       — where deployed services run. Hosts the runtime SA,
#                   Cloud Run services, and any service-managed resources.
#
# When all three resolve to the same project (the 90% case), the role
# split is invisible to the operator but the bootstrap script and
# Terraform are already structured to split later — no refactor needed.

[gcp.orchestration]
project = ""    # empty = inherit from [gcp.defaults]
region  = ""
# agent_sa = "..."             # default: {project-name}-agent
# deployer_role_id = "..."     # default: {projectName}Deployer (camelCase)
# agent_role_expiry_days = 30  # 30-day expiry on agent → custom-role binding

[gcp.build]
project = ""
region  = ""
# builder_sa   = "..."         # default: {project-name}-builder
# ar_repo      = "..."         # default: {project-name}
# state_bucket = "..."         # REQUIRED for cloud-infra; no sane default

[gcp.runtime]
project = ""
region  = ""
# runtime_sa     = "..."       # default: {project-name}-runtime
# min_instances  = 0
# max_instances  = 3
# cpu            = "1"
# memory         = "512Mi"
# ingress        = "all"       # or "internal-and-cloud-load-balancing"
# domain         = ""          # custom domain (LB+DNS opt-in)
# dns_project_id = ""
# dns_managed_zone = ""
# dns_record_name = ""

# ─── Environment-axis overrides (per #115) ─────────────────────────
#
# These layer ON TOP of the role axis. The resolver prefers
# [gcp.<env>.<role>] > [gcp.<role>] for any key. Use them when an
# environment changes WHICH project hosts a role (e.g. prod runtime
# moves to a separate project for tenancy reasons).

# [gcp.staging]
# Inherits everything by default.

# [gcp.production]
# Override which project owns the runtime role in prod (split topology).
# [gcp.production.runtime]
# project        = "acme-prod"
# region         = "us-east1"
# min_instances  = 1
# max_instances  = 10
# domain         = "app.example.com"
# dns_project_id = "acme-dns"
# dns_managed_zone = "example-com"
# dns_record_name  = "app.example.com."
`
}

// ─── .env.example Generation ─────────────────────────────────────────
//
// .env layers on top of config.toml. Mark sensitive keys clearly.
// Loaded by scripts/common.sh; never committed (gitignored).

function generateEnvExample(): string {
  return `# Environment overrides for sensitive values. NEVER commit this file.
# Layered ON TOP of config.toml — anything set here overrides resolved values.
# Copy to .env and fill in.
#
# Convention: structural shape lives in config.toml (committed), sensitive
# values live here (gitignored). Per-user / per-machine overrides too.
#
# Resolution order (see scripts/config.py): .env > config.toml > error.

# ─── Environment selection ──────────────────────────────────
# Selects which env-axis section of config.toml is active.
# ENVIRONMENT=staging
# ENVIRONMENT=production

# ─── Sensitive: project IDs ────────────────────────────────
# Override per-role projects if you don't want them in committed config.toml.
# Useful for personal sandboxes, hackathon projects, or any case where the
# project ID is itself sensitive (carries org / billing info).
# ORCH_PROJECT=your-orchestration-project
# BUILD_PROJECT=your-build-project
# RUNTIME_PROJECT=your-runtime-project

# ─── Sensitive: billing / billing-attached IDs ─────────────
# DNS_PROJECT_ID=your-dns-project

# ─── Sensitive: per-operator identity ──────────────────────
# When CI runs as a service account but local operators run as themselves,
# the agent SA short-name may differ per environment.
# AGENT_SA_NAME=alice-dev-agent

# ─── Sensitive: third-party API keys ───────────────────────
# Never put these in config.toml.
# COINGECKO_API_KEY=
# OPENAI_API_KEY=

# ─── Operator escape hatch ─────────────────────────────────
# ORCH_FORCE_RESTART=1 invalidates the stepwise checkpoint and
# restarts admin-cloud-init / admin-cloud-destroy from step 1.
# Always safe (step idempotency is a contract). Uncomment when you
# need to force a fresh run after a step list change.
# ORCH_FORCE_RESTART=1

# ─── Per-operation overrides ───────────────────────────────
# Required for cloud-app-promote:
# VERSION=v1.0.0
# IMAGE=us-central1-docker.pkg.dev/<build-project>/<repo>/<svc>:sha-abc123f

# Optional: skip confirm prompts in non-interactive runs.
# CONFIRM=yes
`
}

// ─── Custom Deployer Role YAML ──────────────────────────────────────
//
// The agent SA's curated custom role. Diff-reviewable in git. Bound to
// the agent SA with a 30-day expiry (see scripts/cloud.sh::admin-cloud-init).
// Modeled on kunal-labs/onchain-markets/cicd/iam/historical-deployer-role.yaml.
//
// Tightenable per-project; remove permissions the project doesn't need.
// 37-permission default covers: AR push/pull, Cloud Run deploy, Cloud
// Build submit/monitor, IAM SA management + actAs, GCS for TF state +
// CB staging, Logging read, project-metadata read.

function generateDeployerRoleYaml(projectName: string): string {
  // GCP custom role IDs must be camelCase, no dashes.
  const camel = projectName
    .replace(/_/g, "-")
    .split("-")
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("")
  return `title: "${projectName} Deployer"
description: "Curated permissions for the agent SA that deploys ${projectName} to Cloud Run via Cloud Build + Terraform. Bound with 30-day expiry. See cicd/iam/README.md (if present) and scripts/cloud.sh::admin-cloud-init."
stage: GA
includedPermissions:
  # Artifact Registry — push/pull images for Cloud Run deploys.
  - artifactregistry.repositories.uploadArtifacts
  - artifactregistry.repositories.downloadArtifacts
  - artifactregistry.repositories.get
  - artifactregistry.repositories.list
  # Cloud Run — the deploy target.
  - run.services.create
  - run.services.update
  - run.services.delete
  - run.services.get
  - run.services.list
  - run.services.getIamPolicy
  - run.services.setIamPolicy
  - run.revisions.get
  - run.revisions.list
  - run.operations.get
  # Cloud Build — submit and monitor builds (the agent triggers builds
  # which then run as the builder SA via --service-account).
  - cloudbuild.builds.create
  - cloudbuild.builds.get
  - cloudbuild.builds.list
  # IAM Service Accounts — create/manage builder + runtime SAs and
  # impersonate them via actAs.
  - iam.serviceAccounts.create
  - iam.serviceAccounts.delete
  - iam.serviceAccounts.get
  - iam.serviceAccounts.list
  - iam.serviceAccounts.actAs
  - iam.serviceAccounts.getIamPolicy
  - iam.serviceAccounts.setIamPolicy
  # GCS — Terraform state bucket + Cloud Build staging bucket.
  - storage.buckets.get
  - storage.buckets.list
  - storage.buckets.getIamPolicy
  - storage.buckets.setIamPolicy
  - storage.objects.create
  - storage.objects.delete
  - storage.objects.get
  - storage.objects.list
  - storage.objects.update
  # Logging — inspect Cloud Build / Cloud Run logs after deploys.
  - logging.logEntries.list
  - logging.logs.list
  # Project metadata — read-only visibility for diagnostics
  # (cloud-preflight, app-deploy preflight checks).
  - resourcemanager.projects.get
  - resourcemanager.projects.getIamPolicy
# Custom role ID used when this YAML is fed to gcloud iam roles create:
# ${camel}Deployer
`
}

// ─── ADR template for per-project cloud topology ────────────────────
//
// Generated as docs/decisions/ADR-template-cloud-topology.md. Projects
// forking the scaffold copy this to ADR-XXX-cloud-topology.md and fill
// it in. Format borrowed from onchain-markets/docs/decisions/ADR-017;
// content is intentionally generic.

function generateAdrTemplate(): string {
  return `# ADR-XXX: Cloud topology — orchestration / build / runtime

- **Status**: Proposed
- **Date**: YYYY-MM-DD

## Context

This project uses the three-role topology scaffolded by \`lib-agents\`
(see issue #141). The roles are:

| Role            | What it owns                                          |
|-----------------|-------------------------------------------------------|
| orchestration   | Agent SA (operator identity), custom IAM role, daily-deploy entry point |
| build           | Builder SA, Cloud Build, Artifact Registry, TF state |
| runtime         | Runtime SA, Cloud Run service, service-managed resources |

Every role can collapse to the same project (the 90% case) or split.
The split is a config edit, not a code refactor — bootstrap script,
Terraform, and operator commands all work identically; only IAM grants
branch on local-vs-cross-project.

## Decision

**Topology for this project**: <FILL IN — collapsed / partial-split / fully-split>

| Role            | Project                                | Region   |
|-----------------|----------------------------------------|----------|
| orchestration   | \`<your-project>\`                       | \`<region>\` |
| build           | \`<your-project>\`                       | \`<region>\` |
| runtime         | \`<your-project>\`                       | \`<region>\` |

**Rationale for the chosen split** (delete the cases that don't apply):

- *Collapsed (one project)*: personal sandbox, hackathon, single-tenant
  hobby project. No tenancy boundary needed; minimum IAM surface.
- *Build + runtime collapsed, orchestration split*: agent identity lives
  outside the deploy plane (e.g. operator runs from a workstation
  project that is separate from where services run).
- *Orchestration + build collapsed, runtime split*: production tenancy
  pattern — services run in a tenant-owned project; the build plane
  (where source + secrets exist transiently) stays in a separate
  ops-owned project.
- *Fully split*: regulated environments, large orgs, multi-tenant ops
  where each role belongs to a different team.

## TF / admin-cloud-init boundary (non-negotiable)

Per #141 lesson 1, Terraform does **not** mutate project scope. The
boundary is:

| Layer                | Owns                                                          |
|----------------------|---------------------------------------------------------------|
| \`admin-cloud-init\`   | API enablement; AR repo creation; TF state bucket creation; project-wide IAM of other principals (agent SA → custom role; builder SA → predefined functional roles; agent SA → actAs on builder SA) |
| Terraform (\`main.tf\`)| Resource construction: runtime SA, Cloud Run service, IAM bindings on Terraform's own resources (run.invoker, cross-project AR reader, LB/DNS) |

The generated TF works with a builder SA that holds ONLY the 6
predefined functional roles, no \`projectIamAdmin\` or
\`serviceUsageAdmin\`. Adding either to the builder defeats the agent's
least-privilege custom-role model — the agent can impersonate the
builder via Cloud Build, so anything granted to the builder becomes
part of the agent's effective authority.

If a project-scope concern needs automation, add a step to
\`admin_cloud_init\` (run as Owner once), not a Terraform resource.

## Consequences

**Positive**

- Operators see the same Make targets regardless of topology — the
  collapsed and split cases share one operator interface.
- The custom role is diff-reviewable; tightening it doesn't require
  re-pivoting the bootstrap script.
- 30-day expiry on agent → custom-role forces credential rotation
  gracefully (\`make admin-cloud-init\` refreshes idempotently).

**Negative**

- A split topology adds cross-project IAM grants the operator must
  understand (each \`_grant_role\` call branches local-vs-cross).
- The first-time bootstrap requires Owner on each distinct project
  in the topology (not necessarily the same person for every project).

## Alternatives considered

- *Single SA with broad project roles* — what the pre-#141 scaffold
  did, and what dex-arb-agent + onchain-markets started with. Rejected:
  daily-handling risk is unbounded because the agent is project-wide
  Owner-adjacent.
- *Two SAs, but the deployer SA carries projectIamAdmin so TF can
  self-escalate* — what the pre-H7 onchain-markets bootstrap did
  (#116 original proposal). Rejected: TF self-escalation requires the
  builder to hold the very roles the custom role was trying to keep
  off the agent.

## Reference

- Issue \`kunallimaye/lib-agents#141\` — three-role topology + IAM hardening
- Worked example: \`kunal-labs/onchain-markets/docs/decisions/ADR-017-per-component-deployment-topology.md\`
- Origin postmortem: \`kunal-labs/onchain-markets#44\` (epic; 4 restructure passes)
`
}

// ─── AGENTS.local.md boilerplate for detached-orchestration ─────────

function generateAgentsLocalSection(): string {
  return `## Detached Orchestration Convention (issue #140)

This project uses the \`run_detached_with_heartbeat\` helpers in
\`scripts/common.sh\`. Operators and agents MUST use the Makefile
wrappers for any target that mutates external state, NOT direct
\`bash scripts/cloud.sh ...\` invocations.

**Why**: when the parent shell disconnects mid-deploy, the heartbeat
file in \`.orchestration/\` preserves run state. \`make cloud-status\`
shows whether a run is RUNNING / STALLED / COMPLETE / NEVER_STARTED;
\`make cloud-recover\` reads the EXIT/HUP trap recovery file and helps
the operator complete teardown. Direct \`bash\` invocation bypasses
trap setup and leaves orphaned cloud resources on shell disconnect.

### Operator escape hatch

\`ORCH_FORCE_RESTART=1 make admin-cloud-init\` invalidates the stepwise
checkpoint and restarts from step 1. Step idempotency is a contract;
restart-from-1 is always safe. Use this when the step list has changed
since the last partial run (the checkpoint is auto-invalidated when
the step-list hash mismatches, but an explicit override is sometimes
clearer for operators).

### Lifecycle

\`\`\`
make admin-cloud-init    # Owner-tier bootstrap (8 idempotent steps)
make cloud-preflight     # read-only audit; verify state
make cloud-infra         # TF apply via Cloud Build (provisions runtime resources)
make cloud-app-deploy    # build image + swap Cloud Run revision
make cloud-status        # check on long-running detached operations
make cloud-recover       # if something went wrong: read recovery hints
make cloud-clean         # TF destroy (runtime only; bootstrap stays)
make admin-cloud-destroy # Owner-tier teardown (preserves TF state + AR by default)
\`\`\`

### Triggers for this module

This project includes the \`detached-orchestration\` scaffold module
because it has at least one of:

- A \`cicd/cloudbuild*.yaml\` (uses Cloud Build).
- A \`cicd/terraform/\` directory (tfstate-lock hazard).
- Make targets that call \`gcloud builds submit\`, \`terraform apply\`,
  or \`terraform destroy\` (multi-minute remote operations).

If you fork this project and any of those go away, you can remove the
heartbeat/checkpoint machinery — but keep the Tier-1 hygiene snippets
(traps, stable log paths, exit-code discipline) regardless.
`
}

// ─── Gitignore Generation ────────────────────────────────────────────

function gitignoreEntries(pt: ProjectType): string[] {
  const common = [
    "# Environment",
    ".env",
    ".env.local",
    ".env.*.local",
    "config.toml",
    "",
    "# OS",
    ".DS_Store",
    "Thumbs.db",
    "",
    "# IDE",
    ".idea/",
    ".vscode/settings.json",
    "*.swp",
    "*.swo",
    "*~",
    "",
    "# Terraform",
    ".terraform/",
    "*.tfstate",
    "*.tfstate.backup",
    "*.tfplan",
    ".terraform.lock.hcl",
    "",
    "# Build",
    "tmp/",
    ".cache/",
    "*.log",
    "logs/",
    "",
    "# Detached orchestration state (heartbeat/checkpoint/recovery files, #140)",
    ".orchestration/",
  ]

  const perLang: Record<ProjectType, string[]> = {
    node: ["", "# Node", "node_modules/", "dist/", "build/", "out/", ".next/", ".nuxt/", "coverage/"],
    go: ["", "# Go", "bin/", "/vendor/"],
    python: ["", "# Python", "__pycache__/", "*.pyc", ".venv/", "venv/", ".eggs/", "*.egg-info/", ".pytest_cache/", ".mypy_cache/"],
    rust: ["", "# Rust", "target/"],
    java: ["", "# Java", "target/", "build/", ".gradle/", "*.class"],
    generic: ["", "# Build", "build/", "out/"],
  }

  return [...common, ...perLang[pt]]
}

// ─── Component Scaffolding Helpers ───────────────────────────────────

type ScaffoldComponent =
  | "makefile"
  | "scripts"
  | "container"
  | "cloudbuild"
  | "terraform"
  | "iam"
  | "adr"
  | "agentslocal"
  | "gitignore"

// ALL_COMPONENTS is the Full CI/CD bundle (the default when no
// components arg is provided). Order matters for display — list in the
// rough order that operators read.
const ALL_COMPONENTS: ScaffoldComponent[] = [
  "makefile",
  "scripts",
  "container",
  "cloudbuild",
  "terraform",
  "iam",
  "adr",
  "agentslocal",
  "gitignore",
]

async function scaffoldMakefile(root: string, pt: ProjectType, force: boolean): Promise<string[]> {
  return [
    "── Makefile ──",
    safeWrite(join(root, "Makefile"), generateMakefile(pt), force),
  ]
}

async function scaffoldScripts(root: string, pt: ProjectType, force: boolean): Promise<string[]> {
  const dir = join(root, "scripts")
  ensureDir(dir)
  const results = [
    "── Scripts ──",
    safeWrite(join(dir, "common.sh"), generateCommonSh(), force),
    safeWrite(join(dir, "local.sh"), generateLocalSh(pt), force),
    safeWrite(join(dir, "container.sh"), generateContainerSh(pt), force),
    safeWrite(join(dir, "cloud.sh"), generateCloudSh(), force),
    // config.py is required by common.sh when config.toml exists; ship it
    // alongside the shell scripts so the cloud workflow is self-contained.
    safeWrite(join(dir, "config.py"), generateConfigPy(), force),
    // config.toml.example lives at the project root (the real config.toml
    // is gitignored). Documents role-axis + env-axis shape (#141).
    safeWrite(join(root, "config.toml.example"), generateConfigTomlExample(), force),
    // .env.example lives at the project root. Sensitive overrides + the
    // ORCH_FORCE_RESTART escape hatch are documented here.
    safeWrite(join(root, ".env.example"), generateEnvExample(), force),
  ]
  try {
    await Bun.$`chmod +x ${dir}/*.sh`.text()
  } catch { /* non-fatal */ }
  return results
}

// Detect the project's short name from the directory name. Used to name
// the custom deployer-role YAML and the GCP custom role ID.
function projectShortName(root: string): string {
  // Resolve absolute path so basename works correctly.
  // No filesystem call beyond resolving; cheap.
  const parts = root.split("/").filter(Boolean)
  const last = parts.length > 0 ? parts[parts.length - 1] : "app"
  // Sanitize for use as a YAML filename + GCP custom role ID base.
  return last.replace(/[^a-zA-Z0-9-]/g, "-") || "app"
}

function scaffoldIam(root: string, force: boolean): string[] {
  const dir = join(root, "cicd", "iam")
  ensureDir(dir)
  const projName = projectShortName(root)
  return [
    "── IAM (custom deployer role) ──",
    safeWrite(
      join(dir, `${projName}-deployer-role.yaml`),
      generateDeployerRoleYaml(projName),
      force,
    ),
  ]
}

function scaffoldAdr(root: string, force: boolean): string[] {
  const dir = join(root, "docs", "decisions")
  ensureDir(dir)
  return [
    "── ADR template (cloud topology) ──",
    safeWrite(
      join(dir, "ADR-template-cloud-topology.md"),
      generateAdrTemplate(),
      force,
    ),
  ]
}

// Append the detached-orchestration convention section to AGENTS.local.md.
// We APPEND (not overwrite) because AGENTS.local.md is operator-owned —
// the scaffold should never blow away their custom local conventions.
function scaffoldAgentsLocal(root: string, _force: boolean): string[] {
  const path = join(root, "AGENTS.local.md")
  const section = generateAgentsLocalSection()
  const sectionMarker = "## Detached Orchestration Convention (issue #140)"
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8")
    if (existing.includes(sectionMarker)) {
      return ["── AGENTS.local.md ──", `  SKIP: ${path} (section already present)`]
    }
    const updated = existing.replace(/\n+$/, "") + "\n\n" + section
    writeFileSync(path, updated)
    return ["── AGENTS.local.md ──", `  APPENDED: detached-orchestration section to ${path}`]
  }
  // Create new with a brief header so the file is self-documenting.
  const header = `# Local Agent Conventions

This file lives alongside \`AGENTS.md\` and captures conventions that are
specific to this project. Subagents read both.

`
  writeFileSync(path, header + section)
  return ["── AGENTS.local.md ──", `  CREATED: ${path}`]
}

function scaffoldContainer(root: string, pt: ProjectType, force: boolean): string[] {
  const dir = join(root, "cicd")
  ensureDir(dir)
  return [
    "── Container Files ──",
    safeWrite(join(dir, "Dockerfile"), generateDockerfile(pt), force),
    safeWrite(join(dir, ".dockerignore"), generateDockerignore(pt), force),
  ]
}

function scaffoldCloudbuild(root: string, force: boolean): string[] {
  const dir = join(root, "cicd")
  ensureDir(dir)
  return [
    "── Cloud Build ──",
    safeWrite(join(dir, "cloudbuild.yaml"), generateCloudbuildYaml(), force),
    safeWrite(join(dir, "cloudbuild-plan.yaml"), generateCloudbuildPlanYaml(), force),
    safeWrite(join(dir, "cloudbuild-apply.yaml"), generateCloudbuildApplyYaml(), force),
  ]
}

function scaffoldTerraform(root: string, force: boolean): string[] {
  const dir = join(root, "cicd", "terraform")
  ensureDir(dir)
  return [
    "── Terraform ──",
    safeWrite(join(dir, "providers.tf"), generateTfProviders(), force),
    safeWrite(join(dir, "backend.tf"), generateTfBackend(), force),
    safeWrite(join(dir, "variables.tf"), generateTfVariables(), force),
    safeWrite(join(dir, "main.tf"), generateTfMain(), force),
    safeWrite(join(dir, "lb.tf"), generateTfLb(), force),
    safeWrite(join(dir, "dns.tf"), generateTfDns(), force),
    safeWrite(join(dir, "outputs.tf"), generateTfOutputs(), force),
  ]
}

function scaffoldGitignore(root: string, pt: ProjectType): string[] {
  const entries = gitignoreEntries(pt)
  const gitignorePath = join(root, ".gitignore")
  let existing: string[] = []
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf-8").split("\n")
  }
  const existingSet = new Set(existing.map((l) => l.trim()))
  const toAdd = entries.filter(
    (e) => !existingSet.has(e.trim()) && e.trim() !== "",
  )

  const results = ["── .gitignore ──"]
  if (toAdd.length === 0) {
    results.push("  .gitignore is up to date")
  } else {
    const newContent = existing.length > 0
      ? existing.join("\n") + "\n\n# Added by devops scaffold\n" + toAdd.join("\n") + "\n"
      : entries.join("\n") + "\n"
    writeFileSync(gitignorePath, newContent)
    results.push(
      existing.length > 0
        ? `  Updated .gitignore: added ${toAdd.length} entries`
        : `  Created .gitignore with ${entries.length} entries`,
    )
  }
  return results
}

// ─── Tool Export ─────────────────────────────────────────────────────

export const scaffold = tool({
  description:
    "Generate project operational structure: Makefile, scripts/, cicd/Dockerfile, " +
    "cicd/cloudbuild*.yaml, cicd/terraform/, cicd/iam/<deployer-role>.yaml, " +
    "docs/decisions/ADR-template-cloud-topology.md, AGENTS.local.md " +
    "(detached-orchestration section), and .gitignore. Implements the " +
    "three-role topology (orchestration/build/runtime) from issue #141 + " +
    "the Tier-2 detached-orchestration helpers from issue #140. " +
    "Detects project type and tailors all files. Use the 'components' " +
    "parameter to generate only specific parts, or omit it to generate " +
    "the Full CI/CD bundle. Skips existing files unless force=true.",
  args: {
    components: tool.schema
      .array(
        tool.schema.enum([
          "makefile",
          "scripts",
          "container",
          "cloudbuild",
          "terraform",
          "iam",
          "adr",
          "agentslocal",
          "gitignore",
        ]),
      )
      .optional()
      .describe(
        "Which components to scaffold. Options: makefile, scripts, " +
        "container, cloudbuild, terraform, iam (custom deployer-role YAML), " +
        "adr (cloud-topology ADR template), agentslocal " +
        "(detached-orchestration section in AGENTS.local.md), gitignore. " +
        "Omit to generate the Full CI/CD bundle.",
      ),
    force: tool.schema
      .boolean()
      .optional()
      .describe("Overwrite existing files (default: false)"),
  },
  async execute(args, context) {
    const root = context.directory || "."
    const pt = detectProject(root)
    const force = args.force || false
    const components: ScaffoldComponent[] =
      args.components && args.components.length > 0
        ? args.components as ScaffoldComponent[]
        : ALL_COMPONENTS

    const results: string[] = [
      "Project Scaffold (three-role topology, #141 + #140)",
      "=====================================================",
      `Detected project type: ${projectLabel(pt)}`,
      `Components: ${components.join(", ")}`,
      "",
    ]

    for (const component of components) {
      switch (component) {
        case "makefile":
          results.push(...await scaffoldMakefile(root, pt, force))
          break
        case "scripts":
          results.push(...await scaffoldScripts(root, pt, force))
          break
        case "container":
          results.push(...scaffoldContainer(root, pt, force))
          break
        case "cloudbuild":
          results.push(...scaffoldCloudbuild(root, force))
          break
        case "terraform":
          results.push(...scaffoldTerraform(root, force))
          break
        case "iam":
          results.push(...scaffoldIam(root, force))
          break
        case "adr":
          results.push(...scaffoldAdr(root, force))
          break
        case "agentslocal":
          results.push(...scaffoldAgentsLocal(root, force))
          break
        case "gitignore":
          results.push(...scaffoldGitignore(root, pt))
          break
      }
      results.push("")
    }

    results.push("=====================================================")
    results.push("Scaffold complete.")
    results.push("")
    results.push("Next steps for the Full CI/CD bundle:")
    results.push("  1. cp config.toml.example config.toml  (fill in [gcp.defaults].project)")
    results.push("  2. cp .env.example .env                (any sensitive overrides)")
    results.push("  3. make cloud-help                     (verify resolved topology)")
    results.push("  4. make admin-cloud-init               (Owner-tier 8-step bootstrap)")
    results.push("  5. make cloud-preflight                (read-only audit)")
    results.push("  6. make cloud-infra                    (TF apply via Cloud Build)")
    results.push("  7. make cloud-app-deploy               (image build + revision swap)")
    results.push("")
    results.push("Run 'make help' to see all available targets.")

    return results.join("\n")
  },
})
