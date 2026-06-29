import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import { QUEUE_NAME } from '../queue';
import { getLLMClient } from '../llm';
import * as fs from 'fs';
import * as path from 'path';

/*
 * Why are API and worker separate processes?
 * 1. Isolation & Reliability: Heavy tasks (like LLM generation) can block the event loop or crash. 
 *    Running them in a separate worker ensures the API remains responsive to new requests.
 * 2. Scalability: We can scale workers independently of the API servers based on the queue backlog.
 * 3. Resource Management: Workers can be deployed on specialized hardware (e.g., GPUs for local LLMs), 
 *    while the lightweight API can run anywhere.
 * 
 * Why do we let BullMQ handle retries instead of try/catch in the worker?
 * If we catch and swallow errors in the worker, the queue considers the job "completed successfully" 
 * even if it failed. By allowing exceptions to bubble up, BullMQ catches them, marks the job as failed, 
 * and automatically schedules retries with backoff strategies based on the job configuration. 
 * This prevents message loss and ensures resilience against transient API errors.
 * 
 * Active Job Counter:
 * We maintain an in-memory `activeJobCount` for observability and logging purposes. 
 * This counter does NOT enforce concurrency limits — BullMQ natively manages real concurrency 
 * via the `concurrency` option. This counter simply gives us real-time insight into how 
 * many jobs the worker is currently processing at any given moment.
 */

const provider = process.env.LLM_PROVIDER || 'ollama';
const llmClient = getLLMClient(provider);
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

let activeJobCount = 0;
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const workerLogPath = path.join(logsDir, 'worker.log');

function logJob(jobId: string | undefined, status: string, latencyMs: number | null, processedOn: number | undefined, finishedOn: number | undefined) {
  const entry = {
    jobId,
    status,
    latencyMs,
    processedOn,
    finishedOn,
    activeJobCount,
    timestamp: new Date().toISOString()
  };
  fs.appendFileSync(workerLogPath, JSON.stringify(entry) + '\n');
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[Worker] Processing job ${job.id} with prompt: "${job.data.prompt}" using ${provider}`);
    
    // We purposefully do not catch errors here.
    // Let exceptions bubble up for BullMQ to handle retries and exponential backoff.
    const result = await llmClient.complete(job.data.prompt);
    
    console.log(`[Worker] Finished job ${job.id} in ${result.latencyMs}ms`);
    return result;
  },
  {
    connection: connection as any,
    concurrency: concurrency
  }
);

worker.on('ready', () => {
  console.log(`[Worker] Started and listening for jobs (Concurrency: ${concurrency})...`);
});

worker.on('active', (job) => {
  activeJobCount++;
});

worker.on('completed', (job, result) => {
  activeJobCount--;
  logJob(job.id, 'completed', result?.latencyMs || null, job.processedOn, job.finishedOn || Date.now());
});

worker.on('failed', (job, err) => {
  activeJobCount--;
  console.error(`[Worker] Job ${job?.id} failed:`, err?.message);
  logJob(job?.id, 'failed', null, job?.processedOn, job?.finishedOn || Date.now());
});
