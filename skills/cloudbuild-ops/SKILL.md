---
name: cloudbuild-ops
description: Cloud Build CI/CD patterns with Terraform-via-Cloud-Build workflows
---

## What I do

- Guide `cloudbuild.yaml` authoring and step configuration
- Document the Terraform-via-Cloud-Build pattern (plan on PR, apply on merge)
- Define the `cicd/` directory layout conventions
- Cover trigger types, substitution variables, and security practices

## When to use me

Use this skill when setting up CI/CD pipelines with Cloud Build, when
configuring Terraform to run inside Cloud Build, or when troubleshooting
build failures.

## `cicd/` Directory Layout

```
cicd/
  Dockerfile                  # Application container build
  .dockerignore               # Build context exclusions
  cloudbuild.yaml             # Main pipeline: build image + push to AR
  cloudbuild-plan.yaml        # Terraform plan (triggered by PR)
  cloudbuild-apply.yaml       # Terraform apply (triggered by merge)
  terraform/
    providers.tf              # Google provider + required version
    backend.tf                # GCS state backend
    variables.tf              # Input variables (project_id, region, etc.)
    main.tf                   # GCP resources (AR repo, Cloud Run, IAM)
    outputs.tf                # Output values (service URL, repo URL)
```

## `cloudbuild.yaml` Structure

A Cloud Build config defines a sequence of steps:

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'   # Builder image
    args: ['build', '-t', '${_IMAGE}', '.'] # Command and arguments
    dir: '.'                                 # Working directory (optional)
    env: ['KEY=VALUE']                       # Environment variables (optional)

images: ['${_IMAGE}']                        # Images to push after build

substitutions:
  _IMAGE: 'us-central1-docker.pkg.dev/${PROJECT_ID}/app/app:latest'

options:
  logging: CLOUD_LOGGING_ONLY
