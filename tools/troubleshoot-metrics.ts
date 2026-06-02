import { tool } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

// ─── Shared Helper ──────────────────────────────────────────────────

async function run(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const result = await Bun.$`${cmd}`.text()
    return { ok: true, out: result.trim() }
  } catch (e: any) {
    return {
      ok: false,
      out: e?.stderr?.toString?.()?.trim() || e.message || "unknown error",
    }
  }
}

// ─── Prometheus Helpers ─────────────────────────────────────────────

async function findPrometheusEndpoint(context?: { directory?: string }): Promise<{ url: string; method: string } | null> {
  // 1. Check PROMETHEUS_URL environment variable
  const envUrl = process.env.PROMETHEUS_URL
  if (envUrl) {
    return { url: envUrl.replace(/\/+$/, ""), method: "PROMETHEUS_URL env var" }
  }

  const root = context?.directory || "."

  // 2. Scan for compose files with prometheus service
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "podman-compose.yml",
    "compose.yml",
    "compose.yaml",
  ]
  for (const file of composeFiles) {
    const fullPath = join(root, file)
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8")
        // Look for prometheus service with port mapping
        const promMatch = content.match(/prometheus[\s\S]*?ports:\s*\n\s*-\s*["']?(\d+):(\d+)["']?/i)
        if (promMatch) {
          const hostPort = promMatch[1]
          return { url: `http://localhost:${hostPort}`, method: `${file} (port ${hostPort})` }
        }
      } catch { /* non-fatal */ }
    }
  }

  // 3. Check running podman containers with "prometheus" in image name
  const podmanCheck = await run(["podman", "ps", "--format", "json"])
  if (podmanCheck.ok && podmanCheck.out) {
    try {
      const containers = JSON.parse(podmanCheck.out)
      for (const c of containers) {
        const image = (c.Image || "").toLowerCase()
        if (image.includes("prometheus")) {
          // Extract host port mapping
          const ports = c.Ports || []
          for (const p of ports) {
            if (p.host_port && p.container_port === 9090) {
              return { url: `http://localhost:${p.host_port}`, method: `podman container (${c.Names?.[0] || c.Id?.slice(0, 12)})` }
            }
          }
          // Default prometheus port
          return { url: "http://localhost:9090", method: `podman container (${c.Names?.[0] || c.Id?.slice(0, 12)})` }
        }
      }
    } catch { /* non-fatal */ }
  }

  // 4. Try localhost:9090 as fallback
  try {
    const resp = await fetch("http://localhost:9090/-/ready", { signal: AbortSignal.timeout(3000) })
    if (resp.ok) {
      return { url: "http://localhost:9090", method: "localhost:9090 (auto-detected)" }
    }
  } catch { /* not running */ }

  return null
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/)
  if (!match) return 0
  const value = parseFloat(match[1])
  switch (match[2]) {
    case "s": return value * 1000
    case "m": return value * 60 * 1000
    case "h": return value * 3600 * 1000
    case "d": return value * 86400 * 1000
    case "w": return value * 604800 * 1000
    default: return 0
  }
}

function formatPromResult(data: any): string {
  if (!data || !data.data) return "No data returned."

  const resultType = data.data.resultType
  const results = data.data.result

  if (!results || results.length === 0) return "Query returned no results."

  const lines: string[] = [`Result type: ${resultType}`, ""]

  switch (resultType) {
    case "vector": {
      for (const r of results) {
        const labels = Object.entries(r.metric || {})
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ")
        const [timestamp, value] = r.value || []
        const time = timestamp ? new Date(timestamp * 1000).toISOString() : "?"
        lines.push(`{${labels}} => ${value}  (@ ${time})`)
      }
      break
    }

    case "scalar": {
      const [timestamp, value] = results
      lines.push(`Scalar: ${value}  (@ ${new Date(timestamp * 1000).toISOString()})`)
      break
    }

    case "matrix": {
      for (const r of results) {
        const labels = Object.entries(r.metric || {})
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ")
        lines.push(`{${labels}}`)
        lines.push("  Timestamp              | Value")
        lines.push("  " + "\u2500".repeat(50))
        for (const [ts, val] of r.values || []) {
          lines.push(`  ${new Date(ts * 1000).toISOString()} | ${val}`)
        }
        lines.push("")
      }
      break
    }

    case "string": {
      lines.push(`String: ${results}`)
      break
    }

    default:
      lines.push(JSON.stringify(results, null, 2))
  }

  return lines.join("\n")
}

// ─── Prometheus Tools ───────────────────────────────────────────────

