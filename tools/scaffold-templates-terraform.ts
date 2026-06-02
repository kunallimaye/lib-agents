// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// Terraform generators.

// ─── Terraform Generation ────────────────────────────────────────────

export function generateTfProviders(): string {
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
  }
}

# ─── Three-role provider aliases (issue #141) ────────────────────────
#
# Each role gets a named provider alias. When all three roles resolve to
# the same project (the 90% case), the aliases are functionally
# identical — zero overhead. Splitting one or more roles later is a
# config edit (TF_VAR_<role>_project_id), not a refactor.
#
# Resources opt into the alias for the role whose project owns them:
#
#   - Runtime resources (google_service_account.runtime,
#     google_cloud_run_v2_service.app, LB/DNS in runtime project,
#     run.invoker bindings) use provider = google.runtime.
#   - Cross-project reads of build-project resources (AR repo)
#     use provider = google.build.
#   - Orchestration-project resources (if any: future agent SA
#     management from TF, etc.) use provider = google.orchestration.
#
# Default (un-aliased) google provider points at the runtime project —
# matches the common case where most resources live there.

provider "google" {
  project = var.runtime_project_id
  region  = var.runtime_region
}

provider "google-beta" {
  project = var.runtime_project_id
  region  = var.runtime_region
}

provider "google" {
  alias   = "orchestration"
  project = var.orchestration_project_id
  region  = var.orchestration_region
}

provider "google" {
  alias   = "build"
  project = var.build_project_id
  region  = var.build_region
}

provider "google" {
  alias   = "runtime"
  project = var.runtime_project_id
  region  = var.runtime_region
}

# DNS provider alias — scoped to the (separate) DNS project that owns
# the managed zone. Used only by resources in dns.tf when the LB+DNS
# stack is enabled. Safe to leave configured with an empty project_id
# when disabled — no resources reference it in that case.
provider "google" {
  alias   = "dns"
  project = var.dns_project_id
}
`
}

export function generateTfBackend(): string {
  return `# State is stored in GCS. Backend config values are passed via
# Cloud Build substitutions (-backend-config flags).
terraform {
  backend "gcs" {
    # bucket and prefix are set via -backend-config in cloudbuild YAML
  }
}
`
}

export function generateTfVariables(): string {
  return `# ─── Three-role topology (issue #141) ────────────────────────────────
# Each role's project + region is a separate variable. When all three
# resolve to the same value, the role split is invisible at the TF level
# (the provider aliases become functional duplicates). Splitting later
# is just a TF_VAR_<role>_project_id change.

variable "orchestration_project_id" {
  description = "Orchestration project — where the agent SA lives (operator identity)."
  type        = string
}

variable "orchestration_region" {
  description = "Region for orchestration-project resources (rare; provided for symmetry)."
  type        = string
  default     = "us-central1"
}

variable "build_project_id" {
  description = "Build project — hosts the builder SA, Cloud Build, Artifact Registry, TF state bucket."
  type        = string
}

variable "build_region" {
  description = "Region for build-project resources (AR repo, TF state bucket)."
  type        = string
  default     = "us-central1"
}

variable "runtime_project_id" {
  description = "Runtime project — hosts the runtime SA and Cloud Run service. Also the default provider's project."
  type        = string
}

variable "runtime_region" {
  description = "Region for runtime-project resources (Cloud Run, LB/DNS)."
  type        = string
  default     = "us-central1"
}

# ─── Service config ──────────────────────────────────────────────────

variable "service_name" {
  description = "Name of the Cloud Run service and related resources."
  type        = string
  default     = "app"
}

variable "image" {
  description = "Container image to deploy. When empty (or the __placeholder__ sentinel), Cloud Run uses the upstream hello-world image until cloud-app-deploy is run."
  type        = string
  default     = ""
}

variable "domain" {
  description = "Custom domain for the external HTTPS LB. Leave empty to skip the LB+DNS stack."
  type        = string
  default     = ""
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances."
  type        = number
  default     = 3
}

variable "ingress" {
  description = "Cloud Run ingress mode. 'all' allows public *.run.app traffic. 'internal-and-cloud-load-balancing' locks ingress to the external HTTPS LB / internal VPC sources."
  type        = string
  default     = "all"
}

# ─── Service accounts ────────────────────────────────────────────────

