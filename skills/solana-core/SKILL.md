---
name: solana-core
description: Solana blockchain engineering in Rust — transactions, accounts, RPC, and real-time data
---

## What I do

- Guide Solana transaction construction with versioned transactions, ALTs, and compute budget
- Provide RPC provider selection and real-time data streaming patterns
- Document solana-sdk and solana-client crate patterns for Rust engineers
- Define error handling and retry strategies for Solana-specific failure modes

## When to use me

Use this skill for any Solana blockchain project in Rust. Pair with `solana-arb`
for trading/arbitrage systems, `rust-pro` for Rust engineering patterns, and
`perf-rust` for performance optimization.

## Solana Programming Model

| Concept | What It Is | Key Property |
|---|---|---|
| Account | Data container with SOL balance | Owned by exactly one program |
| Program | Stateless executable code | Cannot store state; uses accounts |
| Transaction | Atomic batch of instructions | All succeed or all revert |
| Instruction | Single program invocation | Specifies program, accounts, and data |

- **Account ownership** -- each account owned by exactly one program. Only the
  owner can modify data. System program owns SOL accounts; token program owns token accounts.
- **Rent exemption** -- accounts must maintain minimum SOL balance (2 years rent)
  or be garbage collected. Always fund to rent-exempt minimum.
- **Program Derived Addresses (PDAs)** -- deterministic addresses generated via
  `Pubkey::find_program_address(&[seeds], &program_id)`. No private key exists;
  only the deriving program can sign for them.
- **Key difference from Ethereum** -- code and state are separate. Programs are
  stateless; all state lives in accounts passed to instructions.

## Transaction Construction

Always use **Versioned (v0) transactions** -- legacy transactions lack ALT
support and hit account limits sooner. Use `VersionedTransaction` with `MessageV0`.

- **Address Lookup Tables (ALTs)** -- use when >3 unique accounts. Compress
  32-byte addresses to 1-byte indices. Must be active 1 slot after creation.
- **Compute Budget** -- `set_compute_unit_limit(units)` and
  `set_compute_unit_price(micro_lamports)`. Place compute budget instructions
  FIRST. Simulate to get actual usage, set limit to 1.2x actual.
- **Transaction size limit: 1232 bytes** -- plan instruction packing carefully.
  Use ALTs aggressively to fit more instructions per transaction.

## RPC Provider Selection

```
Need sub-50ms latency to validator?
  YES --> Self-hosted validator + Geyser plugin
  NO  --> Need real-time account streaming?
    YES --> Helius or Triton (Yellowstone gRPC)
    NO  --> Need Solana-specific APIs (priority fees, DAS)?
      YES --> Helius
      NO  --> Any provider (DRPC, QuickNode, Alchemy)
```

| Provider | Solana Focus | Yellowstone gRPC | Priority Fee API | Best For |
|---|---|---|---|---|
| Helius | Dedicated | Yes | Yes | Trading, DeFi, NFTs |
| Triton | Dedicated | Yes | No | High-throughput streaming |
| DRPC | Multi-chain | No | No | General development |
| QuickNode | Multi-chain | No | No | Multi-chain projects |

## Real-Time Data Patterns

| Method | Latency | Complexity | Use When |
|---|---|---|---|
| `getAccountInfo` polling | 400-1000ms | Low | Infrequent checks, simple apps |
| WebSocket subscriptions | 100-400ms | Medium | Account/program monitoring |
| Yellowstone gRPC (Geyser) | 10-50ms | High | Trading, arbitrage, real-time feeds |

- **WebSocket**: `accountSubscribe` (specific accounts), `programSubscribe`
  (all accounts owned by a program), `logsSubscribe` (transaction logs)
- **Yellowstone gRPC**: managed (Helius/Triton) or self-hosted validator with
  Geyser plugin. Streams account updates, transactions, and slot notifications.
- **Reconnection**: always implement reconnection with exponential backoff.
  WebSocket connections drop frequently on Solana RPC nodes. Cap backoff at
  30 seconds, reset on successful reconnection.

## solana-sdk / solana-client Patterns

| Crate | Purpose | Key Types |
|---|---|---|
| `solana-sdk` | Core types and signing | `Pubkey`, `Keypair`, `VersionedTransaction`, `V0Message` |
| `solana-client` | RPC communication | `nonblocking::rpc_client::RpcClient` |
| `solana-transaction-status` | Transaction parsing | `UiTransactionEncoding`, `TransactionDetails` |
| `spl-token` | SPL token operations | `instruction::transfer`, `state::Account` |

**ALWAYS use nonblocking RPC client** -- `solana_client::nonblocking::rpc_client::RpcClient`.
Using the sync `RpcClient` in async context blocks the tokio runtime.

- Single signer: `VersionedTransaction::try_new(message, &[&keypair])`
- Multi-signer: pass all signers in the slice
- Always `simulate_transaction` before `send_transaction` -- catches errors without fees

## Priority Fee Estimation

- Query `getRecentPrioritizationFees` for accounts your transaction touches
- Percentile selection: p50 normal, p75 important, p90+ urgent
- Dynamic adjustment: increase when recent slot skip rate is high
- Helius API: `getPriorityFeeEstimate` returns recommended fee tiers
- Formula: `compute_unit_price = (fee_lamports * 1_000_000) / compute_units`

## Error Handling

| Error | Cause | Recovery |
|---|---|---|
| BlockhashNotFound | Blockhash expired (>150 slots / ~60s) | Refresh blockhash, rebuild and resend |
| InsufficientFunds | Not enough SOL for fees | Check balance before send, maintain reserve |
| AccountNotFound | Token account doesn't exist | Create ATA before transacting |
| ProgramFailedToComplete | Exceeded compute budget | Increase compute unit limit |
| SlippageToleranceExceeded | Price moved during execution | Retry with fresh quote |
| TransactionTooLarge | >1232 bytes | Use ALTs, split into multiple transactions |

- **Retry on**: `BlockhashNotFound`, transient network errors, rate limits (429)
- **Abort on**: program errors (`InstructionError`), `InsufficientFunds`, invalid accounts
- **Blockhash management**: fetch a fresh blockhash before each retry, not once upfront
- **Backoff**: exponential with jitter, starting at 100ms, capping at 5 seconds

## Anti-Patterns

| Anti-Pattern | Consequence |
|---|---|
| Using legacy transactions | Miss ALT benefits, hit account limit sooner |
| Hardcoded compute budget | Wastes SOL (too high) or gets dropped (too low) |
| Ignoring simulation results | Transactions fail on-chain, wasting fees |
| Not handling blockhash expiry | Transactions silently fail after ~60 seconds |
| Polling when streaming is available | Adds 100-500ms latency vs WebSocket/Geyser |
| Using sync `RpcClient` in async context | Blocks the tokio runtime, degrades throughput |
| Single RPC endpoint with no failover | One provider outage stops your system |
| Ignoring rent costs | Unexpected SOL drain from account creation |

## Companion Skills

| Domain | Skill | Coverage |
|---|---|---|
| Arbitrage engineering | `solana-arb` | Jupiter integration, MEV protection, profit optimization |
| Rust engineering | `rust-pro` | Ownership, error handling, unsafe audit, async patterns |
| Performance optimization | `perf-rust` | Profiling, benchmarking, allocation analysis |
