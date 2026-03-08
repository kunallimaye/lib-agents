---
name: troubleshooting
description: Unified troubleshooting — logs, Prometheus metrics, and system diagnostics
---

## What I do

- Guide systematic investigation across logs, metrics, and system health
- Provide error pattern recognition for common tools and languages
- Document diagnostic decision trees for common failure modes
- Help correlate errors across services, metrics, and time windows
- Provide pre-built PromQL queries for common symptoms
- Document system diagnostic patterns (ports, DNS, connectivity, disk, processes)

## When to use me

Use this skill when analysing logs, querying Prometheus metrics, diagnosing
failures, checking system health, or investigating incidents across containers,
CI/CD pipelines, infrastructure, or applications.

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
4. Cross-reference with `container_health` and `check_ports` tools
5. Check metrics: `container_memory_usage_bytes` near limit? `rate(container_cpu_usage_seconds_total[5m])` spiking?

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
6. Query metrics: `increase(kube_pod_container_status_restarts_total[1h])` for restart frequency

### CI/CD pipeline stuck
1. Check for pending approvals or manual gates
2. Check for resource quotas (concurrent build limits)
3. Check network connectivity to artifact registries
4. Look for deadlocked dependencies between build steps

### High latency / slow responses
1. Check `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))` for p99 latency
2. Check `rate(http_requests_total[5m])` for traffic spike
3. Check CPU and memory metrics for resource saturation
4. Check `rate(container_network_receive_errors_total[5m])` for network issues
5. Correlate with logs for slow query warnings or timeout errors

### Service unreachable
1. Use `check_connectivity` to verify network path
2. Use `check_dns` to verify DNS resolution
3. Use `check_ports` to verify the service is listening
4. Check `up` metric in Prometheus for target availability
5. Check container health and logs for crash/restart evidence

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

## Prometheus Metrics Diagnostics

### When to check metrics

- **After finding errors in logs** — correlate with resource metrics at the same timestamp
- **Performance complaints** — check latency percentiles, throughput, saturation
- **Container restarts** — check memory/CPU limits vs actual usage
- **Service health** — check `up` metric and target scrape status
- **Capacity planning** — check resource utilisation trends over time

### Pre-built PromQL Queries

| Symptom | PromQL Query |
|---------|-------------|
| High CPU | `rate(container_cpu_usage_seconds_total[5m])` |
| Memory pressure | `container_memory_usage_bytes / container_spec_memory_limit_bytes` |
| Container restarts | `increase(kube_pod_container_status_restarts_total[1h])` |
| Disk pressure | `node_filesystem_avail_bytes / node_filesystem_size_bytes` |
| Network errors | `rate(container_network_receive_errors_total[5m])` |
| HTTP error rate | `rate(http_requests_total{code=~"5.."}[5m]) / rate(http_requests_total[5m])` |
| Request latency (p99) | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))` |
| Target availability | `up` |
| Scrape duration | `scrape_duration_seconds` |
| Memory saturation | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` |

### Prometheus Target Health Patterns

- **All targets UP** → Monitoring is healthy, check application-level metrics
- **Some targets DOWN** → Check `check_targets` output for last error
  - `connection refused` → Service not running or wrong port
  - `context deadline exceeded` → Target too slow to respond, check resource usage
  - `no route to host` → Network issue, use `check_connectivity`
- **Targets flapping** (alternating UP/DOWN) → Unstable service, check logs for crash loop
- **Dropped targets** → Relabeling rules may be filtering them out

## Correlating Logs with Metrics

### Cross-reference timestamps

When you find an error in logs:
1. Note the exact timestamp of the error
2. Query metrics for a window around that timestamp:
   ```
   query_metrics_range with start="15m" centered on the error time
   ```
3. Look for: CPU spikes, memory jumps, network errors, request rate changes

### Narrowing time windows

1. **Find error in logs** → `extract_errors` gives you the timestamp
2. **Query metrics for that range** → `query_metrics_range` with start/end around the error
3. **Correlate** — Did resource usage spike before the error? Did error rate increase after?
4. **Drill down** — Use more specific PromQL to isolate the component

### Common correlation patterns

| Log Pattern | Metric to Check | What it Means |
|-------------|----------------|---------------|
| OOMKilled | `container_memory_usage_bytes` near limit | Memory leak or undersized limit |
| Connection refused | `up{job="target"}` went to 0 | Dependency service crashed |
| Timeout errors | `histogram_quantile(0.99, ...)` spiking | Downstream latency issue |
| 5xx responses | `rate(http_requests_total{code=~"5.."}[5m])` | Application error rate |
| Disk full | `node_filesystem_avail_bytes` near 0 | Need cleanup or volume resize |

## System Diagnostics

### Port conflicts
Use `check_ports` to see what's listening. Common issues:
- Two services trying to bind the same port
- Service not listening when it should be (crashed or misconfigured)
- Firewall blocking expected ports

### DNS resolution
Use `check_dns` to verify hostname resolution. Common issues:
- DNS not resolving (check `/etc/resolv.conf`)
- Resolving to wrong IP (stale DNS cache or wrong record)
- Slow resolution (DNS server overloaded)

### Network connectivity
Use `check_connectivity` for HTTP endpoints or ping for hosts. Common issues:
- Connection refused (service down or wrong port)
- Timeout (firewall, network partition, or overloaded service)
- SSL/TLS errors (certificate expired or hostname mismatch)

### Disk space
Use `disk_usage` to check directory sizes. Common issues:
- Log files growing unbounded (add log rotation)
- Container images accumulating (run `podman system prune`)
- Build artifacts not cleaned up

### Process inspection
Use `process_list` sorted by CPU or memory. Common issues:
- Runaway process consuming all CPU
- Memory leak causing gradual increase
- Zombie processes accumulating

## Analysis Best Practices

1. **Start with errors, then expand to warnings** — Don't get lost in noise
2. **Check timestamps** — Are errors clustered at a specific time?
3. **Correlate across sources** — Did the container crash at the same time as a deploy?
4. **Look for the first error** — Later errors are often cascading failures
5. **Check resource metrics alongside logs** — OOM, CPU throttling, disk full
6. **Compare against a known good run** — Use `compare_logs` when available
7. **Cross-reference logs with Prometheus** — Find the error timestamp, then query metrics for that window
8. **Check target health first** — If Prometheus targets are down, metrics data may be stale
9. **Use range queries for trends** — Instant queries show current state; range queries show how you got there
10. **Verify system basics** — DNS, connectivity, ports, disk — before diving into application-level issues
