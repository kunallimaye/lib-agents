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
  cloud-init cloud-init-prod cloud-infra cloud-app-deploy \\
  cloud-app-promote cloud-app-undeploy cloud-clean \\
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

# ─── Cloud Runtime ───────────────────────────────────────────────────

cloud-init: ## Bootstrap primary env (TF state, deployer SA, IAM, optional DNS grant)
\t@bash scripts/cloud.sh init

cloud-init-prod: ## One-time prod bootstrap (run as prod project owner; grants projectIamAdmin to deployer SA)
\t@bash scripts/cloud.sh init-prod

cloud-infra: ## Provision/update infrastructure via Terraform (Cloud Build)
\t@bash scripts/cloud.sh infra

cloud-app-deploy: ## Build image and deploy to current ENVIRONMENT (default: staging)
\t@bash scripts/cloud.sh app-deploy

cloud-app-promote: ## Promote a staging image to a non-staging env. Requires VERSION=vX.Y.Z and IMAGE=<full-uri>
\t@bash scripts/cloud.sh app-promote

cloud-app-undeploy: ## Revert Cloud Run to placeholder image (keeps infra)
\t@bash scripts/cloud.sh app-undeploy

cloud-clean: ## Tear down cloud infrastructure (terraform destroy)
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

# Load .env if it exists (do NOT commit .env files)
if [[ -f "\${PROJECT_ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  source "\${PROJECT_ROOT}/.env"
fi

# ─── Environment Selection ───────────────────────────────────────────
# Priority: CLI env var > .env file > default (staging)
export ENVIRONMENT="\${ENVIRONMENT:-staging}"

if [[ "\${ENVIRONMENT}" != "staging" && "\${ENVIRONMENT}" != "production" ]]; then
  die "Invalid ENVIRONMENT '\${ENVIRONMENT}'. Must be 'staging' or 'production'."
fi

# ─── Config.toml Parsing (via Python) ────────────────────────────────
# Uses scripts/config.py to parse config.toml and emit shell variables.
# Python handles the [gcp.default] → [gcp.<env>] merge correctly.

if [[ -f "\${PROJECT_ROOT}/config.toml" ]]; then
  log_info "Loading config from config.toml (environment: \${ENVIRONMENT})"
  eval "$(python3 "\${SCRIPT_DIR}/config.py")"
fi

# ─── Defaults (override in .env, config.toml, or environment) ────────

export PROJECT_NAME="\${PROJECT_NAME:-$(basename "\${PROJECT_ROOT}")}"
export IMAGE_NAME="\${IMAGE_NAME:-\${PROJECT_NAME}}"
export IMAGE_TAG="\${IMAGE_TAG:-latest}"
export GCP_PROJECT="\${GCP_PROJECT:-}"
export GCP_REGION="\${GCP_REGION:-us-central1}"
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

# Service account defaults
export DEPLOYER_SA_NAME="\${DEPLOYER_SA_NAME:-\${PROJECT_NAME}-deployer}"
export RUNTIME_SA_NAME="\${RUNTIME_SA_NAME:-\${PROJECT_NAME}-runtime}"
export CB_PROJECT="\${CB_PROJECT:-\${GCP_PROJECT}}"
export CB_SERVICE_ACCOUNT="\${CB_SERVICE_ACCOUNT:-\${DEPLOYER_SA_NAME}@\${CB_PROJECT}.iam.gserviceaccount.com}"
export RUNTIME_SA_EMAIL="\${RUNTIME_SA_EMAIL:-\${RUNTIME_SA_NAME}@\${GCP_PROJECT}.iam.gserviceaccount.com}"

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
  log_info "Logging to \${LOG_FILE}"
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
# Usage: bash scripts/cloud.sh {init|init-prod|infra|app-deploy|app-promote|app-undeploy|clean}

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "\${SCRIPT_DIR}/common.sh"
start_log "cloud-\${1:-unknown}"

# Build Cloud Build substitutions from config
_tf_substitutions() {
  local subs="_REGION=\${GCP_REGION}"
  [[ -n "\${TF_STATE_BUCKET}" ]] && subs="\${subs},_TF_STATE_BUCKET=\${TF_STATE_BUCKET}"
  [[ -n "\${TF_STATE_PREFIX}" ]] && subs="\${subs},_TF_STATE_PREFIX=\${TF_STATE_PREFIX}"
  subs="\${subs},_SERVICE_NAME=\${PROJECT_NAME}"
  subs="\${subs},_DOMAIN=\${DOMAIN}"
  subs="\${subs},_DNS_PROJECT_ID=\${DNS_PROJECT_ID}"
  subs="\${subs},_DNS_MANAGED_ZONE=\${DNS_MANAGED_ZONE}"
  subs="\${subs},_DNS_RECORD_NAME=\${DNS_RECORD_NAME}"
  subs="\${subs},_MIN_INSTANCES=\${MIN_INSTANCES}"
  subs="\${subs},_MAX_INSTANCES=\${MAX_INSTANCES}"
  subs="\${subs},_CB_SERVICE_ACCOUNT=\${CB_SERVICE_ACCOUNT}"
  subs="\${subs},_RUNTIME_SA_NAME=\${RUNTIME_SA_NAME}"
  subs="\${subs},_CB_PROJECT_ID=\${CB_PROJECT}"
  subs="\${subs},_PROJECT_ID=\${GCP_PROJECT}"
  subs="\${subs},_INGRESS=\${INGRESS}"
  echo "\${subs}"
}

init() {
  log_info "Initializing cloud resources (\${ENVIRONMENT})..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set. Add to config.toml or .env"

  # Refusal guard: cloud-init is for the primary env (where the deployer SA,
  # AR repo, and TF state live). Secondary envs (e.g. prod) must use
  # cloud-init-prod which runs as the prod project owner with prod admin
  # credentials and only grants the bootstrap role on the prod project.
  if [[ "\${GCP_PROJECT}" != "\${CB_PROJECT}" ]]; then
    die "make cloud-init is for the primary environment (where GCP_PROJECT == CB_PROJECT, currently \${CB_PROJECT}). For ENVIRONMENT=\${ENVIRONMENT} which targets \${GCP_PROJECT}, the prod project owner should run 'make cloud-init-prod' instead."
  fi

  # Step 1: Create TF state bucket (if not exists)
  log_info "Step 1/6: Creating Terraform state bucket..."
  if ! gcloud storage buckets describe "gs://\${TF_STATE_BUCKET}" --project="\${GCP_PROJECT}" &>/dev/null; then
    gcloud storage buckets create "gs://\${TF_STATE_BUCKET}" \\
      --project="\${GCP_PROJECT}" \\
      --location="\${GCP_REGION}" \\
      --uniform-bucket-level-access
    log_ok "Created bucket: gs://\${TF_STATE_BUCKET}"
  else
    log_ok "Bucket already exists: gs://\${TF_STATE_BUCKET}"
  fi

  # Step 2: Enable Cloud Build API
  log_info "Step 2/6: Enabling Cloud Build API..."
  gcloud services enable cloudbuild.googleapis.com --project="\${GCP_PROJECT}"
  log_ok "Cloud Build API enabled"

  # Step 3: Create deployer SA (if not exists)
  log_info "Step 3/6: Creating deployer service account..."
  if ! gcloud iam service-accounts describe "\${CB_SERVICE_ACCOUNT}" --project="\${GCP_PROJECT}" &>/dev/null; then
    gcloud iam service-accounts create "\${DEPLOYER_SA_NAME}" \\
      --display-name="\${PROJECT_NAME} Deployer" \\
      --project="\${GCP_PROJECT}"
    log_ok "Created SA: \${CB_SERVICE_ACCOUNT}"
  else
    log_ok "SA already exists: \${CB_SERVICE_ACCOUNT}"
  fi

  # Step 4: Grant bootstrap IAM roles (minimum for TF self-escalation)
  log_info "Step 4/6: Granting bootstrap IAM roles..."
  local bootstrap_roles=(
    "roles/storage.admin"
    "roles/logging.logWriter"
    "roles/resourcemanager.projectIamAdmin"
    "roles/serviceusage.serviceUsageAdmin"
    "roles/iam.serviceAccountCreator"
  )

  for role in "\${bootstrap_roles[@]}"; do
    gcloud projects add-iam-policy-binding "\${GCP_PROJECT}" \\
      --member="serviceAccount:\${CB_SERVICE_ACCOUNT}" \\
      --role="\${role}" \\
      --condition=None \\
      --quiet
  done

  # Bucket-level objectAdmin (belt-and-suspenders for org deny policies)
  gcloud storage buckets add-iam-policy-binding "gs://\${GCP_PROJECT}_cloudbuild" \\
    --member="serviceAccount:\${CB_SERVICE_ACCOUNT}" \\
    --role="roles/storage.objectAdmin" \\
    --condition=None \\
    --quiet 2>/dev/null || true

  gcloud storage buckets add-iam-policy-binding "gs://\${TF_STATE_BUCKET}" \\
    --member="serviceAccount:\${CB_SERVICE_ACCOUNT}" \\
    --role="roles/storage.objectAdmin" \\
    --condition=None \\
    --quiet

  log_ok "Bootstrap IAM roles granted"

  # Step 5: Terraform init (via Cloud Build, using custom SA)
  log_info "Step 5/6: Running Terraform init..."
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-plan.yaml" \\
    --substitutions="_TF_ACTION=init,$(_tf_substitutions)" \\
    --quiet

  # Step 6/6: Grant cross-project DNS permissions (if DNS_PROJECT_ID is set).
  # Note: We use roles/dns.admin here. A previously-tried "record-set-editor"
  # variant role does NOT exist in GCP's predefined Cloud DNS role catalog,
  # despite some references suggesting otherwise. The two predefined roles
  # for managing DNS resources are roles/dns.admin and roles/dns.reader.
  # See: https://cloud.google.com/dns/docs/access-control
  if [[ -n "\${DNS_PROJECT_ID}" ]]; then
    log_info "Step 6/6: Granting roles/dns.admin on \${DNS_PROJECT_ID}..."
    if gcloud projects add-iam-policy-binding "\${DNS_PROJECT_ID}" \\
        --billing-project="\${DNS_PROJECT_ID}" \\
        --member="serviceAccount:\${CB_SERVICE_ACCOUNT}" \\
        --role="roles/dns.admin" \\
        --condition=None \\
        --quiet; then
      log_info "Waiting 120s for IAM propagation..."
      sleep 120
      log_ok "DNS bootstrap complete"
    else
      log_warn ""
      log_warn "Cross-project DNS IAM grant failed on \${DNS_PROJECT_ID}."
      log_warn "Most likely cause: operator lacks setIamPolicy permission on the DNS project."
      log_warn ""
      log_warn "Workarounds (pick one):"
      log_warn "  (a) Re-run the grant manually with elevated credentials:"
      log_warn "      gcloud projects add-iam-policy-binding \${DNS_PROJECT_ID} \\\\"
      log_warn "        --billing-project=\${DNS_PROJECT_ID} \\\\"
      log_warn "        --member=serviceAccount:\${CB_SERVICE_ACCOUNT} \\\\"
      log_warn "        --role=roles/dns.admin --condition=None"
      log_warn ""
      log_warn "  (b) Ask the DNS project owner to run the command above."
      log_warn ""
      log_warn "  (c) Use a different DNS project where you have setIamPolicy permission."
      log_warn ""
      log_warn "Continuing cloud-init. Run 'make cloud-infra' once the grant is in place."
    fi
  else
    log_info "Step 6/6: Skipped (DNS_PROJECT_ID not set)"
  fi

  log_ok "Cloud resources initialized (\${ENVIRONMENT})"
}

# One-time bootstrap of a SECONDARY environment (e.g. production), run by
# the prod project owner with prod admin credentials. Pure gcloud — no
# Cloud Build invocation. Grants the staging-resident deployer SA the
# minimum role needed for it to self-escalate the rest of its IAM via
# Terraform on subsequent \`make cloud-infra\` runs.
#
# Self-escalation chain:
#   prod owner grants:   projectIamAdmin (here)
#                              |
#                              v
#   TF self-grants:      serviceUsageAdmin, iam.serviceAccountCreator,
#                        run.admin, artifactregistry.admin,
#                        iam.serviceAccountUser, plus Compute roles when
#                        LB enabled.
init_prod() {
  log_info "One-time prod bootstrap (\${ENVIRONMENT})..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${CB_PROJECT}" ]] && die "CB_PROJECT is not set."
  [[ -z "\${CB_SERVICE_ACCOUNT}" ]] && die "CB_SERVICE_ACCOUNT is not set."

  # Refusal guard: this target is for secondary envs only
  if [[ "\${GCP_PROJECT}" == "\${CB_PROJECT}" ]]; then
    die "make cloud-init-prod is for secondary environments (where GCP_PROJECT differs from CB_PROJECT, currently \${CB_PROJECT}). For ENVIRONMENT=\${ENVIRONMENT} which targets the same project as CB, use 'make cloud-init' instead."
  fi

  # Step 1/3: Print summary and confirm
  log_info "Step 1/3: Confirming bootstrap targets..."
  log_info ""
  log_info "  Target prod project:       \${GCP_PROJECT}"
  log_info "  Deployer SA to be granted: \${CB_SERVICE_ACCOUNT}"
  log_info "  Role to grant on prod:     roles/resourcemanager.projectIamAdmin"
  if [[ -n "\${DNS_PROJECT_ID}" ]]; then
    log_info "  Target DNS project:        \${DNS_PROJECT_ID}"
    log_info "  Role to grant on DNS:      roles/dns.admin"
  fi
  log_info ""
  if [[ "\${CONFIRM:-}" != "yes" ]]; then
    if ! confirm "Proceed with these grants?"; then
      log_warn "Aborted."
      exit 0
    fi
  fi

  # Step 2/3: Grant projectIamAdmin to deployer SA on prod project. This is
  # the single bootstrap role from which Terraform self-grants all other
  # roles it needs (serviceUsageAdmin, iam.serviceAccountCreator, run.admin,
  # artifactregistry.admin, etc.) on subsequent \`make cloud-infra\` runs.
  log_info "Step 2/3: Granting roles/resourcemanager.projectIamAdmin on \${GCP_PROJECT}..."
  if ! gcloud projects add-iam-policy-binding "\${GCP_PROJECT}" \\
      --billing-project="\${GCP_PROJECT}" \\
      --member="serviceAccount:\${CB_SERVICE_ACCOUNT}" \\
      --role="roles/resourcemanager.projectIamAdmin" \\
      --condition=None \\
      --quiet; then
    die "Failed to grant projectIamAdmin on \${GCP_PROJECT}. The operator running 'make cloud-init-prod' needs setIamPolicy permission on the prod project (roles/resourcemanager.projectIamAdmin or roles/owner)."
  fi
  log_ok "projectIamAdmin granted on \${GCP_PROJECT}"

  # Step 3/3: Grant DNS access (if DNS_PROJECT_ID set) — same warn-and-continue
  # pattern as init()'s Step 6/6, since the operator running cloud-init-prod
  # may not have setIamPolicy on a DNS project owned by a different team.
  if [[ -n "\${DNS_PROJECT_ID}" ]]; then
    log_info "Step 3/3: Granting roles/dns.admin on \${DNS_PROJECT_ID}..."
    if gcloud projects add-iam-policy-binding "\${DNS_PROJECT_ID}" \\
        --billing-project="\${DNS_PROJECT_ID}" \\
        --member="serviceAccount:\${CB_SERVICE_ACCOUNT}" \\
        --role="roles/dns.admin" \\
        --condition=None \\
        --quiet; then
      log_ok "DNS access granted"
    else
      log_warn ""
      log_warn "Cross-project DNS IAM grant failed on \${DNS_PROJECT_ID}."
      log_warn "Most likely cause: operator lacks setIamPolicy on the DNS project."
      log_warn ""
      log_warn "Workarounds (pick one):"
      log_warn "  (a) Re-run the grant manually with elevated credentials:"
      log_warn "      gcloud projects add-iam-policy-binding \${DNS_PROJECT_ID} \\\\"
      log_warn "        --billing-project=\${DNS_PROJECT_ID} \\\\"
      log_warn "        --member=serviceAccount:\${CB_SERVICE_ACCOUNT} \\\\"
      log_warn "        --role=roles/dns.admin --condition=None"
      log_warn ""
      log_warn "  (b) Ask the DNS project owner to run the command above."
      log_warn ""
      log_warn "  (c) Use a different DNS project where you have setIamPolicy permission."
      log_warn ""
      log_warn "Continuing. cloud-infra will fail until the DNS grant is in place."
    fi
  else
    log_info "Step 3/3: Skipped (DNS_PROJECT_ID not set)"
  fi

  log_ok "Prod bootstrap complete (\${ENVIRONMENT})"
  log_info ""
  log_info "Next: anyone with Cloud Build access on \${CB_PROJECT} can now run:"
  log_info "  ENVIRONMENT=\${ENVIRONMENT} make cloud-infra"
  log_info ""
  log_info "Terraform will self-grant the remaining IAM roles on \${GCP_PROJECT}"
  log_info "using the projectIamAdmin permission granted above."
}

