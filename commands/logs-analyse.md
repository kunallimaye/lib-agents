---
description: Analyse logs from containers, builds, services, or files to diagnose issues
agent: devops
---

$ARGUMENTS

This is a log analysis and diagnostics workflow.

**Step 1: Determine scope from arguments**

If $ARGUMENTS specifies a file path (contains `/` or ends in `.log`):
- Use `read_logs` with the file path as target (source auto-detection will resolve to "file")
- Then use `extract_errors` on the same target to find issues
- Skip discovery — go straight to analysis

If $ARGUMENTS specifies a container name, build ID, or systemd unit:
- Use `read_logs` with the target (source auto-detection will resolve the type)
- Then use `extract_errors` on the same target
- Skip discovery — go straight to analysis

If $ARGUMENTS mentions "compare" or "diff" with two targets:
- Use `compare_logs` with the two targets as `good` and `bad`
- Analyse the differences and identify likely root cause

If $ARGUMENTS is empty or says "everything" / "what's broken":
- Run `discover_sources` to find all available log sources
- For each discovered source, run `extract_errors` to find issues
- Use `since: "1h"` as default time window

**Step 2: Analyse and report**

Load the `log-analysis` skill for domain-specific diagnostic knowledge.

For each source with findings, present a structured diagnostic summary:

1. **Source** — what was checked (file path, container name, build ID)
2. **Severity** — count of critical/error/warning messages found
3. **Key findings** — the most significant errors with context
4. **Likely cause** — your assessment based on the error patterns and the
   log-analysis skill's decision trees
5. **Suggested action** — what to try next to resolve the issue

Number each finding for drill-down reference.

**Step 3: Offer next steps**

After presenting the summary, offer:
- "Want me to dig deeper into finding #N?"
- "Should I check system health with the troubleshoot tools?"
- "Want me to compare against a previous successful run?"
- "Should I create a GitHub issue for this error?"