export const discover_prometheus = tool({
  description:
    "Auto-detect a Prometheus endpoint. Checks PROMETHEUS_URL env var, " +
    "docker-compose/podman-compose files, running containers, and " +
    "localhost:9090 as fallback. Returns the discovered endpoint or " +
    "suggestions if not found.",
  args: {},
  async execute(_args, context) {
    const result = await findPrometheusEndpoint(context)

    if (result) {
      const lines = [
        "Prometheus Discovery",
        "====================",
        "",
        `Endpoint : ${result.url}`,
        `Found via: ${result.method}`,
        "",
        "Ready for queries. Use query_metrics or check_targets.",
      ]
      return lines.join("\n")
    }

    return [
      "Prometheus Discovery",
      "====================",
      "",
      "No Prometheus endpoint found.",
      "",
      "Checked:",
      "  1. PROMETHEUS_URL environment variable — not set",
      "  2. docker-compose.yml / podman-compose.yml — no prometheus service found",
      "  3. Running podman containers — no prometheus image detected",
      "  4. http://localhost:9090 — not reachable",
      "",
      "To connect Prometheus:",
      "  - Set PROMETHEUS_URL=http://<host>:<port>",
      "  - Or start Prometheus: podman run -d -p 9090:9090 prom/prometheus",
      "  - Or add a prometheus service to your compose file",
    ].join("\n")
  },
})

export const query_metrics = tool({
  description:
    "Execute a PromQL instant query against Prometheus. Returns current " +
    "metric values. Use for point-in-time checks like current CPU usage, " +
    "memory pressure, or error rates.",
  args: {
    query: tool.schema
      .string()
      .describe("PromQL query expression (e.g. 'up', 'rate(http_requests_total[5m])')"),
    endpoint: tool.schema
      .string()
      .optional()
      .describe("Prometheus endpoint URL (auto-detected if not specified)"),
    time: tool.schema
      .string()
      .optional()
      .describe("Evaluation timestamp (RFC3339 or Unix timestamp, default: now)"),
    timeout: tool.schema
      .string()
      .optional()
      .describe("Query timeout (e.g. '30s', default: server default)"),
  },
  async execute(args, context) {
    let endpoint = args.endpoint
    if (!endpoint) {
      const discovered = await findPrometheusEndpoint(context)
      if (!discovered) {
        return "Error: No Prometheus endpoint found. Set PROMETHEUS_URL or pass endpoint parameter."
      }
      endpoint = discovered.url
    }

    const params = new URLSearchParams({ query: args.query })
    if (args.time) params.set("time", args.time)
    if (args.timeout) params.set("timeout", args.timeout)

    const url = `${endpoint}/api/v1/query?${params.toString()}`

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!resp.ok) {
        const body = await resp.text()
        return `Error: Prometheus returned HTTP ${resp.status}.\n${body}`
      }

      const data = await resp.json()
      if (data.status === "error") {
        return `PromQL Error: ${data.errorType} — ${data.error}`
      }

      const header = [
        `Query: ${args.query}`,
        `Endpoint: ${endpoint}`,
        "\u2500".repeat(60),
        "",
      ].join("\n")

      return header + formatPromResult(data)
    } catch (e: any) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        return `Error: Query timed out after 30s. Try a simpler query or increase timeout.`
      }
      return `Error: Could not reach Prometheus at ${endpoint}.\n${e.message}`
    }
  },
})

