---
description: Implement an issue from its plan, commit, create PR, and optionally merge
agent: devops
---

Implement issue #$ARGUMENTS

NOTE: If $ARGUMENTS is empty, contains a non-numeric value, or references
conversation context (e.g., "the issue we discussed"), STOP and ask the
user for a specific issue number.

1. Run full pre-flight checks for the issue
2. Read the issue and find the implementation plan (look for a comment
   containing "## Implementation Plan")
3. If no plan exists, stop and tell the user to add a plan first
4. Execute each step in the plan sequentially
5. After all steps are complete, follow the post-work protocol:
   - Run test validation
   - Stage and commit with conventional commit message referencing the issue
   - Create a PR that closes the issue
6. Report the PR URL and a summary of changes made
7. Ask the user: "PR #N is ready to merge. Merge? [yes/no]"
   - If yes, squash merge the PR and delete the branch
   - If no, leave the PR open for manual review
