import { tool } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

// ─── Project Detection ───────────────────────────────────────────────

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

function detectProject(root: string): ProjectType {
  if (existsSync(join(root, "package.json"))) return "node"
  if (existsSync(join(root, "go.mod"))) return "go"
  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "requirements.txt"))
  )
    return "python"
  if (existsSync(join(root, "Cargo.toml"))) return "rust"
  if (
    existsSync(join(root, "pom.xml")) ||
    existsSync(join(root, "build.gradle"))
  )
    return "java"
  return "generic"
}

function projectLabel(pt: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    node: "Node.js/TypeScript",
    go: "Go",
    python: "Python",
    rust: "Rust",
    java: "Java",
    generic: "Generic",
  }
  return labels[pt]
}

// ─── File Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function safeWrite(
  path: string,
  content: string,
  force: boolean,
): string {
  if (existsSync(path) && !force) {
    return `  SKIP: ${path} (already exists)`
  }
  ensureDir(join(path, ".."))
  writeFileSync(path, content)
  return `  CREATED: ${path}`
}


// ─── Template Generators (split into separate files for diff/edit cost) ──
import { generateMakefile } from "./scaffold-templates-makefile"
import { generateCommonSh, generateLocalSh, generateContainerSh, generateCloudSh } from "./scaffold-templates-scripts"
import { generateDockerfile, generateDockerignore } from "./scaffold-templates-container"
import { generateCloudbuildYaml, generateCloudbuildPlanYaml, generateCloudbuildApplyYaml } from "./scaffold-templates-cloudbuild"
import { generateTfProviders, generateTfBackend, generateTfVariables, generateTfMain, generateTfOutputs, generateTfLb, generateTfDns } from "./scaffold-templates-terraform"
import { generateDeployerRoleYaml } from "./scaffold-templates-iam"
import { generateConfigPy, generateConfigTomlExample, generateEnvExample, generateAdrTemplate, generateAgentsLocalSection, gitignoreEntries } from "./scaffold-templates-docs"

// ─── Component Scaffolding Helpers ───────────────────────────────────

type ScaffoldComponent =
  | "makefile"
  | "scripts"
  | "container"
  | "cloudbuild"
  | "terraform"
  | "iam"
  | "adr"
  | "agentslocal"
  | "gitignore"

// ALL_COMPONENTS is the Full CI/CD bundle (the default when no
// components arg is provided). Order matters for display — list in the
// rough order that operators read.
const ALL_COMPONENTS: ScaffoldComponent[] = [
  "makefile",
  "scripts",
  "container",
  "cloudbuild",
  "terraform",
  "iam",
  "adr",
  "agentslocal",
  "gitignore",
]

async function scaffoldMakefile(root: string, pt: ProjectType, force: boolean): Promise<string[]> {
  return [
    "── Makefile ──",
    safeWrite(join(root, "Makefile"), generateMakefile(pt), force),
  ]
}

async function scaffoldScripts(root: string, pt: ProjectType, force: boolean): Promise<string[]> {
  const dir = join(root, "scripts")
  ensureDir(dir)
  const results = [
    "── Scripts ──",
    safeWrite(join(dir, "common.sh"), generateCommonSh(), force),
    safeWrite(join(dir, "local.sh"), generateLocalSh(pt), force),
    safeWrite(join(dir, "container.sh"), generateContainerSh(pt), force),
    safeWrite(join(dir, "cloud.sh"), generateCloudSh(), force),
    // config.py is required by common.sh when config.toml exists; ship it
    // alongside the shell scripts so the cloud workflow is self-contained.
    safeWrite(join(dir, "config.py"), generateConfigPy(), force),
    // config.toml.example lives at the project root (the real config.toml
    // is gitignored). Documents role-axis + env-axis shape (#141).
    safeWrite(join(root, "config.toml.example"), generateConfigTomlExample(), force),
    // .env.example lives at the project root. Sensitive overrides + the
    // ORCH_FORCE_RESTART escape hatch are documented here.
    safeWrite(join(root, ".env.example"), generateEnvExample(), force),
  ]
  try {
    await Bun.$`chmod +x ${dir}/*.sh`.text()
  } catch { /* non-fatal */ }
  return results
}

