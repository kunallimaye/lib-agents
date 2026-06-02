---
description: Scaffold Makefile, scripts, container files, Cloud Build, Terraform, IAM, and docs for the project
agent: devops
---

$ARGUMENTS

This is a project scaffolding workflow.

1. Detect the project type (Node, Go, Python, Rust, Java, generic).
2. Ask the user what to scaffold:
   - **Local Dev** (Makefile + scripts + .gitignore)
   - **Container Dev** (Makefile + scripts + container files + .gitignore)
   - **CI/CD Only** (Cloud Build + Terraform + .gitignore)
   - **Full CI/CD + Three-Role Topology + LB+DNS** *(default; recommended)*
     The complete bundle:
     - Makefile (operator interface — every script wrapped)
     - `scripts/common.sh` with Tier-1 hygiene (traps, stable log paths,
       exit-code discipline) and Tier-2 detached-orchestration helpers
       (heartbeat / checkpoint / recovery), per issue #140.
     - `scripts/local.sh` + `scripts/container.sh` + `scripts/cloud.sh`
       with the role-aware vocabulary: `admin-cloud-init`,
       `admin-cloud-destroy`, `cloud-preflight`, `cloud-infra`,
       `cloud-app-deploy`, `cloud-app-promote`, `cloud-app-undeploy`,
       `cloud-clean`, `cloud-status`, `cloud-recover`, `cloud-help`.
     - `scripts/config.py` resolving `env > role > defaults > error`.
     - `config.toml.example` + `.env.example` with role-axis schema
       (orchestration / build / runtime + per-env overrides).
     - Container files (`cicd/Dockerfile`, `cicd/.dockerignore`).
     - Cloud Build configs (`cicd/cloudbuild*.yaml`).
     - Terraform (`cicd/terraform/`) — RESOURCE CONSTRUCTION ONLY.
       NO API enable, NO project IAM self-escalation. AR repo is a
       `data` source. Three provider aliases. Works with a builder SA
       that holds only 6 predefined functional roles.
     - Custom deployer-role YAML (`cicd/iam/<project>-deployer-role.yaml`).
       37-permission curated list, bound to the agent SA with 30-day
       expiry by `admin-cloud-init`. Per issue #141 lesson 2.
     - Cloud-topology ADR template
       (`docs/decisions/ADR-template-cloud-topology.md`) — copy and
       fill in to document the project's topology choice.
     - `AGENTS.local.md` detached-orchestration convention section.
     - `.gitignore` (includes `.orchestration/` for heartbeat files).
3. **Breaking change notice**: The pre-#141 menu option "Full CI/CD +
   External HTTPS LB + DNS + Multi-Env Promotion" is GONE. Existing
   projects scaffolded from the older bundle must re-scaffold and
   reconcile by hand — there is no migration script. See the lib-agents
   CHANGELOG for the full break list.
4. Run the `scaffold` tool with the appropriate `components` parameter
   (or omit `components` for everything).
5. Show a summary of all files created/skipped/appended.
6. If the user picked the Full CI/CD bundle, walk through the post-scaffold
   checklist below.
7. Follow the standard post-work protocol.

## When should I run `/scaffold`?

Five trigger scenarios:

1. **First time in a fresh repo.** Obvious, but state it: this is the
   common case. Default to the Full CI/CD bundle unless the project is
   strictly local-dev or container-only.

2. **After upgrading `lib-agents`.** When generator templates change
   (new fields, new files, new safety machinery), re-run `/scaffold`
   with `force=true` to refresh the generated files. **Always back up
   any local edits to scaffold-generated files first** (Makefile,
   scripts/, cicd/) — `force=true` overwrites silently. Diff before
   committing so you can re-apply your local changes on top.

3. **Adding components incrementally.** Started with Local Dev, now
   adding Container Dev or CI/CD? Use the `components` parameter to
   target only the new bits:
   - `components: ["container"]` — just Dockerfile + .dockerignore
   - `components: ["cloudbuild", "terraform", "iam"]` — just CI/CD
   - `components: ["agentslocal"]` — append detached-orchestration
     section to `AGENTS.local.md`