variable "builder_sa_email" {
  description = "Builder SA email (Cloud Build identity that runs this Terraform). Created by admin-cloud-init. Referenced for cross-project AR reader binding."
  type        = string
}

variable "runtime_sa_name" {
  description = "Short name for the Cloud Run runtime service account. Created by Terraform in the runtime project."
  type        = string
  default     = "app-runtime"
}

variable "ar_repo" {
  description = "Artifact Registry repository ID in the build project (created by admin-cloud-init; read by TF via data source)."
  type        = string
  default     = "app"
}

# ─── DNS / LB stack (opt-in) ─────────────────────────────────────────

variable "dns_project_id" {
  description = "GCP project ID hosting the Cloud DNS managed zone (separate per env). Empty disables LB+DNS stack."
  type        = string
  default     = ""
}

variable "dns_managed_zone" {
  description = "GCP resource name (not DNS name) of the existing managed zone, e.g. 'kunall-demo-altostrat-com'."
  type        = string
  default     = ""
}

variable "dns_record_name" {
  description = "FQDN with trailing dot for the A record, e.g. 'app.example.com.'."
  type        = string
  default     = ""
}
`
}

export function generateTfMain(): string {
  return `# ─── Resource construction only (issue #141 lesson 1) ────────────────
#
# This Terraform NEVER does any of the following:
#
#   * Enable APIs (google_project_service).  --> admin-cloud-init does this.
#   * Grant project-wide IAM to the builder SA.  --> admin-cloud-init does this.
#   * Create the Artifact Registry repo.  --> admin-cloud-init does this.
#   * Create the Terraform state bucket.  --> admin-cloud-init does this.
#
# Why: doing any of those above requires the builder SA to hold
# \`projectIamAdmin\` and \`serviceUsageAdmin\` — which defeats the
# agent's least-privilege custom-role model. The agent can impersonate
# the builder via Cloud Build, so anything granted to the builder
# becomes part of the agent's effective authority.
#
# Generated TF works with a builder SA that holds ONLY the 6 predefined
# functional roles (see scripts/cloud.sh::_step_grant_builder_roles).
#
# Pre-existing build-project resources (AR repo) are read via \`data\`
# sources. This makes the dependency on admin-cloud-init explicit at
# PLAN time: a missing repo fails with a clear "data source not found"
# error, instead of a confusing IAM error at apply time.

# ─── Pre-existing AR repo (read-only) ────────────────────────────────
#
# Created by admin-cloud-init in the build project. Referenced by:
#   - The cross-project runtime-SA reader binding below.
#   - LB/DNS outputs (image URI computation).

data "google_artifact_registry_repository" "app" {
  provider      = google.build
  project       = var.build_project_id
  location      = var.build_region
  repository_id = var.ar_repo
}

# ─── Runtime SA: Cloud Run application identity ─────────────────────
#
# Created in the runtime project. This IS owned by Terraform — it's an
# application-identity resource, not a deploy-plane resource.

resource "google_service_account" "runtime" {
  provider     = google.runtime
  account_id   = var.runtime_sa_name
  display_name = "\${var.service_name} Cloud Run Runtime"
  project      = var.runtime_project_id
}

# ─── Cloud Run Service ───────────────────────────────────────────────

resource "google_cloud_run_v2_service" "app" {
  provider = google.runtime
  project  = var.runtime_project_id
  name     = var.service_name
  location = var.runtime_region
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
      # The \`__placeholder__\` sentinel is passed by \`cloud.sh cloud-app-undeploy\`
      # to revert the service to the upstream hello-world image without
      # tearing down the Cloud Run resource. We treat it (and the empty
      # string, for safety) the same as "no image specified".
      image = (var.image == "" || var.image == "__placeholder__") ? "us-docker.pkg.dev/cloudrun/container/hello:latest" : var.image

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
}

# ─── IAM: Allow unauthenticated access (public service) ─────────────
# Bound on Terraform's own resource (the Cloud Run service), not on the
# project. Remove this block if the service should require authentication.

