---
name: rust-pro
description: Professional Rust engineering — ownership decisions, error handling, unsafe auditing, and async patterns
---

## What I do

- Guide ownership and borrowing decisions with a deterministic decision tree
- Provide error handling protocols for libraries, applications, and CLIs
- Define an unsafe audit protocol for verifying memory safety invariants
- Cover async programming patterns, concurrency selection, and essential tooling

## When to use me

Use this skill when writing, reviewing, or optimizing Rust code. It covers
ownership decisions, error handling, trait design, unsafe auditing, and async
patterns. Pair with `perf-core` for profiling methodology and benchmarking workflow.

## Ownership Decision Tree

```
Need to own the data?
  NO  --> &T (shared borrow) or &mut T (exclusive borrow)
  YES |
      v
Need heap allocation? (large, recursive, or trait object)
  YES --> Box<T>
  NO  |
      v
Need shared ownership?
  NO  --> T (move semantics)
  YES |
      v
Shared across threads?
  YES --> Arc<T> (read-only) or Arc<Mutex<T>> (read-write)
  NO  --> Rc<T> (read-only) or Rc<RefCell<T>> (read-write)

Sometimes owned, sometimes borrowed?
  --> Cow<'_, T>
```

**Every type has a drop story.** Before creating a type that holds resources
(file handles, connections, locks), decide what happens when it is dropped.
If cleanup is needed, implement `Drop`.

- Clone is correct for: small `Copy` types, prototyping, when ownership semantics require it
- Clone is a smell when: silencing the borrow checker, in hot loops, on large allocations
- Prefer: `&T`, `Cow<'_, T>`, or restructured ownership over reflexive cloning

## Error Handling Protocol

| Context | Error Type | Crate | Pattern |
|---|---|---|---|
| Library (public API) | Custom enum | `thiserror` | `#[derive(Error, Debug)]` with `#[error("...")]` |
| Application | Contextual | `anyhow` | `anyhow::Result<T>` with `.context("...")` |
| CLI tool | Contextual + exit | `anyhow` | `anyhow::Result<()>` in `main()` |
| Internal module | Custom or `anyhow` | Either | Match module's public/private boundary |

1. Never `.unwrap()` in library code -- use `?` or return `Result`
2. Never `.unwrap()` in async code -- panics in tasks are hard to debug
3. `.unwrap()` is acceptable in: tests, provably infallible cases (with comment), and early prototyping
4. Prefer `.expect("reason")` over `.unwrap()` when unwrapping is justified
5. Use `map_err` to convert between error types at module boundaries
6. Preserve error chains -- do not discard inner errors

## Lifetime Complexity Budget

| Level | Cost | What It Looks Like | When To Use |
|---|---|---|---|
| 1 | Free | Elision (no annotation) | Default for functions and methods |
| 2 | Cheap | `'static` | Owned data, static strings, thread spawning |
| 3 | Moderate | Single `'a` | Structs borrowing one source, iterators |
| 4 | Expensive | Multiple `'a`, `'b` | Structs borrowing multiple sources |
| 5 | Very expensive | `Pin<&mut Self>`, `PhantomData<&'a T>` | Self-referential types, async futures |

- Always try the cheaper level first. Escalate only when the compiler requires it.
- If you are fighting the borrow checker at level 3+, restructure your data model to use owned data or `Arc`.
- Most code stays at level 1-2. Level 4-5 should be rare and always documented.

## Trait Design Patterns

| Decision | Choose A | Choose B |
|---|---|---|
| Open vs closed set of types | Trait (extensible by downstream) | Enum (fixed set, exhaustive match) |
| One impl per type vs many | Associated type (`type Output`) | Generic parameter (`<T>`) |
| Need type-erased collection | `dyn Trait` (dynamic dispatch) | Generic `<T: Trait>` (monomorphized) |
| Add methods to foreign type | Extension trait (`trait FooExt`) | Newtype wrapper |
| Enforce compile-time property | Marker trait (`trait Sealed {}`) | PhantomData or type state |

- Default to static dispatch (generics). Use `dyn Trait` only when you need heterogeneous collections or to reduce compile times.
- Use supertraits to compose behavior: `trait Service: Send + Sync + 'static`.
- Implement `From<T>` instead of custom conversion methods for type conversions.

## Unsafe Audit Protocol

Valid reasons for unsafe:

1. **FFI** -- calling C libraries or exposing Rust to C
2. **Performance primitive** -- implementing a safe abstraction over raw pointers (e.g., custom collection)
3. **Compiler limitation** -- working around borrow checker where you can prove safety (rare, document extensively)

