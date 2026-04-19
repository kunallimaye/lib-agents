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

// ─── Config Generation ───────────────────────────────────────────────

function generateConfigTomlExample(): string {
  return `# Project configuration for multi-environment deployment.
# Copy this file to config.toml and fill in your values:
#   cp config.toml.example config.toml
#
# Environment resolution order:
#   1. CLI: ENVIRONMENT=production make cloud-deploy
#   2. .env file: ENVIRONMENT=staging
#   3. Default: staging

[project]
name = ""  # e.g. "my-app" — used for SA names, state prefix, etc.

# ─── Default GCP settings (shared across environments) ───────────────
[gcp.default]
region       = "us-central1"
deployer_sa  = ""   # populated after 'make cloud-init' (e.g. my-app-deployer@project.iam.gserviceaccount.com)
runtime_sa   = ""   # populated after first 'make cloud-deploy' (e.g. my-app-runtime@project.iam.gserviceaccount.com)

# ─── Staging environment ─────────────────────────────────────────────
# Staging is the deployment plane — Cloud Build runs HERE for ALL envs.
[gcp.staging]
project = ""  # GCP project ID for staging (e.g. my-app-staging)

# ─── Production environment ──────────────────────────────────────────
# Production has NO Cloud Build. Staging's CB SA deploys to prod.
[gcp.production]
project = ""  # GCP project ID for production (e.g. my-app-production)
`
}

function generateConfigPy(): string {
  return `#!/usr/bin/env python3
"""Parse config.toml and output shell-evaluable environment variables.

Usage (from common.sh):
    eval "$(python3 scripts/config.py)"

Environment merge logic:
    [gcp.default] values are loaded first, then [gcp.{ENVIRONMENT}]
    overrides any keys that are set (non-empty) in the env section.

Requires Python 3.11+ (uses stdlib tomllib, no external deps).
"""

import os
import sys

try:
    import tomllib
except ModuleNotFoundError:
    # Python < 3.11 fallback
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ModuleNotFoundError:
        print("echo 'ERROR: Python 3.11+ required (tomllib) or install tomli'", file=sys.stderr)
        sys.exit(1)

from pathlib import Path


def find_config() -> Path:
    """Walk up from script dir to find config.toml."""
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    config_path = project_root / "config.toml"
    if config_path.exists():
        return config_path
    # Fallback: try cwd
    cwd_config = Path.cwd() / "config.toml"
    if cwd_config.exists():
        return cwd_config
    print(f"# config.toml not found (checked {config_path} and {cwd_config})")
    sys.exit(0)


def main() -> None:
    config_path = find_config()

    with open(config_path, "rb") as f:
        config = tomllib.load(f)

    environment = os.environ.get("ENVIRONMENT", "staging")

    # Project-level settings
    project = config.get("project", {})
    project_name = project.get("name", "")

    # Merge: default -> environment-specific
    gcp = config.get("gcp", {})
    defaults = dict(gcp.get("default", {}))
    env_overrides = dict(gcp.get(environment, {}))

    # Non-empty env values override defaults
    merged = {**defaults}
    for key, value in env_overrides.items():
        if value != "":
            merged[key] = value

    # Output shell exports
    print(f'export ENVIRONMENT="{environment}"')
    if project_name:
        print(f'export PROJECT_NAME="{project_name}"')
    if merged.get("project"):
        print(f'export GCP_PROJECT="{merged["project"]}"')
    if merged.get("region"):
        print(f'export GCP_REGION="{merged["region"]}"')
    if merged.get("deployer_sa"):
        print(f'export DEPLOYER_SA="{merged["deployer_sa"]}"')
    if merged.get("runtime_sa"):
        print(f'export RUNTIME_SA="{merged["runtime_sa"]}"')

    # Derived values
    if project_name:
        print(f'export TF_STATE_PREFIX="{project_name}/{environment}"')
        print(f'export IMAGE_NAME="{project_name}"')
        print(f'export AR_REPO="{project_name}"')


if __name__ == "__main__":
    main()
`
}