infra() {
  log_info "Creating/updating cloud infrastructure (\${ENVIRONMENT})..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set. Add to config.toml or .env"

  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions)" \\
    --quiet

  log_ok "Infrastructure ready (\${ENVIRONMENT})"
}

app_deploy() {
  log_info "Building and deploying application (\${ENVIRONMENT})..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set. Add to config.toml or .env"

  local short_sha
  short_sha="$(git -C "\${PROJECT_ROOT}" rev-parse --short HEAD)"
  local image_base="\${GCP_REGION}-docker.pkg.dev/\${GCP_PROJECT}/\${PROJECT_NAME}/\${PROJECT_NAME}"

  # Step 1: Build and push container image (tagged :latest and :sha-<commit>)
  log_info "Step 1/2: Building and pushing container image..."
  log_info "  Image: \${image_base}:latest"
  log_info "  Image: \${image_base}:sha-\${short_sha}"
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild.yaml" \\
    --substitutions="_IMAGE_NAME=\${image_base},_SHORT_SHA=\${short_sha}" \\
    --quiet

  log_ok "Image built and pushed"

  # Step 2: Update Cloud Run via Terraform to use :latest
  log_info "Step 2/2: Updating Cloud Run service..."
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions),_IMAGE=\${image_base}:latest" \\
    --quiet

  log_ok "Application deployed (sha-\${short_sha})"
}

