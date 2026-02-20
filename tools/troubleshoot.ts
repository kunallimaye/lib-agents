import { tool } from "@opencode-ai/plugin"

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

export const check_ports = tool({
  description:
    "Check which ports are listening on the local system. " +
    "Useful for diagnosing port conflicts or verifying services are running.",
  args: {
    port: tool.schema
      .number()
      .optional()
      .describe("Check a specific port number"),
  },
  async execute(args) {
    if (args.port) {
      const result = await run(["ss", "-tlnp", `sport = :${args.port}`])
      if (!result.ok) return `Error checking port ${args.port}: ${result.out}`
      return result.out || `Port ${args.port} is not in use.`
    }

    const result = await run(["ss", "-tlnp"])
    if (!result.ok) return `Error listing ports: ${result.out}`
    return result.out || "No listening ports found."
  },
})

export const check_dns = tool({
  description:
    "Perform DNS lookup for a hostname. Shows resolved addresses and records.",
  args: {
    hostname: tool.schema.string().describe("Hostname to resolve"),
    type: tool.schema
      .string()
      .optional()
      .describe("Record type (A, AAAA, CNAME, MX, TXT, NS, etc.)"),
  },
  async execute(args) {
    const flags: string[] = ["dig", "+short"]
    if (args.type) flags.push(args.type)
    flags.push(args.hostname)

    const result = await run(flags)
    if (!result.ok) {
      // Fallback to nslookup
      const fallback = await run(["nslookup", args.hostname])
      if (!fallback.ok) return `Error resolving ${args.hostname}: ${fallback.out}`
      return fallback.out
    }

    return result.out || `No ${args.type || "A"} records found for ${args.hostname}.`
  },
})