export const query_metrics_range = tool({
  description:
    "Execute a PromQL range query against Prometheus. Returns time-series " +
    "data over a time window. Use for trend analysis like CPU over the " +
    "last hour or error rate over the last day.",
  args: {
    query: tool.schema
      .string()
      .describe("PromQL query expression"),
    endpoint: tool.schema
      .string()
      .optional()
      .describe("Prometheus endpoint URL (auto-detected if not specified)"),
    start: tool.schema
      .string()
      .describe("Start time as relative duration (e.g. '1h', '30m', '1d') or RFC3339 timestamp"),
    end: tool.schema
      .string()
      .optional()
      .describe("End time as relative duration or RFC3339 (default: now)"),
    step: tool.schema
      .string()
      .optional()
      .describe("Query resolution step (e.g. '60s', '5m', default: '60s')"),
  },
  async execute(args, context) {
    let endpoint = args.endpoint
    if (!endpoint) {
      const discovered = await findPrometheusEndpoint(context)
      if (!discovered) {
        return "Error: No Prometheus endpoint found. Set PROMETHEUS_URL or pass endpoint parameter."
      }
      endpoint = discovered.url
    }

    const now = Date.now()
    const step = args.step || "60s"

    // Parse start time — relative duration or absolute
    let startTime: string
    const startMs = parseDuration(args.start)
    if (startMs > 0) {
      startTime = new Date(now - startMs).toISOString()
    } else {
      startTime = args.start // assume RFC3339
    }

    // Parse end time
    let endTime: string
    if (args.end) {
      const endMs = parseDuration(args.end)
      if (endMs > 0) {
        endTime = new Date(now - endMs).toISOString()
      } else {
        endTime = args.end
      }
    } else {
      endTime = new Date(now).toISOString()
    }

    const params = new URLSearchParams({
      query: args.query,
      start: startTime,
      end: endTime,
      step: step,
    })

    const url = `${endpoint}/api/v1/query_range?${params.toString()}`

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!resp.ok) {
        const body = await resp.text()
        return `Error: Prometheus returned HTTP ${resp.status}.\n${body}`
      }

      const data = await resp.json()
      if (data.status === "error") {
        return `PromQL Error: ${data.errorType} — ${data.error}`
      }

      const header = [
        `Range Query: ${args.query}`,
        `Endpoint: ${endpoint}`,
        `Window: ${startTime} → ${endTime} (step: ${step})`,
        "\u2500".repeat(60),
        "",
      ].join("\n")

      return header + formatPromResult(data)
    } catch (e: any) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        return `Error: Range query timed out after 30s. Try a shorter time range or larger step.`
      }
      return `Error: Could not reach Prometheus at ${endpoint}.\n${e.message}`
    }
  },
})

export const check_targets = tool({
  description:
    "Check Prometheus scrape target health. Shows active and dropped " +
    "targets grouped by job with health status, last scrape time, " +
    "and last error. Useful for verifying monitoring coverage.",
  args: {
    endpoint: tool.schema
      .string()
      .optional()
      .describe("Prometheus endpoint URL (auto-detected if not specified)"),
  },
  async execute(args, context) {
    let endpoint = args.endpoint
    if (!endpoint) {
      const discovered = await findPrometheusEndpoint(context)
      if (!discovered) {
        return "Error: No Prometheus endpoint found. Set PROMETHEUS_URL or pass endpoint parameter."
      }
      endpoint = discovered.url
    }

    const url = `${endpoint}/api/v1/targets`

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!resp.ok) {
        const body = await resp.text()
        return `Error: Prometheus returned HTTP ${resp.status}.\n${body}`
      }

      const data = await resp.json()
      if (data.status === "error") {
        return `Error: ${data.errorType} — ${data.error}`
      }

      const active = data.data?.activeTargets || []
      const dropped = data.data?.droppedTargets || []

      const lines: string[] = [
        "Prometheus Targets",
        "==================",
        `Endpoint: ${endpoint}`,
        `Active: ${active.length} | Dropped: ${dropped.length}`,
        "\u2500".repeat(60),
        "",
      ]

      // Group active targets by job
      const byJob: Record<string, any[]> = {}
      for (const t of active) {
        const job = t.labels?.job || "unknown"
        if (!byJob[job]) byJob[job] = []
        byJob[job].push(t)
      }

      for (const [job, targets] of Object.entries(byJob)) {
        const healthy = targets.filter((t: any) => t.health === "up").length
        lines.push(`Job: ${job} (${healthy}/${targets.length} healthy)`)
        for (const t of targets) {
          const health = t.health === "up" ? "UP" : "DOWN"
          const scrapeUrl = t.scrapeUrl || t.labels?.instance || "?"
          const lastScrape = t.lastScrape
            ? new Date(t.lastScrape).toISOString()
            : "never"
          const lastError = t.lastError || ""
          lines.push(`  [${health}] ${scrapeUrl}`)
          lines.push(`    Last scrape: ${lastScrape}`)
          if (lastError) {
            lines.push(`    Last error:  ${lastError}`)
          }
        }
        lines.push("")
      }

      if (dropped.length > 0) {
        lines.push(`\u2500\u2500 Dropped Targets (${dropped.length}) \u2500\u2500`)
        for (const t of dropped.slice(0, 10)) {
          const labels = Object.entries(t.discoveredLabels || {})
            .map(([k, v]) => `${k}="${v}"`)
            .join(", ")
          lines.push(`  {${labels}}`)
        }
        if (dropped.length > 10) {
          lines.push(`  ... and ${dropped.length - 10} more`)
        }
      }

      return lines.join("\n")
    } catch (e: any) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        return `Error: Targets request timed out after 15s.`
      }
      return `Error: Could not reach Prometheus at ${endpoint}.\n${e.message}`
    }
  },
})
