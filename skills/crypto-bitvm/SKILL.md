---
name: crypto-bitvm
description: BitVM3 protocol engineering — Bitcoin-native verification, fraud proofs, and bridging constructions
---

## What I do

- Guide BitVM3 protocol design including Taproot script trees and RISC-V verification
- Document the challenge-response bisection protocol for fraud proof construction
- Cover connector outputs, state continuity, and protocol sequencing
- Provide bridging construction patterns for trust-minimized Bitcoin bridges

## When to use me

Use this skill when designing BitVM3 verification schemes, constructing
fraud proofs for Bitcoin, or building trust-minimized bridges. Pair with
`crypto-core` for shared foundations and `crypto-zkp` for STARK-based
proof verification within BitVM3.

## Bitcoin Script Constraints

**Bitcoin cannot compute arbitrary programs, but it CAN verify claims
about computation. BitVM3 exploits this: execute off-chain, verify
on-chain only if disputed.**

| Constraint | Limit | Implication |
|---|---|---|
| No loops | Opcodes execute once | Cannot iterate; must unroll all logic |
| Stack-based | ~1000 element stack | Limited working memory per script |
| Script size | ~10,000 bytes per script | Single script cannot encode large programs |
| Block weight | 4 MB (witness discount) | Total transaction data is bounded |
| Limited opcodes | ~100 active opcodes | No native field arithmetic, no pairings |
| No state | Scripts are stateless | Cannot reference previous execution results |

## Taproot Script Trees

### MAST Structure

Merkelized Alternative Script Trees encode many spending conditions as
leaves in a Merkle tree. Only the exercised leaf is revealed on-chain.
This allows encoding large programs as many small script leaves, where
each leaf verifies one step of computation.

### Spending Paths

| Spending Path | When Used | On-Chain Cost |
|---|---|---|
| Key path | Cooperative case (all parties agree) | Minimal (single signature) |
| Script path | Dispute case (fraud proof needed) | Reveal Merkle proof + script leaf |

### Limits

- Taproot tree depth is practically limited by witness size (4 MB block
  weight limit)
- Each leaf script is limited to ~10,000 bytes
- Total addressable program size scales with depth * leaf_size, but only
  one leaf is revealed per spend

## RISC-V Trace Verification

### Why RISC-V

RISC-V is a minimal, open instruction set architecture with fixed-width
instructions. Each instruction modifies a small, well-defined machine
state (32 registers + memory). This makes single-step verification
feasible within Bitcoin script constraints.

### Execution Trace

1. Run the full program off-chain on a RISC-V emulator
2. Record the machine state (PC, registers, memory hash) at each step
3. Commit to the trace as a Merkle tree of state transitions
4. Each leaf represents one instruction: (state_before, instruction,
   state_after)

### Trace Segmentation

- Full trace may contain millions of steps
- Bisection protocol narrows any dispute to a single step
- Only ONE instruction verification happens on-chain
- That single step must be verifiable in a Bitcoin script leaf

## Challenge-Response Bisection

### Protocol Flow

1. **Operator claims result** -- Publishes computation result R and
   commits to the full execution trace (Merkle root of state transitions)
   *Staked: operator posts a security bond*

2. **Challenge window opens** -- Any verifier can dispute the result
   within the timeout period (e.g., 7 days)
   *If no challenge: operator withdraws bond + reward*

3. **Challenger initiates dispute** -- Posts a counter-claim with their
   own trace commitment and a challenge bond
   *Both parties now have funds at stake*

4. **Bisection rounds** -- Parties alternately identify the first point
   of disagreement by binary search over trace segments
   *Each round halves the disputed region; O(log n) rounds total*

5. **Single-step verification** -- Dispute narrowed to one instruction.
   Bitcoin script verifies: given state_before + instruction, does
   state_after match the operator's claim?
   *This is the only on-chain computation*

6. **Settlement** -- Correct party recovers both bonds. Incorrect party
   loses their entire stake.
   *Incentive: cost of cheating exceeds potential gain*

### Timeout Safety

