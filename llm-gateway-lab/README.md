# LLM Inference Gateway (Stage 1)

## What this is

An LLM inference gateway built to examine bounded concurrency, queue-based decoupling, and provider-level concurrency limits fundamentally as distributed-systems problems, rather than AI problems. This project abstracts away the generative aspects of LLMs to focus purely on the load-bearing infrastructure required when a slow, unreliable, rate-limited dependency sits behind a high-throughput API.

## Architecture

The gateway is built around a deliberately separated layer architecture to guarantee decoupling:
- **Fastify API**: Enqueue-only. It immediately returns a `jobId` and never blocks waiting for LLM inference.
- **BullMQ Queue**: Backed by Redis, ensuring jobs are persisted and reliably dispatched.
- **Worker Process**: A separate Node.js process that polls the queue, executes the inference, and writes results back.
- **LLM Layer**: A provider-agnostic `LLMClient` interface (Strategy pattern) instantiated via a Factory (`getLLMClient`). The worker executes `client.complete(prompt)` without needing to know whether the backing provider is Groq or local Ollama. The Redis connection is shared across the application as a Singleton to prevent connection leaks.

```
Client → API → Queue → Worker → LLM (Groq / local Ollama)
```

## Key finding

**Concurrency slices a fixed compute budget rather than adding compute.** 
When testing against a local Ollama model (Qwen2.5-Coder), a solo request took roughly 5.6s. When `OLLAMA_NUM_PARALLEL` was set to 5, the model engaged true parallelism, but individual request latencies ballooned to ~50-54s. 

Despite the severe degradation in per-request latency, total throughput improved significantly. The total time to clear a 30-job batch dropped from an estimated ~17 minutes (if processed serially) down to ~3.5 minutes (concurrently). This demonstrated a **~4.7x improvement in batch throughput**, proving that concurrency at the inference layer trades individual latency for sustained batch throughput.

## Benchmark Results

The following metrics reflect a clean, validated 30-job run with `WORKER_CONCURRENCY=5` and `OLLAMA_NUM_PARALLEL=5`.

| Metric | Value |
|--------|-------|
| p50 latency | ~29.7s |
| p95 latency | ~53.9s |
| p99 / max latency | ~64.6s |
| Total batch wall-clock | 212.6s |
| Peak observed concurrency | 5 (verified via two independent methods: sweep-line algorithm in the load-test script, and a live tracking counter in the worker process) |

## Bugs found and fixed during this stage

| Bug | Symptom | Root Cause | Fix |
|---|---|---|---|
| **Stalled-job correctness** | Jobs double-executing or generating duplicate worker events. | BullMQ's default `lockDuration` is 30s. Actual LLM jobs took 40-90s+, causing the queue to mark them as stalled and pass them to other workers while the original execution was still running. | Configured `lockDuration: 120000` with a matching `lockRenewTime` in the worker initialization. |
| **Concurrency miscalculation** | Load-test script reported a max concurrency of 16, while the worker maxed at 5. | The script used pairwise interval-overlap counting, which transitively grouped overlaps across the entire batch lifespan instead of measuring true instantaneous concurrency. | Replaced the pairwise algorithm with a strict sweep-line algorithm (+1/-1 events, sorted by time) to accurately track the peak. |
| **State/ReturnValue race condition** | Polled jobs returned `state: "completed"` but `latencyMs` was `undefined`. | A documented BullMQ behavior (Issue #1697). `job.getState()` performs a fresh Redis read, while `job.returnvalue` reads from the initially fetched in-memory object. A job finishing exactly between these two async calls desyncs the data. | Modified the API to re-fetch the job via `getJob(jobId)` if `state` resolves to `completed` or `failed` but the result payload is missing. |

## How to run

1. **Start Redis**:
   ```bash
   docker-compose up -d
   ```
2. **Environment Variables**:
   Ensure a `.env` file exists with the following configuration:
   ```env
   WORKER_CONCURRENCY=5
   OLLAMA_NUM_PARALLEL=5
   LLM_PROVIDER=ollama # or groq
   GROQ_API_KEY=your_key_here
   ```
3. **Start the API and Worker** (in separate terminal sessions):
   ```bash
   npm run dev:api
   npm run dev:worker
   ```
4. **Run the Load Test**:
   ```bash
   npx ts-node src/scripts/load-test.ts
   ```

## What's deliberately not built yet

This stage focuses strictly on decoupling and bounded concurrency. The following features were explicitly deferred to later stages:
- No rate limiting (token buckets, leaky buckets)
- No streaming or backpressure management
- No chaos injection (simulated network drops, random latency jitter)
- No circuit breaker pattern for failing providers

## Next: Stage 2

Stage 2 will focus on resilience and failure handling by introducing a Redis-backed token-bucket rate limiter in front of the worker. It will also implement a chaos-injection layer that deliberately breaks the pipeline on purpose to test graceful degradation under severe downstream failure conditions.
