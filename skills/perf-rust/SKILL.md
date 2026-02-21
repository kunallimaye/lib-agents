---
name: perf-rust
description: Rust-specific profiling, benchmarking, and optimization patterns
---

## What I do

- Guide Rust profiling with cargo flamegraph, samply, and platform-specific tools
- Document benchmarking patterns with criterion, divan, and iai
- Cover LLVM compiler internals, codegen flags, and assembly verification
- Provide memory analysis and zero-allocation patterns for allocation-free code

## When to use me

Use this skill when profiling, benchmarking, or optimizing Rust code. Pair
with `perf-core` for universal methodology and `rust-pro` for ownership,
error handling, and unsafe patterns.

## Profiling

```bash
cargo flamegraph --bin my-app -- --input data.json  # flame graph (perf/dtrace)
samply record ./target/release/my-app               # lightweight, opens Firefox Profiler
```

| Platform | Primary | Alternative | CI |
|----------|---------|-------------|-----|
| Linux | `perf` + `flamegraph` | `samply` | `cargo flamegraph` |
| macOS | `cargo-instruments` | `samply` | `samply` |
| Windows | `samply` | ETW + WPA | `samply` |

For heap profiling, use `dhat-rs` (see Memory section).

## Benchmarking

### criterion

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};
fn bench_sorting(c: &mut Criterion) {
    let mut group = c.benchmark_group("sorting");
    let data: Vec<u64> = (0..1000).rev().collect();
    group.bench_function("std_sort", |b| b.iter(|| {
        let mut v = black_box(data.clone()); v.sort(); v
    }));
    group.bench_function("unstable_sort", |b| b.iter(|| {
        let mut v = black_box(data.clone()); v.sort_unstable(); v
    }));
    group.finish();
}
criterion_group!(benches, bench_sorting);
criterion_main!(benches);
```

### divan

```rust
fn main() { divan::main(); }
#[divan::bench(args = [100, 1000, 10_000])]
fn sort_vec(n: usize) -> Vec<u64> {
    let mut v: Vec<u64> = (0..n as u64).rev().collect(); v.sort_unstable(); v
}
```

### iai / iai-callgrind

Instruction-count based -- deterministic, no noise, ideal for CI.
Use `critcmp` for cross-branch comparison (`--save-baseline main` / `--baseline main`).

## Compiler Internals

| Flag | Values | Effect |
|------|--------|--------|
| `opt-level` | `0`-`3`, `s`, `z` | `3` = max speed, `z` = min size |
| `lto` | `false`, `thin`, `fat` | Link-time optimization across crates |
| `codegen-units` | `1`-`256` | Lower = better optimization, slower compile |
| `target-cpu` | `native`, specific | Enable CPU-specific instructions |
| `panic` | `unwind`, `abort` | `abort` reduces binary size |

`cargo llvm-lines | head -20` -- find monomorphization cost. Extract non-generic inner functions or use `dyn Trait` for cold paths.

- `#[inline]` for small hot functions across crate boundaries only
- `#[inline(never)]` to isolate in profiling; `#[inline(always)]` almost never correct
- **LTO**: `lto = "thin"` for fast builds, `"fat"` for max optimization
- **PGO**: `-Cprofile-generate` → run workload → `-Cprofile-use`. Typical: 10-20% gain
- **SIMD**: `std::arch` (stable), `std::simd` (nightly); verify with `cargo-show-asm`

## Reading Compiler Output

```bash
cargo asm my_crate::hot_function        # view assembly
cargo asm --llvm my_crate::hot_function # view LLVM IR
```

**Godbolt**: paste at [godbolt.org](https://godbolt.org) with `-O`, compare with/without
abstraction. Identical assembly = zero-cost confirmed.
**Look for:** unexpected `call` (missing inlining), `panicking` (bounds checks), missing SIMD.

## Memory & Allocation

| Allocator | Crate | Best For |
|-----------|-------|----------|
| jemalloc | `tikv-jemallocator` | Multi-threaded, reduced fragmentation |
| mimalloc | `mimalloc` | General-purpose, consistent perf |
| System | (default) | Small binaries, minimal deps |

```rust
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;
```

### dhat-rs for heap profiling

```rust
#[cfg(feature = "dhat-heap")]
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn test_allocations() {
    let _profiler = dhat::Profiler::new_heap();
    // run code, view results with dhat/dh_view.html
}
```

| Source | Why | Fix |
|--------|-----|-----|
| `format!` | New `String` each call | `write!` to reusable buffer |
| `to_string()` | Allocates from `&str` | Keep as `&str` |
| `Vec` growth | Doubles capacity | `Vec::with_capacity` |
| `Box::new` in loops | Heap alloc per iter | Stack or arena |

## Zero-Allocation Patterns

| Before | After | Why |
|--------|-------|-----|
| `Vec<T>` | `SmallVec<[T; N]>` / `ArrayVec<T, N>` | Stack-allocated small collections |
| `String` parameter | `&str` or `Cow<'_, str>` | Avoid forced allocation |
| `format!("{}", num)` | `itoa::Buffer` / `ryu::Buffer` | Stack-allocated formatting |
| `Vec::push` in loop | `Vec::with_capacity` | Pre-allocate when size known |
| `Box<dyn Trait>` | generic `T: Trait` | Avoid heap for single type |
| `to_owned()` | Extend borrow lifetime | Eliminate allocation |

## Build Performance

`cargo build --timings` -- HTML report of per-crate compile times.

- **sccache** -- `RUSTC_WRAPPER=sccache` for shared compilation cache
- **Workspace splitting** -- isolate slow proc macros into separate members
- **Reduce generics** -- `impl Trait` internally to limit monomorphization
- **cargo-udeps** -- `cargo +nightly udeps` to find unused dependencies

## Anti-Patterns

| Anti-Pattern | Measurable Impact |
|---|---|
| `Vec::push` without `with_capacity` | O(log n) reallocations when size is known |
| `format!` in hot loops | Heap allocation per iteration; use `write!` to buffer |
| Missing `--release` in benchmarks | Debug optimizations disabled; results meaningless |
| `HashMap` for small lookups | Sorted array + binary search faster for <20 elements |
| Excessive monomorphization | 50 instantiations; use `dyn Trait` or non-generic inner |
| Missing LTO for release | 10-20% speedup left on the table |
| `String::from` + `push_str` | Use `format!` or `with_capacity` + single alloc |
| Benchmarking without `black_box` | Compiler eliminates dead code; measures nothing |

## Companion Skills

| Domain | Skill | Coverage |
|---|---|---|
| Performance analysis | `perf-core` | Profiling methodology, flame graphs, benchmarking workflow |
| Rust engineering | `rust-pro` | Ownership, error handling, unsafe audit, async patterns |