Timeout parameters must account for Bitcoin network congestion. A
challenge timeout that is too short allows censorship attacks (adversary
pays high fees to delay the challenger's response). A timeout that is
too long unnecessarily delays settlement.

## Connector Outputs

Connector outputs enforce transaction ordering in the dispute protocol.

### How They Work

- Transaction T_n includes an output that can ONLY be spent by T_(n+1)
- This creates a directed chain: T1 -> T2 -> T3 -> ... -> T_final
- If any transaction in the chain is missing, subsequent transactions
  cannot be broadcast

### Why They Matter

- Prevent out-of-order execution of bisection rounds
- Ensure the dispute protocol follows the correct sequence
- Combined with timelocks, create a complete state machine on Bitcoin

### Design Rules

- Each protocol round corresponds to one pre-signed transaction
- Connector outputs link rounds sequentially
- Timelocks on each round enforce minimum response time
- All transactions are pre-signed before the protocol begins

## Bridging Constructions

| Approach | Trust Model | Operators | Capital Efficiency |
|---|---|---|---|
| Federated (e.g., Liquid) | n-of-m multisig | Fixed set | High |
| BitVM3 bridge | 1-of-n honest verifier | Permissionless challengers | Medium (bonded) |
| Hash time-lock (HTLC) | Trustless atomic swap | None (peer-to-peer) | Low (requires counterparty) |

### BitVM3 Bridge Pattern

1. Operator locks collateral in BitVM3 contract
2. User deposits BTC; operator mints equivalent on destination chain
3. Operator claims reimbursement by proving correct execution
4. Any verifier can challenge incorrect claims via bisection protocol
5. Honest verifier assumption: only ONE challenger needs to be honest

## Workflow: Building a BitVM3 Verification Scheme

1. **Define computation** -- Specify the function to verify on Bitcoin.
   Ensure it compiles to RISC-V. Estimate total trace length.
2. **Budget script size** -- Calculate Taproot tree depth needed. Verify
   each leaf fits in ~10KB. Check total witness weight against 4MB limit.
3. **Generate trace commitment** -- Run computation on RISC-V emulator.
   Build Merkle tree of state transitions. Commit root on-chain.
4. **Design connector output chain** -- Pre-sign all bisection round
   transactions. Link with connector outputs. Set timelock parameters.
5. **Implement single-step verifier** -- Write Bitcoin script that verifies
   one RISC-V instruction. This is the security-critical component. Test
   with every supported opcode.
6. **Test adversarially** -- Simulate disputes with intentionally incorrect
   traces. Verify the protocol catches every cheating strategy. Test
   timeout edge cases and fee market scenarios.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Taproot tree exceeding practical depth limits | Witness size exceeds block weight; transaction cannot be mined |
| Challenge timeout shorter than congestion spikes | Censorship attack: adversary pays high fees to delay challenger |
| Incomplete fraud proof coverage | Operator can cheat on uncovered execution paths without penalty |
| Connector output ordering bugs | Protocol rounds execute out of order; state machine breaks |
| Ignoring Bitcoin fee market dynamics | During fee spikes, challenge transactions may not confirm in time |
| Single-step verifier not tested against all opcodes | One unverifiable instruction allows operator to forge results |
| Operator collateral below maximum extractable value | Rational operator profits from cheating; bridge becomes insecure |

## BitVM3 Code Review Addendum

The following checks extend the `crypto-core` code review checklist with
Bitcoin-specific items:

- [ ] Taproot script tree depth within consensus limits
- [ ] Each script leaf fits within ~10,000 byte limit
- [ ] Total witness weight under 4 MB block weight
- [ ] Challenge timeout accounts for network congestion (7+ days recommended)
- [ ] Connector outputs enforce correct round sequencing
- [ ] All RISC-V opcodes covered by single-step verifier
- [ ] Fraud proof handles ALL operator cheating strategies
- [ ] Fee bumping strategy (RBF/CPFP) handles mempool congestion
- [ ] Operator collateral exceeds maximum extractable value from cheating
- [ ] Pre-signed transactions use appropriate sighash flags
