import { tool } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join, basename } from "path"

// ─── Helpers ────────────────────────────────────────────────────────

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

type SourceType = "file" | "container" | "cloudbuild" | "journald" | "gcloud"

function inferSource(target: string): SourceType {
  if (target.includes("/") || target.endsWith(".log") || target.endsWith(".txt")) return "file"
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target)) return "cloudbuild"
  if (target.endsWith(".service")) return "journald"
  return "container"
}

const SEVERITY_PATTERNS: Record<string, RegExp> = {
  error: /\b(ERROR|FATAL|CRIT(?:ICAL)?|PANIC|EXCEPTION|FAIL(?:ED|URE)?|Traceback|panic:|fatal error:|UnhandledPromiseRejection|ECONNREFUSED|OOMKilled|segfault|SIGSEGV|SIGKILL)\b/i,
  warning: /\b(WARN(?:ING)?|DEPRECAT(?:ED|ION)|TIMEOUT|RETRY|retry|timeout)\b/i,
  info: /\b(INFO|DEBUG|TRACE|NOTICE)\b/i,
}

function matchesSeverity(line: string, minSeverity: string): boolean {
  if (minSeverity === "all") return true
  if (minSeverity === "info") return true
  if (minSeverity === "warning") {
    return SEVERITY_PATTERNS.error.test(line) || SEVERITY_PATTERNS.warning.test(line)
  }
  if (minSeverity === "error") {
    return SEVERITY_PATTERNS.error.test(line)
  }
  return true
}

function extractWithContext(lines: string[], pattern: RegExp, contextLines: number = 5): string[] {
  const result: string[] = []
  const matched = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      matched.add(i)
    }
  }

  for (const idx of matched) {
    const start = Math.max(0, idx - contextLines)
    const end = Math.min(lines.length - 1, idx + contextLines)
    if (result.length > 0) result.push("---")
    for (let i = start; i <= end; i++) {
      const marker = matched.has(i) ? ">>> " : "    "
      result.push(`${marker}${i + 1}: ${lines[i]}`)
    }
  }

  return result
}

// ─── Tool: discover_sources ─────────────────────────────────────────