export const check_connectivity = tool({
  description:
    "Check network connectivity to a host. Uses curl for HTTP(S) endpoints " +
    "and ping for general hosts.",
  args: {
    host: tool.schema.string().describe("Host or URL to check connectivity to"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in seconds (default: 5)"),
  },
  async execute(args) {
    const timeout = args.timeout || 5

    if (args.host.startsWith("http://") || args.host.startsWith("https://")) {
      // HTTP(S) check
      const result = await run([
        "curl",
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "HTTP %{http_code} | Time: %{time_total}s | DNS: %{time_namelookup}s | Connect: %{time_connect}s",
        "--max-time",
        String(timeout),
        args.host,
      ])
      if (!result.ok) return `FAIL: Cannot reach ${args.host}. Error: ${result.out}`
      return `PASS: ${args.host}\n  ${result.out}`
    }

    // Ping check
    const result = await run(["ping", "-c", "3", "-W", String(timeout), args.host])
    if (!result.ok) return `FAIL: Cannot reach ${args.host}. Error: ${result.out}`
    return result.out
  },
})

export const system_info = tool({
  description:
    "Show system information including OS, kernel, CPU, memory, and uptime.",
  args: {},
  async execute() {
    const lines: string[] = ["System Information", "==================", ""]

    // OS / Kernel
    const uname = await run(["uname", "-a"])
    if (uname.ok) lines.push(`Kernel : ${uname.out}`)

    // CPU
    try {
      const cpu = await Bun.$`grep -m1 "model name" /proc/cpuinfo`.text()
      const cpuName = cpu.trim().split(":")[1]?.trim() || "unknown"
      const cores = await Bun.$`grep -c "^processor" /proc/cpuinfo`.text()
      lines.push(`CPU    : ${cpuName} (${cores.trim()} cores)`)
    } catch {
      lines.push("CPU    : could not detect")
    }

    // Memory
    const free = await run(["free", "-h"])
    if (free.ok) {
      const memLine = free.out.split("\n").find((l) => l.startsWith("Mem:"))
      if (memLine) {
        const parts = memLine.split(/\s+/)
        lines.push(`Memory : ${parts[2]} used / ${parts[1]} total (${parts[6]} available)`)
      }
    }

    // Disk
    const df = await run(["df", "-h", "/"])
    if (df.ok) {
      const diskLine = df.out.split("\n")[1]
      if (diskLine) {
        const parts = diskLine.split(/\s+/)
        lines.push(`Disk / : ${parts[2]} used / ${parts[1]} total (${parts[4]} usage)`)
      }
    }

    // Uptime
    try {
      const uptime = await Bun.$`uptime -p`.text()
      lines.push(`Uptime : ${uptime.trim()}`)
    } catch {}

    return lines.join("\n")
  },
})

export const process_list = tool({
  description:
    "List running processes, optionally filtered by name or sorted by resource usage.",
  args: {
    filter: tool.schema
      .string()
      .optional()
      .describe("Filter processes by name (grep pattern)"),
    sort: tool.schema
      .enum(["cpu", "mem", "pid"])
      .optional()
      .describe("Sort by resource (default: cpu)"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max number of processes to show (default: 20)"),
  },
  async execute(args) {
    const limit = args.limit || 20
    const sort = args.sort || "cpu"

    let sortFlag: string
    switch (sort) {
      case "mem":
        sortFlag = "-rss"
        break
      case "pid":
        sortFlag = "pid"
        break
      default:
        sortFlag = "-pcpu"
    }

    if (args.filter) {
      const result = await run([
        "ps",
        "aux",
        "--sort",
        sortFlag,
      ])
      if (!result.ok) return `Error listing processes: ${result.out}`

      const lines = result.out.split("\n")
      const header = lines[0]
      const filtered = lines
        .slice(1)
        .filter((l) => l.toLowerCase().includes(args.filter!.toLowerCase()))
        .slice(0, limit)

      if (filtered.length === 0) {
        return `No processes found matching '${args.filter}'.`
      }

      return [header, ...filtered].join("\n")
    }

    const result = await run(["ps", "aux", "--sort", sortFlag])
    if (!result.ok) return `Error listing processes: ${result.out}`

    const lines = result.out.split("\n")
    return lines.slice(0, limit + 1).join("\n")
  },
})

export const disk_usage = tool({
  description: "Show disk usage for a directory or the entire filesystem.",
  args: {
    path: tool.schema
      .string()
      .optional()
      .describe("Directory path to check (default: current directory)"),
    depth: tool.schema
      .number()
      .optional()
      .describe("Max depth for directory breakdown (default: 1)"),
  },
  async execute(args) {
    const target = args.path || "."
    const depth = args.depth || 1

    const result = await run([
      "du",
      "-h",
      "--max-depth",
      String(depth),
      "--apparent-size",
      target,
    ])
    if (!result.ok) return `Error checking disk usage: ${result.out}`
    return result.out
  },
})

export const container_health = tool({
  description:
    "Check health of running containers. Lists containers with their " +
    "status, resource usage, and health check results.",
  args: {},
  async execute() {
    // Check if podman is available
    const podmanCheck = await run(["podman", "--version"])
    if (!podmanCheck.ok) {
      return "Error: podman is not installed or not in PATH."
    }

    const lines: string[] = ["Container Health Check", "=====================", ""]

    // List running containers
    const ps = await run([
      "podman",
      "ps",
      "--format",
      "json",
    ])

    if (!ps.ok) {
      return `Error listing containers: ${ps.out}`
    }

    try {
      const containers = JSON.parse(ps.out)
      if (!containers || containers.length === 0) {
        return "No running containers found."
      }

      for (const c of containers) {
        const name = c.Names?.[0] || c.Name || c.Id?.slice(0, 12) || "unknown"
        const image = c.Image || "unknown"
        const state = c.State || "unknown"
        const status = c.Status || ""

        lines.push(`Container: ${name}`)
        lines.push(`  Image  : ${image}`)
        lines.push(`  State  : ${state}`)
        lines.push(`  Status : ${status}`)

        // Get resource stats
        const stats = await run([
          "podman",
          "stats",
          "--no-stream",
          "--format",
          "{{.CPUPerc}} CPU | {{.MemUsage}} MEM | {{.NetIO}} NET | {{.BlockIO}} BLOCK",
          name,
        ])
        if (stats.ok && stats.out) {
          lines.push(`  Usage  : ${stats.out}`)
        }

        lines.push("")
      }
    } catch {
      lines.push("Could not parse container list.")
      lines.push(ps.out)
    }

    return lines.join("\n")
  },
})