app_promote() {
  log_info "Promoting image to \${ENVIRONMENT}..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set. Add to config.toml or .env"
  [[ "\${ENVIRONMENT}" == "staging" ]] && die "Cannot promote to staging. Use app-deploy instead."
  [[ -z "\${VERSION:-}" ]] && die "VERSION is required (e.g., VERSION=v1.0.0)"
  [[ -z "\${IMAGE:-}" ]] && die "IMAGE is required (full URI of staging image to promote, e.g., IMAGE=us-central1-docker.pkg.dev/<cb-project>/\${PROJECT_NAME}/\${PROJECT_NAME}:sha-abc123f)"

  # Step 1: Tag the source image with the semver version
  log_info "Step 1/2: Tagging image as \${VERSION}..."
  gcloud artifacts docker tags add \\
    "\${IMAGE}" \\
    "\${IMAGE%%:*}:\${VERSION}"

  log_ok "Tagged \${IMAGE} as \${VERSION}"

  # Step 2: Deploy to target environment via Terraform
  local versioned_image="\${IMAGE%%:*}:\${VERSION}"
  log_info "Step 2/2: Deploying \${versioned_image} to \${ENVIRONMENT}..."

  # Cloud Build always runs in the default/staging project (CB_PROJECT)
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions),_IMAGE=\${versioned_image}" \\
    --quiet

  log_ok "Promoted \${VERSION} to \${ENVIRONMENT}"
}

