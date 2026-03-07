---
name: log-analysis
description: Systematic log analysis and incident diagnosis patterns
---

## What I do

- Guide systematic log investigation across multiple sources
- Provide error pattern recognition for common tools and languages
- Document diagnostic decision trees for common failure modes
- Help correlate errors across services and time windows

## When to use me

Use this skill when analysing logs, diagnosing failures, or investigating
incidents across containers, CI/CD pipelines, infrastructure, or applications.

## Diagnostic Decision Trees

### Container won't start
1. Check `podman logs <container>` for startup errors
2. Look for: port conflicts, missing env vars, permission denied, OOM
3. Check `podman inspect` for exit code:
   - **137** → OOMKilled (container exceeded memory limit)
   - **1** → Application error (check app logs for stack trace)
   - **126** → Permission denied (check file permissions, USER directive)
   - **127** → Command not found (check CMD/ENTRYPOINT in Dockerfile)
   - **143** → SIGTERM (graceful shutdown, check orchestrator)
4. Cross-reference with `container_health` and `check_ports` troubleshoot tools

### Cloud Build failure
1. Check `gcloud builds log <id>` for the failing step
2. Common patterns:
   - **"DEADLINE_EXCEEDED"** → Build timeout, increase `timeout` in cloudbuild.yaml
   - **"permission denied"** → Service account missing IAM roles
   - **"not found"** → Image or artifact reference is wrong
   - **"FETCHSOURCE" error** → Can't access source repo, check permissions
   - **Step N "failed"** → Read step N logs for the actual error
3. Check substitution variables match expectations
4. Verify the Cloud Build service account has required permissions

### Terraform apply failure
1. Check for state lock ("Error acquiring the state lock") → Wait or force-unlock
2. Check for resource conflicts ("Resource already exists") → Import or taint
3. Check for quota/permission errors → Request quota increase or fix IAM
4. Check for dependency errors → Run `terraform plan` first to preview
5. Run `terraform state list` to verify current state

### Application crash loop
1. Check container restart count with `podman ps`
2. Read last 100 lines of logs before each crash
3. Look for: unhandled exceptions, segfaults, OOM, connection refused
4. Check if the crash correlates with a recent deployment
5. Check resource limits (memory, CPU) against actual usage

### CI/CD pipeline stuck
1. Check for pending approvals or manual gates
2. Check for resource quotas (concurrent build limits)
3. Check network connectivity to artifact registries
4. Look for deadlocked dependencies between build steps

## Common Error Patterns by Tool

### Podman
| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `port already in use` | Another container/process on same port | Use `check_ports` tool, then stop conflicting process |
| `OOMKilled` (exit 137) | Container exceeded memory limit | Increase `--memory` flag or fix memory leak |
| `no such image` | Image not built or wrong tag | Check with `podman images`, rebuild if needed |
| `permission denied` | File ownership mismatch | Check USER in Dockerfile, fix COPY --chown |
| `network not found` | Pod network doesn't exist | Create network with `podman network create` |

### Cloud Build
| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `TIMEOUT` | Build exceeded deadline | Increase `timeout` in cloudbuild config |
| `FETCHSOURCE` | Can't access source repo | Check repo permissions and triggers |
| `Step N failed` | Build step returned non-zero | Read step N output for details |
| `INTERNAL` | Cloud Build service issue | Retry, check GCP status dashboard |

### Terraform
| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `state lock` | Another process holds the lock | Wait or `terraform force-unlock <ID>` |
| `already exists` | Resource created outside TF | `terraform import` or `terraform taint` |
| `quota exceeded` | GCP quota limit hit | Request quota increase in Cloud Console |
| `provider produced inconsistent result` | Provider bug or state drift | `terraform refresh` then retry |

### GCP / gcloud
| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `PERMISSION_DENIED` | Missing IAM role | Grant required role to service account |
| `NOT_FOUND` | Resource doesn't exist | Check resource name, project, region |
| `RESOURCE_EXHAUSTED` | Quota limit reached | Request quota increase |
| `UNAVAILABLE` | Service temporarily down | Retry with exponential backoff |

## Log Severity Patterns by Language

Use these patterns to detect error severity in application logs:

### Python
- **Error**: `Traceback (most recent call last)`, `raise \w+Error`, `logging.error`, `logging.critical`
- **Warning**: `logging.warning`, `DeprecationWarning`, `UserWarning`
- Stack traces span multiple lines — capture from `Traceback` to the final exception line

### Go
- **Error**: `level=error`, `level=fatal`, `panic:`, `fatal error:`, `goroutine \d+`
- **Warning**: `level=warn`, `level=warning`
- Panic traces include goroutine dumps — capture the full goroutine block

### Node.js / TypeScript
- **Error**: `Error:`, `TypeError:`, `ReferenceError:`, `UnhandledPromiseRejection`, `ECONNREFUSED`, `ENOENT`
- **Warning**: `DeprecationWarning`, `ExperimentalWarning`
- Stack traces start with `Error:` followed by indented `at` lines

### Rust
- **Error**: `thread .* panicked at`, `RUST_BACKTRACE`, `fatal runtime error`
- **Warning**: `warning:` from compiler output
- Panic traces include file:line:column references

### Java
- **Error**: `Exception in thread`, `at .*\(.*\.java:\d+\)`, `Caused by:`, `java.lang.\w+Exception`
- **Warning**: `WARN`, `WARNING`
- Stack traces are multi-line with `at` prefixed lines and `Caused by:` chains

### Structured JSON Logs
- Look for `"level"`, `"severity"`, `"lvl"` fields
- Common values: `"error"`, `"fatal"`, `"warn"`, `"info"`, `"debug"`
- Parse the JSON to extract structured fields when possible

### Syslog / systemd
- **Error**: `<*.err>`, `<*.crit>`, `<*.alert>`, `<*.emerg>`
- **Warning**: `<*.warning>`
- Use `journalctl -p err` to filter by priority

## Analysis Best Practices

1. **Start with errors, then expand to warnings** — Don't get lost in noise
2. **Check timestamps** — Are errors clustered at a specific time?
3. **Correlate across sources** — Did the container crash at the same time as a deploy?
4. **Look for the first error** — Later errors are often cascading failures
5. **Check resource metrics alongside logs** — OOM, CPU throttling, disk full
6. **Compare against a known good run** — Use `compare_logs` when available
