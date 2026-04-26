---
description: Scaffold Makefile, scripts, container files, Cloud Build, and Terraform for the project
agent: devops
---

$ARGUMENTS

This is a project scaffolding workflow.

1. Detect the project type (Node, Go, Python, etc.).
2. Ask the user what to scaffold:
   - **Local Dev** (Makefile + scripts + .gitignore)
   - **Container Dev** (Makefile + scripts + container files + .gitignore)
   - **CI/CD Only** (Cloud Build + Terraform + .gitignore)
   - **Full CI/CD** (Makefile + scripts + container files + Cloud Build + Terraform + .gitignore)
   - **Everything** (alias for Full CI/CD)
   - **Full CI/CD + External HTTPS LB + DNS + Multi-Env Promotion**
     (Full CI/CD plus Terraform `lb.tf` + `dns.tf` and scripts
     `config.py` + `config.toml.example` + the multi-verb cloud
     workflow `init` + `init-prod` + `infra` + `app-deploy` +
     `app-promote` + `app-undeploy` + `clean`).
3. If CI/CD is selected, confirm the user wants Terraform executed via Cloud
   Build (plan on PR, apply on merge).
4. Run the `scaffold` tool with the appropriate `components` parameter
   (or omit `components` for everything).
5. Show a summary of all files created/skipped.
6. If the user picked the LB + DNS + multi-env option, show the post-scaffold
   checklist below.
7. Follow the standard post-work protocol.

## Post-scaffold checklist (LB + DNS + multi-env)

When the user picked the full CI/CD with LB + DNS + multi-env option, walk
them through:

1. **Copy the example config:**
   ```bash
   cp config.toml.example config.toml
   ```
   `config.toml` is gitignored — never commit it.

2. **Fill in the staging / Cloud Build project (`[gcp.default]`):**
   - `project_id` — the GCP project that owns the deployer SA, the AR repo,
     and the Terraform state bucket (this is your Cloud Build project).
   - `[gcp.default.terraform].state_bucket` — pre-existing or to-be-created
     GCS bucket name for Terraform state.
   - DNS trio (only if you want the external HTTPS LB + custom domain):
     - `dns_project_id` — GCP project hosting the Cloud DNS managed zone
       (typically a SEPARATE project, owned by the DNS / platform team).
     - `dns_managed_zone` — GCP RESOURCE NAME of the existing managed zone
       (not the DNS name; e.g. `kunall-demo-altostrat-com`).
     - `dns_record_name` — FQDN with trailing dot, e.g. `app.example.com.`.
   - `domain` — same FQDN without the trailing dot, e.g. `app.example.com`.

3. **Fill in `[gcp.production].project_id`** with a SEPARATE GCP project ID
   (a different project from staging/CB). Optionally override `domain` and
   the DNS trio for the prod-specific record.

4. **Run the two-environment workflow:**
   ```bash
   # Bootstrap staging / Cloud Build project (TF state bucket, deployer SA,
   # bootstrap IAM, optional cross-project DNS grant). Run as the staging
   # project owner.
   make cloud-init

   # One-time prod bootstrap: grants projectIamAdmin on the prod project
   # to the staging-resident deployer SA, so Terraform can self-escalate
   # on subsequent cloud-infra runs. Run as the PROD project owner.
   ENVIRONMENT=production make cloud-init-prod

   # Provision prod infrastructure (Cloud Run, AR, IAM, optional LB+DNS).
   ENVIRONMENT=production make cloud-infra

   # Deploy the app to staging (build + push + Cloud Run update).
   make cloud-app-deploy

   # Promote a specific staging image to production with a semver tag.
   # IMAGE = full URI of the staging image you want to promote (use the
   #         :sha-<short_sha> tag printed by cloud-app-deploy).
   ENVIRONMENT=production VERSION=v1.0.0 \\
     IMAGE=us-central1-docker.pkg.dev/<cb-project>/<service>/<service>:sha-abc123f \\
     make cloud-app-promote
   ```