```

### Key concepts

| Concept | Description |
|---------|-------------|
| `steps` | Ordered list of build steps. Each runs in its own container. |
| `name` | Docker image for the step. Use `gcr.io/cloud-builders/*` or any public image. |
| `args` | Command-line arguments (the image's ENTRYPOINT receives these). |
| `dir` | Working directory relative to the source root. |
| `images` | Images to push to a registry after all steps complete. |
| `substitutions` | User-defined variables prefixed with `_`. Also `$PROJECT_ID`, `$BUILD_ID`, etc. |

### Built-in substitutions

| Variable | Description |
|----------|-------------|
| `$PROJECT_ID` | GCP project ID |
| `$BUILD_ID` | Unique build identifier |
| `$COMMIT_SHA` | Git commit SHA (when triggered by repo) |
| `$BRANCH_NAME` | Git branch name |
| `$TAG_NAME` | Git tag name |
| `$SHORT_SHA` | First 7 chars of commit SHA |

## Terraform via Cloud Build

The core pattern: **Terraform never runs locally.** Cloud Build is the
execution environment for all infrastructure changes.

### Two-pipeline Model

**Pipeline 1: Plan (PR trigger)**
- Triggered when a pull request is opened or updated
- Runs `terraform init` + `terraform plan`
- Outputs the plan for review (visible in build logs)
- Does NOT apply changes

**Pipeline 2: Apply (Merge trigger)**
- Triggered when a PR is merged to the default branch
- Runs `terraform init` + `terraform apply -auto-approve`
- Applies the reviewed changes
- Can also run `terraform destroy` via substitution override

### Configuration

```yaml
# cloudbuild-plan.yaml
steps:
  - name: 'hashicorp/terraform:1.7'
    dir: 'cicd/terraform'
    args: ['init', '-backend-config=bucket=${_TF_STATE_BUCKET}']
    env: ['TF_IN_AUTOMATION=true']

  - name: 'hashicorp/terraform:1.7'
    dir: 'cicd/terraform'
    args: ['plan', '-no-color', '-input=false']
    env:
      - 'TF_IN_AUTOMATION=true'
      - 'TF_VAR_project_id=${PROJECT_ID}'
```

### State Backend

Terraform state is stored in GCS:

```hcl
terraform {
  backend "gcs" {
    # bucket and prefix set via -backend-config flags in cloudbuild YAML
  }
}
```

The bucket name is passed as a substitution: `_TF_STATE_BUCKET`.
Convention: `${PROJECT_ID}-tfstate` with prefix matching the service name.

### Three-role topology + two-SA model (issue #141)

The scaffolded projects use a **three-role topology** (orchestration / build /
runtime) and a **two-SA model** with explicit predefined roles. Replaces the
old "two-phase IAM with TF self-escalation" framing from #116.

**Roles:**

| Role            | What it owns                                          |
|-----------------|-------------------------------------------------------|
| orchestration   | Agent SA (operator identity), custom IAM role, daily-deploy entry point |
| build           | Builder SA, Cloud Build, Artifact Registry, TF state |
| runtime         | Runtime SA, Cloud Run service, service-managed resources |

The 90% case: all three roles collapse to one project. Splitting later is
a config edit, not a refactor — bootstrap script + TF + operator commands
all work identically; only IAM grants branch local-vs-cross-project.

**Two service accounts** (NOT the default Cloud Build SA, NOT the default
Compute Engine SA):

| SA          | Lives in    | Permissions                                | Used by                                |
|-------------|-------------|--------------------------------------------|----------------------------------------|
| **agent**   | orch project| Custom role (curated YAML, 30-day expiry)  | Human/CI operator running daily deploys|
| **builder** | build project| 6 predefined functional roles + storage.admin| Cloud Build via `--service-account=...`|

**Custom role for the agent SA** (NOT predefined). Lives in
`cicd/iam/<project>-deployer-role.yaml`, diff-reviewable in git. The
30-day expiry condition on the agent → custom-role binding forces
graceful credential rotation; re-run `make admin-cloud-init` to refresh.

**Builder SA's 6 predefined roles** (scoped to what TF actually needs to
construct resources):

| Role                              | On project | Why                              |
|-----------------------------------|------------|----------------------------------|
| `roles/run.admin`                 | runtime    | Deploy Cloud Run services        |
| `roles/artifactregistry.admin`    | runtime    | Manage AR repo (existence checks)|
| `roles/iam.serviceAccountUser`    | runtime    | actAs runtime SA                 |
| `roles/iam.serviceAccountAdmin`   | runtime    | Create + manage runtime SA       |
| `roles/logging.logWriter`         | runtime    | Cloud Build log emission         |
| `roles/storage.admin`             | build      | TF state bucket + CB staging     |

**NOT granted to the builder SA** (these would defeat the agent's
least-privilege model — agent can impersonate builder via Cloud Build,
so anything granted to builder becomes part of agent's effective authority):

- `roles/resourcemanager.projectIamAdmin`
- `roles/serviceusage.serviceUsageAdmin`
- `roles/iam.serviceAccountCreator`
- `roles/compute.networkAdmin`
- `roles/compute.loadBalancerAdmin`

### TF / admin-cloud-init boundary (non-negotiable)

Per issue #141 lesson 1, **Terraform does NOT mutate project scope**.
The boundary is:

| Layer                  | Owns                                                          |
|------------------------|---------------------------------------------------------------|
| `admin-cloud-init`     | API enablement; AR repo creation; TF state bucket creation; project-wide IAM of other principals (agent SA → custom role; builder SA → predefined functional roles; agent SA → actAs on builder SA) |
| Terraform (`main.tf`)  | Resource construction: runtime SA, Cloud Run service, IAM bindings on Terraform's own resources (run.invoker, cross-project AR reader, LB/DNS) |

The pre-#141 scaffold had Terraform doing a two-phase API enable
(`bootstrap_apis` + `apis`) and self-grant chains
(`google_project_iam_member.deployer_*`). That worked but required
granting the builder SA `projectIamAdmin` + `serviceUsageAdmin`, which
defeats the agent's curated-role design. **Removed entirely in #141.**

**Pre-existing build-project resources are read via `data` sources.**
The AR repo is read into `main.tf` via
`data "google_artifact_registry_repository" "app"`. This makes the
dependency on the bootstrap step explicit at *plan* time: a missing
repo fails with a clear "data source not found" error instead of a
confusing IAM-binding error at apply time.

## Trigger Types

### Push trigger
Fires on push to a branch matching a pattern:

```bash
gcloud builds triggers create github \
  --repo-name=my-repo --repo-owner=my-org \
  --branch-pattern="^main$" \
  --build-config=cicd/cloudbuild-apply.yaml
```

### Pull request trigger
Fires on PR creation or update:

```bash
gcloud builds triggers create github \
  --repo-name=my-repo --repo-owner=my-org \
  --pull-request-pattern="^main$" \
  --build-config=cicd/cloudbuild-plan.yaml
```

### Manual trigger
Run on demand:

```bash
gcloud builds triggers run TRIGGER_ID --branch=main
```

## Security Best Practices

1. **Never put secrets in `cloudbuild.yaml`** -- Use Secret Manager:
   ```yaml
   availableSecrets:
     secretManager:
       - versionName: projects/$PROJECT_ID/secrets/my-secret/versions/latest
         env: 'MY_SECRET'
   ```

2. **Least-privilege service account** -- Only grant the roles the build needs.

3. **Pin builder image versions** -- Use `hashicorp/terraform:1.7` not
   `hashicorp/terraform:latest`.

4. **Set `TF_IN_AUTOMATION=true`** -- Suppresses interactive prompts and
   produces cleaner output.

5. **Use `-input=false`** -- Prevent Terraform from waiting for user input
   in a non-interactive environment.

6. **Review plans before apply** -- The two-pipeline model ensures a human
   reviews the plan (in PR logs) before apply runs.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Build fails with auth error | Check service account roles |
| Terraform state locked | Run `terraform force-unlock LOCK_ID` via Cloud Build |
| Image push fails | Verify Artifact Registry repo exists and SA has `artifactregistry.admin` |
| Substitution not resolved | Ensure variable starts with `_` and is declared in `substitutions` |
| Build timeout | Increase `timeout` in `options` (default: 10 minutes) |

## Reference: lessons baked in (issue #141)

Six concrete bug-class lessons from the `kunal-labs/onchain-markets` cloud
workstream (epic #44, 4 restructure passes for "deploy a Cloud Run service
in Tokyo"). All preventable from the scaffold; all now baked in:

1. **TF does not self-escalate IAM.** Project-scope concerns live in
   `admin-cloud-init`. Builder SA holds only 6 predefined functional roles.
2. **Custom YAML role + 30-day expiry for the agent SA.** Diff-reviewable;
   forces graceful credential rotation.
3. **Stepwise checkpoint invalidates on step-list-hash mismatch.** A change
   to the step list silently invalidates stale checkpoints — restart from
   step 1. Step idempotency is a contract; restart is always safe.
4. **`format=full` on identity-token metadata fetch.** See `skills/gcloud-ops`.
5. **Operator CLI conventions baked in.** Default `cargo run --release`;
   distinct bin names across sibling crates; Makefile is the operator
   interface — never invoke scripts directly.
6. **Role-aware CLI vocabulary.** `admin-cloud-init` / `cloud-preflight` /
   `cloud-infra` / `cloud-app-deploy` etc., not `init` / `cloud-init` /
   `init-prod` (which described the operation, not the role).

## Agent Integration

- Terraform runs via Cloud Build, not locally. Cloud Build is the execution
  environment for all infrastructure changes.
- Cloud Build configs and Terraform modules live in `cicd/`.
- The custom deployer role YAML lives in `cicd/iam/`.
- NEVER run `terraform apply` or `terraform destroy` without first showing
  the plan output and getting user confirmation.
- NEVER submit Cloud Build jobs that run `terraform apply` without user
  confirmation.
- ALWAYS show plan output before any apply operation.
- ALWAYS use `make <target>` instead of `bash scripts/cloud.sh ...` —
  the wrappers engage trap handlers + heartbeat/checkpoint machinery
  that catches operator shell disconnects (per issue #140).