// Detect the project's short name from the directory name. Used to name
// the custom deployer-role YAML and the GCP custom role ID.
function projectShortName(root: string): string {
  // Resolve absolute path so basename works correctly.
  // No filesystem call beyond resolving; cheap.
  const parts = root.split("/").filter(Boolean)
  const last = parts.length > 0 ? parts[parts.length - 1] : "app"
  // Sanitize for use as a YAML filename + GCP custom role ID base.
  return last.replace(/[^a-zA-Z0-9-]/g, "-") || "app"
}

function scaffoldIam(root: string, force: boolean): string[] {
  const dir = join(root, "cicd", "iam")
  ensureDir(dir)
  const projName = projectShortName(root)
  return [
    "── IAM (custom deployer role) ──",
    safeWrite(
      join(dir, `${projName}-deployer-role.yaml`),
      generateDeployerRoleYaml(projName),
      force,
    ),
  ]
}

function scaffoldAdr(root: string, force: boolean): string[] {
  const dir = join(root, "docs", "decisions")
  ensureDir(dir)
  return [
    "── ADR template (cloud topology) ──",
    safeWrite(
      join(dir, "ADR-template-cloud-topology.md"),
      generateAdrTemplate(),
      force,
    ),
  ]
}

// Append the detached-orchestration convention section to AGENTS.local.md.
// We APPEND (not overwrite) because AGENTS.local.md is operator-owned —
// the scaffold should never blow away their custom local conventions.
function scaffoldAgentsLocal(root: string, _force: boolean): string[] {
  const path = join(root, "AGENTS.local.md")
  const section = generateAgentsLocalSection()
  const sectionMarker = "## Detached Orchestration Convention (issue #140)"
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8")
    if (existing.includes(sectionMarker)) {
      return ["── AGENTS.local.md ──", `  SKIP: ${path} (section already present)`]
    }
    const updated = existing.replace(/\n+$/, "") + "\n\n" + section
    writeFileSync(path, updated)
    return ["── AGENTS.local.md ──", `  APPENDED: detached-orchestration section to ${path}`]
  }
  // Create new with a brief header so the file is self-documenting.
  const header = `# Local Agent Conventions

This file lives alongside \`AGENTS.md\` and captures conventions that are
specific to this project. Subagents read both.

`
  writeFileSync(path, header + section)
  return ["── AGENTS.local.md ──", `  CREATED: ${path}`]
}

function scaffoldContainer(root: string, pt: ProjectType, force: boolean): string[] {
  const dir = join(root, "cicd")
  ensureDir(dir)
  return [
    "── Container Files ──",
    safeWrite(join(dir, "Dockerfile"), generateDockerfile(pt), force),
    safeWrite(join(dir, ".dockerignore"), generateDockerignore(pt), force),
  ]
}

function scaffoldCloudbuild(root: string, force: boolean): string[] {
  const dir = join(root, "cicd")
  ensureDir(dir)
  return [
    "── Cloud Build ──",
    safeWrite(join(dir, "cloudbuild.yaml"), generateCloudbuildYaml(), force),
    safeWrite(join(dir, "cloudbuild-plan.yaml"), generateCloudbuildPlanYaml(), force),
    safeWrite(join(dir, "cloudbuild-apply.yaml"), generateCloudbuildApplyYaml(), force),
  ]
}

function scaffoldTerraform(root: string, force: boolean): string[] {
  const dir = join(root, "cicd", "terraform")
  ensureDir(dir)
  return [
    "── Terraform ──",
    safeWrite(join(dir, "providers.tf"), generateTfProviders(), force),
    safeWrite(join(dir, "backend.tf"), generateTfBackend(), force),
    safeWrite(join(dir, "variables.tf"), generateTfVariables(), force),
    safeWrite(join(dir, "main.tf"), generateTfMain(), force),
    safeWrite(join(dir, "lb.tf"), generateTfLb(), force),
    safeWrite(join(dir, "dns.tf"), generateTfDns(), force),
    safeWrite(join(dir, "outputs.tf"), generateTfOutputs(), force),
  ]
}

