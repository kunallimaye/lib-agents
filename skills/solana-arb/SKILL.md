---
name: solana-arb
description: Solana arbitrage engineering — Jupiter integration, MEV protection, and profit optimization
---

## What I do

- Guide Jupiter v6 API integration for quoting, routing, and swap execution
- Document arbitrage opportunity detection and profit calculation with failure economics
- Define MEV protection strategies with Jito bundles and anti-sandwich patterns
- Provide bot architecture patterns, monitoring, and honest testing strategies

## When to use me

Use this skill when building trading bots or arbitrage systems on Solana. Pair
with `solana-core` for transaction construction and RPC patterns, `rust-pro`
for Rust engineering, and `perf-rust` for hot-path optimization.

## Jupiter v6 Integration

- **Quote API**: `GET /quote` with `inputMint`, `outputMint`, `amount`, `slippageBps`
- **Swap API**: `POST /swap` with `quoteResponse` and `userPublicKey`
- **Route selection**: `ExactIn` vs `ExactOut`. Use `maxAccounts` to constrain
  tx size. `onlyDirectRoutes` is faster but may miss better multi-hop routes.
- **Direct AMM integration**: interact directly with Raydium/Orca/Phoenix pool
  programs for lower latency (skip Jupiter API round-trip)
- **Concurrent quoting**: `tokio::task::JoinSet` to quote multiple routes simultaneously

## Arbitrage Opportunity Detection

| Pattern | Description | Complexity |
|---|---|---|
| Triangular arb | A->B->C->A on a single DEX | Medium |
| Two-leg arb | Buy DEX1, sell DEX2 | Low |
| Cross-pool divergence | Same pair, different pools | Low |

### Decision tree: Is an opportunity real?

```
Price discrepancy detected
  -> Is quote < 2 slots old? NO -> discard (stale)
  -> Does simulated profit > all-in costs? NO -> skip
  -> Is the route still valid? NO -> re-quote
  -> Execute
```

Latency matters: the first bot to land the transaction captures the opportunity.

## Latency Budget Framework

| Phase | Budget | Typical | Optimization |
|---|---|---|---|
| Detection | <50ms | 100ms | Geyser stream vs polling |
| Quoting | <30ms | 80ms | Local route calc vs Jupiter API |
| Simulation | <20ms | 50ms | Cached simulation, skip when confident |
| Submission | <50ms | 100ms | Jito bundle vs direct RPC |
| Confirmation | <400ms | 800ms | Stake-weighted confirmation |
| **TOTAL** | **<550ms** | **1130ms** | **Target: sub-second end-to-end** |

Methodology: measure each phase with `std::time::Instant`, log p50/p95/p99,
optimize the widest phase first (same principle as `perf-core`).

## Profit Calculation

| Cost Component | How to Calculate | Typical Range |
|---|---|---|
| Base fee | 5000 lamports/signature | Fixed |
| Priority fee | compute_units x unit_price | 1K-1M lamports |
| Slippage | quote_amount - actual_received | 0.1-2% |
| Token account rent | If creating new ATAs | 0.002 SOL |
| Failed tx cost | base_fee + priority_fee (lost) | Full cost, zero revenue |
| RPC cost | Per-request pricing | Provider-dependent |

### Failed Transaction Economics

Solana arb failure rate: ~30-40% of transactions fail (dropped, expired,
front-run). Model this as a first-class business metric.

- Expected profit = `(gross_profit x success_rate) - (tx_cost x total_attempts)`
- A bot with 60% success rate and 0.001 SOL/tx cost needs >0.0017 SOL gross
  profit per trade to break even
- Track failed tx cost as a first-class P&L metric

## Atomic Execution & Jito Bundles

- **Atomic execution**: all swap instructions in a single transaction -- all
  succeed or all revert. Order: `compute_budget_ix` -> `swap_ix_1` -> `swap_ix_2`
- **Jito bundles**: submit transactions as an atomic bundle to the Jito block
  engine. Use when `gross_profit > tip_amount` AND trade is sandwichable.
- **Tips**: check Jito tip floor for minimum viable tip. Use Jito's published
  tip account addresses. Competitive tips for high-value trades.
