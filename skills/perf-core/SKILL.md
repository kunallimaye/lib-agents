---
name: perf-core
description: Performance analysis methodology and universal profiling tools
---

## What I do

- Provide a systematic methodology for performance analysis
- Document universal profiling and benchmarking tools
- Guide flame graph interpretation and bottleneck identification
- Define performance regression testing principles

## When to use me

Use this skill as the entry point for any performance analysis task. Pair
with a language-specific skill (perf-go, perf-typescript) for tooling details.

## Performance Methodology

Every performance task follows the same loop:

1. **Measure** -- establish a baseline (latency, throughput, memory, CPU)
2. **Profile** -- collect data on where time and resources are spent
3. **Identify** -- find the bottleneck (CPU? Memory? I/O? Contention?)
4. **Optimize** -- fix only the identified bottleneck
5. **Verify** -- re-measure to confirm improvement and check for regressions

Do not skip steps. Do not optimize without profiling first.

## Universal Tools

| Tool | Purpose | Install |
|------|---------|---------|
| `hyperfine` | CLI benchmark runner with statistical analysis | `cargo install hyperfine` |
| `perf` | Linux CPU profiler (sampling, counters) | `apt install linux-tools-common` |
| `flamegraph` | Generate flame graphs from `perf` data | `cargo install flamegraph` |
| `valgrind` | Memory error detection and heap profiling | `apt install valgrind` |
| `strace` | Syscall tracing for I/O analysis | `apt install strace` |

### Quick benchmarking with hyperfine

```bash
# Single command
hyperfine 'my-program --input data.json'

# Compare two implementations
hyperfine 'my-program-v1 input.txt' 'my-program-v2 input.txt'

# Warmup runs and minimum iterations
hyperfine --warmup 3 --min-runs 10 'my-program'
```

## Reading Flame Graphs

- **Width** = time spent in that function (wider = hotter)
- **Height** = call stack depth (taller = deeper call chain)
- Look for **wide plateaus** -- these are hot functions consuming the most time
- Ignore **narrow towers** -- deep but fast, not the bottleneck
- Use **differential flame graphs** to compare before/after optimization
- Colors are arbitrary in most tools -- width is the only metric that matters

## Performance Regression Testing

- Run benchmarks in CI on every pull request
- Compare results against a baseline from the default branch
- Alert on regressions exceeding a defined threshold (e.g., >5%)
- Store benchmark results as CI artifacts for historical comparison
- Use statistical analysis (multiple runs, confidence intervals) to avoid
  false positives from noise

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|-------------|-------------|
| Optimizing without measuring | You will optimize the wrong thing |
| Microbenchmarks in isolation | Miss system-level bottlenecks and real-world interactions |
| Optimizing cold paths | 1% of code often accounts for 99% of runtime |
| Premature optimization | Correctness and clarity first, then measure |
| Single-run benchmarks | Statistical noise masks the real signal |
| Guessing the bottleneck | Profile data beats intuition every time |

## Language-Specific Skills

After establishing methodology with this skill, load the appropriate
language-specific skill for concrete tooling:

| Language | Skill | Coverage |
|----------|-------|----------|
| Go | `perf-go` | pprof, testing.B, benchstat, GC tuning |
| TypeScript / Node.js | `perf-typescript` | V8 profiling, clinic.js, vitest bench |
