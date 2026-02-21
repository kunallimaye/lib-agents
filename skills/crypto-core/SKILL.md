---
name: crypto-core
description: Cryptographic engineering foundations — algebraic thinking, security invariants, and code review
---

## What I do

- Provide algebraic thinking foundations for cryptographic engineering
- Document finite field and elliptic curve properties used in modern protocols
- Define security invariants, threat models, and constant-time programming discipline
- Supply a cryptographic code review checklist for auditing implementations

## When to use me

Use this skill as the entry point for any cryptographic engineering task. Pair
with a domain-specific skill (`crypto-zkp`, `crypto-garbled-circuits`,
`crypto-bitvm`) for protocol-specific guidance.

## Core Mental Models

| Mental Model | What It Means | When To Apply |
|---|---|---|
| Everything is a polynomial | Computations become polynomial evaluations; proofs become commitment checks | Circuit design, proof system selection |
| Constraint != computation | A circuit constrains relationships between values; it does not compute them | Circuit writing, debugging |
| The simulator argument | If a simulator produces indistinguishable output without the witness, the protocol is zero-knowledge | Security analysis |
| Soundness by reduction | Security reduces to a hard mathematical problem (DLP, hash collision) | Threat modeling |
| Communication is the bottleneck | In MPC, minimizing rounds and bandwidth dominates local computation cost | Garbled circuit and MPC optimization |
| Prover-verifier asymmetry | Provers do heavy work so verifiers stay cheap -- this is a feature | System design |
| Composability is fragile | Secure protocols composed naively can become insecure | Protocol design, integration |

## Core Principles

1. **Never roll your own crypto primitives** -- Use audited libraries for field
   arithmetic, curve operations, and hash functions. Your job is to compose
   them correctly.
2. **State your threat model explicitly** -- Every design decision depends on
   who the adversary is and what they can do. Document it.
3. **Constraint count is your performance metric** -- In ZK, fewer constraints
   means faster proofs and lower costs. Optimize ruthlessly.
4. **Verify your verifier** -- A bug in the prover wastes time; a bug in the
   verifier breaks security. The verifier is the critical path.
5. **Test with adversarial witnesses** -- Do not just test the happy path.
   Generate invalid witnesses and confirm they are rejected.
6. **Fiat-Shamir requires domain separation** -- When making interactive
   protocols non-interactive, include all public parameters in the transcript.
7. **Constant-time is non-negotiable** -- Any branch or memory access that
   depends on secret data is a side channel.

## Finite Fields & Elliptic Curves

| Curve/Field | Field Size | Pairing | Post-Quantum | Used By |
|---|---|---|---|---|
| BN254 | 254-bit | Yes | No | Groth16 (Ethereum), circom |
| BLS12-381 | 381-bit | Yes | No | Ethereum 2.0, Zcash Sapling |
| Pasta (Pallas/Vesta) | 255-bit | No | No | Halo2, Mina |
| Goldilocks | 64-bit | No | No | Plonky2, STARKs |
| BabyBear | 31-bit | No | No | Plonky3, RISC Zero, SP1 |
| Mersenne31 | 31-bit | No | No | Circle STARKs, Stwo |

Small fields (Goldilocks, BabyBear) enable faster native arithmetic.
Pairing-friendly curves (BN254, BLS12-381) are required for Groth16 and
KZG commitments.

## Security Invariants

Properties to verify in any cryptographic protocol:

- **Completeness** -- an honest prover can always convince an honest verifier
- **Soundness** -- a cheating prover cannot convince a verifier (except with
  negligible probability)
- **Zero-knowledge** -- the verifier learns nothing beyond the statement's truth
- **Witness indistinguishability** -- the verifier cannot tell which witness
  was used

### Attack Catalog

| Attack | Target | Mitigation |
|---|---|---|
| Grinding | PoW-based commitments | Sufficient security parameter (>= 128 bits) |
| Proof malleability | Verification contexts | Bind proofs to session and context identifiers |
| Trusted setup compromise | SNARKs with ceremony | Use universal setup (PLONK) or STARKs |
| Side channel (timing) | Secret-dependent branches | Constant-time implementations only |
| Weak Fiat-Shamir | Non-interactive proofs | Include ALL public inputs in the transcript |
| Subgroup attack | Deserialized curve points | Validate on-curve AND subgroup membership |

## Anti-Patterns

| Anti-Pattern | Why It's Catastrophic | What To Do Instead |
|---|---|---|
| Field arithmetic with native integers | Overflow, timing leaks, incorrect modular reduction | Use audited libraries (arkworks, gnark, ffjavascript) |
| Reusing nonces across proofs | Enables secret key extraction | Fresh cryptographic randomness per proof |
| Weak Fiat-Shamir transcript | Proof malleability and replay attacks | Include unique session ID and all public inputs |
| No domain separation on hashes | Cross-protocol hash collisions | Prefix every hash with a unique domain tag |
| Skipping subgroup checks on deserialization | Invalid curve attacks in wrong subgroup | Validate on-curve AND correct subgroup |
| Hardcoded security parameters | Cannot adapt to evolving threats | Parameterize security level (lambda = 128, 256) |
| Using `Math.random()` for crypto | Predictable; adversary reconstructs secrets | `crypto.getRandomValues()` or `/dev/urandom` |
| Branching on secret values | Timing side channel leaks secret bits | Constant-time conditional selection |

## Code Review Checklist

### Field Arithmetic
- [ ] All arithmetic operates in the correct field (check prime)
- [ ] No integer overflow before modular reduction
- [ ] Inversion handles zero case (error, not silent failure)

### Constant-Time Operations
- [ ] No branching on secret values
- [ ] No secret-dependent memory access patterns
- [ ] Timing of operations does not leak input structure

### Randomness
- [ ] Cryptographically secure RNG for all secret generation
- [ ] No nonce reuse across proofs or protocol instances
- [ ] Randomness is fresh per proof (no caching or reuse)

### Protocol Composition
- [ ] Fiat-Shamir transcript includes ALL public parameters
- [ ] Domain separation tags on all hash calls
- [ ] No challenge reuse across protocol instances
- [ ] Binding and hiding properties preserved under composition

### Serialization & Transport
- [ ] Deserialized points validated (on-curve + subgroup check)
- [ ] Canonical serialization (no ambiguous encoding)
- [ ] Proof format includes version identifier

## Domain-Specific Skills

After establishing foundations with this skill, load the appropriate
domain-specific skill for protocol-level guidance:

| Domain | Skill | Coverage |
|---|---|---|
| Zero-knowledge proofs | `crypto-zkp` | Proof systems, circuit design, constraint fuzzing, formal verification |
| Garbled circuits and MPC | `crypto-garbled-circuits` | Yao's protocol, OT, half-gates, multi-party extensions |
| BitVM3 protocol | `crypto-bitvm` | Bitcoin script, Taproot, RISC-V verification, fraud proofs |
