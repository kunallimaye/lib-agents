---
description: Run a structured diverge-evaluate-converge brainstorming session
agent: ideate
---

$ARGUMENTS

Run a full structured brainstorming session with all four phases:

**Phase 1 -- Understand the Audience**
1. If the user provided audience context in the arguments, confirm it.
2. If not, ask about target users, their pain points, and what success looks like.
3. Summarize the audience profile before proceeding.

**Phase 2 -- Diverge**
4. Generate 8-12 ideas across at least 3 perspective lenses (frustrated user,
   power user, newcomer, competitor's user, non-user).
5. Include at least 2 radical or unconventional ideas with the three-part
   protocol (core insight, biggest risk, minimal experiment).
6. Label each idea with the perspective lens it comes from.
7. If brainstorming about a software project, read relevant source files first
   to ground ideas in the actual codebase.

**Phase 3 -- Evaluate**
8. Score each idea on audience impact (1-5), feasibility (1-5), and novelty (1-5).
9. Present a ranked table sorted by a weighted score (audience impact weighted 2x).
10. Highlight the top 3-4 ideas.

**Phase 4 -- Converge**
11. For each top idea, provide:
    - A brief concept description (2-3 sentences)
    - A minimal implementation approach
    - The first concrete next step
12. Ask the user which ideas to pursue.
13. For approved ideas, delegate to @git-ops to create GitHub issues with
    the `feature` label (or `experiment` label for radical concepts).
14. If brainstorming revealed documentation gaps, delegate to @docs.