4. **After a topology change.** Splitting build from runtime projects,
   or moving the agent SA to a separate orchestration project? Re-scaffold
   `scripts/cloud.sh`, `config.toml.example`, and `cicd/terraform/`
   (target `components: ["scripts", "terraform"]`). Hand-merge any
   project-specific edits.

5. **After custom-role tightening.** If you're trimming permissions in
   `cicd/iam/<project>-deployer-role.yaml`, re-scaffold just the IAM
   component (`components: ["iam"]`) to get the latest curated
   defaults as a baseline. Diff against your tightened version.

**NEVER** for files you've hand-edited without backing them up first.
`force=false` (the default) skips collisions, but `force=true` will
overwrite silently. If in doubt, run with `force=false` and inspect
the SKIP list to find what would have been overwritten.

## Post-scaffold checklist (Full CI/CD bundle)

1. **Copy the example config files:**
   ```bash
   cp config.toml.example config.toml
   cp .env.example .env
   ```
   Both `config.toml` and `.env` are gitignored — never commit them.

2. **Fill in `config.toml`:**
   - At minimum, set `[gcp.defaults].project` to your GCP project ID.
     This is the 90% case — all three roles (orchestration, build,
     runtime) collapse to one project. Fine for personal/hobby use.
   - Set `[gcp.build].state_bucket` to a TF state bucket name (will be
     created by `make admin-cloud-init` if it doesn't exist).
   - For a split topology (e.g. production runtime in a separate
     project), uncomment and fill `[gcp.production.runtime].project`.
   - For LB+DNS, fill in `[gcp.runtime].domain` + the DNS trio
     (`dns_project_id`, `dns_managed_zone`, `dns_record_name`).

3. **Optionally fill `.env`** with sensitive overrides (project IDs you
   don't want in committed `config.toml`, API keys, per-operator
   agent SA name).

4. **Document the topology decision.** Copy
   `docs/decisions/ADR-template-cloud-topology.md` to
   `docs/decisions/ADR-XXX-cloud-topology.md` (next ADR number),
   fill in the chosen topology + rationale, and commit it. Future
   you will thank present you.

5. **Run the lifecycle:**
   ```bash
   # Verify the resolved three-role topology before doing anything.
   make cloud-help

   # Owner-tier 8-step bootstrap (run as Owner once per project).
   # Cross-project-aware: each grant branches on local-vs-cross-project.
   # Stepwise + checkpointed: re-run resumes; ORCH_FORCE_RESTART=1
   # invalidates the checkpoint and restarts from step 1.
   make admin-cloud-init

   # Read-only audit. Per-role-aware messaging so multi-project
   # topology debugs cleanly.
   make cloud-preflight

   # Provision runtime infrastructure (Cloud Run, runtime SA, LB/DNS).
   # TF apply runs via Cloud Build using the builder SA.
   make cloud-infra

   # Build container image + swap Cloud Run revision (current ENVIRONMENT).
   make cloud-app-deploy

   # Check status of long-running operations (heartbeat-aware).
   make cloud-status

   # If something went wrong during a detached run, read the recovery
   # hints written by the EXIT/HUP trap handler.
   make cloud-recover

   # Promote a specific image to a non-staging runtime with a semver tag.
   # IMAGE = full URI of the staging image (use the :sha-<sha> tag
   #         printed by cloud-app-deploy).
   ENVIRONMENT=production VERSION=v1.0.0 \
     IMAGE=us-central1-docker.pkg.dev/<build-project>/<repo>/<svc>:sha-abc123f \
     make cloud-app-promote
   ```

6. **Operator escape hatch:** `ORCH_FORCE_RESTART=1` on any
   `admin-cloud-*` or `cloud-*` target invalidates the stepwise
   checkpoint and restarts from step 1. Always safe (step idempotency
   is a contract). Use when the step list has changed since your last
   partial run, or when the checkpoint state is suspect.