// ─── Makefile Generation ─────────────────────────────────────────────

function generateMakefile(_pt: ProjectType): string {
  return `.PHONY: help \\
  local-init local-clean local-build local-run local-test local-lint \\
  container-init container-clean container-build container-run \\
  cloud-init cloud-build cloud-deploy cloud-promote cloud-clean \\
  logs-list logs-last logs-clean

help: ## Show this help
\t@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \\
\t  awk 'BEGIN {FS = ":.*?## "}; {printf "  \\033[36m%-20s\\033[0m %s\\n", $$1, $$2}'

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

# ─── Cloud Runtime ───────────────────────────────────────────────────

cloud-init: ## Initialize cloud resources (via Cloud Build)
\t@bash scripts/cloud.sh init

cloud-build: ## Build and push to Artifact Registry (via Cloud Build)
\t@bash scripts/cloud.sh build

cloud-deploy: ## Deploy to cloud runtime (via Cloud Build)
\t@bash scripts/cloud.sh deploy

cloud-promote: ## Promote staging image to production
\t@bash scripts/cloud.sh promote

cloud-clean: ## Tear down cloud resources (via Cloud Build)
\t@bash scripts/cloud.sh clean

# ─── Logs ─────────────────────────────────────────────────────────────

logs-list: ## List recent log files
\t@ls -lt logs/*.log 2>/dev/null | head -20 || echo "No log files found"

logs-last: ## Show the most recent log file
\t@ls -t logs/*.log 2>/dev/null | head -1 | xargs cat 2>/dev/null || echo "No log files found"

logs-clean: ## Remove all log files
\t@rm -rf logs/*.log && echo "Cleaned log files" || true
`
}

// ─── Scripts Generation ──────────────────────────────────────────────