app_undeploy() {
  log_info "Undeploying application (\${ENVIRONMENT}, reverting to placeholder)..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set. Add to config.toml or .env"

  # Set image to empty string — Terraform will use the placeholder
  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=apply,$(_tf_substitutions),_IMAGE=" \\
    --quiet

  log_ok "Application undeployed (Cloud Run reverted to placeholder)"
}

clean() {
  log_info "Tearing down cloud resources (\${ENVIRONMENT})..."
  require_cmd gcloud

  [[ -z "\${GCP_PROJECT}" ]] && die "GCP_PROJECT is not set. Add to config.toml or .env"
  [[ -z "\${TF_STATE_BUCKET}" ]] && die "TF_STATE_BUCKET is not set. Add to config.toml or .env"

  if ! confirm "This will destroy cloud infrastructure for \${ENVIRONMENT}. Continue?"; then
    log_warn "Aborted."
    exit 0
  fi

  gcloud builds submit "\${PROJECT_ROOT}" \\
    --project="\${CB_PROJECT}" \\
    --service-account="projects/\${CB_PROJECT}/serviceAccounts/\${CB_SERVICE_ACCOUNT}" \\
    --config="\${PROJECT_ROOT}/cicd/cloudbuild-apply.yaml" \\
    --substitutions="_TF_ACTION=destroy,$(_tf_substitutions)" \\
    --quiet

  log_ok "Cloud resources destroyed (\${ENVIRONMENT})"
}

# ─── Dispatch ─────────────────────────────────────────────────────────

case "\${1:-}" in
  init)         init ;;
  init-prod)    init_prod ;;
  infra)        infra ;;
  app-deploy)   app_deploy ;;
  app-promote)  app_promote ;;
  app-undeploy) app_undeploy ;;
  clean)        clean ;;
  *)            die "Usage: $0 {init|init-prod|infra|app-deploy|app-promote|app-undeploy|clean}" ;;
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
  _SHORT_SHA: 'unknown'

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
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  # Run plan (or custom action)
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
      - 'TF_VAR_project_id=\${_PROJECT_ID}'
      - 'TF_VAR_region=\${_REGION}'
      - 'TF_VAR_service_name=\${_SERVICE_NAME}'
      - 'TF_VAR_image=\${_IMAGE}'
      - 'TF_VAR_domain=\${_DOMAIN}'
      - 'TF_VAR_min_instances=\${_MIN_INSTANCES}'
      - 'TF_VAR_max_instances=\${_MAX_INSTANCES}'
      - 'TF_VAR_cb_service_account=\${_CB_SERVICE_ACCOUNT}'
      - 'TF_VAR_runtime_sa_name=\${_RUNTIME_SA_NAME}'
      - 'TF_VAR_dns_project_id=\${_DNS_PROJECT_ID}'
      - 'TF_VAR_dns_managed_zone=\${_DNS_MANAGED_ZONE}'
      - 'TF_VAR_dns_record_name=\${_DNS_RECORD_NAME}'
      - 'TF_VAR_cb_project=\${_CB_PROJECT_ID}'
      - 'TF_VAR_ingress=\${_INGRESS}'

