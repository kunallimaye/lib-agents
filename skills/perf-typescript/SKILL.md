---
name: perf-typescript
description: TypeScript and Node.js profiling, benchmarking, and optimization patterns
---

## What I do

- Guide Node.js and TypeScript profiling with built-in and third-party tools
- Document V8 engine internals relevant to optimization
- Provide benchmarking patterns with vitest bench and tinybench
- Cover memory leak detection and bundle size analysis

## When to use me

Use this skill when profiling, benchmarking, or optimizing TypeScript or
Node.js applications. Pair with perf-core for universal methodology.

## Profiling

### Node.js built-in flags

```bash
# CPU profiling (V8 tick processor)
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Heap snapshot on demand
node --inspect app.js
# Then connect Chrome DevTools and take snapshot

# Heap profiling to file
node --heap-prof app.js

# Trace garbage collection
node --trace-gc app.js
```

### Chrome DevTools workflow

1. Start the process with `--inspect` or `--inspect-brk`
2. Open `chrome://inspect` in Chrome and click the target
3. **CPU Profile** -- Performance tab -> Record -> run workload -> Stop -> analyze flame chart
4. **Heap Snapshot** -- Memory tab -> Take snapshot -> look for retained objects
5. **Allocation Timeline** -- Memory tab -> Record allocations -> identify growth patterns

### clinic.js suite

| Tool | Purpose | Command |
|------|---------|---------|
| `clinic doctor` | Overall health (event loop, CPU, memory) | `clinic doctor -- node app.js` |
| `clinic bubbleprof` | Async bottleneck visualization | `clinic bubbleprof -- node app.js` |
| `clinic flame` | CPU flame graph | `clinic flame -- node app.js` |

Install: `npm install -g clinic`

## Benchmarking

### vitest bench

```typescript
import { bench, describe } from 'vitest'

describe('string concatenation', () => {
  bench('plus operator', () => {
    let s = ''
    for (let i = 0; i < 1000; i++) s += 'x'
  })

  bench('array join', () => {
    const parts: string[] = []
    for (let i = 0; i < 1000; i++) parts.push('x')
    parts.join('')
  })
})
```

Run with: `vitest bench`

### tinybench (standalone)

```typescript
import { Bench } from 'tinybench'

const bench = new Bench({ time: 1000 })
bench
  .add('Map lookup', () => { map.get('key') })
  .add('Object lookup', () => { obj['key'] })

await bench.run()
console.table(bench.table())
```

## V8 Internals

### Hidden classes and inline caching
- V8 assigns hidden classes to objects based on property order and types
- Adding properties in different orders creates different hidden classes
- Keep object shapes consistent -- initialize all properties in the constructor

### Monomorphism
- Functions called with the same argument types are optimized aggressively
- Polymorphic calls (varying types) trigger deoptimization
- Check with: `node --trace-deopt app.js`

### Optimization killers
- `try/catch` in hot loops (move the try/catch outside the loop)
- `arguments` object leaking (use rest parameters instead)
- `eval` and `with` (prevent optimization entirely)
- `delete` on objects (breaks hidden class, use `undefined` assignment)

## Memory Analysis

### Common leak patterns

| Pattern | Cause | Fix |
|---------|-------|-----|
| Closure references | Inner function holds outer scope alive | Nullify references when done |
| Event listeners | Listeners accumulate without removal | Use `once` or remove in cleanup |
| Global caches | Unbounded maps/objects grow forever | Use LRU cache with max size |
| Timers | `setInterval` without `clearInterval` | Always store and clear timer refs |
| Detached DOM nodes | Removed from DOM but referenced in JS | Nullify references after removal |

### Heap snapshot comparison

1. Take snapshot before the operation
2. Perform the suspected leaking operation multiple times
3. Take snapshot after
4. Compare snapshots -- sort by "Delta" to find growing object counts
5. Follow retainer chains to find what holds leaked objects

## Bundle Size

```bash
# Analyze bundle composition
npx esbuild-visualizer --metadata meta.json --open

# Source map analysis
npx source-map-explorer dist/bundle.js

# Check package size impact before install
npx package-phobia <package-name>
```

- Enable tree-shaking: use ESM imports, avoid `import *`
- Use dynamic `import()` for code splitting on routes or heavy features
- Audit dependencies: `npx depcheck` for unused packages

## Event Loop Monitoring

```typescript
import { monitorEventLoopDelay } from 'node:perf_hooks'

const h = monitorEventLoopDelay({ resolution: 20 })
h.enable()

setInterval(() => {
  console.log(`Event loop p99: ${(h.percentile(99) / 1e6).toFixed(1)}ms`)
  h.reset()
}, 5000)
```

- p99 above 100ms indicates event loop congestion
- Move CPU-intensive work to worker threads
- Break long synchronous operations into chunks with `setImmediate`

## CI Integration

- Run `vitest bench` in CI and compare against baseline
- Use `hyperfine --export-json` for CLI tool benchmarks
- Store results as CI artifacts for historical tracking
- Fail the build on regressions exceeding the defined threshold

## Anti-Patterns

| Anti-Pattern | Better Approach |
|-------------|----------------|
| Sync file I/O in hot paths | Use `fs/promises` or streams |
| `JSON.parse(JSON.stringify(obj))` for deep clone | Use `structuredClone` |
| String concatenation in tight loops | Use array + `join` or template literals |
| Not awaiting promises | Causes memory leaks from unresolved chains |
| CPU-bound work on main thread | Use `worker_threads` for heavy computation |
| Unbounded `Promise.all` | Use `p-limit` or batch processing |
