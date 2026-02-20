---
description: Run DevOps tasks with pre-flight checks (issue link, clean tree, dedicated branch)
agent: devops
---

$ARGUMENTS

Before doing any work, run the full pre-flight check:

1. If the user provided an issue number, use `full_preflight` with that number.
2. If no issue number is provided, ask the user to provide one or confirm
   creation of a new issue (delegate to @git-ops to create it, then re-run
   pre-flight with the new issue number).
3. If pre-flight fails, report the failure and help the user fix it before
   proceeding.
4. Only after pre-flight passes, proceed with the requested work.

After completing the work:
1. Delegate to @git-ops to stage and commit changes.
2. Delegate to @git-ops to create a PR that closes the linked issue.
3. Report the PR URL and linked issue back to the user.