substitutions:
  _TF_ACTION: 'plan'
  _TF_STATE_BUCKET: ''
  _TF_STATE_PREFIX: 'app'
  _REGION: 'us-central1'
  _SERVICE_NAME: 'app'
  _IMAGE: ''
  _DOMAIN: ''
  _MIN_INSTANCES: '0'
  _MAX_INSTANCES: '3'
  _CB_SERVICE_ACCOUNT: ''
  _RUNTIME_SA_NAME: 'app-runtime'
  _DNS_PROJECT_ID: ''
  _DNS_MANAGED_ZONE: ''
  _DNS_RECORD_NAME: ''
  _CB_PROJECT_ID: ''
  _PROJECT_ID: ''
  _INGRESS: 'all'

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
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  # Apply (or destroy)
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-auto-approve'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
      - 'TF_VAR_project_id=\${_PROJECT_ID}'
      - 'TF_VAR_region=\${_REGION}'
      - 'TF_VAR_service_name=\${_SERVICE_NAME}'
      - 'TF_VAR_image=\${_IMAGE}'
      - 'TF_VAR_domain=\${_DOMAIN}'
      - 'TF_VAR_min_instances=\${_MIN_INSTANCES}'
      - 'TF_VAR_max_instances=\${_MAX_INSTANCES}'
      - 'TF_VAR_cb_service_account=\${_CB_SERVICE_ACCOUNT}'
      - 'TF_VAR_runtime_sa_name=\${_RUNTIME_SA_NAME}'
      - 'TF_VAR_dns_project_id=\${_DNS_PROJECT_ID}'
      - 'TF_VAR_dns_managed_zone=\${_DNS_MANAGED_ZONE}'
      - 'TF_VAR_dns_record_name=\${_DNS_RECORD_NAME}'
      - 'TF_VAR_cb_project=\${_CB_PROJECT_ID}'
      - 'TF_VAR_ingress=\${_INGRESS}'