function generateCommonSh(): string {
  return `#!/usr/bin/env bash
# Common functions sourced by all scripts
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

# ─── Environment ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "\${SCRIPT_DIR}/.." && pwd)"

# Environment resolution: CLI > .env > default (staging)
export ENVIRONMENT="\${ENVIRONMENT:-staging}"

# Load .env if it exists (do NOT commit .env files)
if [[ -f "\${PROJECT_ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  source "\${PROJECT_ROOT}/.env"
fi

# Load config.toml via Python parser (structured multi-env config)
# Falls back to .env defaults if config.toml doesn't exist
if [[ -f "\${PROJECT_ROOT}/config.toml" ]]; then
  if command -v python3 &>/dev/null; then
    eval "$(python3 "\${SCRIPT_DIR}/config.py")"
  else
    log_warn "python3 not found — config.toml will not be loaded. Install Python 3.11+."
  fi
fi

# ─── Defaults (override in config.toml, .env, or environment) ────────

export PROJECT_NAME="\${PROJECT_NAME:-$(basename "\${PROJECT_ROOT}")}"
export IMAGE_NAME="\${IMAGE_NAME:-\${PROJECT_NAME}}"
export IMAGE_TAG="\${IMAGE_TAG:-latest}"
export GCP_PROJECT="\${GCP_PROJECT:-}"
export GCP_REGION="\${GCP_REGION:-us-central1}"
export AR_REPO="\${AR_REPO:-\${PROJECT_NAME}}"

# ─── Derived values ──────────────────────────────────────────────────

export TF_STATE_PREFIX="\${TF_STATE_PREFIX:-\${PROJECT_NAME}/\${ENVIRONMENT}}"
export DEPLOYER_SA="\${DEPLOYER_SA:-\${PROJECT_NAME}-deployer@\${GCP_PROJECT}.iam.gserviceaccount.com}"
export RUNTIME_SA="\${RUNTIME_SA:-\${PROJECT_NAME}-runtime@\${GCP_PROJECT}.iam.gserviceaccount.com}"

# ─── Helpers ──────────────────────────────────────────────────────────

require_cmd() {
  command -v "$1" &>/dev/null || die "'$1' is required but not installed."
}

confirm() {
  local prompt="\${1:-Are you sure?} [y/N] "
  read -r -p "\${prompt}" response
  [[ "\${response}" =~ ^[Yy]$ ]]
}

# ─── Log Capture ─────────────────────────────────────────────────────

LOG_DIR="\${PROJECT_ROOT}/logs"
mkdir -p "\${LOG_DIR}"

# Start capturing all stdout/stderr to a per-run log file.
# Usage: start_log <action-name>
start_log() {
  local action="\${1:-unknown}"
  LOG_FILE="\${LOG_DIR}/$(date +%Y%m%d-%H%M%S)-\${action}.log"
  exec > >(tee -a "\${LOG_FILE}") 2>&1
  log_info "Logging to \${LOG_FILE} [env=\${ENVIRONMENT}]"
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
      run: '  cargo run',
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
# Cloud runtime operations (via Cloud Build)
# Usage: bash scripts/cloud.sh {init|build|deploy|promote|clean}
#
# Architecture: staging is the single deployment plane.
# All Cloud Build jobs submit to the STAGING project, even when
# deploying to production. Production has NO Cloud Build.

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "\${SCRIPT_DIR}/common.sh"
start_log "cloud-\${1:-unknown}"

AR_LOCATION="\${GCP_REGION}"
AR_IMAGE="\${AR_LOCATION}-docker.pkg.dev/\${GCP_PROJECT}/\${AR_REPO}/\${IMAGE_NAME}:\${IMAGE_TAG}"

# Resolve the staging project for CB submission.
# All builds submit to staging regardless of ENVIRONMENT.
_staging_project() {
  if [[ -f "\${PROJECT_ROOT}/config.toml" ]] && command -v python3 &>/dev/null; then
    ENVIRONMENT=staging python3 "\${SCRIPT_DIR}/config.py" 2>/dev/null | grep '^export GCP_PROJECT=' | sed 's/export GCP_PROJECT="\\(.*\\)"/\\1/'
  else
    echo "\${GCP_PROJECT}"
  fi
}

# Build Cloud Build substitutions for Terraform pipelines
_tf_substitutions() {
  local action="\${1}"
  local subs="_TF_ACTION=\${action}"
  subs+=",_TF_STATE_BUCKET=\${GCP_PROJECT}-tfstate"
  subs+=",_TF_STATE_PREFIX=\${TF_STATE_PREFIX}"
  subs+=",_REGION=\${GCP_REGION}"
  subs+=",_CB_SERVICE_ACCOUNT=\${DEPLOYER_SA}"
  subs+=",_RUNTIME_SA_NAME=\${PROJECT_NAME}-runtime"
  echo "\${subs}"
}

# ─── Phase 1: Bootstrap ─────────────────────────────────────────────
# Creates the deployer SA with minimal bootstrap roles via gcloud.
# Phase 2 (Terraform) grants functional roles via self-escalation.

init() {
  log_info "Initializing cloud resources for \${ENVIRONMENT}..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Set it in config.toml or .env"

  local SA_NAME="\${PROJECT_NAME}-deployer"
  local SA_EMAIL="\${SA_NAME}@\${GCP_PROJECT}.iam.gserviceaccount.com"

  log_info "Phase 1: Creating deployer SA '\${SA_NAME}' in \${GCP_PROJECT}..."

  # Create deployer service account
  gcloud iam service-accounts create "\${SA_NAME}" \\
    --project="\${GCP_PROJECT}" \\
    --display-name="\${PROJECT_NAME} Cloud Build deployer" \\
    2>/dev/null || log_warn "SA already exists: \${SA_EMAIL}"

  # Grant bootstrap roles (minimum for Terraform to run and self-escalate)
  local BOOTSTRAP_ROLES=(
    "roles/storage.admin"
    "roles/logging.logWriter"
    "roles/resourcemanager.projectIamAdmin"
    "roles/serviceusage.serviceUsageAdmin"
  )

  for role in "\${BOOTSTRAP_ROLES[@]}"; do
    log_info "  Granting \${role}..."
    gcloud projects add-iam-policy-binding "\${GCP_PROJECT}" \\
      --member="serviceAccount:\${SA_EMAIL}" \\
      --role="\${role}" \\
      --condition=None \\
      --quiet
  done

  # Create TF state bucket if it doesn't exist
  local STATE_BUCKET="\${GCP_PROJECT}-tfstate"
  if ! gcloud storage buckets describe "gs://\${STATE_BUCKET}" --project="\${GCP_PROJECT}" &>/dev/null; then
    log_info "Creating TF state bucket: gs://\${STATE_BUCKET}"
    gcloud storage buckets create "gs://\${STATE_BUCKET}" \\
      --project="\${GCP_PROJECT}" \\
      --location="\${GCP_REGION}" \\
      --uniform-bucket-level-access
  else
    log_info "TF state bucket already exists: gs://\${STATE_BUCKET}"
  fi

  # Enable required APIs
  log_info "Enabling required APIs..."
  gcloud services enable \\
    --project="\${GCP_PROJECT}" \\
    cloudbuild.googleapis.com \\
    run.googleapis.com \\
    artifactregistry.googleapis.com \\
    iam.googleapis.com \\
    cloudresourcemanager.googleapis.com

  # Run Terraform init via Cloud Build using the new SA
  log_info "Phase 2: Running Terraform init via Cloud Build..."
  local STAGING_PROJECT
  STAGING_PROJECT="$(_staging_project)"

  gcloud builds submit \\
    --project="\${STAGING_PROJECT}" \\
    --service-account="projects/\${STAGING_PROJECT}/serviceAccounts/\${SA_EMAIL}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-plan.yaml" \\
    --substitutions="$(_tf_substitutions init)" \\
    "\${PROJECT_ROOT}"

  log_ok "Cloud resources initialized. Deployer SA: \${SA_EMAIL}"
  log_info "Update config.toml [gcp.default] deployer_sa = \\"\${SA_EMAIL}\\""
}

build() {
  log_info "Building and pushing image via Cloud Build [\${ENVIRONMENT}]..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Set it in config.toml or .env"

  local STAGING_PROJECT
  STAGING_PROJECT="$(_staging_project)"

  gcloud builds submit \\
    --project="\${STAGING_PROJECT}" \\
    --service-account="projects/\${STAGING_PROJECT}/serviceAccounts/\${DEPLOYER_SA}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild.yaml" \\
    --substitutions="_IMAGE_NAME=\${AR_IMAGE}" \\
    "\${PROJECT_ROOT}"

  log_ok "Image built and pushed: \${AR_IMAGE}"
}

deploy() {
  log_info "Deploying via Cloud Build [\${ENVIRONMENT}]..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Set it in config.toml or .env"

  local STAGING_PROJECT
  STAGING_PROJECT="$(_staging_project)"

  gcloud builds submit \\
    --project="\${STAGING_PROJECT}" \\
    --service-account="projects/\${STAGING_PROJECT}/serviceAccounts/\${DEPLOYER_SA}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="$(_tf_substitutions apply)" \\
    "\${PROJECT_ROOT}"

  log_ok "Deployment complete [\${ENVIRONMENT}]"
}

promote() {
  log_info "Promoting staging image to production..."
  require_cmd gcloud

  # Resolve staging and production projects
  local STAGING_PROJECT PROD_PROJECT
  STAGING_PROJECT="$(ENVIRONMENT=staging python3 "\${SCRIPT_DIR}/config.py" 2>/dev/null | grep '^export GCP_PROJECT=' | sed 's/export GCP_PROJECT="\\(.*\\)"/\\1/')"
  PROD_PROJECT="$(ENVIRONMENT=production python3 "\${SCRIPT_DIR}/config.py" 2>/dev/null | grep '^export GCP_PROJECT=' | sed 's/export GCP_PROJECT="\\(.*\\)"/\\1/')"

  [[ -z "\${STAGING_PROJECT}" ]] && die "Staging project not set in config.toml"
  [[ -z "\${PROD_PROJECT}" ]] && die "Production project not set in config.toml"

  # Find the latest SHA tag from staging
  local SHA_TAG
  SHA_TAG="$(gcloud artifacts docker tags list \\
    "\${GCP_REGION}-docker.pkg.dev/\${STAGING_PROJECT}/\${AR_REPO}/\${IMAGE_NAME}" \\
    --filter="tag~^sha-" \\
    --sort-by="~tag" \\
    --limit=1 \\
    --format="value(tag)" 2>/dev/null)"

  [[ -z "\${SHA_TAG}" ]] && die "No SHA-tagged images found in staging"

  log_info "Latest staging image: \${SHA_TAG}"

  if ! confirm "Promote \${SHA_TAG} to production (\${PROD_PROJECT})?"; then
    log_warn "Aborted."
    exit 0
  fi

  # Deploy to production via Terraform (submitted to staging CB)
  local PROD_IMAGE="\${GCP_REGION}-docker.pkg.dev/\${STAGING_PROJECT}/\${AR_REPO}/\${IMAGE_NAME}:\${SHA_TAG}"
  local PROD_STATE_PREFIX="\${PROJECT_NAME}/production"

  gcloud builds submit \\
    --project="\${STAGING_PROJECT}" \\
    --service-account="projects/\${STAGING_PROJECT}/serviceAccounts/\${DEPLOYER_SA}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,_TF_STATE_BUCKET=\${PROD_PROJECT}-tfstate,_TF_STATE_PREFIX=\${PROD_STATE_PREFIX},_REGION=\${GCP_REGION},_CB_SERVICE_ACCOUNT=\${DEPLOYER_SA},_RUNTIME_SA_NAME=\${PROJECT_NAME}-runtime" \\
    "\${PROJECT_ROOT}"

  log_ok "Production deployment complete: \${SHA_TAG} → \${PROD_PROJECT}"
}

clean() {
  log_info "Tearing down cloud resources [\${ENVIRONMENT}]..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Set it in config.toml or .env"

  if ! confirm "This will destroy cloud infrastructure for \${ENVIRONMENT}. Continue?"; then
    log_warn "Aborted."
    exit 0
  fi

  local STAGING_PROJECT
  STAGING_PROJECT="$(_staging_project)"

  gcloud builds submit \\
    --project="\${STAGING_PROJECT}" \\
    --service-account="projects/\${STAGING_PROJECT}/serviceAccounts=\${DEPLOYER_SA}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="$(_tf_substitutions destroy)" \\
    "\${PROJECT_ROOT}"

  log_ok "Cloud resources destroyed [\${ENVIRONMENT}]"
}

# ─── Dispatch ─────────────────────────────────────────────────────────

case "\${1:-}" in
  init)    init    ;;
  build)   build   ;;
  deploy)  deploy  ;;
  promote) promote ;;
  clean)   clean   ;;
  *)       die "Usage: $0 {init|build|deploy|promote|clean}" ;;
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
# Triggered by: push to main branch or manual submission
# Images are tagged with :latest AND :sha-<SHORT_SHA> for traceability
steps:
  # Build container image with both tags
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-f'
      - 'cicd/Dockerfile'
      - '-t'
      - '\${_IMAGE_NAME}:latest'
      - '-t'
      - '\${_IMAGE_NAME}:sha-\${SHORT_SHA}'
      - '.'

  # Push all tags to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - '--all-tags'
      - '\${_IMAGE_NAME}'

images:
  - '\${_IMAGE_NAME}:latest'
  - '\${_IMAGE_NAME}:sha-\${SHORT_SHA}'

substitutions:
  _IMAGE_NAME: 'us-central1-docker.pkg.dev/\${PROJECT_ID}/app/app'

options:
  logging: CLOUD_LOGGING_ONLY
`
}

