# Changelog

All notable changes to `lib-agents` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — three-role topology + detached orchestration (BREAKING)

Closes [#141](https://github.com/kunallimaye/lib-agents/issues/141) and
[#140](https://github.com/kunallimaye/lib-agents/issues/140).

This release is a **major-version-bump-worthy breaking change** to the
`/scaffold` Full CI/CD bundle. Existing projects scaffolded from older
bundles must re-scaffold and reconcile by hand — there is no migration
script.

### BREAKING

- **`ANTIGRAVITY-AGENTS.md` removed.** The Antigravity / Jetski workflow
  support is gone (issue [#146](https://github.com/kunallimaye/lib-agents/issues/146)).
  Any downstream user who pulled `ANTIGRAVITY-AGENTS.md` via the
  documented `curl ... -o AGENTS.md` command is broken on next install.
  No migration path: use the standard `AGENTS.md` shipped with the repo.
- **`config.toml` schema replaced.** The old `[gcp.default]` +
  `[gcp.staging]` + `[gcp.production]` environment-axis schema is GONE.
  Replaced with a **role-axis** schema: `[gcp.defaults]` (required
  catch-all) + `[gcp.orchestration]` + `[gcp.build]` + `[gcp.runtime]`.
  Environment-axis layering (e.g. `[gcp.production.runtime]`) still
  works on top.
- **`scripts/cloud.sh` verbs replaced.**
  - `init` / `init-prod` → `admin-cloud-init` (single Owner-tier
    bootstrap, cross-project-aware; no more separate "primary vs
    secondary env" code paths).
  - `infra` → `cloud-infra`.
  - `app-deploy` → `cloud-app-deploy`.
  - `app-promote` → `cloud-app-promote`.
  - `app-undeploy` → `cloud-app-undeploy`.
  - `clean` → `cloud-clean`.
  - New: `admin-cloud-destroy`, `cloud-preflight`, `cloud-status`,
    `cloud-recover`, `cloud-help`.
  - Stubs print a clear redirect on the old verbs (will be removed in
    the next major bump).
- **Makefile targets renamed.** `make cloud-init` → `make admin-cloud-init`,
  `make cloud-init-prod` → `make admin-cloud-init` (collapsed),
  `make cloud-clean` → `make cloud-clean` (unchanged), etc. See the
  generated Makefile for the full list.
- **Terraform variables replaced.** `var.project_id` / `var.region` /
  `var.cb_project` / `var.cb_service_account` are GONE. Replaced with
  the role-axis variables: `var.orchestration_project_id` /
  `var.build_project_id` / `var.runtime_project_id` (+ matching
  `_region` variables), and `var.builder_sa_email`.
- **Terraform resources removed.**
  - `google_project_service.bootstrap_apis` — API enable moves to
    `admin-cloud-init`.
  - `google_project_service.apis` — same.
  - `google_project_iam_member.deployer_run_admin` /
    `deployer_ar_admin` / `deployer_sa_user` /
    `deployer_serviceusage_admin` / `deployer_sa_creator` /
    `deployer_network_admin` / `deployer_lb_admin` — TF self-escalation
    forbidden (#141 lesson 1). Project IAM moves to `admin-cloud-init`.
  - `time_sleep.wait_for_iam` — moot without TF doing IAM.
  - `google_artifact_registry_repository.app` (resource) — now a
    `data` source instead. AR repo created by `admin-cloud-init`.
- **Builder SA's required IAM tightened.** Generated TF works with a
  builder SA that holds ONLY 6 predefined functional roles
  (`run.admin`, `artifactregistry.admin`, `iam.serviceAccountUser`,
  `iam.serviceAccountAdmin`, `logging.logWriter`, `storage.admin`).
  No `projectIamAdmin`, no `serviceUsageAdmin`. Anyone running the old
  bundle's TF must remove those broad grants from the builder SA after
  re-scaffolding.
- **Provider config in `providers.tf` replaced.** Old `google.dns` +
  `google.cb_project` aliases are GONE; new aliases are
  `google.orchestration` / `google.build` / `google.runtime` (+ a
  `google.dns` alias retained for the DNS project). When all three
  role projects collapse to one, the aliases are functionally identical.
- **The `commands/scaffold.md` menu option** "Full CI/CD + External
  HTTPS LB + DNS + Multi-Env Promotion" is renamed to "Full CI/CD +
  Three-Role Topology + LB+DNS" and the bundle behind it is the new
  shape. Old behavior is gone.
- **Rust scaffold** defaults `make local-run` to `cargo run --release`
  (was `cargo run`). Dev profile users need an explicit
  `local-run-dev` target.

### Added

- **`config.toml.example`** with role-axis schema, fully commented.
- **`.env.example`** generated alongside, documenting sensitive
  overrides (project IDs, billing accounts, emails, API keys) and the
  `ORCH_FORCE_RESTART=1` operator escape hatch.
- **`scripts/config.py`** rewritten to resolve `env > role > defaults
  > error` precedence. Same parser is the source of truth for shell
  scripts and Terraform.
- **`scripts/common.sh`** ports the stepwise orchestration helpers
  from #140 with step-list-hash checkpoint invalidation per #141
  lesson 3:
  - `run_detached_stepwise` — N idempotent steps, checkpoint after
    each, resume on re-run, restart-from-1 when step list changes.
  - `run_detached_cloudbuild` — single atomic remote job + heartbeat.
  - `heartbeat_status` / `recovery_summary` — read state for
    `cloud-status` / `cloud-recover`.
  - Tier-1 hygiene now guaranteed: `set -euo pipefail`, `die` helper,
    traps on EXIT/INT/TERM/HUP, stable `logs/<timestamp>-<action>.log`
    paths, no `|| true` swallowing failures.
- **`cicd/iam/<project>-deployer-role.yaml`** — curated 37-permission
  custom role for the agent SA. Diff-reviewable in git. Bound by
  `admin-cloud-init` with a 30-day expiry condition.
- **`docs/decisions/ADR-template-cloud-topology.md`** — template
  projects copy to `ADR-XXX-cloud-topology.md` and fill in.
- **`AGENTS.local.md`** — detached-orchestration convention section
  (appended, not overwritten — operator-owned).
- **`scaffold` tool components**: `iam`, `adr`, `agentslocal`.
  Default bundle includes all of them.
- **`/scaffold` command UX**: new "When should I run `/scaffold`?"
  section covering 5 trigger scenarios (fresh repo, lib-agents
  upgrade, incremental add, topology change, custom-role tightening).
- **Skills updates**:
  - `skills/cloudbuild-ops/SKILL.md` documents three-role topology,
    custom-role pattern, builder-SA role surface, TF / admin-cloud-init
    boundary, and the 6 lessons from #141.
  - `skills/gcloud-ops/SKILL.md` documents `format=full` identity-token
    pattern and cross-project IAM grant pattern.
  - `skills/makefile-ops/SKILL.md` codifies "Makefile = operator
    interface" as a hard rule; documents `cargo run --release`
    default; documents distinct bin names across sibling crates.
- **`.gitignore`** includes `.orchestration/` (heartbeat / checkpoint /
  recovery state).

### Removed

- TF self-escalation chain (see BREAKING).
- TF-driven API enablement (see BREAKING).
- `time_sleep.wait_for_iam` (see BREAKING).
- The pre-#141 menu wording in `commands/scaffold.md`.

### Tooling

- **`chore(ci):`** added a `shellcheck` job to the `repo-hygiene`
  workflow ([#160](https://github.com/kunallimaye/lib-agents/issues/160)).
  Scans `install.sh` and `install/lib-*.sh` at severity `warning` using
  `ludeeus/action-shellcheck@2.0.0` (tag-pinned). Existing violations
  fixed inline (SC2155, SC2207, one dead assignment); 17 cross-module
  globals and intentional single-iteration loops carry documented
  per-line suppressions. See PR for full violation-count breakdown.

### Fixed

- **`fix(install):`** refuse the `--link` + `--profile` (and
  `--link` + `--all`) combination at argument-parsing time
  ([#161](https://github.com/kunallimaye/lib-agents/issues/161)).
  Previously these combinations were silent footguns: `--link`
  installs agent.md files as symlinks back into the source repo, and
  profile-skill injection then wrote THROUGH the symlinks, corrupting
  the canonical `agents/*/agent.md` files in the lib-agents source
  tree. The installer now exits 2 with a clear error and a
  pick-one-of-these table. This is approach (b) — refuse the
  combination — from the issue; a symlink-resolution / replace-with-real
  approach (a) is deferred. The PR does not repair any
  previously-corrupted source files; it only prevents new corruption.
  A `SYMLINK HAZARD` block comment above `inject_profile_skills` in
  `install/lib-profiles.sh` documents the invariant for future
  maintainers.

### Motivating downstream failures

Both issues were driven by real production incidents in downstream
projects. Cited here so future-readers can understand the design rationale:

- **`kunal-labs/onchain-markets`** epic
  [#44](https://github.com/kunal-labs/onchain-markets/issues/44),
  PRs [#81](https://github.com/kunal-labs/onchain-markets/pull/81),
  [#86](https://github.com/kunal-labs/onchain-markets/pull/86),
  [#87](https://github.com/kunal-labs/onchain-markets/issues/87),
  [#88](https://github.com/kunal-labs/onchain-markets/pull/88),
  [#89](https://github.com/kunal-labs/onchain-markets/issues/89),
  [#90](https://github.com/kunal-labs/onchain-markets/pull/90),
  [#91](https://github.com/kunal-labs/onchain-markets/issues/91),
  [#92](https://github.com/kunal-labs/onchain-markets/pull/92) —
  origin of #141's 6 lessons. 4 restructure passes (H6 → H7 → H7.5
  → H7.6) for what was supposed to be "deploy a Cloud Run service in
  Tokyo." Each restructure was a fix for a real architectural bug
  that should have been caught by the scaffold from day one.
- **`kunal-labs/dex-arb-agent`**
  [#136](https://github.com/kunal-labs/dex-arb-agent/issues/136) —
  origin of #140's Tier-1 hygiene + detached-orchestration module.
  Operator-driven `make local-cloud-deploy` died on parent-shell
  disconnect; remote Cloud Build ran to SUCCESS but the local
  orchestrator that was supposed to drive subsequent capture-window +
  teardown phases was gone. Cloud Run kept burning ~43 minutes of
  Tokyo compute past intended teardown.

### Smoke testing

The PR includes a dry-run smoke test (scaffold into a pilot workspace
+ `terraform fmt` + `terraform validate` + `shellcheck` + `python -m
py_compile` + `make -n` on every `cloud-*` and `admin-*` target). The
results are in the PR body.

**What still needs human verification on real GCP before tagging this
release:** end-to-end `make admin-cloud-init` → `make cloud-preflight`
→ `make cloud-infra` → `make cloud-app-deploy` → curl against a live
URL. Plus a real-GCP test of the cross-project IAM branching in
`_grant_role` (the dry-run smoke test exercises the local-project path
only).
