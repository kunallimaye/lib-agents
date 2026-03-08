---
name: blog-conventions
description: Conventions and best practices for writing codebase-grounded technical content
---

## What I do

- Guide the structure, tone, and code snippet conventions for technical content grounded in actual codebase analysis
- Provide templates for 6 content types: project overview, architecture deep-dive, feature spotlight, tutorial, release narrative, and explain
- Enforce code snippet standards: file path attribution, 10-30 line limit, mandatory "why" commentary
- Support 3 tone presets for different audiences: external, internal, marketing

## When to use me

Use this skill when analyzing a codebase to produce technical content. It ensures
consistent structure, accurate code references, and appropriate tone across all
content types.

## Content Type Templates

### Project Overview

**Structure**: Hook → The Problem → The Solution → Key Concepts (3-5) → Architecture Overview → Getting Started → What's Next

**When to use**: First introduction to a project. Aimed at someone discovering it for the first time.

### Architecture Deep-Dive

**Structure**: Context/Motivation → High-Level Architecture → Design Decision 1 (with code + WHY) → Design Decision 2 (with code + WHY) → Tradeoffs Acknowledged → Conclusion

**When to use**: Explaining design decisions and tradeoffs. The most technically demanding content type.

### Feature Spotlight

**Structure**: The Problem → How It Works (with code) → Why This Approach → Alternatives Considered → Try It Yourself

**When to use**: Zooming into one specific concept, pattern, or feature.

### Tutorial/How-to

**Structure**: What You'll Build → Prerequisites → Step 1..N (code + expected output) → Common Pitfalls → Next Steps

**When to use**: Teaching usage step-by-step. Every step must be reproducible.

### Release Narrative

**Structure**: What Changed → Why It Matters → Key Changes (with diffs/code) → Migration Notes → What's Next

**When to use**: Diff-driven content about what changed between versions and why it matters. Delegate to `@git-ops` for commit history and release context.

### Explain

**Structure**: Context → The Thing Explained → How It Works (code walkthrough) → Why It's Done This Way → Related Concepts

**When to use**: Personal comprehension, not publishing. The user wants to understand something in the codebase. Output is conversational and thorough.

## Code Snippet Conventions

1. **File path attribution** -- Include the file path as a first-line comment:
   ```typescript
   // from: src/tools/agent-workspace.ts
   ```

2. **Focused snippets** -- 10-30 lines per snippet (hard max: 40). Use `// ...` for omitted lines.

3. **Mandatory commentary** -- Always follow a code snippet with a paragraph explaining the *why*. Show the "what" through code, explain the "why" through prose.

4. **Syntax highlighting** -- Use fenced code blocks with the appropriate language identifier.

5. **Input/output pairs** -- For tutorials, show expected output after commands or code execution.

## Tone Presets

### External (default)

- Engaging, accessible, slightly opinionated
- Write for a developer audience at intermediate level
- Lead with the problem, not the solution
- Use analogies when introducing complex concepts
- Avoid jargon without explanation
- Active voice, present tense
- Use "we" when walking through code, "you" when addressing the reader
- One idea per paragraph

### Internal

- Direct, concise, assumes domain knowledge
- Skip introductory context the team already knows
- Focus on decisions, rationale, and implications
- Reference internal tools, processes, and prior decisions freely
- Suitable for team wikis, onboarding docs, and ADRs

### Marketing

- Benefit-led, emphasize impact over implementation
- Use non-technical analogies for complex concepts
- Include a clear call-to-action
- Shorter paragraphs, more whitespace
- Focus on what users can do, not how it works internally

## Frontmatter Convention

Every piece of content should include YAML frontmatter:

```yaml
---
title: "Descriptive Title"
date: YYYY-MM-DD
tags: [tag1, tag2]
description: "One-sentence summary for SEO/previews"
type: overview|deep-dive|spotlight|tutorial|release|explain
---
```

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Code without explanation | Reader sees *what* but not *why* |
| "This is self-explanatory" | Nothing is self-explanatory to someone seeing it for the first time |
| Wall-of-code (>40 lines) | Reader's eyes glaze over; break into focused chunks |
| Burying the lede | Put the interesting insight first, then build context |
| Ignoring tradeoffs | Every design decision has a cost; honesty builds trust |
| Pure positive spin | Reads as marketing, not engineering; acknowledge limitations |
| "In this blog post we will explore..." | Filler that says nothing; start with the insight or problem |
| Fabricated code | All snippets MUST come from actual files in the project |
| Speculating about rationale | If unsure why a decision was made, say so honestly |

## Agent Integration

- Load this skill before writing any content
- Select the appropriate template based on the requested content type
- Follow code snippet conventions strictly — every snippet needs attribution and commentary
- Apply the tone preset matching the user's request (default: external)
- Present content in conversation first; only write to file when explicitly asked
