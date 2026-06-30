# AI MLOps Experiment Labs

Most "AI engineering" content is just wrapper-around-an-API work. These self-directed weekend labs deliberately go deeper—treating LLM inference fundamentally as a distributed systems problem rather than a prompting problem. The focus here is on building the unglamorous micro-primitives (queues, concurrency control, rate limiting, circuit breakers, chaos injection) that production AI infrastructure actually depends on, and benchmarking them rigorously rather than assuming they work. Each lab is documented with real, measured data—including the dead ends and bugs uncovered along the way, not just the polished final result.

## The Labs

| Lab | Title | Status | Description | Link |
| :---: | :--- | :--- | :--- | :--- |
| **#1** | **LLM Inference Gateway** | Stage 1 Complete | Bounded concurrency, queue/worker decoupling, and cross-validated benchmarking. Proved that concurrency improved batch throughput ~4.7x while actively making individual request latency worse. | [Read Lab #1](./llm-gateway-lab/README.md) |

## Why These Labs Exist

These experiments act as a bridge between traditional backend engineering and modern AI operations, directly mapping to the kinds of load-bearing infrastructure questions asked in machine-coding and system design interviews. The long-term goal is to cultivate a deep, full-stack understanding of AI-native architecture—where slow, unreliable, and rate-limited dependencies are managed through robust engineering principles.

## Tech Stack

This repository leans on a battle-tested production stack:
- **Core:** Node.js, TypeScript
- **API & Queue:** Fastify, BullMQ, Redis
- **Infrastructure:** Docker, NGINX, PM2
- **LLM Providers:** Groq, local Ollama models
