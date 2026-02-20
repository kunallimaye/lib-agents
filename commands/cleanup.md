---
description: List and prune stale git branches that have been merged
agent: git-ops
---

$ARGUMENTS

This is a branch cleanup workflow. No pre-flight checks are needed for cleanup.

1. Run `list_stale` from the branch-cleanup tool to show all merged branches
   (both local and remote).
2. Present the list to the user with branch names and last commit dates.
3. Ask the user which branches to delete:
   - Local only (default)
   - Local and remote (if they confirm)
4. Run `prune` with the user's confirmation to delete the selected branches.
5. Run `prune_remote` to clean up stale remote-tracking references.
6. Show a summary of what was cleaned up.