function generateCloudbuildPlanYaml(): string {
  return `# Terraform plan pipeline
# Triggered by: pull request events
# Runs terraform init + plan and outputs the plan for review
steps:
  # Initialize Terraform
  - name: 'hashicorp/terraform:1.7'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  # Run plan (or custom action)
  - name: 'hashicorp/terraform:1.7'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
      - 'TF_VAR_project_id=\${PROJECT_ID}'
      - 'TF_VAR_region=\${_REGION}'
      - 'TF_VAR_cb_service_account=\${_CB_SERVICE_ACCOUNT}'
      - 'TF_VAR_runtime_sa_name=\${_RUNTIME_SA_NAME}'

substitutions:
  _TF_ACTION: 'plan'
  _TF_STATE_BUCKET: '\${PROJECT_ID}-tfstate'
  _TF_STATE_PREFIX: 'app/staging'
  _REGION: 'us-central1'
  _CB_SERVICE_ACCOUNT: ''
  _RUNTIME_SA_NAME: 'app-runtime'

options:
  logging: CLOUD_LOGGING_ONLY
`
}

function generateCloudbuildApplyYaml(): string {
  return `# Terraform apply pipeline
# Triggered by: merge to main branch
# Runs terraform init + apply (or destroy) with auto-approve
steps:
  # Initialize Terraform
  - name: 'hashicorp/terraform:1.7'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  # Apply (or destroy)
  - name: 'hashicorp/terraform:1.7'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-auto-approve'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
      - 'TF_VAR_project_id=\${PROJECT_ID}'
      - 'TF_VAR_region=\${_REGION}'
      - 'TF_VAR_cb_service_account=\${_CB_SERVICE_ACCOUNT}'
      - 'TF_VAR_runtime_sa_name=\${_RUNTIME_SA_NAME}'

substitutions:
  _TF_ACTION: 'apply'
  _TF_STATE_BUCKET: '\${PROJECT_ID}-tfstate'
  _TF_STATE_PREFIX: 'app/staging'
  _REGION: 'us-central1'
  _CB_SERVICE_ACCOUNT: ''
  _RUNTIME_SA_NAME: 'app-runtime'

options:
  logging: CLOUD_LOGGING_ONLY
`
}

