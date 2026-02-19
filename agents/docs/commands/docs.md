---
description: Generate, update, or validate project README.md
agent: docs
---

$ARGUMENTS

If no arguments are provided:
1. Run the readme-analyze tool to understand the project
2. Check if a README.md exists
3. If it exists, run readme-validate to check for issues
4. If it doesn't exist, run readme-scaffold to generate one
5. Present the results and ask the user what action to take

If arguments say "generate", "create", or "new":
1. Analyze the project with readme-analyze
2. Generate a README with readme-scaffold
3. Show the generated README and ask to write it

If arguments say "update" or "refresh":
1. Analyze the project with readme-analyze
2. Validate the existing README with readme-validate
3. Update the README to fix any issues found

If arguments say "validate", "check", or "lint":
1. Run readme-validate on the existing README
2. For any TODOs or issues found that should be tracked,
   delegate to @git-ops to create GitHub issues
