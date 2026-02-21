---
name: design-web3
description: Web3 system design — blockchain architecture, on-chain/off-chain decisions, and smart contract patterns
---

## What I do

- Bridge traditional system design concepts to blockchain-specific constraints
- Provide decision frameworks for on-chain vs off-chain placement
- Document smart contract architecture patterns and gas optimization
- Cover finality models, cross-chain communication, and state management

## When to use me

Use this skill when designing blockchain-based systems or migrating traditional
architectures to Web3. Pair with `design-core` for foundational design
principles and decision frameworks.

## Traditional to Web3 Paradigm Translation

| Traditional Concept | Web3 Equivalent | Key Difference |
|---|---|---|
| Database | Smart contract storage | Writes cost gas; storage is permanent and public |
| API server | Smart contract functions | Execution is trustless but expensive and rate-limited by block space |
| Authentication | Wallet signatures (ECDSA) | Self-sovereign identity; no password resets |
| Authorization | On-chain access control | Enforced by consensus, not by a server you control |
| Message queue | Events / logs | Append-only, indexed, but not readable by contracts |
| Cron job | Keeper networks (Chainlink, Gelato) | No native scheduling; external actors trigger execution |
| Load balancer | Multiple RPC endpoints | Decentralized but variable latency and reliability |
| Database migration | Contract upgrade pattern | Immutable by default; upgrades require proxy patterns |
| Caching layer | Indexer (The Graph, Subsquid) | On-chain reads are slow; indexers denormalize for query speed |
| CI/CD pipeline | Deployment scripts + verification | Deployed code is immutable; verify source on block explorer |

## On-chain / Off-chain Decision Framework

```
Does the data need trustless verification?
  YES --> On-chain (or commit hash on-chain, data off-chain)
  NO  |
      v
Does the operation need atomic composability with other contracts?
  YES --> On-chain
  NO  |
      v
Can the operation tolerate >12s latency (block time)?
  NO  --> Off-chain with on-chain settlement
  YES |
      v
Is the data larger than 1 KB per transaction?
  YES --> Off-chain storage (IPFS, Arweave) with on-chain hash
  NO  |
      v
Does the computation cost >500K gas?
  YES --> Off-chain compute with on-chain proof (ZK or optimistic)
  NO  --> On-chain is viable; evaluate gas cost vs trust benefit
```

## Smart Contract Architecture Patterns

| Pattern | Use Case | Trade-off |
|---|---|---|
| Transparent proxy | Upgradeable contracts | Admin key risk; storage collision possible |
| UUPS proxy | Upgradeable with lower gas | Upgrade logic in implementation; bricking risk |
| Diamond (EIP-2535) | Large contracts exceeding size limit | Complexity; harder to audit and verify |
| Minimal proxy (EIP-1167) | Deploying many identical contracts cheaply | Cannot be upgraded; fixed logic |
| Beacon proxy | Upgrading many proxies atomically | Single point of upgrade; centralization risk |
| Immutable | Maximum trust and simplicity | No bug fixes; must get it right the first time |

**Default choice:** Immutable for simple contracts. UUPS proxy when upgrades
are genuinely needed. Avoid Diamond unless contract size forces it.

## Gas Optimization as Architectural Constraint

Design-level decisions that dominate gas costs (not code-level tricks):

1. **Storage layout** -- Pack variables into 32-byte slots. One SSTORE
   costs 20K gas (cold) or 5K gas (warm). Minimize storage writes.
2. **Batch operations** -- Amortize fixed costs across multiple operations.
   One transaction with N transfers beats N transactions.
3. **Off-chain computation** -- Move computation off-chain; submit only
   results and proofs on-chain.
4. **Event-driven reads** -- Use events for data that only needs to be
   read off-chain. Events cost ~375 gas per topic vs 20K for storage.
5. **Lazy evaluation** -- Defer computation until the result is needed.
   Distribute gas cost across multiple transactions.

## Finality Models

| Chain Type | Finality | Time | Design Implication |
|---|---|---|---|
| Ethereum (PoS) | Probabilistic then finalized | ~15 min (2 epochs) | Wait for finalization for high-value operations |
| L2 Rollups | Soft confirmation, then L1 finality | Seconds (soft), hours (hard) | Design for two-tier confirmation UX |
| Solana | Optimistic confirmation | ~400ms | Fast but reorgs possible; confirm for value transfers |
| Cosmos (Tendermint) | Instant finality | ~6s | No reorgs; safe to act on first confirmation |
| Bitcoin | Probabilistic | ~60 min (6 blocks) | Wait for depth proportional to transaction value |

## Cross-chain Communication Patterns

| Pattern | Trust Model | Latency | Best For |
|---|---|---|---|
| Hash time-locked contracts (HTLC) | Trustless | Minutes-hours | Atomic swaps between chains |
| Light client bridges | Trust chain consensus | Minutes | High-security cross-chain messaging |
| Optimistic bridges | Trust + fraud proof window | 7+ days | L2-to-L1 withdrawals |
| Oracle-based bridges | Trust oracle set | Seconds-minutes | Speed-critical cross-chain transfers |
| ZK bridges | Trust math (proof verification) | Minutes | High-security with faster finality than optimistic |

**Default choice:** Use canonical bridges when available. For custom bridges,
prefer ZK or light client approaches over oracle-based for security.

## State Management on Blockchains

- **On-chain state** -- Minimal, critical data only (balances, ownership,
  protocol parameters). Expensive to write, cheap to verify.
- **Events as state** -- Emit events for historical data. Reconstruct state
  off-chain via indexers. Cannot be read by other contracts.
- **Off-chain indexing** -- Use The Graph or custom indexers for complex
  queries. Treat as a read cache, not source of truth.
- **Hybrid state** -- Merkle roots on-chain, full data off-chain (calldata,
  IPFS, DA layers). Verify inclusion proofs on-chain.

## Anti-Patterns

| Anti-Pattern | Why It Fails | What To Do Instead |
|---|---|---|
| Storing everything on-chain | Gas costs explode; blockchain is not a database | Store hashes on-chain, data off-chain |
| Ignoring MEV | Transactions are reordered for profit; users get worse prices | Design with MEV awareness; use private mempools or batch auctions |
| Treating blockchain as a database | Queries are expensive; no native indexing or joins | Use indexers for reads; blockchain is for verification |
| Single-chain lock-in | Chains evolve; users exist across ecosystems | Abstract chain-specific logic behind interfaces |
| Unbounded loops in contracts | Gas limit exceeded; transaction reverts | Use pagination or off-chain computation with proofs |
| Admin keys without timelock | Rug pull risk; single point of trust failure | Timelock + multi-sig for all privileged operations |
| Ignoring upgrade path | Immutable bugs with no recovery mechanism | Decide upgrade strategy before deployment; document it |
