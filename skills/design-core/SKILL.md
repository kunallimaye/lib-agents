---
name: design-core
description: System design foundations — first-principles thinking, evolution stages, and decision frameworks
---

## What I do

- Provide first-principles decomposition for system design problems
- Document mental models, evolution stages, and architecture decision trees
- Define design review checklists and common anti-patterns
- Supply cross-references to domain-specific design skills

## When to use me

Use this skill as the entry point for any system design task. Pair with a
domain-specific skill (`design-web3`, `design-defi`, `design-arbitrage`)
for specialized guidance.

## Core Mental Models

| Mental Model | What It Means | When To Apply |
|---|---|---|
| Trade-offs all the way down | Every design choice sacrifices something; make the sacrifice explicit | Architecture decisions, technology selection |
| Boundaries first | Define system boundaries and interfaces before internals | Service decomposition, API design |
| Complexity is debt | Every abstraction, dependency, and indirection has carrying cost | Adding components, choosing patterns |
| Prove it works | A running prototype beats a perfect diagram | Early design phases, technology evaluation |
| Scale is earned | Design for current load + 10x; re-architect at 100x | Capacity planning, infrastructure decisions |
| Failure is default | Systems fail; design for graceful degradation, not perfection | Reliability engineering, error handling |
| Delete before add | Removing complexity is more valuable than adding capability | Feature creep, refactoring decisions |

## Core Principles

1. **Decompose to atoms first** -- Break the problem into its smallest
   independent sub-problems before proposing any architecture.
2. **Simplest working system first** -- Build the simplest thing that
   validates your core hypothesis. Add complexity only when forced by
   real constraints.
3. **Working software over hypothesis** -- A running, verifiable system
   always beats a theoretical design. Ship, measure, iterate.
4. **Make failure cheap** -- Design so that failures are detected fast,
   blast radius is contained, and recovery is automated.
5. **Explicit over implicit** -- State assumptions, constraints, and
   trade-offs in writing. Implicit knowledge is a single point of failure.
6. **Gradual evolution** -- Tune and alter incrementally as usage grows
   or real issues emerge. Avoid big-bang rewrites.
7. **Pragmatic over elegant** -- Choose what works and is maintainable
   over what is theoretically beautiful.

## System Evolution Stages

| Stage | Scale Trigger | Architectural Response |
|---|---|---|
| 0 - Prototype | 0-100 users | Monolith, single database, manual deployment |
| 1 - Validated | 100-10K users | Read replicas, CDN, CI/CD pipeline, basic monitoring |
| 2 - Growing | 10K-100K users | Cache layer, async processing, horizontal scaling, load balancing |
| 3 - Scaling | 100K-1M users | Service decomposition, event-driven architecture, distributed tracing |
| 4 - Platform | 1M+ users | Multi-region, CQRS/event sourcing, dedicated teams per service |

Enter each stage only when the previous stage's limits are hit. Premature
advancement is the most common and most expensive architectural mistake.

## First-Principles Decomposition Protocol

1. **State the problem** -- One sentence: what must the system do?
2. **Identify inputs, outputs, and invariants** -- What goes in, what
   comes out, what must always be true?
3. **Find the hardest sub-problem** -- Which component has the tightest
   constraints (latency, consistency, throughput)?
4. **Design the simplest solution for the hardest part** -- Solve the
   constraint that matters most with the least complexity.
5. **Verify with back-of-envelope math** -- Will it handle the load?
   Storage? Bandwidth? Latency budget?
6. **Iterate** -- Add the next hardest sub-problem. Repeat until the
   system is complete.

## Architecture Decision Trees

### Data Store Selection

```
Need ACID transactions across multiple entities?
  YES --> Relational DB (PostgreSQL, MySQL)
  NO  |
      v
Need flexible schema or document storage?
  YES --> Document DB (MongoDB, Firestore)
  NO  |
      v
Need sub-millisecond key-value lookups?
  YES --> In-memory store (Redis, Memcached)
  NO  |
      v
Need full-text search?
  YES --> Search engine (Elasticsearch, Typesense)
  NO  |
      v
Need time-series or append-only writes?
  YES --> Time-series DB (TimescaleDB, InfluxDB)
  NO  --> Start with PostgreSQL (most versatile default)
```

### Communication Patterns

```
Need immediate response from the receiver?
  YES --> Synchronous (HTTP/gRPC)
  NO  |
      v
Need guaranteed delivery with ordering?
  YES --> Message queue (Kafka, Pub/Sub)
  NO  |
      v
Need fan-out to multiple consumers?
  YES --> Pub/Sub (Cloud Pub/Sub, SNS)
  NO  |
      v
Need real-time bidirectional communication?
  YES --> WebSockets or SSE
  NO  --> Async HTTP with polling or webhooks
```

### Deployment Topology

```
Single team, single service?
  YES --> Monolith on managed compute (Cloud Run, App Engine)
  NO  |
      v
Multiple teams, clear domain boundaries?
  YES --> Service per bounded context (Kubernetes, Cloud Run)
  NO  |
      v
Need extreme scale for specific components?
  YES --> Decompose hot path only; keep the rest monolithic
  NO  --> Modular monolith with clear internal boundaries
```

## Design Review Checklist

### Simplicity
- [ ] Can any component be removed without breaking the core use case?
- [ ] Are there fewer than 3 synchronous hops in the critical path?
- [ ] Is the data model normalized to the simplest correct form?
- [ ] Could a simpler technology achieve the same result?

### Failure Modes
- [ ] What happens when each dependency is unavailable for 5 minutes?
- [ ] Are timeouts, retries, and circuit breakers configured?
- [ ] Is there a kill switch for every non-critical feature?
- [ ] Can the system degrade gracefully under partial failure?

### Evolution
- [ ] Can the schema evolve without downtime?
- [ ] Are service interfaces versioned?
- [ ] Can components be replaced independently?
- [ ] Is there a rollback plan for every deployment?

## Anti-Patterns

| Anti-Pattern | Why It Fails | What To Do Instead |
|---|---|---|
| Premature microservices | Distributed complexity without distributed team or load | Start monolithic; decompose when forced by scale or team boundaries |
| Resume-driven architecture | Technology chosen for career value, not problem fit | Choose the most boring technology that solves the problem |
| Diagram-driven development | Architecture diagrams without running code | Build a walking skeleton first; diagram what you built |
| Speculative generality | Building for hypothetical future requirements | YAGNI -- build for today's requirements, design for tomorrow's |
| Distributed monolith | Microservices that must deploy together | If services share a release cycle, they are one service |
| Shared mutable state | Multiple services writing to the same database | Each service owns its data; communicate via APIs or events |
| No back-of-envelope math | Designing without validating capacity assumptions | Estimate QPS, storage, bandwidth before choosing architecture |

## Domain-Specific Skills

After establishing foundations with this skill, load the appropriate
domain-specific skill for specialized guidance:

| Domain | Skill | Coverage |
|---|---|---|
| Web3 and blockchain | `design-web3` | On-chain/off-chain decisions, smart contract patterns, gas optimization |
| DeFi protocols | `design-defi` | Protocol composability, invariant design, economic security |
| Trading and arbitrage | `design-arbitrage` | Latency budgets, execution engines, risk management as design constraint |
