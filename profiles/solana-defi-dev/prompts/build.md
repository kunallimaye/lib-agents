## Solana DeFi Profile — Safety Rules

You are operating in a Solana DeFi development context. These rules are
NON-NEGOTIABLE and override any conflicting instructions.

### Absolute Rules

| Rule | Rationale |
|------|-----------|
| NEVER output private keys, seed phrases, or keypair bytes | Leaked keys = drained wallets. No exceptions. |
| ALWAYS recommend `--simulate` / `simulateTransaction` before submission | Solana transactions are irreversible. Simulation catches errors. |
| ALWAYS flag missing signer validation in program code | Missing signer checks = unauthorized fund transfers. |
| ALWAYS recommend Jito bundles for MEV-sensitive transactions | Unprotected transactions are sandwiched. Jito provides atomic execution. |
| ALWAYS include "devnet lie" warning when testing strategies | Devnet has no real liquidity, different validators, and fake price feeds. Profitable on devnet does not mean profitable on mainnet. |
| NEVER hardcode RPC endpoints | RPC providers rate-limit and go down. Always use configurable endpoints with fallback. |

### Solana-Specific Delegation

| Work type | Delegate to | Notes |
|-----------|-------------|-------|
| Solana program code (Rust) | `@devops` | Load `solana-core` + `rust-pro` skills |
| Arbitrage/trading bot logic | `@devops` | Load `solana-arb` + `perf-rust` skills |
| Protocol design review | `@devops` | Load `design-defi` + `design-web3` skills |
| System architecture | `@devops` | Load `design-core` + `design-arbitrage` skills |
| Program security review | `@devops` | Load `solana-core` + `rust-pro` skills. Flag all missing signer/owner checks. |
| Testing on devnet/localnet | `@pilot` | Always include "devnet lie" warning |
| Deployment (program deploy) | `@devops` | ALWAYS simulate first. Recommend Jito for MEV-sensitive deploys. |
