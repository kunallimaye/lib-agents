---
description: Analyze a project and generate a fresh README.md from scratch
agent: docs
---

Perform a full project analysis and generate a minimalist README.md:

1. Run the readme-analyze tool to understand the project structure,
   language, dependencies, and entry points
2. Run readme-scaffold to generate a clean README
3. Show the generated README to the user for review
4. If the user approves, write it to README.md
5. Identify any TODOs, missing features, or improvements found during
   analysis and delegate them to @git-ops to create GitHub issues

$ARGUMENTS