export const discover_sources = tool({
  description:
    "Auto-detect available log sources in the current project. " +
    "Checks for local log files in logs/, running containers, " +
    "recent Cloud Build builds, and common log file patterns.",
  args: {},
  async execute(_args, context) {
    const root = context.directory || "."
    const sources: string[] = ["Log Source Discovery", "====================", ""]

    // 1. Check logs/ directory (scaffolded per-run logs)
    const logsDir = join(root, "logs")
    if (existsSync(logsDir)) {
      try {
        const files = readdirSync(logsDir)
          .filter((f) => f.endsWith(".log"))
          .sort()
          .reverse()
          .slice(0, 10)
        if (files.length > 0) {
          sources.push("── Local Log Files (logs/) ──")
          for (const f of files) {
            const stat = statSync(join(logsDir, f))
            const age = Math.round((Date.now() - stat.mtimeMs) / 60000)
            const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`
            sources.push(`  ${f}  (${age}m ago, ${size})`)
          }
          sources.push("")
        }
      } catch { /* non-fatal */ }
    }

    // 2. Check for *.log files in project root
    try {
      const rootFiles = readdirSync(root).filter(
        (f) => f.endsWith(".log") && statSync(join(root, f)).isFile(),
      )
      if (rootFiles.length > 0) {
        sources.push("── Log Files (project root) ──")
        for (const f of rootFiles) {
          const stat = statSync(join(root, f))
          const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`
          sources.push(`  ${f}  (${size})`)
        }
        sources.push("")
      }
    } catch { /* non-fatal */ }

    // 3. Check running containers
    const podmanCheck = await run(["podman", "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"])
    if (podmanCheck.ok && podmanCheck.out) {
      sources.push("── Containers (Podman) ──")
      for (const line of podmanCheck.out.split("\n")) {
        if (line.trim()) sources.push(`  ${line}`)
      }
      sources.push("")
    }

    // Also check stopped containers
    const podmanAll = await run(["podman", "ps", "-a", "--filter", "status=exited", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"])
    if (podmanAll.ok && podmanAll.out) {
      sources.push("── Stopped Containers ──")
      for (const line of podmanAll.out.split("\n")) {
        if (line.trim()) sources.push(`  ${line}`)
      }
      sources.push("")
    }

    // 4. Check recent Cloud Build builds
    const gcloudCheck = await run(["gcloud", "builds", "list", "--limit=5", "--format=table(id,status,createTime,duration)"])
    if (gcloudCheck.ok && gcloudCheck.out) {
      sources.push("── Cloud Build (recent) ──")
      sources.push(gcloudCheck.out)
      sources.push("")
    }

    // 5. Check for common log directories
    const commonDirs = ["/var/log", "var/log", "log"]
    for (const dir of commonDirs) {
      const fullPath = dir.startsWith("/") ? dir : join(root, dir)
      if (existsSync(fullPath)) {
        try {
          const files = readdirSync(fullPath)
            .filter((f) => f.endsWith(".log"))
            .slice(0, 5)
          if (files.length > 0) {
            sources.push(`── ${fullPath} ──`)
            for (const f of files) sources.push(`  ${f}`)
            sources.push("")
          }
        } catch { /* permission denied is common */ }
      }
    }

    if (sources.length <= 3) {
      sources.push("No log sources found. Run a build or deployment to generate logs.")
      sources.push("")
      sources.push("Tip: If this project was scaffolded with lib-agents, logs are")
      sources.push("captured automatically in the logs/ directory.")
    }

    return sources.join("\n")
  },
})

// ─── Tool: read_logs ────────────────────────────────────────────────

export const read_logs = tool({
  description:
    "Read and filter logs from various sources (file, container, Cloud Build, " +
    "journald, Cloud Logging). Supports severity filtering, time windowing, " +
    "search patterns, and smart truncation. Source type is auto-detected " +
    "from the target if not specified.",
  args: {
    source: tool.schema
      .enum(["auto", "file", "container", "cloudbuild", "journald", "gcloud"])
      .optional()
      .describe("Log source type (default: auto-detect from target)"),
    target: tool.schema
      .string()
      .describe(
        "Source identifier: file path, container name/ID, Cloud Build ID, " +
        "systemd unit name, or Cloud Logging filter",
      ),
    severity: tool.schema
      .enum(["all", "info", "warning", "error"])
      .optional()
      .describe("Minimum severity to include (default: all)"),
    since: tool.schema
      .string()
      .optional()
      .describe("Time window: '10m', '1h', '1d' (default: 1h)"),
    tail: tool.schema
      .number()
      .optional()
      .describe("Number of lines from end (default: 500)"),
    search: tool.schema
      .string()
      .optional()
      .describe("Search pattern to filter lines (regex supported)"),
  },
  async execute(args) {
    const sourceType = args.source === "auto" || !args.source
      ? inferSource(args.target)
      : args.source as SourceType
    const severity = args.severity || "all"
    const tail = args.tail || 500
    const since = args.since || "1h"

    let rawLines: string[] = []

    switch (sourceType) {
      case "file": {
        if (!existsSync(args.target)) {
          return `Error: File not found: ${args.target}`
        }
        try {
          const content = readFileSync(args.target, "utf-8")
          rawLines = content.split("\n")
        } catch (e: any) {
          return `Error reading file: ${e.message}`
        }
        break
      }

      case "container": {
        const flags = ["logs", "--tail", String(tail)]
        if (since) flags.push("--since", since)
        flags.push(args.target)
        const result = await run(["podman", ...flags])
        if (!result.ok) return `Error reading container logs: ${result.out}`
        rawLines = result.out.split("\n")
        break
      }

      case "cloudbuild": {
        const result = await run(["gcloud", "builds", "log", args.target])
        if (!result.ok) return `Error reading Cloud Build logs: ${result.out}`
        rawLines = result.out.split("\n")
        break
      }

      case "journald": {
        const flags = ["journalctl", "-u", args.target, "--no-pager", "-n", String(tail)]
        if (since) flags.push("--since", since)
        const result = await run(flags)
        if (!result.ok) return `Error reading journald logs: ${result.out}`
        rawLines = result.out.split("\n")
        break
      }

      case "gcloud": {
        const flags = ["gcloud", "logging", "read", args.target, "--limit", String(tail), "--format=value(textPayload)"]
        const result = await run(flags)
        if (!result.ok) return `Error reading Cloud Logging: ${result.out}`
        rawLines = result.out.split("\n")
        break
      }
    }

    // Apply severity filter
    let filtered = severity === "all"
      ? rawLines
      : rawLines.filter((line) => matchesSeverity(line, severity))

    // Apply search pattern
    if (args.search) {
      try {
        const regex = new RegExp(args.search, "i")
        filtered = filtered.filter((line) => regex.test(line))
      } catch {
        return `Error: Invalid search pattern: ${args.search}`
      }
    }

    // Apply tail limit
    if (filtered.length > tail) {
      filtered = filtered.slice(-tail)
    }

    const header = [
      `Log: ${args.target} (${sourceType})`,
      `Lines: ${filtered.length} (of ${rawLines.length} total)`,
      `Severity: ${severity} | Since: ${since} | Tail: ${tail}`,
      args.search ? `Search: ${args.search}` : null,
      "─".repeat(60),
    ]
      .filter(Boolean)
      .join("\n")

    return `${header}\n${filtered.join("\n")}`
  },
})

// ─── Tool: extract_errors ───────────────────────────────────────────

export const extract_errors = tool({
  description:
    "Extract errors and warnings from logs with surrounding context. " +
    "Detects stack traces, ERROR/FATAL/WARN messages, exit codes, panics, " +
    "and other common error patterns. Returns only relevant sections.",
  args: {
    source: tool.schema
      .enum(["auto", "file", "container", "cloudbuild", "journald", "gcloud"])
      .optional()
      .describe("Log source type (default: auto-detect from target)"),
    target: tool.schema
      .string()
      .describe("Source identifier: file path, container name, build ID, etc."),
    context_lines: tool.schema
      .number()
      .optional()
      .describe("Lines of context around each error (default: 5)"),
    severity: tool.schema
      .enum(["error", "warning"])
      .optional()
      .describe("Minimum severity to extract (default: error)"),
  },
  async execute(args) {
    const sourceType = args.source === "auto" || !args.source
      ? inferSource(args.target)
      : args.source as SourceType
    const contextLines = args.context_lines || 5
    const severity = args.severity || "error"

    // Read the log content
    let rawContent: string

    switch (sourceType) {
      case "file": {
        if (!existsSync(args.target)) {
          return `Error: File not found: ${args.target}`
        }
        try {
          rawContent = readFileSync(args.target, "utf-8")
        } catch (e: any) {
          return `Error reading file: ${e.message}`
        }
        break
      }

      case "container": {
        const result = await run(["podman", "logs", "--tail", "2000", args.target])
        if (!result.ok) return `Error reading container logs: ${result.out}`
        rawContent = result.out
        break
      }

      case "cloudbuild": {
        const result = await run(["gcloud", "builds", "log", args.target])
        if (!result.ok) return `Error reading Cloud Build logs: ${result.out}`
        rawContent = result.out
        break
      }

      case "journald": {
        const result = await run(["journalctl", "-u", args.target, "--no-pager", "-n", "2000"])
        if (!result.ok) return `Error reading journald logs: ${result.out}`
        rawContent = result.out
        break
      }

      case "gcloud": {
        const result = await run(["gcloud", "logging", "read", args.target, "--limit=2000", "--format=value(textPayload)"])
        if (!result.ok) return `Error reading Cloud Logging: ${result.out}`
        rawContent = result.out
        break
      }

      default:
        return `Error: Unknown source type: ${sourceType}`
    }

    const lines = rawContent.split("\n")
    const pattern = severity === "warning"
      ? new RegExp(`${SEVERITY_PATTERNS.error.source}|${SEVERITY_PATTERNS.warning.source}`, "i")
      : SEVERITY_PATTERNS.error

    const extracted = extractWithContext(lines, pattern, contextLines)

    if (extracted.length === 0) {
      return `No ${severity}-level messages found in ${args.target} (${sourceType}).`
    }

    const errorCount = extracted.filter((l) => l.startsWith(">>>")).length
    const header = [
      `Error Extraction: ${args.target} (${sourceType})`,
      `Found: ${errorCount} ${severity}-level messages`,
      `Context: ±${contextLines} lines`,
      "─".repeat(60),
    ].join("\n")

    return `${header}\n${extracted.join("\n")}`
  },
})

// ─── Tool: compare_logs ─────────────────────────────────────────────

export const compare_logs = tool({
  description:
    "Compare logs between two runs to identify what changed. " +
    "Useful for diagnosing regressions: compare a working build/run " +
    "against a failing one. Highlights lines present in the failing " +
    "run but absent from the working run.",
  args: {
    source: tool.schema
      .enum(["auto", "file", "container", "cloudbuild"])
      .optional()
      .describe("Log source type (default: auto-detect from target)"),
    good: tool.schema
      .string()
      .describe("Identifier for the working/good run (file path, container, build ID)"),
    bad: tool.schema
      .string()
      .describe("Identifier for the failing/bad run (file path, container, build ID)"),
    context_lines: tool.schema
      .number()
      .optional()
      .describe("Lines of context around differences (default: 3)"),
  },
  async execute(args) {
    const contextLines = args.context_lines || 3

    async function fetchContent(target: string): Promise<string> {
      const sourceType = args.source === "auto" || !args.source
        ? inferSource(target)
        : args.source as SourceType

      switch (sourceType) {
        case "file": {
          if (!existsSync(target)) throw new Error(`File not found: ${target}`)
          return readFileSync(target, "utf-8")
        }
        case "container": {
          const result = await run(["podman", "logs", "--tail", "2000", target])
          if (!result.ok) throw new Error(`Container logs error: ${result.out}`)
          return result.out
        }
        case "cloudbuild": {
          const result = await run(["gcloud", "builds", "log", target])
          if (!result.ok) throw new Error(`Cloud Build logs error: ${result.out}`)
          return result.out
        }
        default:
          throw new Error(`Compare not supported for source type: ${sourceType}`)
      }
    }

    let goodContent: string
    let badContent: string

    try {
      goodContent = await fetchContent(args.good)
    } catch (e: any) {
      return `Error reading good run: ${e.message}`
    }

    try {
      badContent = await fetchContent(args.bad)
    } catch (e: any) {
      return `Error reading bad run: ${e.message}`
    }

    // Normalize lines: strip leading timestamps for comparison
    const timestampRegex = /^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*\s*/
    const normalize = (line: string) => line.replace(timestampRegex, "").trim()

    const goodLines = goodContent.split("\n")
    const badLines = badContent.split("\n")

    const goodSet = new Set(goodLines.map(normalize))
    const badSet = new Set(badLines.map(normalize))

    // Find lines unique to bad (potential issues)
    const onlyInBad: { idx: number; line: string }[] = []
    for (let i = 0; i < badLines.length; i++) {
      if (!goodSet.has(normalize(badLines[i])) && badLines[i].trim()) {
        onlyInBad.push({ idx: i, line: badLines[i] })
      }
    }

    // Find lines unique to good (things that stopped happening)
    const onlyInGood: { idx: number; line: string }[] = []
    for (let i = 0; i < goodLines.length; i++) {
      if (!badSet.has(normalize(goodLines[i])) && goodLines[i].trim()) {
        onlyInGood.push({ idx: i, line: goodLines[i] })
      }
    }

    const result: string[] = [
      "Log Comparison",
      "==============",
      `Good: ${args.good} (${goodLines.length} lines)`,
      `Bad:  ${args.bad} (${badLines.length} lines)`,
      "─".repeat(60),
      "",
    ]

    if (onlyInBad.length > 0) {
      result.push(`── Lines ONLY in failing run (${onlyInBad.length}) ──`)
      result.push("These appeared in the bad run but not the good run:")
      result.push("")
      for (const entry of onlyInBad.slice(0, 50)) {
        // Add context from bad run
        const start = Math.max(0, entry.idx - contextLines)
        const end = Math.min(badLines.length - 1, entry.idx + contextLines)
        for (let i = start; i <= end; i++) {
          const marker = i === entry.idx ? "+ " : "  "
          result.push(`${marker}${i + 1}: ${badLines[i]}`)
        }
        result.push("")
      }
      if (onlyInBad.length > 50) {
        result.push(`  ... and ${onlyInBad.length - 50} more unique lines`)
      }
    }

    if (onlyInGood.length > 0) {
      result.push("")
      result.push(`── Lines ONLY in working run (${onlyInGood.length}) ──`)
      result.push("These were present in the good run but missing from the bad run:")
      result.push("")
      for (const entry of onlyInGood.slice(0, 20)) {
        result.push(`- ${entry.idx + 1}: ${entry.line}`)
      }
      if (onlyInGood.length > 20) {
        result.push(`  ... and ${onlyInGood.length - 20} more`)
      }
    }

    if (onlyInBad.length === 0 && onlyInGood.length === 0) {
      result.push("No significant differences found between the two runs.")
      result.push("The logs appear identical (after timestamp normalization).")
    }

    return result.join("\n")
  },
})
