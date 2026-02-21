---
name: crypto-zkp
description: Zero-knowledge proof engineering — circuit design, proof system selection, and formal verification
---

## What I do

- Guide proof system selection with a multi-dimensional decision framework
- Document circuit engineering discipline (R1CS, PLONKish arithmetization)
- Enforce adversarial constraint testing through the constraint fuzzer directive
- Cover formal verification tools and the ZKP tooling ecosystem

## When to use me

Use this skill when designing ZK circuits, selecting proof systems, or
implementing ZKP-based protocols. Pair with `crypto-core` for shared
foundations, security invariants, and code review checklists.

## Proof System Decision Framework

### Decision Tree

```
Need post-quantum security?
  YES --> zk-STARKs (hash-based, no pairings)
  NO  |
      v
Need minimal proof size? (on-chain verification)
  YES --> Groth16 (~200 bytes, trusted setup per circuit)
  NO  |
      v
Need universal/updatable setup?
  YES --> PLONK variants (KZG setup, reusable across circuits)
  NO  |
      v
Need no trusted setup at all?
  YES --> Bulletproofs (no setup, O(n) verification)
          or STARKs (no setup, large proofs, fast verification)
  NO  |
      v
Need recursive proof composition?
  YES --> Nova/SuperNova (folding schemes)
          Halo2 (IPA-based recursion)
          Plonky2/3 (STARK-inside-SNARK)
  NO  |
      v
Need general computation (not custom circuits)?
  YES --> zkVM: SP1, RISC Zero, Jolt, Valida
  NO  --> Custom circuit: circom, halo2, noir
```

### Comparison Matrix

| System | Setup | Proof Size | Prover | Verifier | Post-Quantum | Recursion |
|---|---|---|---|---|---|---|
| Groth16 | Per-circuit | ~200 B | Slow | Very fast | No | Difficult |
| PLONK (KZG) | Universal | ~400 B | Medium | Fast | No | Yes |
| PLONK (IPA) | None | ~1.5 KB | Medium | Slower | No | Yes |
| STARKs | None | ~50-200 KB | Fast | Fast | Yes | Yes |
| Bulletproofs | None | ~700 B | Slow | Slow (O(n)) | No | No |
| Nova | None | ~10 KB | Fast (IVC) | Fast | Depends | Native |

## Circuit Engineering

### Arithmetization

| Aspect | R1CS | PLONKish |
|---|---|---|
| Gate type | a * b = c (multiplication gates) | Custom gates, lookup tables |
| Flexibility | Fixed structure | Highly configurable |
| Best for | Simple circuits (Groth16) | Complex circuits (halo2, PLONK) |
| Optimization | Minimize multiplication gates | Minimize rows, use lookups |

### The Critical Distinction

In circom, `<--` is **witness assignment** (prover-side computation, not
enforced by the verifier). `===` is a **constraint** (enforced by the
verifier). A circuit with assignments but no constraints accepts ANY witness.

Always verify: constraint count matches expected count. Use the `--inspect`
flag to audit constraints.

### Optimization Patterns

- **Lookup tables** for range checks and non-arithmetic operations
- **Custom gates** for repeated sub-circuits (PLONKish only)
- **Batch inversions** -- one inversion + n multiplications instead of n
  inversions
- **Algebraic tricks** -- x^3 costs 1 constraint (x*x=x2, x2*x=x3), not 2
- **Constant propagation** -- replace known-at-compile-time values to
  eliminate constraints

## Constraint Fuzzer Directive

Before any circuit is considered tested, generate and verify rejection of
these adversarial witnesses. Do not skip this step.

1. **All-zeros** -- set every private input to 0
2. **All-max** -- set every private input to (field_prime - 1)
3. **Perturbed valid** -- take a valid witness, randomly change one value
4. **Swapped inputs** -- swap two private input values
5. **Replayed witness** -- use a valid witness from a different public input

All five must be REJECTED by the constraint system. If any passes,
the circuit is under-constrained.

Under-constrained circuits compile, generate proofs with valid witnesses,
and appear to work correctly. They silently break security. This is the
most dangerous class of ZK bug.

## Workflow: Designing a ZK Circuit

1. **Specify** -- Define the statement: "I know w such that f(x, w) = true"
   where x is public. List all security properties needed.
2. **Arithmetize** -- Decompose the computation into field operations (+, *,
   =). Choose R1CS or PLONKish. Estimate constraint count.
3. **Implement** -- Choose tooling: circom for simple circuits, halo2 for
   complex circuits with custom gates, noir for portability. Separate
   witness generation from constraint logic.
4. **Test** -- Valid witness passes. Run constraint fuzzer directive. Test
   edge cases: zero values, max field elements, boundary conditions.
5. **Optimize** -- Profile constraint count per operation. Apply lookup
   tables, custom gates, batch inversions. Re-test after every change.
6. **Audit** -- Run `crypto-core` code review checklist. Check for
   under-constrained values. Run formal verification tools.
7. **Deploy** -- Generate or use trusted setup (if applicable). Deploy
   verifier contract (if on-chain). Monitor proof generation times.

## Formal Verification

| Tool | Target | What It Checks |
|---|---|---|
| ecne | circom circuits | Constraint equivalence to specification |
| Picus | circom circuits | Under-constraint detection (finds missing constraints) |
| Certora | Solidity verifiers | Smart contract correctness of on-chain verifiers |

Use formal verification when: (1) the circuit handles financial value,
(2) constraint count exceeds 10,000, or (3) the circuit will be deployed
without further audit. Formal verification does not replace adversarial
testing -- it complements it.

## Tooling Ecosystem

| Tool | Language | Proof System | Maturity | Best For |
|---|---|---|---|---|
| circom | DSL (JS/Wasm) | Groth16, PLONK | Production | Simple-to-medium circuits, rapid prototyping |
| snarkjs | JavaScript | Groth16, PLONK | Production | Proof generation and verification for circom |
| halo2 | Rust | PLONKish (IPA/KZG) | Production | Complex circuits, custom gates, lookups |
| arkworks | Rust | Multiple | Production | Research, custom proof systems, flexibility |
| noir | DSL (Rust) | Backend-agnostic | Maturing | Portable ZK apps, developer experience |
| gnark | Go | Groth16, PLONK | Production | Go ecosystem, fast prover |
| SP1 | Rust (zkVM) | STARK-based | Maturing | General computation proofs, RISC-V |
| RISC Zero | Rust (zkVM) | STARK-based | Production | General computation, developer-friendly |
| Jolt | Rust (zkVM) | Sum-check | Research | Lookup-based zkVM |
| Plonky2/3 | Rust | STARK + recursion | Production | Recursive proofs, Ethereum L2s |
| rapidsnark | C++ | Groth16 | Production | Fast server-side Groth16 proving |
| Circomlib | circom | N/A | Production | Standard circuit library (hashes, sigs, etc.) |

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Confusing `<--` with `===` in circom | Creates under-constrained circuit; prover can forge proofs |
| Testing only with valid witnesses | Misses under-constrained circuits that accept invalid proofs |
| Optimizing before constraint count is baselined | Cannot measure improvement without a baseline |
| Using Groth16 when circuit changes frequently | Every circuit change requires a new trusted setup ceremony |
| Ignoring proof malleability | Third parties can modify proofs without invalidating them |
| Skipping formal verification on high-value circuits | Under-constraints are invisible to standard testing |