// ─── Terraform Generation ────────────────────────────────────────────

function generateTfProviders(): string {
  return `terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
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
  return `variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Name of the Cloud Run service"
  type        = string
  default     = "app"
}

variable "image" {
  description = "Container image to deploy (full Artifact Registry path)"
  type        = string
  default     = ""
}

# ─── Service Account Variables ───────────────────────────────────────

variable "cb_service_account" {
  description = "Cloud Build deployer service account email (for functional IAM grants)"
  type        = string
  default     = ""
}

variable "runtime_sa_name" {
  description = "Name for the Cloud Run runtime service account"
  type        = string
  default     = "app-runtime"
}

# ─── Scaling Variables ───────────────────────────────────────────────

variable "min_instances" {
  description = "Minimum Cloud Run instances (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
  default     = 3
}

# ─── Domain Mapping ─────────────────────────────────────────────────

variable "domain" {
  description = "Custom domain for Cloud Run service (leave empty to skip domain mapping)"
  type        = string
  default     = ""
}
`
}

function generateTfMain(): string {
  return `# ─── Artifact Registry ────────────────────────────────────────────────

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = var.service_name
  format        = "DOCKER"
  description   = "Container images for \${var.service_name}"
}

# ─── Runtime Service Account ────────────────────────────────────────
# Dedicated SA for Cloud Run (replaces default Compute Engine SA)

