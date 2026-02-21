---
name: design-arbitrage
description: Latency-sensitive trading and arbitrage system design — execution engines, risk management, and cross-venue patterns
---

## What I do

- Provide architecture frameworks for latency-sensitive trading systems
- Document tick-to-trade pipeline design and execution engine patterns
- Define risk management as a first-class design constraint
- Cover cross-venue and cross-chain arbitrage patterns

## When to use me

Use this skill when designing trading systems, arbitrage bots, or
latency-sensitive execution infrastructure. Pair with `design-core` for
foundational design principles and decision frameworks.

## Latency Budget Framework

Allocate your total latency budget across pipeline stages. Every microsecond
matters -- measure, don't guess.

| Pipeline Stage | Target (CEX) | Target (DEX) | Optimization Lever |
|---|---|---|---|
| Market data ingestion | <100 us | <10 ms | Binary protocols, kernel bypass, co-location |
| Signal generation | <50 us | <5 ms | Pre-computed tables, SIMD, branch-free logic |
| Risk check | <10 us | <1 ms | Lock-free data structures, pre-validated limits |
| Order construction | <20 us | <5 ms | Pre-built templates, connection pooling |
| Network transit | <1 ms | <100 ms | Co-location, direct market access, private mempools |
| Execution confirmation | <5 ms | 1-12 s | Optimistic execution, parallel confirmation |

**Rule:** Measure end-to-end latency at p99, not p50. The tail kills profits.

## Tick-to-Trade Pipeline Architecture

```
Market Data Feed(s)
  |
  v
Feed Handler (normalize, deduplicate, sequence)
  |
  v
Order Book Reconstruction (L2/L3 book maintenance)
  |
  v
Signal Engine (strategy logic, opportunity detection)
  |
  v
Risk Gate (pre-trade checks, position limits, exposure)
  |
  v
Execution Engine (order routing, smart order routing)
  |
  v
Confirmation Handler (fill tracking, position update)
  |
  v
Post-Trade (reconciliation, PnL, reporting)
```

**Critical path:** Feed Handler -> Signal -> Risk -> Execution. Everything
else is off the hot path. Never add latency to the critical path for
logging, metrics, or persistence.

## Market Data Normalization & Distribution

- **Feed handlers** -- One per venue. Normalize to internal format at the
  edge. Binary protocols (FIX/FAST, WebSocket binary) over JSON.
- **Order book reconstruction** -- Maintain local order book from incremental
  updates. Detect gaps and request snapshots. Never trust stale books.
- **Multi-venue aggregation** -- Merge books across venues for best
  bid/offer (BBO). Account for fees, latency, and fill probability.
- **Distribution** -- Shared memory or lock-free ring buffers for
  intra-process. Kernel bypass (DPDK, io_uring) for inter-process.

## Execution Engine Patterns

| Pattern | Latency | Complexity | Best For |
|---|---|---|---|
| Event-driven (single-threaded) | Lowest | Low | Simple strategies, single venue |
| Actor model | Low | Medium | Multi-strategy, multi-venue |
| Lock-free pipeline | Very low | High | Ultra-low-latency, dedicated hardware |
| Thread-per-venue | Medium | Low | Moderate latency requirements |

**Default choice:** Event-driven single-threaded for simplicity. Move to
lock-free pipeline only when measured latency demands it.

### Smart Order Routing

- **Venue selection** -- Route to venue with best price after fees. Factor
  in historical fill rates and latency.
- **Order splitting** -- Split large orders across venues to minimize
  market impact. Use TWAP/VWAP for size.
- **Retry logic** -- Rejected orders retry on alternate venues. Never
  retry without checking current position and risk limits.

## Risk Management as Design Constraint

Risk checks are on the critical path. They must be fast AND correct.

| Risk Check | Enforcement | Bypass = |
|---|---|---|
| Position limits | Per-instrument and portfolio-wide | Unbounded loss exposure |
| Notional limits | Maximum value per order and per time window | Single trade blows up account |
| Loss limits | Daily, hourly, per-strategy drawdown limits | Bleeding capital on broken strategy |
| Rate limits | Maximum orders per second per venue | Exchange ban, API revocation |
| Kill switch | Hardware or software emergency stop | No way to stop a runaway system |

**Kill switch is non-negotiable.** It must work independently of the trading
system. Hardware kill switch preferred. Test it weekly.

## Co-location & Infrastructure Decisions

- **Co-locate** when latency is the primary competitive advantage
- **Central hub** with low-latency links for cross-venue strategies
- **Own node** for DEX strategies; connect to block builders / private mempools
- **Cloud** in nearest region for moderate latency requirements
- **Hardware** -- FPGA for nanosecond-critical feed handling; GPU for parallel
  signal computation; commodity hardware for everything else
- **Network** -- Dedicated NICs, kernel bypass (DPDK), jumbo frames.
  Measure and minimize jitter, not just average latency.

## Cross-venue / Cross-chain Arbitrage Patterns

| Pattern | Execution | Risk | Latency |
|---|---|---|---|
| CEX-CEX | Simultaneous limit orders | Leg risk (partial fill) | Microseconds |
| CEX-DEX | CEX order + DEX swap | Leg risk + MEV extraction | Milliseconds-seconds |
| DEX-DEX (same chain) | Atomic via flash loan or multicall | No leg risk if atomic | Block time |
| DEX-DEX (cross-chain) | Bridge or intent-based | Bridge risk + timing risk | Minutes |
| Atomic (flash loan) | Borrow, swap, repay in one tx | Reverts if unprofitable | Block time |

**Atomic execution eliminates leg risk** but limits you to single-chain,
single-block opportunities. Non-atomic execution accesses more opportunities
but requires hedging and position management.

## Anti-Patterns

| Anti-Pattern | Why It Fails | What To Do Instead |
|---|---|---|
| GC in hot path | Stop-the-world pauses cause missed opportunities | Use GC-free languages (C, Rust) or pre-allocate in Java/Go |
| Unnecessary serialization | JSON/protobuf encoding adds microseconds per message | Use shared memory, zero-copy, or fixed-size binary formats |
| Blocking I/O in critical path | Thread blocks waiting for network; latency spikes | Non-blocking I/O, io_uring, or dedicated I/O threads |
| No kill switch | Runaway system trades until account is empty | Independent kill switch; test weekly |
| Untested failover | Primary fails; backup has never been tested | Regular failover drills; automated health checks |
| Logging on hot path | Disk I/O or lock contention in critical path | Async logging with ring buffer; sample in hot path |
| Backtesting without slippage | Strategy looks profitable but fails with real market impact | Model slippage, fees, and latency in backtests |