function scaffoldGitignore(root: string, pt: ProjectType): string[] {
  const entries = gitignoreEntries(pt)
  const gitignorePath = join(root, ".gitignore")
  let existing: string[] = []
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf-8").split("\n")
  }
  const existingSet = new Set(existing.map((l) => l.trim()))
  const toAdd = entries.filter(
    (e) => !existingSet.has(e.trim()) && e.trim() !== "",
  )

  const results = ["── .gitignore ──"]
  if (toAdd.length === 0) {
    results.push("  .gitignore is up to date")
  } else {
    const newContent = existing.length > 0
      ? existing.join("\n") + "\n\n# Added by devops scaffold\n" + toAdd.join("\n") + "\n"
      : entries.join("\n") + "\n"
    writeFileSync(gitignorePath, newContent)
    results.push(
      existing.length > 0
        ? `  Updated .gitignore: added ${toAdd.length} entries`
        : `  Created .gitignore with ${entries.length} entries`,
    )
  }
  return results
}

// ─── Tool Export ─────────────────────────────────────────────────────

export const scaffold = tool({
  description:
    "Generate project operational structure: Makefile, scripts/, cicd/Dockerfile, " +
    "cicd/cloudbuild*.yaml, cicd/terraform/, cicd/iam/<deployer-role>.yaml, " +
    "docs/decisions/ADR-template-cloud-topology.md, AGENTS.local.md " +
    "(detached-orchestration section), and .gitignore. Implements the " +
    "three-role topology (orchestration/build/runtime) from issue #141 + " +
    "the Tier-2 detached-orchestration helpers from issue #140. " +
    "Detects project type and tailors all files. Use the 'components' " +
    "parameter to generate only specific parts, or omit it to generate " +
    "the Full CI/CD bundle. Skips existing files unless force=true.",
  args: {
    components: tool.schema
      .array(
        tool.schema.enum([
          "makefile",
          "scripts",
          "container",
          "cloudbuild",
          "terraform",
          "iam",
          "adr",
          "agentslocal",
          "gitignore",
        ]),
      )
      .optional()
      .describe(
        "Which components to scaffold. Options: makefile, scripts, " +
        "container, cloudbuild, terraform, iam (custom deployer-role YAML), " +
        "adr (cloud-topology ADR template), agentslocal " +
        "(detached-orchestration section in AGENTS.local.md), gitignore. " +
        "Omit to generate the Full CI/CD bundle.",
      ),
    force: tool.schema
      .boolean()
      .optional()
      .describe("Overwrite existing files (default: false)"),
  },
  async execute(args, context) {
    const root = context.directory || "."
    const pt = detectProject(root)
    const force = args.force || false
    const components: ScaffoldComponent[] =
      args.components && args.components.length > 0
        ? args.components as ScaffoldComponent[]
        : ALL_COMPONENTS

    const results: string[] = [
      "Project Scaffold (three-role topology, #141 + #140)",
      "=====================================================",
      `Detected project type: ${projectLabel(pt)}`,
      `Components: ${components.join(", ")}`,
      "",
    ]

    for (const component of components) {
      switch (component) {
        case "makefile":
          results.push(...await scaffoldMakefile(root, pt, force))
          break
        case "scripts":
          results.push(...await scaffoldScripts(root, pt, force))
          break
        case "container":
          results.push(...scaffoldContainer(root, pt, force))
          break
        case "cloudbuild":
          results.push(...scaffoldCloudbuild(root, force))
          break
        case "terraform":
          results.push(...scaffoldTerraform(root, force))
          break
        case "iam":
          results.push(...scaffoldIam(root, force))
          break
        case "adr":
          results.push(...scaffoldAdr(root, force))
          break
        case "agentslocal":
          results.push(...scaffoldAgentsLocal(root, force))
          break
        case "gitignore":
          results.push(...scaffoldGitignore(root, pt))
          break
      }
      results.push("")
    }

    results.push("=====================================================")
    results.push("Scaffold complete.")
    results.push("")
    results.push("Next steps for the Full CI/CD bundle:")
    results.push("  1. cp config.toml.example config.toml  (fill in [gcp.defaults].project)")
    results.push("  2. cp .env.example .env                (any sensitive overrides)")
    results.push("  3. make cloud-help                     (verify resolved topology)")
    results.push("  4. make admin-cloud-init               (Owner-tier 8-step bootstrap)")
    results.push("  5. make cloud-preflight                (read-only audit)")
    results.push("  6. make cloud-infra                    (TF apply via Cloud Build)")
    results.push("  7. make cloud-app-deploy               (image build + revision swap)")
    results.push("")
    results.push("Run 'make help' to see all available targets.")

    return results.join("\n")
  },
})
