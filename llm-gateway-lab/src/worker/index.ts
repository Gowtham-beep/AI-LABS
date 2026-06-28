import { Worker, Job } from 'bullmq';
import { connection } from '../config/redis';
import { QUEUE_NAME } from '../queue';
import { generateText } from '../llm';
import { InferJobData, InferJobResult } from '../types';

/**
 * Why API and worker are separate processes:
 * 
 * By running the worker as a separate Node.js process (standalone entrypoint), we decouple job processing from HTTP handling.
 * This is crucial for CPU/memory-intensive tasks like communicating with LLMs or orchestrating heavy inferences.
 * It prevents long-running operations in the worker from blocking the event loop of the API server.
 */

console.log(`Starting BullMQ worker for queue: ${QUEUE_NAME}...`);

const worker = new Worker<InferJobData, InferJobResult, 'infer'>(
  QUEUE_NAME,
  async (job: Job<InferJobData, InferJobResult, 'infer'>) => {
    console.log(`Processing job ${job.id} with prompt: "${job.data.prompt}"`);
    
    // Call the LLM abstraction
    const result = await generateText(job.data.prompt);
    
    console.log(`Job ${job.id} completed.`);
    return result;
  },
  { connection: connection as any }
);

worker.on('completed', (job) => {
  console.log(`Worker: Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.error(`Worker: Job ${job?.id} has failed with ${err.message}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});
