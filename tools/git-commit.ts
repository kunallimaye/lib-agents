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

export const stage = tool({
  description:
    "Stage files for commit. Use '.' to stage all changes, or provide specific paths.",
  args: {
    paths: tool.schema
      .string()
      .describe("Space-separated file paths to stage, or '.' for all"),
  },
  async execute(args) {
    const paths = args.paths.split(/\s+/).filter(Boolean)
    if (paths.length === 0) return "Error: No paths provided."

    return await gitRun(["add", ...paths])
  },
})

export const commit = tool({
  description:
    "Create a commit with the staged changes. Provide a commit message. " +
    "If no changes are staged, returns an error.",
  args: {
    message: tool.schema
      .string()
      .describe(
        "Commit message. Prefer conventional commit format: type(scope): description"
      ),
  },
  async execute(args) {
    // Check if there are staged changes
    const staged = await gitRun(["diff", "--cached", "--stat"])
    if (!staged || staged === "" || staged.startsWith("Error:")) {
      return "Error: No staged changes to commit. Stage files first with the stage tool."
    }

    return await gitRun(["commit", "-m", args.message])
  },
})

export const amend = tool({
  description:
    "Amend the last commit. Optionally change the message. " +
    "WARNING: Do not amend commits that have been pushed to a shared remote.",
  args: {
    message: tool.schema
      .string()
      .optional()
      .describe("New commit message (if omitted, keeps the existing message)"),
  },
  async execute(args) {
    // Check if HEAD has been pushed
    const pushed = await gitRun([
      "log",
      "--oneline",
      "HEAD",
      "--not",
      "--remotes",
      "-n1",
    ])
    if (pushed === "" || pushed.startsWith("Error:")) {
      return (
        "WARNING: The last commit appears to have been pushed to a remote. " +
        "Amending will require a force push. Aborting for safety. " +
        "If you really want to amend, use git bash directly."
      )
    }

    const flags = ["commit", "--amend"]
    if (args.message) {
      flags.push("-m", args.message)
    } else {
      flags.push("--no-edit")
    }

    return await gitRun(flags)
  },
})

export const unstage = tool({
  description: "Unstage files (remove from staging area without losing changes).",
  args: {
    paths: tool.schema
      .string()
      .describe("Space-separated file paths to unstage, or '.' for all"),
  },
  async execute(args) {
    const paths = args.paths.split(/\s+/).filter(Boolean)
    if (paths.length === 0) return "Error: No paths provided."

    return await gitRun(["restore", "--staged", ...paths])
  },
})

export const diff_staged = tool({
  description: "Show the diff of currently staged changes (what will be committed).",
  args: {},
  async execute() {
    const result = await gitRun(["diff", "--cached"])
    return result || "No staged changes."
  },
})