Audit checklist:

- [ ] Safety invariant documented in `// SAFETY:` comment above every unsafe block
- [ ] `cargo +nightly miri test` passes for all tests exercising unsafe code
- [ ] Unsafe code encapsulated behind a safe public API (no unsafe in public interface)
- [ ] Adversarial inputs tested (null pointers, out-of-bounds, concurrent access)
- [ ] Code review explicitly acknowledges unsafe and verifies invariant

Unsafe internals, safe externals. Every unsafe block should be wrapped in a
function or module that exposes a safe API. Users of your code should never
need to write unsafe.

## Async & Concurrency

### Async Patterns

| Pattern | Guidance |
|---|---|
| Runtime selection | Use `tokio` unless you have a specific reason not to |
| `Send + Sync` | All data held across `.await` must be `Send`. Use `Arc` instead of `Rc` in async. |
| Locks across `.await` | Never hold `MutexGuard` across an `.await` point. Drop the guard first or use `tokio::sync::Mutex`. |
| `spawn` vs `spawn_blocking` | `spawn` for async work. `spawn_blocking` for CPU-bound or blocking I/O. |
| Cancellation safety | Assume any `.await` can be cancelled. Do not rely on destructors running after cancellation. |
| `select!` | Use `tokio::select!` for racing futures. Every branch must be cancellation-safe. |
| Streams | Prefer `StreamExt` combinators over manual `poll_next`. |

### Concurrency Selection Matrix

| Need | Mechanism | When |
|---|---|---|
| Exclusive mutable access | `Mutex<T>` | Short critical sections, low contention |
| Read-heavy shared access | `RwLock<T>` | Many readers, rare writers |
| Message passing | `mpsc`, `oneshot`, `broadcast` | Decoupled components, actor pattern |
| Lock-free counter/flag | `AtomicUsize`, `AtomicBool` | Simple shared state, high contention |
| Data parallelism | `rayon` | CPU-bound work over collections |

Prefer message passing (channels) over shared state (`Mutex`). Channels make
ownership transfer explicit and avoid deadlocks.

## Tooling

| Tool | Purpose | Command |
|---|---|---|
| `cargo clippy` | Lint with pedantic rules | `cargo clippy -- -W clippy::pedantic` |
| `cargo fmt` | Format code (rustfmt) | `cargo fmt --check` (CI) / `cargo fmt` (fix) |
| `cargo nextest` | Fast parallel test runner | `cargo nextest run` |
| `cargo deny` | Audit deps for vulnerabilities and licenses | `cargo deny check` |
| `cargo expand` | Show macro expansion output | `cargo expand --lib` |
| `cargo miri` | Detect undefined behavior in unsafe code | `cargo +nightly miri test` |
| `cargo fuzz` | Fuzz testing for crash discovery | `cargo fuzz run <target>` |
| `cargo doc` | Generate and verify documentation | `cargo doc --no-deps --document-private-items` |
| `bacon` | Background code checker (watch mode) | `bacon clippy` |

Run `clippy`, `fmt --check`, `nextest`, and `deny check` in CI on every pull
request. Add `miri` for crates with unsafe code.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| `.clone()` to silence the borrow checker | Hides ownership design flaws; creates unnecessary allocations in hot paths |
| `Arc<Mutex<T>>` as default shared state | Adds overhead when single-threaded `Rc<RefCell<T>>` or channels suffice |
| `.unwrap()` in library code | Panics are unrecoverable; callers cannot handle the error |
| `String` parameters instead of `&str` | Forces callers to allocate; accept `impl AsRef<str>` or `&str` |
| `Box<dyn Error>` in public library API | Callers cannot match on error variants; use `thiserror` enum |
| Holding `MutexGuard` across `.await` | Blocks the executor thread; causes deadlocks with single-threaded runtime |
| Fighting the borrow checker with lifetimes | Restructure data model to use owned data or `Arc` instead |
| `unsafe` without `// SAFETY:` comment | Invariant is undocumented; cannot be verified during review |
| Ignoring `clippy::pedantic` | Misses idiomatic patterns, potential bugs, and API design issues |

## Companion Skills

| Domain | Skill | Coverage |
|---|---|---|
| Performance analysis | `perf-core` | Profiling methodology, flame graphs, benchmarking workflow |
| Rust performance | `perf-rust` | Profiling, benchmarking, codegen flags, zero-allocation patterns |
| Container builds | `container-ops` | Multi-stage Dockerfile for Rust, image optimization |
