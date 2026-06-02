// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// Cloud Build YAML generators.

// ─── Cloud Build Generation ─────────────────────────────────────────

export function generateCloudbuildYaml(): string {
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
  # Note: _SHORT_SHA has no default. Cloud Build auto-populates \$SHORT_SHA
  # for trigger-driven builds; for manual \`gcloud builds submit\`, the
  # caller MUST pass \`--substitutions=_SHORT_SHA=<sha>\` (which
  # scripts/cloud.sh::app_deploy does). Forcing a missing-substitution
  # error here is preferable to silently tagging images :sha-unknown
  # and overwriting one another across builds.

options:
  logging: CLOUD_LOGGING_ONLY
`
}

export function _tfEnvBlock(): string {
  // Shared TF_VAR_* env block for both plan and apply pipelines.
  // Three-role topology: each role's project + region is passed
  // through. When all three resolve to the same value, the provider
  // aliases become functional duplicates (zero overhead).
  return `      - 'TF_VAR_orchestration_project_id=\${_ORCH_PROJECT_ID}'
      - 'TF_VAR_orchestration_region=\${_REGION}'
      - 'TF_VAR_build_project_id=\${_BUILD_PROJECT_ID}'
      - 'TF_VAR_build_region=\${_REGION}'
      - 'TF_VAR_runtime_project_id=\${_RUNTIME_PROJECT_ID}'
      - 'TF_VAR_runtime_region=\${_REGION}'
      - 'TF_VAR_service_name=\${_SERVICE_NAME}'
      - 'TF_VAR_image=\${_IMAGE}'
      - 'TF_VAR_domain=\${_DOMAIN}'
      - 'TF_VAR_min_instances=\${_MIN_INSTANCES}'
      - 'TF_VAR_max_instances=\${_MAX_INSTANCES}'
      - 'TF_VAR_builder_sa_email=\${_BUILDER_SA_EMAIL}'
      - 'TF_VAR_runtime_sa_name=\${_RUNTIME_SA_NAME}'
      - 'TF_VAR_ar_repo=\${_SERVICE_NAME}'
      - 'TF_VAR_dns_project_id=\${_DNS_PROJECT_ID}'
      - 'TF_VAR_dns_managed_zone=\${_DNS_MANAGED_ZONE}'
      - 'TF_VAR_dns_record_name=\${_DNS_RECORD_NAME}'
      - 'TF_VAR_ingress=\${_INGRESS}'`
}

export function _tfSubstitutionsBlock(defaultAction: string): string {
  return `  _TF_ACTION: '${defaultAction}'
  _TF_STATE_BUCKET: ''
  _TF_STATE_PREFIX: 'app'
  _REGION: 'us-central1'
  _SERVICE_NAME: 'app'
  _IMAGE: ''
  _DOMAIN: ''
  _MIN_INSTANCES: '0'
  _MAX_INSTANCES: '3'
  _BUILDER_SA_EMAIL: ''
  _RUNTIME_SA_NAME: 'app-runtime'
  _DNS_PROJECT_ID: ''
  _DNS_MANAGED_ZONE: ''
  _DNS_RECORD_NAME: ''
  _ORCH_PROJECT_ID: ''
  _BUILD_PROJECT_ID: ''
  _RUNTIME_PROJECT_ID: ''
  _INGRESS: 'all'`
}

export function generateCloudbuildPlanYaml(): string {
  return `# Terraform plan pipeline (three-role topology, #141)
# Triggered by: pull request events
# Runs terraform init + plan and outputs the plan for review.
# Builder SA runs in build project; provisions runtime-project resources.
steps:
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
${_tfEnvBlock()}

substitutions:
${_tfSubstitutionsBlock('plan')}

options:
  logging: CLOUD_LOGGING_ONLY
`
}

export function generateCloudbuildApplyYaml(): string {
  return `# Terraform apply pipeline (three-role topology, #141)
# Triggered by: merge to main branch.
# Runs terraform init + apply (or destroy) with auto-approve.
# Builder SA runs in build project; provisions runtime-project resources.
steps:
  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - 'init'
      - '-backend-config=bucket=\${_TF_STATE_BUCKET}'
      - '-backend-config=prefix=\${_TF_STATE_PREFIX}'
    env:
      - 'TF_IN_AUTOMATION=true'

  - name: 'hashicorp/terraform:1.14'
    dir: 'cicd/terraform'
    args:
      - '\${_TF_ACTION}'
      - '-auto-approve'
      - '-no-color'
      - '-input=false'
    env:
      - 'TF_IN_AUTOMATION=true'
${_tfEnvBlock()}

substitutions:
${_tfSubstitutionsBlock('apply')}

options:
  logging: CLOUD_LOGGING_ONLY
`
}

