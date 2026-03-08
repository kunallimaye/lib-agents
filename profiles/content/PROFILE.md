---
name: content
description: Content creation — codebase-grounded technical writing with code-focused analysis

agents:
  - git-ops
  - devops
  - docs
  - ideate
  - pilot
  - scribe

agent_skills:
  build: []
  devops:
    - devops-workflow
    - makefile-ops
    - container-ops
    - cloudbuild-ops
    - gcloud-ops
  git-ops:
    - git-pr-workflow
    - git-release
  docs:
    - readme-conventions
  scribe:
    - blog-conventions
  pilot: []
---

# Content Profile

Extends the default profile with the scribe agent for codebase-grounded
technical content creation. Includes all standard operational agents plus
a dedicated scribe agent pinned to Gemini 3.1 Pro for its 1M context window.

## Included Agents

| Agent | Purpose |
|-------|---------|
| `git-ops` | Git and GitHub operations |
| `devops` | DevOps workflows, containers, infrastructure |
| `docs` | README and documentation maintenance |
| `ideate` | Brainstorming and creative ideation |
| `pilot` | Isolated experimentation and hypothesis testing |
| `scribe` | Codebase-grounded technical content generation |

## Included Skills

| Skill | Agent | Description |
|-------|-------|-------------|
| `blog-conventions` | scribe | Technical content writing conventions and templates |
| `devops-workflow` | devops | Issue-driven DevOps workflow |
| `makefile-ops` | devops | Makefile and modular scripts |
| `container-ops` | devops | Podman container operations |
| `cloudbuild-ops` | devops | Cloud Build CI/CD patterns |
| `gcloud-ops` | devops | Google Cloud Platform operations |
| `git-pr-workflow` | git-ops | PR creation and review |
| `git-release` | git-ops | Release management |
| `readme-conventions` | docs | README best practices |
