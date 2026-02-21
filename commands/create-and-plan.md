---
description: Create a feature request issue and plan its implementation
agent: devops
---

$ARGUMENTS

## Context Check (MANDATORY)

The description above must be fully self-contained. If it contains short
references like "the above feature", "what we discussed", or "the two
issues", STOP immediately and report back that you need a complete,
self-contained specification. Do NOT guess or proceed with incomplete
context -- the parent agent must expand the reference into a full
description before you can act.

## Steps

1. Delegate to @git-ops to create a GitHub issue:
   - Derive a clear title from the description
   - Write a well-structured body with Summary, Scope, and Acceptance
     Criteria sections
   - Apply appropriate labels (feature, bug, chore, and priority level)
   - Return the issue number

2. Analyze the codebase to understand existing patterns, conventions,
   and files that will need to be created or modified

3. Write a detailed implementation plan as a comment on the issue:
   - Prerequisites and delivery details (files, branch name)
   - Step-by-step implementation instructions with specific content
   - Verification checklist

4. Report the issue URL and a summary of the plan
