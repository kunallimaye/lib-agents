---
name: design-defi
description: DeFi protocol design — composability, invariant design, economic security, and attack surface analysis
---

## What I do

- Provide protocol design frameworks for DeFi systems
- Document composability risks, invariant design, and economic security analysis
- Cover MEV exposure, governance patterns, and token economic constraints
- Supply attack surface analysis and anti-patterns for protocol designers

## When to use me

Use this skill when designing DeFi protocols, analyzing economic security,
or evaluating protocol composability. Pair with `design-core` for foundational
design principles and `design-web3` for blockchain architecture decisions.

## DeFi Protocol Taxonomy

| Category | Examples | Core Mechanism | Primary Risk |
|---|---|---|---|
| AMM | Uniswap, Curve, Balancer | Constant-function market making | Impermanent loss, MEV extraction |
| Lending/Borrowing | Aave, Compound, Morpho | Collateralized debt positions | Liquidation cascades, oracle failure |
| Yield Aggregator | Yearn, Beefy | Strategy routing across protocols | Composability risk, strategy bugs |
| Derivatives | GMX, dYdX, Synthetix | Synthetic exposure or perpetuals | Oracle manipulation, funding rate attacks |
| Stablecoins | MakerDAO, Frax, Ethena | Peg maintenance via collateral or algorithm | De-peg events, bank run dynamics |
| Liquid Staking | Lido, Rocket Pool | Tokenized staking positions | Validator slashing, redemption delays |

## Composability Risk Matrix

| Interaction | Risk Level | Failure Mode |
|---|---|---|
| Protocol A reads Protocol B's price | High | Oracle manipulation propagates across protocols |
| Protocol A holds Protocol B's LP tokens | Medium | IL or exploit in B drains A's reserves |
| Protocol A uses Protocol B as collateral | High | De-peg or exploit in B triggers cascading liquidations |
| Protocol A routes through Protocol B | Medium | B's downtime or exploit blocks A's core function |
| Protocol A governs Protocol B's parameters | Low-Medium | Governance attack on A compromises B |

**Rule:** Every external protocol dependency is an attack surface. Map all
dependencies before launch. Have circuit breakers for each.

## Invariant Design by Protocol Type

| Protocol Type | Core Invariant | Violation Consequence |
|---|---|---|
| AMM (x*y=k) | Reserve product is non-decreasing after fees | Funds drained via price manipulation |
| Lending | Total borrows <= total collateral * LTV | Protocol insolvency, bad debt |
| Stablecoin | Collateral value >= outstanding supply * target ratio | De-peg, bank run |
| Vault/Aggregator | Share price is monotonically non-decreasing | Depositors lose principal |
| Derivatives | Sum of all positions' PnL + fees = 0 (zero-sum) | Protocol takes unhedged directional risk |

**Test invariants continuously.** Every state transition must preserve
invariants. Fuzz with adversarial sequences, not just single operations.

## Economic Security Analysis Framework

1. **Oracle dependencies** -- List every price feed. What happens if each
   returns stale data, zero, or max uint? Use TWAP over spot where possible.
2. **Liquidation cascades** -- Model what happens when collateral drops 30%
   in one block. Can liquidators process the volume? Is there bad debt?
3. **Flash loan attack surface** -- Can any function be exploited when an
   attacker has unlimited capital for one transaction? Test every public
   function with flash-loaned inputs.
4. **Price manipulation vectors** -- Can a large trade in a low-liquidity
   pool move a price that your protocol depends on? Calculate cost of attack
   vs profit.
5. **Governance attack cost** -- How much capital to acquire enough votes
   to pass a malicious proposal? Is it less than the protocol's TVL?

## MEV Exposure Assessment

| MEV Type | Affected Protocols | Mitigation |
|---|---|---|
| Sandwich attacks | AMMs, DEX aggregators | Slippage limits, private mempools, batch auctions |
| Frontrunning | Liquidations, NFT mints | Commit-reveal schemes, Flashbots Protect |
| Backrunning | Oracle updates, large trades | Design for it; let arbitrageurs correct prices |
| JIT liquidity | Concentrated liquidity AMMs | Accept as feature; benefits traders |
| Liquidation MEV | Lending protocols | Dutch auction liquidations, gradual liquidation |

## Protocol Upgrade & Governance Patterns

| Pattern | Speed | Security | Best For |
|---|---|---|---|
| Immutable | N/A | Maximum | Simple, audited, final protocols |
| Timelock + multi-sig | Days | High | Production protocols with known admin set |
| Governor + token voting | Days-weeks | Medium | Decentralized protocols with active community |
| Emergency shutdown | Immediate | Situational | Circuit breaker for critical vulnerabilities |
| Optimistic governance | Days (unless vetoed) | Medium-High | Frequent parameter updates with safety net |

**Default:** Timelock (48h minimum) + multi-sig (3/5 or higher) for all
privileged operations. Emergency shutdown as a separate, faster path.

## Token Economic Design Constraints

- **Supply mechanics** -- Fixed supply, inflationary, or deflationary. Each
  creates different holder incentives and long-term sustainability.
- **Incentive alignment** -- Token holders, LPs, and users must all benefit
  from protocol growth. Misalignment leads to mercenary capital.
- **ve-token models** -- Lock tokens for voting power and boosted rewards.
  Aligns long-term holders but creates liquidity risk and governance capture.
- **Fee distribution** -- Protocol fees to token holders, treasury, or
  buyback-and-burn. Each has regulatory and incentive implications.
- **Emission schedules** -- Front-loaded emissions attract early users but
  create sell pressure. Gradual emissions sustain longer but grow slower.

## Anti-Patterns

| Anti-Pattern | Why It Fails | What To Do Instead |
|---|---|---|
| Unbounded composability | Each integration multiplies attack surface | Whitelist integrations; circuit breakers per dependency |
| Single oracle dependency | Oracle failure or manipulation breaks the protocol | Multiple oracle sources with median or fallback logic |
| No circuit breakers | Exploits drain entire TVL before anyone reacts | Pause functions, rate limits, maximum single-tx value |
| Rug-pullable admin keys | Single EOA controls protocol funds or parameters | Timelock + multi-sig; progressive decentralization |
| Untested invariants | Invariant violations discovered in production | Fuzz invariants with adversarial sequences before launch |
| Ignoring flash loan context | Functions assume capital constraints that flash loans remove | Test every public function with flash-loaned inputs |
| Copy-paste tokenomics | Token model from unrelated protocol misaligns incentives | Design token mechanics for your specific value flows |
