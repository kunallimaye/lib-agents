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

export const detect = tool({
  description:
    "Detect merge conflicts in the working tree and list all conflicted files. " +
    "Returns conflict status and the list of files with conflicts.",
  args: {},
  async execute() {
    // Check for unmerged paths
    const result = await gitRun(["diff", "--name-only", "--diff-filter=U"])

    if (!result || result === "") {
      return "No merge conflicts detected."
    }

    if (result.startsWith("Error:")) return result

    const files = result.split("\n").filter(Boolean)
    const lines = [
      `Found ${files.length} file(s) with merge conflicts:`,
      "",
    ]
    for (const f of files) {
      lines.push(`  - ${f}`)
    }
    return lines.join("\n")
  },
})

export const show = tool({
  description:
    "Show the conflict markers in a specific file. " +
    "Displays the full file content with <<<<<<< / ======= / >>>>>>> markers highlighted.",
  args: {
    path: tool.schema
      .string()
      .describe("Path to the file with conflicts"),
  },
  async execute(args) {
    const envErr = await ensureEnvironment()
    if (envErr) return envErr

    try {
      const content = await Bun.$`cat ${args.path}`.text()
      if (!content.includes("<<<<<<<")) {
        return `No conflict markers found in ${args.path}.`
      }
      return `Conflict markers in ${args.path}:\n\n${content}`
    } catch (e: any) {
      return `Error reading ${args.path}: ${e.message || "file not found"}`
    }
  },
})

export const abort_merge = tool({
  description:
    "Abort an in-progress merge and return to the pre-merge state.",
  args: {},
  async execute() {
    return await gitRun(["merge", "--abort"])
  },
})
