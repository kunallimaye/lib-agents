---
name: solana-defi-dev
description: Solana DeFi development — blockchain engineering, arbitrage, protocol design, and Rust performance

agents:
  - git-ops
  - devops
  - docs
  - pilot

agent_skills:
  build:
    - solana-core
    - solana-arb
    - design-core
    - design-defi
    - design-arbitrage
    - design-web3
    - rust-pro
    - perf-rust
  devops:
    - devops-workflow
    - makefile-ops
    - container-ops
    - cloudbuild-ops
    - gcloud-ops
  git-ops:
    - git-pr-workflow
    - git-release
  docs:
    - readme-conventions
  pilot: []
---

# Solana DeFi Dev Profile

Solana DeFi development profile bundling blockchain engineering, arbitrage,
protocol design, and Rust performance skills. This is Phase 0 — it uses only
skills and agents that already exist in the codebase.

## Target Personas

1. **Solana DeFi Builders** — Rust developers building DeFi protocols (AMMs,
   lending, vaults) using Anchor
2. **Arbitrage/MEV Engineers** — Developers building trading bots, arbitrage
   systems, and MEV strategies
3. **DeFi Protocol Architects** — Senior engineers designing protocol
   composability, economic security, and token mechanics

## Included Agents

| Agent | Purpose |
|-------|---------|
| `git-ops` | Git and GitHub operations |
| `devops` | DevOps workflows, containers, infrastructure |
| `docs` | README and documentation maintenance |
| `pilot` | Isolated experimentation and hypothesis testing |

## Included Skills

### Solana & Blockchain

| Skill | Agent | Description |
|-------|-------|-------------|
| `solana-core` | build | Solana blockchain fundamentals — accounts, transactions, RPC, real-time data |
| `solana-arb` | build | Arbitrage strategies, Jupiter, Jito bundles, MEV protection |

### System Design

| Skill | Agent | Description |
|-------|-------|-------------|
| `design-core` | build | Core system design principles |
| `design-defi` | build | DeFi protocol design, composability, invariants |
| `design-arbitrage` | build | Latency-sensitive trading system design, risk management |
| `design-web3` | build | On-chain/off-chain decisions, finality models |

### Rust Engineering

| Skill | Agent | Description |
|-------|-------|-------------|
| `rust-pro` | build | Rust engineering patterns |
| `perf-rust` | build | Rust performance optimization |

### Operational

| Skill | Agent | Description |
|-------|-------|-------------|
| `devops-workflow` | devops | Issue-driven DevOps workflow |
| `makefile-ops` | devops | Makefile and modular scripts |
| `container-ops` | devops | Podman container operations |
| `cloudbuild-ops` | devops | Cloud Build CI/CD patterns |
| `gcloud-ops` | devops | Google Cloud Platform operations |
| `git-pr-workflow` | git-ops | PR creation and review |
| `git-release` | git-ops | Release management |
| `readme-conventions` | docs | README best practices |

## Phase Roadmap

This profile is **Phase 0** of a multi-phase rollout:

- **Phase 0** (this issue): Bundle existing skills and agents
- **Phase 1**: Add `solana-anchor` skill (Anchor framework patterns)
- **Phase 2**: Add `solana-security` skill (program security audit checklist)
- **Phase 3**: Add `solana-testing` skill (localnet, bankrun, test patterns)
- **Phase 4**: Add `security-audit` agent (dedicated security review agent)
