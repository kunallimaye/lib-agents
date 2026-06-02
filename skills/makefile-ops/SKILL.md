---
name: makefile-ops
description: Makefile and modular scripts conventions for DevOps projects
---

## What I do

- Define the standard Makefile target structure for local, container, and cloud operations
- Guide modular shell script authoring in `scripts/`
- Document per-language build and run patterns
- Explain the thin-wrapper pattern and why complex logic belongs in scripts

## When to use me

Use this skill when scaffolding a new project's operational structure, when
modifying Makefile targets or scripts, or when onboarding someone to the
project's development workflow.

## Makefile Conventions

### Three Domains, Six Actions

| Domain | init | clean | build | run/deploy | test | lint |
|--------|------|-------|-------|------------|------|------|
| **Local dev** | `local-init` | `local-clean` | `local-build` | `local-run` | `local-test` | `local-lint` |
| **Container dev** | `container-init` | `container-clean` | `container-build` | `container-run` | — | — |
| **Cloud runtime** | `admin-cloud-init` † | `cloud-clean` | `cloud-infra` | `cloud-app-deploy` | `cloud-preflight` | — |
| **Logs** | — | `logs-clean` | — | — | — | `logs-list` / `logs-last` |

† Cloud runtime adds **admin-tier** and **app lifecycle** verbs beyond the
standard table (post-#142):

- `admin-cloud-init` — owner-only project bootstrap (APIs, service accounts,
  IAM bindings, state buckets); requires Owner role.
- `admin-cloud-destroy` — owner-only teardown of admin-managed resources.
- `cloud-infra` — Terraform plan + apply via Cloud Build (developer-tier).
- `cloud-app-deploy` — image build + Cloud Run revision swap.
- `cloud-app-promote` — semver-tagged promotion of a tested revision.
- `cloud-app-undeploy` — revert/rollback the active revision.
- `cloud-preflight` — pre-deploy audit (auth, quota, config, IAM checks).

### Thin-wrapper Pattern

Every Makefile target is a one-liner that calls a script:

```makefile
local-build: ## Build the project locally
	@bash scripts/local.sh build
```

**Rules:**
- No complex logic in the Makefile -- it's only a dispatch layer
- Use `@` prefix to suppress command echo
- Add `## description` comments for `make help` support
- All `.PHONY` targets declared at the top

### Hard rule: Makefile = operator interface, scripts = implementation

This is the convention, not a suggestion (#141 lesson 5 + #140):

**`make <target>` is the operator interface. Bash scripts under
`scripts/` are the implementation.** Never document `bash scripts/foo.sh
...` directly in READMEs, runbooks, or onboarding docs. Always wrap in
`make foo` and document the Make target.

Why:

- The Make target engages logging (`start_log`), trap handlers, and
  the heartbeat / checkpoint / recovery machinery in `scripts/common.sh`.
  Direct `bash` invocation bypasses those — orphaned cloud resources
  on shell disconnect (the failure shape that motivated #140).
- The Make target is what `make help` discovers. Adding an operator-
  facing target that's invokable only via raw `bash` makes it
  invisible to discovery.
- The Make target is the diff-reviewable surface. Bash script flag
  changes hide; Make target renames don't.
- Future-you and any subagent re-reading the project six months later
  knows where to look: `make help` first, scripts/ only when
  debugging.

The scaffold bakes this in: every script gets a Makefile wrapper, and
the generated `scripts/cloud.sh` includes a header comment telling
operators "never invoke this script directly — go through `make
<target>`."

### Help Target

Include a `help` target that extracts descriptions from `##` comments:

```makefile
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
```

## Scripts Conventions

### Directory Layout

```
scripts/
  common.sh        # Shared functions (always sourced first)
  local.sh         # Local dev operations
  container.sh     # Container operations (Podman)
  cloud.sh         # Cloud operations (gcloud, Cloud Build)
```

### `common.sh` Pattern

Every script sources `common.sh` first:

```bash
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
```

`common.sh` provides:
- `set -euo pipefail` -- fail on errors, undefined vars, pipe failures
- Colored logging: `log_info`, `log_ok`, `log_warn`, `log_error`, `die`
- Environment loading from `.env` (if it exists)
- Default variables: `PROJECT_NAME`, `IMAGE_NAME`, `IMAGE_TAG`, `GCP_PROJECT`, `GCP_REGION`
- Helper functions: `require_cmd` (assert CLI exists), `confirm` (yes/no prompt)

### Subcommand Dispatch

Each script accepts a subcommand as its first argument:

```bash
case "${1:-}" in
  init)  init  ;;
  clean) clean ;;
  build) build ;;
  run)   run   ;;
  *)     die "Usage: $0 {init|clean|build|run}" ;;
esac
```

### Script Permissions

All scripts must be executable: `chmod +x scripts/*.sh`

## Container Files

Container build files live in `cicd/`, NOT at the project root:

```
cicd/
  Dockerfile         # Multi-stage build, tailored to project type
  .dockerignore      # Build context exclusions
```

The `scripts/container.sh` build command references `cicd/Dockerfile`:

```bash
podman build -f cicd/Dockerfile -t "${IMAGE_NAME}:${IMAGE_TAG}" .
```

The build context is the project root (`.`) so source code is accessible,
but the Dockerfile itself is kept separate in `cicd/`.

### .dockerignore

Must exclude:
- `.git`, `.gitignore`, `*.md`, `LICENSE`
- `.env`, `.env.*` (secrets must not be baked into images)
- `cicd/terraform/`, `cicd/cloudbuild*.yaml` (not needed in the image)
- Language-specific artifacts (`node_modules/`, `__pycache__/`, `target/`, etc.)

### Log Management Targets

The scaffolded Makefile includes targets for managing per-run log files:

| Target | Description |
|--------|-------------|
| `logs-list` | List recent log files (newest first, max 20) |
| `logs-last` | Display contents of the most recent log file |
| `logs-clean` | Remove all log files from `logs/` directory |

Log files are created automatically by the scaffolded scripts. Each `make`
target execution generates a timestamped log file in `logs/`:

```
logs/20260307-143022-local-build.log
logs/20260307-143155-container-run.log
logs/20260307-150000-cloud-app-deploy.log
```

These log files capture all stdout and stderr output from the command,
making it easy to review past runs and diagnose failures.

## Per-language Patterns

### Node.js/TypeScript
- **init**: `npm install`
- **build**: `npm run build`
- **run**: `npm run dev`
- **test**: `npm test`
- **lint**: `npm run lint` or `npx eslint .`
- **Dockerfile**: Multi-stage with `node:20-alpine`, `npm ci` in builder

### Go
- **init**: `go mod download`
- **build**: `go build -o bin/ ./...`
- **run**: `go run .`
- **test**: `go test ./...`
- **lint**: `golangci-lint run` or `go vet ./...`
- **Dockerfile**: Multi-stage with `golang:1.22-alpine`, `distroless` runtime

### Python
- **init**: `python3 -m venv .venv && pip install -r requirements.txt`
- **build**: `python3 -m build` (if applicable)
- **run**: `python3 -m uvicorn main:app` (or `python3 main.py`)
- **test**: `python3 -m pytest`
- **lint**: `ruff check .` or `python3 -m flake8 .`
- **Dockerfile**: Multi-stage with `python:3.12-slim`, venv copied to runtime

### Rust
- **init**: `cargo fetch`
- **build**: `cargo build --release`
- **run**: `cargo run --release` *(operator-facing run is release by
  default; #141 lesson 5. Dev profile is fine for `cargo test`, wrong
  for "operator-facing run this against prod." Add a `local-run-dev`
  target with bare `cargo run` if you need the dev profile.)*
- **test**: `cargo test`
- **lint**: `cargo clippy -- -D warnings`
- **Dockerfile**: Multi-stage with `rust:1.77-alpine`, `distroless` runtime

#### Sibling crates: distinct bin names

In a Cargo workspace with multiple crates each shipping `src/bin/<name>.rs`,
Cargo warns about colliding output filenames (e.g., both crates produce a
`target/debug/server` binary). This will become a hard error in a future
Cargo release.

The fix: set distinct bin names per crate in each `Cargo.toml`:

```toml
[[bin]]
name = "agent-mkt-historical"
path = "src/bin/server.rs"
```

The scaffold's Rust workspace template enforces this. When adding a new
sibling crate, pick a unique bin name (prefix with the crate's short
name is the convention).

### Java
- **init**: `mvn dependency:resolve` or `gradle dependencies`
- **build**: `mvn package -DskipTests` or `gradle build -x test`
- **run**: `mvn exec:java` or `gradle run`
- **test**: `mvn test` or `gradle test`
- **lint**: `mvn checkstyle:check` or `gradle check`
- **Dockerfile**: Multi-stage with Maven/Gradle builder, JRE runtime

## Anti-patterns

- **Complex logic in Makefile** -- Use scripts instead. Makefiles are hard to
  debug and have surprising whitespace rules.
- **Platform-specific commands without guards** -- Use `require_cmd` to check
  for required tools.
- **Hardcoded paths** -- Use variables derived from `PROJECT_ROOT`.
- **Secrets in scripts** -- Use `.env` files (git-ignored) or environment
  variables. Never hardcode credentials.
- **Skipping `set -euo pipefail`** -- Always fail fast. Silent failures
  cause cascading problems.

## Agent Integration

- All operational tasks go through `make` targets. If a project has no
  Makefile, offer to scaffold one first using the `scaffold` tool.
- NEVER document or invoke `bash scripts/foo.sh ...` directly — always
  go through `make foo`. The wrappers engage trap handlers + heartbeat
  / checkpoint machinery (see `scripts/common.sh`); direct invocation
  bypasses them.
- Detect the project type automatically and tailor all generated files.
- Scaffolding generates Makefile, modular scripts in `scripts/`, container
  files, Cloud Build configs, Terraform modules, the custom deployer-role
  YAML in `cicd/iam/`, the cloud-topology ADR template in
  `docs/decisions/`, the detached-orchestration section in
  `AGENTS.local.md`, and `.gitignore` (including `.orchestration/`).
- Use the `scaffold` tool directly. Do not delegate scaffolding to other agents.
