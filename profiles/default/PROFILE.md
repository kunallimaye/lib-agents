---
name: default
description: Standard operational setup — DevOps, Git, docs, ideation, pilot, scribe, and orchestrator agents with core operational skills

agents:
  - git-ops
  - devops
  - docs
  - ideate
  - pilot
  - scribe
  - orchestrator

agent_skills:
  build: []
  devops:
    - devops-workflow
    - makefile-ops
    - container-ops
    - cloudbuild-ops
    - gcloud-ops
    - troubleshooting
  git-ops:
    - git-pr-workflow
    - git-release
  docs:
    - readme-conventions
  pilot: []
  scribe: []
  orchestrator: []
---

# Default Profile

Standard operational setup with 7 agents and 8 operational skills. This is the
baseline configuration suitable for any project that uses the lib-agents DevOps
workflow.

## Included Agents

| Agent | Purpose |
|-------|---------|
| `git-ops` | Git and GitHub operations |
| `devops` | DevOps workflows, containers, infrastructure |
| `docs` | README and documentation maintenance |
| `ideate` | Brainstorming and creative ideation |
| `pilot` | Isolated experimentation and hypothesis testing |
| `scribe` | Codebase-grounded technical writing (blog posts, deep-dives, explainers) |
| `orchestrator` | Plan-then-delegate workflow agent (delegates execution to other agents via Task; no direct edits) |

## Included Skills

| Skill | Agent | Description |
|-------|-------|-------------|
| `devops-workflow` | devops | Issue-driven DevOps workflow |
| `makefile-ops` | devops | Makefile and modular scripts |
| `container-ops` | devops | Podman container operations |
| `cloudbuild-ops` | devops | Cloud Build CI/CD patterns |
| `gcloud-ops` | devops | Google Cloud Platform operations |
| `troubleshooting` | devops | Log/metric/system troubleshooting |
| `git-pr-workflow` | git-ops | PR creation and review |
| `git-release` | git-ops | Release management |
| `readme-conventions` | docs | README best practices |
