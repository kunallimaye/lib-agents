import { tool } from "@opencode-ai/plugin"
import { ensureEnvironment } from "./git-ops-init"

async function gitRun(args: string[]): Promise<string> {
  const envErr = await ensureEnvironment()
  if (envErr) return envErr

  try {
    const result = await Bun.$`git ${args}`.text()
    return result.trim()
  } catch (e: any) {
    const stderr = e?.stderr?.toString?.()?.trim() || ""
    return `Error: ${stderr || e.message || "unknown error"}`
  }
}

const PROTECTED_BRANCHES = ["main", "master", "develop", "production"]

export const create = tool({
  description:
    "Create a new git branch. Optionally specify a base branch and whether to check it out immediately.",
  args: {
    name: tool.schema.string().describe("Name for the new branch"),
    base: tool.schema
      .string()
      .optional()
      .describe("Base branch to create from (default: current branch)"),
    checkout: tool.schema
      .boolean()
      .optional()
      .describe("Switch to the new branch after creating it (default: true)"),
  },
  async execute(args) {
    const shouldCheckout = args.checkout !== false

    if (shouldCheckout) {
      const flags = ["checkout", "-b", args.name]
      if (args.base) flags.push(args.base)
      return await gitRun(flags)
    } else {
      const flags = ["branch", args.name]
      if (args.base) flags.push(args.base)
      return await gitRun(flags)
    }
  },
})

export const switch_branch = tool({
  description: "Switch to an existing branch.",
  args: {
    name: tool.schema.string().describe("Branch name to switch to"),
  },
  async execute(args) {
    return await gitRun(["checkout", args.name])
  },
})

export const delete_branch = tool({
  description:
    "Delete a branch. Refuses to delete protected branches (main, master, develop, production) " +
    "unless force is true. Uses -d by default (safe delete), -D with force.",
  args: {
    name: tool.schema.string().describe("Branch name to delete"),
    force: tool.schema
      .boolean()
      .optional()
      .describe("Force delete even if unmerged or protected (default: false)"),
  },
  async execute(args) {
    if (PROTECTED_BRANCHES.includes(args.name) && !args.force) {
      return (
        `Error: Refusing to delete protected branch '${args.name}'. ` +
        `Pass force=true to override this safety check.`
      )
    }

    const flag = args.force ? "-D" : "-d"
    return await gitRun(["branch", flag, args.name])
  },
})

export const list = tool({
  description:
    "List branches. Shows local branches by default, or include remote branches.",
  args: {
    remote: tool.schema
      .boolean()
      .optional()
      .describe("Include remote branches (default: false)"),
    pattern: tool.schema
      .string()
      .optional()
      .describe("Glob pattern to filter branches (e.g., 'feature/*')"),
  },
  async execute(args) {
    const flags: string[] = ["branch"]
    if (args.remote) flags.push("-a")
    flags.push("-v")
    if (args.pattern) flags.push("--list", args.pattern)

    return await gitRun(flags)
  },
})

export const rename = tool({
  description: "Rename a branch.",
  args: {
    old_name: tool.schema.string().describe("Current branch name"),
    new_name: tool.schema.string().describe("New branch name"),
  },
  async execute(args) {
    if (PROTECTED_BRANCHES.includes(args.old_name)) {
      return `Error: Refusing to rename protected branch '${args.old_name}'.`
    }
    return await gitRun(["branch", "-m", args.old_name, args.new_name])
  },
})

export const current = tool({
  description: "Show the current branch name.",
  args: {},
  async execute() {
    return await gitRun(["rev-parse", "--abbrev-ref", "HEAD"])
  },
})