resource "google_service_account" "runtime" {
  account_id   = var.runtime_sa_name
  display_name = "\${var.service_name} Cloud Run runtime"
}

# ─── Deployer SA Functional IAM (Phase 2 self-escalation) ────────────
# Phase 1 grants bootstrap roles via gcloud (see scripts/cloud.sh init).
# Phase 2 (here) grants the functional roles the deployer needs for
# ongoing CI/CD operations.

resource "google_project_iam_member" "deployer_run_admin" {
  count   = var.cb_service_account != "" ? 1 : 0
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:\${var.cb_service_account}"
}

resource "google_project_iam_member" "deployer_ar_admin" {
  count   = var.cb_service_account != "" ? 1 : 0
  project = var.project_id
  role    = "roles/artifactregistry.admin"
  member  = "serviceAccount:\${var.cb_service_account}"
}

resource "google_project_iam_member" "deployer_sa_user" {
  count   = var.cb_service_account != "" ? 1 : 0
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:\${var.cb_service_account}"
}

# ─── Cloud Run Service ───────────────────────────────────────────────

resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region

  template {
    service_account = google_service_account.runtime.email

    containers {
      image = var.image != "" ? var.image : "\${var.region}-docker.pkg.dev/\${var.project_id}/\${var.service_name}/\${var.service_name}:latest"

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
# Remove this block if the service should require authentication.

resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Domain Mapping (conditional) ───────────────────────────────────
# Only created when var.domain is set to a non-empty value.

resource "google_cloud_run_domain_mapping" "app" {
  count    = var.domain != "" ? 1 : 0
  location = var.region
  name     = var.domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}
`
}

function generateTfOutputs(): string {
  return `output "service_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.app.uri
}

output "artifact_registry_repo" {
  description = "Artifact Registry repository URL"
  value       = "\${var.region}-docker.pkg.dev/\${var.project_id}/\${google_artifact_registry_repository.app.repository_id}"
}

output "runtime_sa_email" {
  description = "Runtime service account email"
  value       = google_service_account.runtime.email
}

output "domain_records" {
  description = "DNS records to configure for domain mapping"
  value       = var.domain != "" ? google_cloud_run_domain_mapping.app[0].status[0].resource_records : []
}
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

type ScaffoldComponent = "config" | "makefile" | "scripts" | "container" | "cloudbuild" | "terraform" | "gitignore"

const ALL_COMPONENTS: ScaffoldComponent[] = ["config", "makefile", "scripts", "container", "cloudbuild", "terraform", "gitignore"]

function scaffoldConfig(root: string, force: boolean): string[] {
  return [
    "── Config ──",
    safeWrite(join(root, "config.toml.example"), generateConfigTomlExample(), force),
  ]
}

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
    safeWrite(join(dir, "config.py"), generateConfigPy(), force),
  ]
  try {
    await Bun.$`chmod +x ${dir}/*.sh ${dir}/config.py`.text()
  } catch { /* non-fatal */ }
  return results
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
    "Generate project operational structure: config.toml, Makefile, scripts/, " +
    "cicd/Dockerfile, cicd/cloudbuild*.yaml, cicd/terraform/, and .gitignore. " +
    "Detects project type and tailors all files. Full CI/CD includes multi-environment " +
    "support (staging/production) with custom deployer and runtime service accounts. " +
    "Use the 'components' parameter to generate only specific parts, or omit it to " +
    "generate everything. Skips existing files unless force=true.",
  args: {
    components: tool.schema
      .array(tool.schema.enum(["config", "makefile", "scripts", "container", "cloudbuild", "terraform", "gitignore"]))
      .optional()
      .describe(
        "Which components to scaffold. Options: config, makefile, scripts, container, " +
        "cloudbuild, terraform, gitignore. Omit to generate everything. " +
        "When cloudbuild or terraform is selected, config is auto-included.",
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
    let components: ScaffoldComponent[] =
      args.components && args.components.length > 0
        ? args.components as ScaffoldComponent[]
        : ALL_COMPONENTS

    // Auto-include config when CI/CD components are selected
    if ((components.includes("cloudbuild") || components.includes("terraform")) && !components.includes("config")) {
      components = ["config", ...components]
    }

    const results: string[] = [
      "Project Scaffold",
      "================",
      `Detected project type: ${projectLabel(pt)}`,
      `Components: ${components.join(", ")}`,
      "",
    ]

    for (const component of components) {
      switch (component) {
        case "config":
          results.push(...scaffoldConfig(root, force))
          break
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
        case "gitignore":
          results.push(...scaffoldGitignore(root, pt))
          break
      }
      results.push("")
    }

    results.push("================")
    results.push("Scaffold complete. Run 'make help' to see available targets.")

    return results.join("\n")
  },
})
