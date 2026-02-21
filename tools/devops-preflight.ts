import { tool } from "@opencode-ai/plugin"
import { existsSync } from "fs"

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

async function getDefaultBranch(): Promise<string> {
  const result = await run([
    "gh",
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ])
  return result.ok ? result.out : "main"
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

export const check_issue = tool({
  description:
    "Verify that a GitHub issue exists and is open. Returns the issue title " +
    "and state, or an error if the issue does not exist.",
  args: {
    number: tool.schema.number().describe("GitHub issue number to verify"),
  },
  async execute(args) {
    if (args.number <= 0) return "FAIL: Issue number must be a positive integer."

    const result = await run([
      "gh",
      "issue",
      "view",
      String(args.number),
      "--json",
      "number,title,state,labels,url",
    ])

    if (!result.ok) {
      return `FAIL: Could not find issue #${args.number}. Error: ${result.out}`
    }

    try {
      const issue = JSON.parse(result.out)
      const labels =
        issue.labels?.map((l: any) => l.name).join(", ") || "none"
      const lines = [
        `PASS: Issue #${issue.number} exists`,
        `  Title  : ${issue.title}`,
        `  State  : ${issue.state}`,
        `  Labels : ${labels}`,
        `  URL    : ${issue.url}`,
      ]

      if (issue.state === "CLOSED") {
        lines.push("")
        lines.push(
          "WARNING: This issue is closed. Consider reopening it or creating a new issue.",
        )
      }

      return lines.join("\n")
    } catch {
      return result.out
    }
  },
})

export const check_clean = tool({
  description:
    "Check if the git working tree is clean (no uncommitted changes). " +
    "Returns PASS if clean, FAIL with details if dirty.",
  args: {},
  async execute() {
    const result = await run(["git", "status", "--porcelain"])

    if (!result.ok) {
      return `FAIL: Could not check git status. Error: ${result.out}`
    }

    if (result.out === "") {
      return "PASS: Working tree is clean. No uncommitted changes."
    }

    const lines = result.out.split("\n")
    const staged = lines.filter(
      (l) => l.startsWith("M ") || l.startsWith("A ") || l.startsWith("D "),
    )
    const unstaged = lines.filter(
      (l) =>
        l.startsWith(" M") || l.startsWith(" D") || l.startsWith("MM"),
    )
    const untracked = lines.filter((l) => l.startsWith("??"))

    const summary = [
      `FAIL: Working tree is dirty. ${lines.length} file(s) with changes.`,
      "",
    ]

    if (staged.length > 0) {
      summary.push(`Staged (${staged.length}):`)
      for (const f of staged) summary.push(`  ${f}`)
      summary.push("")
    }
    if (unstaged.length > 0) {
      summary.push(`Unstaged (${unstaged.length}):`)
      for (const f of unstaged) summary.push(`  ${f}`)
      summary.push("")
    }
    if (untracked.length > 0) {
      summary.push(`Untracked (${untracked.length}):`)
      for (const f of untracked) summary.push(`  ${f}`)
      summary.push("")
    }

    summary.push("Options:")
    summary.push("  1. Stash changes: delegate to @git-ops to stash")
    summary.push("  2. Commit changes: delegate to @git-ops to commit")
    summary.push(
      "  3. Discard changes: only with explicit user confirmation",
    )

    return summary.join("\n")
  },
})

export const check_branch = tool({
  description:
    "Create or verify a dedicated branch for an issue. Uses the naming " +
    "convention <type>/<issue>-<slug>. If already on the correct branch, " +
    "reports success. Otherwise creates and switches to the new branch.",
  args: {
    issue_number: tool.schema.number().describe("GitHub issue number"),
    issue_title: tool.schema
      .string()
      .describe("Issue title (used to generate the branch slug)"),
    type: tool.schema
      .enum(["feature", "fix", "chore", "docs", "refactor", "test"])
      .optional()
      .describe("Branch type prefix (default: feature)"),
  },
  async execute(args) {
    const type = args.type || "feature"
    const slug = slugify(args.issue_title)
    const branchName = `${type}/${args.issue_number}-${slug}`

    // Check current branch
    const currentResult = await run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if (!currentResult.ok) {
      return `FAIL: Could not determine current branch. Error: ${currentResult.out}`
    }

    const currentBranch = currentResult.out

    // Check if already on a branch for this issue
    const issuePattern = `/${args.issue_number}-`
    if (currentBranch.includes(issuePattern)) {
      return [
        `PASS: Already on branch for issue #${args.issue_number}`,
        `  Branch: ${currentBranch}`,
      ].join("\n")
    }

    // Get default branch to branch from
    const defaultBranch = await getDefaultBranch()

    // Switch to default branch first if not already on it
    if (currentBranch !== defaultBranch) {
      const switchResult = await run(["git", "checkout", defaultBranch])
      if (!switchResult.ok) {
        return `FAIL: Could not switch to ${defaultBranch}. Error: ${switchResult.out}`
      }
    }

    // Pull latest
    const pullResult = await run(["git", "pull", "--ff-only"])
    if (!pullResult.ok) {
      // Non-fatal: might not have upstream set or be offline
    }

    // Check if branch already exists locally
    const existsResult = await run(["git", "rev-parse", "--verify", branchName])
    if (existsResult.ok) {
      // Branch exists, just switch to it
      const checkoutResult = await run(["git", "checkout", branchName])
      if (!checkoutResult.ok) {
        return `FAIL: Branch '${branchName}' exists but could not switch to it. Error: ${checkoutResult.out}`
      }
      return [
        `PASS: Switched to existing branch for issue #${args.issue_number}`,
        `  Branch: ${branchName}`,
      ].join("\n")
    }

    // Create new branch
    const createResult = await run(["git", "checkout", "-b", branchName])
    if (!createResult.ok) {
      return `FAIL: Could not create branch '${branchName}'. Error: ${createResult.out}`
    }

    return [
      `PASS: Created and switched to new branch for issue #${args.issue_number}`,
      `  Branch : ${branchName}`,
      `  Base   : ${defaultBranch}`,
    ].join("\n")
  },
})

export const check_plan = tool({
  description:
    "Check if an implementation plan has been posted as a comment on the " +
    "GitHub issue. Looks for a comment containing '## Implementation Plan'. " +
    "Returns PASS if found, WARN if not found.",
  args: {
    number: tool.schema.number().describe("GitHub issue number to check"),
  },
  async execute(args) {
    if (args.number <= 0) return "FAIL: Issue number must be a positive integer."

    const result = await run([
      "gh",
      "issue",
      "view",
      String(args.number),
      "--json",
      "comments",
    ])

    if (!result.ok) {
      return `FAIL: Could not fetch comments for issue #${args.number}. Error: ${result.out}`
    }

    try {
      const data = JSON.parse(result.out)
      const comments: Array<{
        body: string
        author: { login: string }
        createdAt: string
      }> = data.comments || []

      for (const comment of comments) {
        if (comment.body.includes("## Implementation Plan")) {
          const date = comment.createdAt
            ? new Date(comment.createdAt).toISOString().slice(0, 10)
            : "unknown"
          return [
            `PASS: Implementation plan found on issue #${args.number}`,
            `  Author : ${comment.author?.login || "unknown"}`,
            `  Date   : ${date}`,
          ].join("\n")
        }
      }

      return [
        `WARN: No implementation plan found on issue #${args.number}`,
        "",
        `Searched ${comments.length} comment(s) for a comment containing "## Implementation Plan".`,
        "",
        "Options:",
        "  1. Create and post a plan now (research codebase, draft plan, post as comment)",
        "  2. Skip plan check (requires explicit user confirmation)",
        "",
        "The user MUST explicitly confirm before proceeding without a plan.",
      ].join("\n")
    } catch {
      return `FAIL: Could not parse comments for issue #${args.number}. Raw: ${result.out}`
    }
  },
})

export const full_preflight = tool({
  description:
    "Run all pre-flight checks in sequence: verify issue exists, check for " +
    "clean working tree, create/verify dedicated branch, and check for an " +
    "implementation plan on the issue. Returns a consolidated report. " +
    "This is the preferred way to run pre-flight checks.",
  args: {
    issue_number: tool.schema.number().describe("GitHub issue number"),
    type: tool.schema
      .enum(["feature", "fix", "chore", "docs", "refactor", "test"])
      .optional()
      .describe("Branch type prefix (default: feature)"),
    skip_plan_check: tool.schema
      .boolean()
      .optional()
      .describe(
        "Skip the implementation plan check (default: false). " +
        "Set to true for trivial issues where a plan is not needed.",
      ),
  },
  async execute(args) {
    const lines: string[] = [
      "DevOps Pre-flight Check",
      "=======================",
      "",
    ]

    // 1. Check issue
    lines.push("1. Issue Check")
    lines.push("   -----------")

    const issueResult = await run([
      "gh",
      "issue",
      "view",
      String(args.issue_number),
      "--json",
      "number,title,state,labels,url",
    ])

    if (!issueResult.ok) {
      lines.push(`   FAIL: Could not find issue #${args.issue_number}.`)
      lines.push(`   Error: ${issueResult.out}`)
      lines.push("")
      lines.push("Pre-flight FAILED. Cannot proceed without a valid issue.")
      return lines.join("\n")
    }

    let issueTitle = ""
    try {
      const issue = JSON.parse(issueResult.out)
      issueTitle = issue.title || ""
      const labels =
        issue.labels?.map((l: any) => l.name).join(", ") || "none"
      lines.push(`   PASS: Issue #${issue.number} -- ${issue.title}`)
      lines.push(`   State: ${issue.state}  |  Labels: ${labels}`)

      if (issue.state === "CLOSED") {
        lines.push(
          "   WARNING: Issue is closed. Consider reopening or creating a new one.",
        )
      }
    } catch {
      lines.push(`   PASS: Issue #${args.issue_number} exists (could not parse details)`)
    }
    lines.push("")

    // 2. Check clean tree
    lines.push("2. Clean Tree Check")
    lines.push("   ----------------")

    const statusResult = await run(["git", "status", "--porcelain"])
    if (!statusResult.ok) {
      lines.push(`   FAIL: Could not check git status. Error: ${statusResult.out}`)
      lines.push("")
      lines.push("Pre-flight FAILED.")
      return lines.join("\n")
    }

    if (statusResult.out !== "") {
      const fileCount = statusResult.out.split("\n").length
      lines.push(
        `   FAIL: Working tree is dirty. ${fileCount} file(s) with changes.`,
      )
      lines.push("   Stash or commit changes before proceeding.")
      lines.push("")
      lines.push("Pre-flight FAILED. Clean the working tree first.")
      return lines.join("\n")
    }

    lines.push("   PASS: Working tree is clean.")
    lines.push("")

    // 3. Check/create branch
    lines.push("3. Branch Check")
    lines.push("   ------------")

    const type = args.type || "feature"
    const slug = slugify(issueTitle)
    const branchName = `${type}/${args.issue_number}-${slug}`

    const currentResult = await run([
      "git",
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])

    if (!currentResult.ok) {
      lines.push(`   FAIL: Could not determine current branch.`)
      lines.push("")
      lines.push("Pre-flight FAILED.")
      return lines.join("\n")
    }

    const currentBranch = currentResult.out
    const issuePattern = `/${args.issue_number}-`

    if (currentBranch.includes(issuePattern)) {
      lines.push(
        `   PASS: Already on branch '${currentBranch}' for issue #${args.issue_number}`,
      )
    } else {
      // Get default branch
      const defaultBranch = await getDefaultBranch()

      // Switch to default branch if needed
      if (currentBranch !== defaultBranch) {
        const switchResult = await run(["git", "checkout", defaultBranch])
        if (!switchResult.ok) {
          lines.push(`   FAIL: Could not switch to ${defaultBranch}.`)
          lines.push("")
          lines.push("Pre-flight FAILED.")
          return lines.join("\n")
        }
      }

      // Pull latest (non-fatal)
      await run(["git", "pull", "--ff-only"])

      // Check if branch exists
      const existsResult = await run([
        "git",
        "rev-parse",
        "--verify",
        branchName,
      ])

      if (existsResult.ok) {
        const checkoutResult = await run(["git", "checkout", branchName])
        if (!checkoutResult.ok) {
          lines.push(`   FAIL: Could not switch to existing branch '${branchName}'.`)
          lines.push("")
          lines.push("Pre-flight FAILED.")
          return lines.join("\n")
        }
        lines.push(`   PASS: Switched to existing branch '${branchName}'`)
      } else {
        const createResult = await run(["git", "checkout", "-b", branchName])
        if (!createResult.ok) {
          lines.push(`   FAIL: Could not create branch '${branchName}'.`)
          lines.push(`   Error: ${createResult.out}`)
          lines.push("")
          lines.push("Pre-flight FAILED.")
          return lines.join("\n")
        }
        lines.push(`   PASS: Created branch '${branchName}' from '${defaultBranch}'`)
      }
    }

    lines.push("")

    // 4. Check for implementation plan
    lines.push("4. Plan Check")
    lines.push("   ----------")

    if (args.skip_plan_check) {
      lines.push("   SKIP: Plan check skipped by user.")
      lines.push("")
    } else {
      const commentsResult = await run([
        "gh",
        "issue",
        "view",
        String(args.issue_number),
        "--json",
        "comments",
      ])

      let hasPlan = false
      let planAuthor = ""
      let planDate = ""

      if (commentsResult.ok) {
        try {
          const data = JSON.parse(commentsResult.out)
          const comments: Array<{
            body: string
            author: { login: string }
            createdAt: string
          }> = data.comments || []

          for (const comment of comments) {
            if (comment.body.includes("## Implementation Plan")) {
              hasPlan = true
              planAuthor = comment.author?.login || "unknown"
              planDate = comment.createdAt
                ? new Date(comment.createdAt).toISOString().slice(0, 10)
                : "unknown"
              break
            }
          }
        } catch {
          // If we can't parse comments, treat as no plan found
        }
      }

      if (hasPlan) {
        lines.push(
          `   PASS: Implementation plan found on issue #${args.issue_number}`,
        )
        lines.push(`   Author: ${planAuthor}  |  Date: ${planDate}`)
      } else {
        lines.push(
          `   WARN: No implementation plan found on issue #${args.issue_number}`,
        )
        lines.push(
          "   Post a plan comment with '## Implementation Plan' header before starting work,",
        )
        lines.push(
          "   or confirm to proceed without one.",
        )
      }
      lines.push("")
    }

    // Determine overall result
    const hasWarning = lines.some((l) => l.includes("WARN:"))
    const overallResult = hasWarning
      ? "Pre-flight PASSED with warnings. Review warnings before proceeding."
      : "Pre-flight PASSED. Ready to proceed."

    lines.push("=======================")
    lines.push(overallResult)
    lines.push("")
    lines.push(`Issue  : #${args.issue_number} -- ${issueTitle}`)
    lines.push(`Branch : ${branchName || currentBranch}`)

    return lines.join("\n")
  },
})

// ─── Test Validation ─────────────────────────────────────────────────

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

function detectProjectType(root: string): ProjectType {
  if (existsSync(`${root}/package.json`)) return "node"
  if (existsSync(`${root}/go.mod`)) return "go"
  if (existsSync(`${root}/pyproject.toml`) || existsSync(`${root}/requirements.txt`)) return "python"
  if (existsSync(`${root}/Cargo.toml`)) return "rust"
  if (existsSync(`${root}/pom.xml`) || existsSync(`${root}/build.gradle`)) return "java"
  return "generic"
}

function autoDetectTestCommand(pt: ProjectType): string | null {
  const commands: Record<ProjectType, string | null> = {
    node: "npm test",
    go: "go test ./...",
    python: "python3 -m pytest",
    rust: "cargo test",
    java: null, // too variable (maven vs gradle)
    generic: null,
  }
  return commands[pt]
}

export const validate_tests = tool({
  description:
    "Run test validation before committing. Detects available test " +
    "infrastructure in priority order: make local-test → make test → " +
    "auto-detect by project type. Returns PASS, FAIL, or WARN with " +
    "structured output and options for the user.",
  args: {},
  async execute(_args, context) {
    const root = context.directory || "."
    const lines: string[] = [
      "Test Validation",
      "===============",
      "",
    ]

    // Detection priority:
    // 1. make local-test
    // 2. make test
    // 3. auto-detect by project type

    // Check if Makefile exists and has test targets
    const hasMakefile = existsSync(`${root}/Makefile`)
    let testCommand: string | null = null
    let testSource = ""

    if (hasMakefile) {
      // Check for local-test target
      const localTestCheck = await run(["make", "-n", "local-test"])
      if (localTestCheck.ok) {
        testCommand = "make local-test"
        testSource = "Makefile target: local-test"
      } else {
        // Check for test target
        const testCheck = await run(["make", "-n", "test"])
        if (testCheck.ok) {
          testCommand = "make test"
          testSource = "Makefile target: test"
        }
      }
    }

    // Fallback: auto-detect by project type
    if (!testCommand) {
      const pt = detectProjectType(root)
      const autoCmd = autoDetectTestCommand(pt)
      if (autoCmd) {
        testCommand = autoCmd
        testSource = `auto-detected (${pt})`
      }
    }

    // No test infrastructure found → WARN
    if (!testCommand) {
      lines.push("Result: WARN")
      lines.push("")
      lines.push("No test infrastructure was found.")
      lines.push("")
      lines.push("Searched for:")
      lines.push("  1. make local-test  (not found)")
      lines.push("  2. make test        (not found)")
      lines.push("  3. Auto-detect      (no known test command for this project type)")
      lines.push("")
      lines.push("Options:")
      lines.push("  1. Proceed without test validation (requires explicit user confirmation)")
      lines.push("  2. Create a tracking issue to add test infrastructure")
      lines.push("  3. Abort and add tests before committing")
      lines.push("")
      lines.push("The user MUST explicitly confirm before proceeding without tests.")

      return lines.join("\n")
    }

    // Run the detected tests
    lines.push(`Detected: ${testSource}`)
    lines.push(`Command : ${testCommand}`)
    lines.push("")

    const cmdParts = testCommand.split(" ")
    const result = await run(cmdParts)

    if (result.ok) {
      // PASS
      lines.push("Result: PASS")
      lines.push("")
      lines.push("Tests passed. Proceeding to commit.")
      if (result.out) {
        lines.push("")
        lines.push("Output:")
        // Limit output to last 30 lines to avoid flooding
        const outputLines = result.out.split("\n")
        const tail = outputLines.length > 30
          ? outputLines.slice(-30)
          : outputLines
        if (outputLines.length > 30) {
          lines.push(`  ... (${outputLines.length - 30} lines truncated)`)
        }
        for (const l of tail) lines.push(`  ${l}`)
      }
    } else {
      // FAIL
      lines.push("Result: FAIL")
      lines.push("")
      lines.push("Tests failed. Review the output below.")
      lines.push("")
      lines.push("Output:")
      const outputLines = result.out.split("\n")
      const tail = outputLines.length > 50
        ? outputLines.slice(-50)
        : outputLines
      if (outputLines.length > 50) {
        lines.push(`  ... (${outputLines.length - 50} lines truncated)`)
      }
      for (const l of tail) lines.push(`  ${l}`)
      lines.push("")
      lines.push("Options:")
      lines.push("  1. Fix the failing tests and re-run validation")
      lines.push("  2. Skip test validation (requires explicit user confirmation — not recommended)")
      lines.push("  3. Abort the commit")
      lines.push("")
      lines.push("The user MUST explicitly confirm before skipping failed tests.")
    }

    return lines.join("\n")
  },
})