resource "google_cloud_run_v2_service_iam_member" "public" {
  provider = google.runtime
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Cross-project AR access (when runtime != build project) ────────
#
# When the runtime project differs from the build project (production
# tenancy pattern), the runtime SA needs read access to the build
# project's AR repo to pull images. Bound on the AR repo (Terraform's
# resource visibility via the data source), not on the project.
#
# When runtime == build, the binding is skipped — runtime SA already has
# implicit access by virtue of living in the same project as the repo.

locals {
  cross_project_ar = var.runtime_project_id != var.build_project_id
}

resource "google_artifact_registry_repository_iam_member" "runtime_ar_reader" {
  count      = local.cross_project_ar ? 1 : 0
  provider   = google.build
  project    = var.build_project_id
  location   = var.build_region
  repository = data.google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:\${google_service_account.runtime.email}"
}
`
}

export function generateTfOutputs(): string {
  return `output "service_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.app.uri
}

output "runtime_sa_email" {
  description = "Runtime SA email (Cloud Run app identity)."
  value       = google_service_account.runtime.email
}

output "artifact_registry_repo" {
  description = "Artifact Registry repository URL (in the build project)."
  value       = "\${var.build_region}-docker.pkg.dev/\${var.build_project_id}/\${data.google_artifact_registry_repository.app.repository_id}"
}

output "topology" {
  description = "Resolved three-role topology — useful for cloud-help output."
  value = {
    orchestration = var.orchestration_project_id
    build         = var.build_project_id
    runtime       = var.runtime_project_id
  }
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

export function generateTfLb(): string {
  return `# ─── External HTTPS Load Balancer in front of Cloud Run ──────────────
#
# All resources here live in the RUNTIME project (var.runtime_project_id)
# and use provider = google.runtime. They're gated by local.enable_lb.
#
# To disable the LB+DNS stack, leave the four gating variables empty
# (var.domain, var.dns_project_id, var.dns_managed_zone, var.dns_record_name).
#
# To force traffic through the LB only, set var.ingress to
# "internal-and-cloud-load-balancing" — then direct *.run.app hits return
# 403 and the LB becomes the only public entry point.

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
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-lb-ip"
  project  = var.runtime_project_id
}

# 2. Serverless NEG → Cloud Run. The NEG itself is free.
resource "google_compute_region_network_endpoint_group" "cloud_run_neg" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.runtime_region
  project               = var.runtime_project_id

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }
}

# 3. Backend service. No health check needed for serverless NEGs.
resource "google_compute_backend_service" "app" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-backend"
  project               = var.runtime_project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run_neg[0].id
  }
}

# 4. URL map for HTTPS traffic — routes everything to the backend.
resource "google_compute_url_map" "https" {
  count           = local.enable_lb ? 1 : 0
  provider        = google.runtime
  name            = "\${var.service_name}-https"
  project         = var.runtime_project_id
  default_service = google_compute_backend_service.app[0].id
}

# 5. Google-managed SSL cert (classic). Provisioning is asynchronous.
resource "google_compute_managed_ssl_certificate" "app" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-cert"
  project  = var.runtime_project_id

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# 6. Target HTTPS proxy.
resource "google_compute_target_https_proxy" "app" {
  count            = local.enable_lb ? 1 : 0
  provider         = google.runtime
  name             = "\${var.service_name}-https-proxy"
  project          = var.runtime_project_id
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
}

# 7. Forwarding rule (443) — binds the reserved IP to the HTTPS proxy.
resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-https-fr"
  project               = var.runtime_project_id
  target                = google_compute_target_https_proxy.app[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# 8. URL map that 301-redirects all HTTP traffic to HTTPS.
resource "google_compute_url_map" "http_redirect" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-http-redirect"
  project  = var.runtime_project_id

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

# 9. Target HTTP proxy for the redirect URL map.
resource "google_compute_target_http_proxy" "app" {
  count    = local.enable_lb ? 1 : 0
  provider = google.runtime
  name     = "\${var.service_name}-http-proxy"
  project  = var.runtime_project_id
  url_map  = google_compute_url_map.http_redirect[0].id
}

# 10. Forwarding rule (80) — same reserved IP, different port.
resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.enable_lb ? 1 : 0
  provider              = google.runtime
  name                  = "\${var.service_name}-http-fr"
  project               = var.runtime_project_id
  target                = google_compute_target_http_proxy.app[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
`
}

export function generateTfDns(): string {
  return `# ─── DNS A record (in separate DNS project) ──────────────────────────
#
# Writes a single A record into a pre-existing managed zone owned by a
# different GCP project (var.dns_project_id). The builder SA must hold
# roles/dns.admin on that project — granted by admin-cloud-init.
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

