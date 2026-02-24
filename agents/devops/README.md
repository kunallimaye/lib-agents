# devops agent

DevOps operations agent that enforces disciplined, issue-driven workflows. Every task must link to a GitHub issue and run on a dedicated branch. Scaffolds Makefile-driven projects with modular scripts, container files, Cloud Build CI/CD, and Terraform infrastructure.

## Prerequisites

- [OpenCode](https://opencode.ai)
- [Bun](https://bun.sh) runtime
- [`gh` CLI](https://cli.github.com) (authenticated)
- [Podman](https://podman.io) for container operations
- [gcloud CLI](https://cloud.google.com/sdk/gcloud) for Google Cloud and Cloud Build operations
- [Terraform](https://www.terraform.io) or [OpenTofu](https://opentofu.org) for local infrastructure (optional -- CI/CD runs Terraform via Cloud Build)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/kunallimaye/lib-agents/main/install.sh | bash -s -- devops
```

This automatically installs dependencies (`git-ops`, `docs`).

## Pre-flight Protocol

Before any work begins, the agent enforces three checks:

1. **Linked Issue** -- A valid GitHub issue must exist. The agent asks for one if not provided.
2. **Clean Tree** -- No uncommitted changes. The agent offers to stash or commit if dirty.
3. **Dedicated Branch** -- Creates `<type>/<issue>-<slug>` from the default branch.

All three must pass before work proceeds.

## Makefile-Driven Operations

All operational tasks go through Makefile targets. The Makefile is a thin wrapper -- each target calls a script in `scripts/`.

| Domain | Targets | Script |
|--------|---------|--------|
| Local dev | `local-init`, `local-clean`, `local-build`, `local-run` | `scripts/local.sh` |
| Container dev | `container-init`, `container-clean`, `container-build`, `container-run` | `scripts/container.sh` |
| Cloud runtime | `cloud-init`, `cloud-build`, `cloud-deploy`, `cloud-clean` | `scripts/cloud.sh` |

### Scaffolded Project Structure

```
Makefile                          # Thin wrapper calling scripts/
scripts/
  common.sh                       # Shared: logging, error handling, env loading
  local.sh                        # Local dev operations
  container.sh                    # Container build/run via Podman
  cloud.sh                        # Cloud operations via gcloud/Cloud Build
cicd/
  Dockerfile                      # Multi-stage container build
  .dockerignore                   # Build context exclusions
  cloudbuild.yaml                 # Main Cloud Build pipeline
  cloudbuild-plan.yaml            # Terraform plan (PR trigger)
  cloudbuild-apply.yaml           # Terraform apply (merge trigger)
  terraform/
    main.tf                       # GCP resources (Artifact Registry, Cloud Run, IAM)
    variables.tf                  # Input variables
    outputs.tf                    # Output values
    backend.tf                    # GCS state backend
    providers.tf                  # Google provider config
```

## Tools

| Tool | Exports | Description |
|------|---------|-------------|
| `devops-preflight` | `preflight`, `validate_tests` | Pre-flight checks and test validation |
| `scaffold` | `scaffold` | Project scaffolding (with optional `components` parameter) |
| `cloudbuild` | `submit`, `list_builds`, `log`, `triggers_list`, `triggers_run`, `cancel` | Cloud Build management |
| `podman` | `build`, `run_container`, `ps`, `images`, `logs`, `stop`, `rm`, `inspect`, `exec` | Container management |
| `terraform` | `init`, `validate`, `fmt`, `plan`, `apply`, `destroy`, `state_list`, `state_show`, `output`, `workspace_list`, `workspace_select` | Infrastructure as code |
| `gcloud` | `auth_status`, `project_info`, `compute_list`, `gke_clusters`, `run_services`, `logs_read`, `iam_roles`, `config_list`, `services_list` | Google Cloud operations |
| `troubleshoot` | `check_ports`, `check_dns`, `check_connectivity`, `system_info`, `process_list`, `disk_usage`, `container_health` | System diagnostics |
| `branch-cleanup` | `list_stale`, `prune` | Stale branch cleanup |

## Commands

| Command | Description |
|---------|-------------|
| `/devops` | Main entry point -- runs pre-flight then handles the task |
| `/scaffold` | Scaffold Makefile, scripts, container files, Cloud Build, Terraform |
| `/deploy` | Build and deploy containers or infrastructure (Makefile-aware) |
| `/infra` | Manage Terraform and GCP infrastructure |
| `/cleanup` | List and prune stale merged branches |

## Skills

| Skill | Description |
|-------|-------------|
| `devops-workflow` | Issue-driven workflow lifecycle guide |
| `makefile-ops` | Makefile + modular scripts conventions |
| `container-ops` | Podman best practices and patterns |
| `cloudbuild-ops` | Cloud Build CI/CD + Terraform-via-Cloud-Build patterns |
| `gcloud-ops` | GCP operations and IAM best practices |

## Dependencies

- `git-ops` -- GitHub operations (issues, commits, PRs, reviews)
- `docs` -- README maintenance and documentation

## Safety

- `terraform apply` and `terraform destroy` require explicit `confirm=true`
- Cloud Build submissions for `terraform apply` require user confirmation
- Container deletion requires user confirmation
- IAM policy changes show diffs before applying
- Destructive bash commands are denied by the permission allowlist
- `.gitignore` is always kept up to date when scaffolding
