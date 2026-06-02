// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// Each export here is a pure string-template generator used by the
// scaffold tool. ProjectType is duplicated here to avoid cross-file
// type imports (opencode plugin loader treats each tools/*.ts as an
// independent module).

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

// ─── Makefile Generation ─────────────────────────────────────────────

export function generateMakefile(_pt: ProjectType): string {
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
