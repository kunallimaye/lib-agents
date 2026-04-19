---
description: Scaffold Makefile, scripts, container files, Cloud Build, Terraform, and multi-env config for the project
agent: devops
---

$ARGUMENTS

This is a project scaffolding workflow.

1. Detect the project type (Node, Go, Python, etc.).
2. Ask the user what to scaffold:
   - **Everything** (config + Makefile + scripts + container files + Cloud Build + Terraform + .gitignore)
   - **Local dev only** (Makefile + scripts + .gitignore)
   - **Container dev** (Makefile + scripts + container files + .gitignore)
   - **Full CI/CD** (all of the above + multi-env config.toml + Cloud Build + Terraform + custom SAs)
3. If CI/CD is selected, explain the architecture:
   - Multi-environment: `config.toml` with staging + production sections
   - Staging is the single Cloud Build deployment plane (prod has no CB)
   - Custom deployer SA (created by `make cloud-init`) and runtime SA (created by Terraform)
   - Images tagged with `:latest` + `:sha-<commit>`, promoted to prod via `make cloud-promote`
4. Run the `scaffold` tool with the appropriate `components` parameter
   (or omit `components` for everything).
5. Show a summary of all files created/skipped.
6. Remind the user to:
   - Copy `config.toml.example` to `config.toml` and fill in project/GCP values
   - Run `make cloud-init` to bootstrap the deployer SA (Phase 1)
   - Run `make cloud-deploy` to deploy via Terraform (Phase 2 grants functional roles)
7. Follow the standard post-work protocol.
