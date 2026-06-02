// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// Docs / misc-text generators: config.py, config.toml example,
// .env.example, ADR template, AGENTS.local boilerplate, .gitignore entries.

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

// ─── Config Files Generation ────────────────────────────────────────

export function generateConfigPy(): string {
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

export function generateConfigTomlExample(): string {
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

export function generateEnvExample(): string {
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


// ─── ADR template for per-project cloud topology ────────────────────
//
// Generated as docs/decisions/ADR-template-cloud-topology.md. Projects
// forking the scaffold copy this to ADR-XXX-cloud-topology.md and fill
// it in. Format borrowed from onchain-markets/docs/decisions/ADR-017;
// content is intentionally generic.

export function generateAdrTemplate(): string {
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

export function generateAgentsLocalSection(): string {
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

export function gitignoreEntries(pt: ProjectType): string[] {
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

