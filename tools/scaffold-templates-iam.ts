// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// IAM custom-role YAML generator.

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

export function generateDeployerRoleYaml(projectName: string): string {
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