- **Searcher API**: gRPC connection to Jito block engine for bundle submission

## Risk Management

| Risk | Detection | Mitigation |
|---|---|---|
| Stale quote | Timestamp > 2 slots old | Max quote age, re-quote before execute |
| Sandwich attack | Unusual slippage on landed tx | Jito bundles, tight slippage limits |
| Failed transaction | Simulation returns error | Pre-simulate every transaction |
| Inventory risk | Token balance drifts from target | Auto-rebalance at threshold |
| Network congestion | Slot skip rate > 5% | Dynamic priority fees, pause trading |
| Smart contract risk | Pool program upgrade | Monitor program upgrade authority |

## MEV Defense Checklist

- [ ] Use Jito bundles for all trades above minimum profit threshold
- [ ] Set per-route slippage limits (not a global default)
- [ ] Never broadcast swap intent via public mempool
- [ ] Verify tip amount covers bundle inclusion probability
- [ ] Monitor for unusual slippage patterns indicating adversarial activity
- [ ] Implement circuit breaker: stop trading after N consecutive losses
- [ ] Use separate fee-payer keypair from main trading keypair

## Bot Architecture

Async event loop: `stream(account_updates) -> filter(price_divergence > threshold)
-> quote(jupiter OR direct_amm) -> simulate -> execute(jito OR direct_send)`

- **Concurrent quoting**: `tokio::task::JoinSet` for multiple routes simultaneously
- **State management**: track in-flight transactions (avoid double-execution),
  cooldown per pool pair
- **Graceful shutdown**: drain in-flight transactions, log final P&L, do not
  open new positions

## Testing Strategies

| Environment | What It Validates | What It DOESN'T Validate |
|---|---|---|
| localnet (solana-test-validator + cloned state) | Tx construction, instruction ordering, error handling | Real latency, competition, actual liquidity |
| Devnet | Basic API integration, account creation | Arb profitability (no real liquidity or competition) |
| Mainnet paper trading | Real prices, latency, competition | Execution (observe but don't trade) |
| Mainnet live (small size) | Everything | Scale (start with minimum viable trade size) |

**The Devnet Lie**: devnet pools have no real liquidity and no competing bots.
A strategy profitable on devnet tells you nothing about mainnet viability.
Start with localnet for correctness, skip to mainnet paper trading for strategy.

## Monitoring & Observability

| Metric | Why | Alert Threshold |
|---|---|---|
| P&L per hour | Core business metric | Negative for >10 min |
| Transaction success rate | Execution quality | <80% |
| Quote-to-land latency p95 | Speed competitiveness | >500ms |
| Failed tx cost per hour | Wasted spend | >X SOL (user-defined) |
| Opportunity detection rate | Pipeline health | 0 for >5 min |
| Jito bundle inclusion rate | Bundle competitiveness | <50% |

## Anti-Patterns

| Anti-Pattern | Measurable Impact |
|---|---|
| Trusting quotes without simulation | Failed txs waste base + priority fees with zero revenue |
| Fixed slippage tolerance (e.g., 1% global) | Too loose on stable pairs (leaks value), too tight on volatile (misses trades) |
| No circuit breaker | Compounds losses during adverse conditions |
| Ignoring failed tx costs in P&L | Overstates profitability by 30-40% on typical Solana arb |
| Hardcoded priority fees | Underpays during congestion (dropped), overpays during calm (eats profits) |
| Single RPC endpoint with no failover | One provider outage halts all trading |
| Not accounting for ATA rent in profit calc | 0.002 SOL per new token account adds up |
| Submitting without Jito | Exposes profitable trades to sandwich attacks in public mempool |

## Companion Skills

| Domain | Skill | Coverage |
|---|---|---|
| Solana fundamentals | `solana-core` | Transactions, RPC, accounts, real-time data |
| Rust engineering | `rust-pro` | Ownership, error handling, async patterns |
| Performance optimization | `perf-rust` | Profiling, benchmarking, allocation analysis |
| Performance methodology | `perf-core` | Measure-profile-identify-optimize-verify loop |