substitutions:
  _TF_ACTION: 'apply'
  _TF_STATE_BUCKET: ''
  _TF_STATE_PREFIX: 'app'
  _REGION: 'us-central1'
  _SERVICE_NAME: 'app'
  _IMAGE: ''
  _DOMAIN: ''
  _MIN_INSTANCES: '0'
  _MAX_INSTANCES: '3'
  _CB_SERVICE_ACCOUNT: ''
  _RUNTIME_SA_NAME: 'app-runtime'
  _DNS_PROJECT_ID: ''
  _DNS_MANAGED_ZONE: ''
  _DNS_RECORD_NAME: ''
  _CB_PROJECT_ID: ''
  _PROJECT_ID: ''
  _INGRESS: 'all'

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
    time = {
      source  = "hashicorp/time"
      version = "~> 0.9"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# DNS provider alias — scoped to the (separate) DNS project that owns the
# managed zone. Used only by resources in dns.tf when the LB+DNS stack is
# enabled. Safe to leave configured with an empty project_id when disabled,
# because no resources reference it in that case.
provider "google" {
  alias   = "dns"
  project = var.dns_project_id
}

# Cloud Build project provider alias — scoped to the project that hosts the
# deployer SA, the AR repo, and the TF state bucket. For the primary env
# (staging) this equals var.project_id. For secondary envs (e.g. prod) it
# differs, and is used to write the cross-project Artifact Registry reader
# binding so the prod runtime SA can pull promoted images from staging's AR.
provider "google" {
  alias   = "cb_project"
  project = var.cb_project
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
  description = "Name of the Cloud Run service and related resources"
  type        = string
  default     = "app"
}

variable "image" {
  description = "Container image to deploy. When empty, Cloud Run uses a placeholder image (us-docker.pkg.dev/cloudrun/container/hello:latest) until the real app is deployed via cloud-app-deploy."
  type        = string
  default     = ""
}

variable "domain" {
  description = "Custom domain for the external HTTPS LB. Leave empty to skip the LB+DNS stack."
  type        = string
  default     = ""
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 3
}

variable "cb_service_account" {
  description = "Cloud Build deployer service account email for IAM management"
  type        = string
}

variable "runtime_sa_name" {
  description = "Short name for the Cloud Run runtime service account"
  type        = string
  default     = "app-runtime"
}

variable "dns_project_id" {
  description = "GCP project ID hosting the Cloud DNS managed zone (separate per env). Empty disables LB+DNS stack."
  type        = string
  default     = ""
}

variable "dns_managed_zone" {
  description = "GCP resource name (not DNS name) of the existing managed zone, e.g. 'kunall-demo-altostrat-com'"
  type        = string
  default     = ""
}

variable "dns_record_name" {
  description = "FQDN with trailing dot for the A record, e.g. 'app.example.com.'"
  type        = string
  default     = ""
}

variable "cb_project" {
  description = "Cloud Build project ID (where deployer SA + AR repo live). Equals project_id for the primary env; differs for secondary envs (e.g. prod)."
  type        = string
}

variable "ingress" {
  description = "Cloud Run ingress mode. 'all' allows public *.run.app traffic. 'internal-and-cloud-load-balancing' locks ingress to the external HTTPS LB / internal VPC sources."
  type        = string
  default     = "all"
}
`
}

function generateTfMain(): string {
  return `# ─── GCP API Enablement ──────────────────────────────────────────────
#
# APIs are enabled in two phases to break a chicken-and-egg cycle:
#
#   1. \`bootstrap_apis\` — enables the meta-APIs (serviceusage, iam,
#      cloudresourcemanager) that all subsequent gcloud/TF calls need.
#      No \`depends_on\` — these MUST come first. Without serviceusage
#      enabled, the project_iam_member bindings below would 403.
#
#   2. \`apis\` — enables the runtime APIs (run, artifactregistry,
#      cloudbuild, compute). Depends on \`time_sleep.wait_for_iam\` so
#      the deployer SA's IAM has propagated before TF tries to operate
#      on those APIs through it.
#
# This split is what makes a brand-new-project apply work without any
# prior gcloud bootstrap. Previously the whole \`apis\` set depended on
# IAM bindings whose grants needed serviceusage already on, so the only
# reason apply succeeded was that cloud-init Steps 1–4 had already
# enabled serviceusage via gcloud.

resource "google_project_service" "bootstrap_apis" {
  for_each = toset([
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false

  depends_on = [time_sleep.wait_for_iam]
}

# ─── Deployer SA: Functional roles (self-granted via projectIamAdmin) ──
#
# All deployer IAM bindings depend on \`bootstrap_apis\` so the
# serviceusage / iam / cloudresourcemanager APIs are guaranteed to be on
# before the IAM API tries to write the binding (which would otherwise
# 403 on a brand-new project).

resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

resource "google_project_iam_member" "deployer_ar_admin" {
  project = var.project_id
  role    = "roles/artifactregistry.admin"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

resource "google_project_iam_member" "deployer_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

# Self-escalation chain extenders. With these two grants, the deployer SA
# can bootstrap the rest of its IAM purely from a single bootstrap role
# (roles/resourcemanager.projectIamAdmin) granted on the project — needed
# so secondary envs (prod) can be bootstrapped via cloud-init-prod with
# just projectIamAdmin granted by the prod owner. On the primary env
# (staging) these are idempotent no-ops because cloud-init Step 4 already
# grants the same roles via gcloud.

resource "google_project_iam_member" "deployer_serviceusage_admin" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageAdmin"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

resource "google_project_iam_member" "deployer_sa_creator" {
  project = var.project_id
  role    = "roles/iam.serviceAccountCreator"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

# Compute network admin: required by the LB stack (global address, NEG,
# SSL cert, URL map, target proxies, forwarding rules). Granted only when
# the LB stack is enabled (gated by local.enable_lb).
resource "google_project_iam_member" "deployer_network_admin" {
  count   = local.enable_lb ? 1 : 0
  project = var.project_id
  role    = "roles/compute.networkAdmin"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

# Compute LB admin: required by the LB stack (backend services, URL maps,
# SSL certificates, target proxies, forwarding rules, serverless NEGs).
# Granted only when the LB stack is enabled (gated by local.enable_lb).
resource "google_project_iam_member" "deployer_lb_admin" {
  count   = local.enable_lb ? 1 : 0
  project = var.project_id
  role    = "roles/compute.loadBalancerAdmin"
  member  = "serviceAccount:\${var.cb_service_account}"

  depends_on = [google_project_service.bootstrap_apis]
}

# ─── Wait for IAM propagation ───────────────────────────────
# GCP IAM changes take 60-120s to propagate across regions/services.
# Resources that depend on the deployer SA's functional roles must wait
# for propagation, otherwise they hit eventual-consistency 403s.
#
# IMPORTANT: \`time_sleep\` only sleeps on create or when one of its OWN
# attributes (triggers, create_duration, destroy_duration) changes.
# Adding bindings to \`depends_on\` does NOT re-trigger the wait. We use
# \`triggers\` keyed on the IAM binding IDs so any change to the deployer
# IAM set forces the time_sleep to be recreated and sleep again.

resource "time_sleep" "wait_for_iam" {
  depends_on = [
    google_project_iam_member.deployer_run_admin,
    google_project_iam_member.deployer_ar_admin,
    google_project_iam_member.deployer_sa_user,
    google_project_iam_member.deployer_serviceusage_admin,
    google_project_iam_member.deployer_sa_creator,
    google_project_iam_member.deployer_network_admin,
    google_project_iam_member.deployer_lb_admin,
  ]

  triggers = {
    iam_members = sha256(jsonencode([
      google_project_iam_member.deployer_run_admin.id,
      google_project_iam_member.deployer_ar_admin.id,
      google_project_iam_member.deployer_sa_user.id,
      google_project_iam_member.deployer_serviceusage_admin.id,
      google_project_iam_member.deployer_sa_creator.id,
      try(google_project_iam_member.deployer_network_admin[0].id, ""),
      try(google_project_iam_member.deployer_lb_admin[0].id, ""),
    ]))
  }

  create_duration = "120s"
}

# ─── Runtime SA: Cloud Run application identity ─────────────────────

resource "google_service_account" "runtime" {
  account_id   = var.runtime_sa_name
  display_name = "\${var.service_name} Cloud Run Runtime"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

# ─── Artifact Registry ────────────────────────────────────────────────

resource "google_artifact_registry_repository" "app" {
  depends_on = [
    google_project_service.apis,
    time_sleep.wait_for_iam,
  ]

  location      = var.region
  repository_id = var.service_name
  format        = "DOCKER"
  description   = "Container images for \${var.service_name}"
  labels        = { app = var.service_name }
}

# ─── Cloud Run Service ───────────────────────────────────────────────

resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region
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
      image = var.image != "" ? var.image : "us-docker.pkg.dev/cloudrun/container/hello:latest"

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

  depends_on = [
    google_project_service.apis,
    time_sleep.wait_for_iam,
  ]
}

# ─── IAM: Allow unauthenticated access (public service) ─────────────
# Remove this block if the service should require authentication.

resource "google_cloud_run_v2_service_iam_member" "public" {
  depends_on = [time_sleep.wait_for_iam]

  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Cross-project AR access (secondary envs only) ──────────────────
#
# When this env's runtime project differs from the CB project (i.e., this
# is a secondary env like prod), the runtime SA needs read access to the
# primary env's AR repo to pull promoted images. The deployer SA already
# has artifactregistry.admin on CB_PROJECT (granted by the primary env's
# TF state via the existing deployer_ar_admin resource), so this binding
# is authorized to write through the google.cb_project provider alias.
#
# On the primary env (staging) where project_id == cb_project, the
# binding is skipped — the runtime SA already has access via in-project
# IAM granted elsewhere.

locals {
  is_secondary_env = var.project_id != var.cb_project
}

resource "google_artifact_registry_repository_iam_member" "runtime_ar_reader" {
  count      = local.is_secondary_env ? 1 : 0
  provider   = google.cb_project
  project    = var.cb_project
  location   = var.region
  repository = var.service_name
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

output "artifact_registry_repo" {
  description = "Artifact Registry repository URL"
  value       = "\${var.region}-docker.pkg.dev/\${var.project_id}/\${google_artifact_registry_repository.app.repository_id}"
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
# Architecture:
#   client → reserved IPv4 (anycast) → global external HTTPS LB
#          → serverless NEG → Cloud Run
#
# To force traffic through the LB only, set var.ingress to
# "internal-and-cloud-load-balancing" — then direct *.run.app hits return
# 403 and the LB becomes the only public entry point.
#
# All resources are gated by \`local.enable_lb\`. When any of dns_project_id /
# dns_managed_zone / dns_record_name / domain are empty, no LB resources
# are created — the stack is opt-in.

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
  count   = local.enable_lb ? 1 : 0
  name    = "\${var.service_name}-lb-ip"
  project = var.project_id

  depends_on = [google_project_service.apis, time_sleep.wait_for_iam]
}

# 2. Serverless NEG → Cloud Run. The NEG itself is free.
resource "google_compute_region_network_endpoint_group" "cloud_run_neg" {
  count                 = local.enable_lb ? 1 : 0
  name                  = "\${var.service_name}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }

  depends_on = [google_project_service.apis, time_sleep.wait_for_iam]
}

# 3. Backend service. No health check needed for serverless NEGs.
resource "google_compute_backend_service" "app" {
  count                 = local.enable_lb ? 1 : 0
  name                  = "\${var.service_name}-backend"
  project               = var.project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run_neg[0].id
  }

  depends_on = [google_project_service.apis, time_sleep.wait_for_iam]
}

# 4. URL map for HTTPS traffic — routes everything to the backend.
resource "google_compute_url_map" "https" {
  count           = local.enable_lb ? 1 : 0
  name            = "\${var.service_name}-https"
  project         = var.project_id
  default_service = google_compute_backend_service.app[0].id

  depends_on = [google_project_service.apis, time_sleep.wait_for_iam]
}

# 5. Google-managed SSL cert (classic). Provisioning is asynchronous;
#    the resource returns as soon as it's submitted (status PROVISIONING).
#    Cert reaches ACTIVE 15-60 min after DNS resolves to the LB IP.
resource "google_compute_managed_ssl_certificate" "app" {
  count   = local.enable_lb ? 1 : 0
  name    = "\${var.service_name}-cert"
  project = var.project_id

  managed {
    domains = [var.domain]
  }

  # Recreate cert if the domain list changes — old cert can't be reused.
  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis, time_sleep.wait_for_iam]
}

# 6. Target HTTPS proxy — terminates TLS using the managed cert.
resource "google_compute_target_https_proxy" "app" {
  count            = local.enable_lb ? 1 : 0
  name             = "\${var.service_name}-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
}

# 7. Forwarding rule (443) — binds the reserved IP to the HTTPS proxy.
resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.enable_lb ? 1 : 0
  name                  = "\${var.service_name}-https-fr"
  project               = var.project_id
  target                = google_compute_target_https_proxy.app[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# 8. URL map that 301-redirects all HTTP traffic to HTTPS.
resource "google_compute_url_map" "http_redirect" {
  count   = local.enable_lb ? 1 : 0
  name    = "\${var.service_name}-http-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }

  depends_on = [google_project_service.apis, time_sleep.wait_for_iam]
}

# 9. Target HTTP proxy for the redirect URL map.
resource "google_compute_target_http_proxy" "app" {
  count   = local.enable_lb ? 1 : 0
  name    = "\${var.service_name}-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.http_redirect[0].id
}

# 10. Forwarding rule (80) — same reserved IP, different port.
resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.enable_lb ? 1 : 0
  name                  = "\${var.service_name}-http-fr"
  project               = var.project_id
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
# different GCP project (\`var.dns_project_id\`). The deployer SA must hold
# \`roles/dns.admin\` on that project — granted via gcloud during
# \`make cloud-init\` (see scripts/cloud.sh::init Step 6/6).
#
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
"""Parse config.toml and emit shell variable assignments.

Reads [gcp.default] as base config, merges overrides from
[gcp.{ENVIRONMENT}], and prints KEY='value' lines for eval.
"""

import os
import sys

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # Python < 3.11 fallback


def main():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config.toml')
    if not os.path.exists(config_path):
        print(f"echo 'ERROR: config.toml not found at {config_path}'",
              file=sys.stderr)
        sys.exit(1)

    with open(config_path, 'rb') as f:
        config = tomllib.load(f)

    env = os.environ.get('ENVIRONMENT', 'staging')

    # Project-level config
    project = config.get('project', {})
    project_name = project.get('name', 'app')

    # GCP defaults
    defaults = config.get('gcp', {}).get('default', {})
    tf_defaults = defaults.get('terraform', {})

    # Environment overrides
    env_overrides = config.get('gcp', {}).get(env, {})

    # Merge: env overrides win
    resolved = {**defaults, **env_overrides}
    # Remove nested 'terraform' from resolved (handled separately)
    resolved.pop('terraform', None)

    # Terraform config (no env override for terraform section)
    tf_config = tf_defaults

    # Derive SA emails — deployer SA always from defaults (Cloud Build project)
    cb_project = defaults.get('project_id', '')
    cb_sa_name = defaults.get('deployer_sa', f'{project_name}-deployer')
    cb_sa_email = f'{cb_sa_name}@{cb_project}.iam.gserviceaccount.com'

    # Resolved target project
    project_id = resolved.get('project_id', '')

    # Runtime SA for the target environment
    runtime_sa_name = resolved.get('runtime_sa', f'{project_name}-runtime')
    runtime_sa_email = f'{runtime_sa_name}@{project_id}.iam.gserviceaccount.com'

    # Deployer SA name (for gcloud iam create in init)
    deployer_sa_name = defaults.get('deployer_sa', f'{project_name}-deployer')

    # Auto-derive TF state prefix
    tf_state_prefix = f'{project_name}/{env}'

    # Output shell variables
    print(f"ENVIRONMENT='{env}'")
    print(f"PROJECT_NAME='{project_name}'")
    print(f"GCP_PROJECT='{project_id}'")
    print(f"GCP_REGION='{resolved.get('region', 'us-central1')}'")
    print(f"DOMAIN='{resolved.get('domain', '')}'")
    print(f"DNS_PROJECT_ID='{resolved.get('dns_project_id', '')}'")
    print(f"DNS_MANAGED_ZONE='{resolved.get('dns_managed_zone', '')}'")
    print(f"DNS_RECORD_NAME='{resolved.get('dns_record_name', '')}'")
    print(f"DEPLOYER_SA_NAME='{deployer_sa_name}'")
    print(f"RUNTIME_SA_NAME='{runtime_sa_name}'")
    print(f"CB_PROJECT='{cb_project}'")
    print(f"CB_SERVICE_ACCOUNT='{cb_sa_email}'")
    print(f"RUNTIME_SA_EMAIL='{runtime_sa_email}'")
    print(f"MIN_INSTANCES='{resolved.get('min_instances', '0')}'")
    print(f"MAX_INSTANCES='{resolved.get('max_instances', '3')}'")
    print(f"CPU='{resolved.get('cpu', '1')}'")
    print(f"MEMORY='{resolved.get('memory', '512Mi')}'")
    print(f"INGRESS='{resolved.get('ingress', 'all')}'")
    print(f"TF_STATE_BUCKET='{tf_config.get('state_bucket', '')}'")
    print(f"TF_STATE_PREFIX='{tf_state_prefix}'")


if __name__ == '__main__':
    main()
`
}

function generateConfigTomlExample(): string {
  return `# Project Configuration
# Copy this file to config.toml and fill in your values.
# config.toml is gitignored — never commit it.

[project]
name = "app"

# Default GCP settings (inherited by all environments)
[gcp.default]
project_id = "your-gcp-project-id"
region = "us-central1"
domain = ""
min_instances = 0
max_instances = 3
cpu = "1"
memory = "512Mi"
ingress = "all"
deployer_sa = "app-deployer"
runtime_sa = "app-runtime"

# DNS / external HTTPS LB stack (opt-in).
# Leave empty to disable the LB+DNS stack — Cloud Run remains reachable
# only via its *.run.app URL. Set all three together (and \`domain\` above)
# to provision the LB and write the DNS A record.
#
#   dns_project_id   - GCP project ID hosting the Cloud DNS managed zone
#                      (a SEPARATE project from the runtime project, by
#                      convention; the deployer SA is granted
#                      roles/dns.admin on it during cloud-init).
#   dns_managed_zone - GCP RESOURCE NAME of the existing managed zone,
#                      e.g. 'kunall-demo-altostrat-com' (NOT the DNS name).
#   dns_record_name  - Fully-qualified record name with a trailing dot,
#                      e.g. 'app.example.com.'.
dns_project_id = ""
dns_managed_zone = ""
dns_record_name = ""

[gcp.default.terraform]
state_bucket = "your-tfstate-bucket"
# state_prefix is auto-derived: {project.name}/{ENVIRONMENT}

# ─── Per-environment overrides ─────────────────────────
# Each section inherits from [gcp.default].
# Only specify values that differ from the defaults.

[gcp.staging]
# Uses all defaults — override here if staging needs different values.
# Example LB+DNS setup:
#   domain = "app.example.com"
#   dns_project_id = "your-staging-dns-project"
#   dns_managed_zone = "your-zone-resource-name"
#   dns_record_name = "app.example.com."

[gcp.production]
project_id = "your-prod-project-id"
domain = "your-prod-domain.example.com"
min_instances = 1
max_instances = 10
# dns_project_id = "your-prod-dns-project"
# dns_managed_zone = "your-prod-zone-resource-name"
# dns_record_name = "your-prod-domain.example.com."
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

type ScaffoldComponent = "makefile" | "scripts" | "container" | "cloudbuild" | "terraform" | "gitignore"

const ALL_COMPONENTS: ScaffoldComponent[] = ["makefile", "scripts", "container", "cloudbuild", "terraform", "gitignore"]

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
    // is gitignored). It documents the multi-environment shape that
    // scripts/config.py and scripts/cloud.sh expect.
    safeWrite(join(root, "config.toml.example"), generateConfigTomlExample(), force),
  ]
  try {
    await Bun.$`chmod +x ${dir}/*.sh`.text()
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
    "cicd/cloudbuild*.yaml, cicd/terraform/, and .gitignore. Detects project type " +
    "and tailors all files. Use the 'components' parameter to generate only specific " +
    "parts, or omit it to generate everything. Skips existing files unless force=true.",
  args: {
    components: tool.schema
      .array(tool.schema.enum(["makefile", "scripts", "container", "cloudbuild", "terraform", "gitignore"]))
      .optional()
      .describe(
        "Which components to scaffold. Options: makefile, scripts, container, " +
        "cloudbuild, terraform, gitignore. Omit to generate everything.",
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
      "Project Scaffold",
      "================",
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
