---
name: crypto-garbled-circuits
description: Garbled circuits and multi-party computation — Yao's protocol, oblivious transfer, and MPC extensions
---

## What I do

- Guide garbled circuit protocol implementation from circuit design to evaluation
- Document oblivious transfer protocols and amortized OT extensions
- Cover optimization techniques (free-XOR, half-gates, point-and-permute)
- Provide multi-party computation extensions and MPC tooling guidance

## When to use me

Use this skill when implementing two-party or multi-party computation
protocols, designing garbled circuits, or working with oblivious transfer.
Pair with `crypto-core` for shared foundations and security checklists.

## Security Models

Always state which security model your implementation targets. Semi-honest
protocols are NOT secure against malicious adversaries.

| Model | Adversary Power | Guarantees | Protocols |
|---|---|---|---|
| Semi-honest | Follows protocol but tries to learn from transcript | Privacy of inputs | Basic Yao, GMW |
| Malicious | Can deviate arbitrarily from protocol | Privacy + correctness | Cut-and-choose Yao, SPDZ |
| Covert | Cheats if undetectable (deterrence-based) | Cheating detected with probability p | Covert-secure GC |

## Yao's Garbled Circuits Protocol

### Protocol Flow (Semi-Honest)

1. **Agree on function** -- Both parties agree on a Boolean circuit C
   computing f(x, y)
   *Security: circuit is public; no information leaks here*

2. **Garbler generates wire labels** -- For each wire w, create two random
   labels (w0, w1) representing bit values 0 and 1
   *Security: labels must be indistinguishable; use crypto RNG*

3. **Garbler garbles gates** -- For each gate, encrypt the output labels
   under the corresponding input labels using a PRF or hash
   *Security: garbled table reveals nothing about gate semantics*

4. **Garbler sends garbled circuit + own input labels** -- Transmit garbled
   tables and labels corresponding to the garbler's actual input bits
   *Security: only labels for garbler's actual bits are sent*

5. **Oblivious transfer for evaluator's input** -- Evaluator obtains labels
   for their input bits via 1-out-of-2 OT without revealing choice bits
   *Security: OT ensures garbler cannot learn evaluator's input*

6. **Evaluator evaluates** -- Decrypt each garbled gate using the received
   input labels to obtain the output labels
   *Security: evaluator sees only one label per wire (their path)*

7. **Output decoding** -- Garbler reveals the mapping from output labels
   to plaintext bits
   *Security: only the output wire mapping is revealed*

## Oblivious Transfer

### 1-out-of-2 OT

Sender holds two messages (m0, m1). Receiver holds a choice bit b. After
the protocol, receiver obtains m_b and sender learns nothing about b.

### OT Extensions

Base OT is expensive (requires public-key cryptography). OT extensions
amortize the cost: perform ~128 base OTs using public-key crypto, then
derive millions of OTs using only symmetric-key operations.

### Role in Garbled Circuits

OT is the mechanism that makes garbled circuit evaluation secure. Without
it, the garbler could infer the evaluator's input from which wire labels
were requested.

## Optimizations

| Optimization | Cost Reduction | How It Works |
|---|---|---|
| Free-XOR | XOR gates: 0 ciphertexts | Choose global offset D; set w1 = w0 XOR D for all wires. XOR output = label_a XOR label_b (no encryption) |
| Half-gates | AND gates: 2 ciphertexts (was 4) | Split AND into two half gates (one garbler-known, one evaluator-known), each needing 1 ciphertext |
| Point-and-permute | No trial decryption | Append a permutation bit to each label; evaluator knows which row to decrypt directly |
| Row reduction | AND gates: 3 ciphertexts (was 4) | Derive one output label from the hash; only encrypt the remaining three rows |

Modern implementations combine free-XOR + half-gates + point-and-permute.
This gives XOR gates for free and AND gates at 2 ciphertexts each.

## Multi-Party Extensions

| Protocol | Parties | Rounds | Approach | Best For |
|---|---|---|---|---|
| GMW | n >= 2 | O(depth) | Secret sharing + OT per AND gate | Low communication, high round count OK |
| BMR | n >= 2 | O(1) | All parties jointly garble | Low latency (constant rounds) |
| SPDZ | n >= 2 | O(1) online | Preprocessing + secret sharing | Malicious security, arithmetic circuits |
| ABY | 2 | Mixed | Hybrid GC + arithmetic + boolean SS | Mixed computation types |

**When to use which approach:**

- Use garbled circuits when the function is naturally Boolean and round
  count must be low
- Use secret sharing when the function is naturally arithmetic or the
  party count is high
- Use hybrid (ABY) when the function mixes Boolean and arithmetic
  operations

## Circuit Representation

### Bristol Format

Standard text format for Boolean circuits used by most MPC frameworks:

```
<num_gates> <num_wires>
<num_input_wires_party1> <num_input_wires_party2>
<num_output_wires>
<input_wires...> <output_wire> <gate_type>
```

Gate types: `AND`, `XOR`, `INV`, `OR`

Convert high-level functions to Bristol circuits using circuit compilers
(CBMC-GC, HyCC) for C/C++ programs, or manual decomposition for small
circuits. Minimize AND gate count -- AND gates are expensive while XOR
gates are free with the free-XOR optimization.

## Workflow: Implementing a Garbled Circuit Protocol

1. **Specify** -- Define the 2PC/MPC function f(x1, ..., xn). Identify
   which inputs are private to which party. Choose security model
   (semi-honest vs malicious).
2. **Compile to Boolean circuit** -- Convert the function to Boolean gates.
   Optimize for AND gate count (not total gate count). Use Bristol format.
3. **Choose protocol** -- 2 parties + Boolean: Yao's GC. n parties: GMW or
   BMR. Mixed computation: ABY. Malicious security: cut-and-choose or SPDZ.
4. **Implement** -- Use a framework (EMP-toolkit, MP-SPDZ, ABY). Do not
   implement OT or garbling primitives from scratch.
5. **Test** -- Verify correctness against plaintext computation. Test with
   adversarial inputs. Measure communication cost and round count.
6. **Audit** -- Run `crypto-core` code review checklist. Verify OT security.
   Check for wire label leakage. Confirm security model assumptions hold.

## MPC Tooling

| Tool | Language | Protocols | Maturity | Best For |
|---|---|---|---|---|
| EMP-toolkit | C++ | Yao's GC, OT, semi-honest + malicious | Production | Fast 2PC implementation |
| MP-SPDZ | C++/Python | 30+ protocols (GC, SS, mixed) | Production | Research, protocol comparison |
| ABY/ABY3 | C++ | Hybrid (GC + arithmetic + boolean SS) | Production | Mixed computation, 2-3 parties |
| MOTION | C++ | GMW, BMR, mixed protocols | Maturing | Multi-party with mixed gates |
| Obliv-C | C extension | Yao's GC | Stable | C-native oblivious computation |
| SCALE-MAMBA | C++/Python | SPDZ (malicious MPC) | Production | Malicious-secure arithmetic MPC |

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Reusing wire labels across circuit evaluations | Enables label recovery; breaks semantic security of garbling |
| Implementing OT from scratch | Subtle security requirements; use audited libraries |
| Assuming semi-honest security suffices | Real adversaries deviate from protocol; state model explicitly |
| Leaking garbled gate evaluation order | Reveals circuit topology to evaluator beyond what is necessary |
| Ignoring communication complexity | Network bandwidth often dominates computation cost in MPC |
| Not counting AND gates separately | XOR gates are free; only AND gates determine garbling cost |
