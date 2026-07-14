import Fastify from 'fastify';
import { inferenceQueue } from '../queue';
import { globalTokenBucket } from '../ratelimiter/tokenBucket';

const fastify = Fastify({
  logger: true,
});

fastify.post('/infer', async (request, reply) => {
  const { prompt } = request.body as { prompt: string };
  
  if (!prompt) {
    return reply.status(400).send({ error: 'prompt is required' });
  }

  // reservedCost is a hard ceiling, not an estimate — 
  // num_predict guarantees actual output tokens never exceed MAX_OUTPUT_TOKENS, 
  // so this reservation can never be insufficient, only excessive
  const MAX_OUTPUT_TOKENS = 150;
  // A conservative flat approach for input estimation: guarantees at least 50 tokens
  // reserved for input regardless of prompt length (covering template overhead)
  // while still scaling up for genuinely long prompts.
  const wordCount = prompt.split(' ').length;
  const estimatedInputTokens = Math.max(50, Math.ceil(wordCount * 2));
  const reservedCost = estimatedInputTokens + MAX_OUTPUT_TOKENS;

  if (reservedCost > globalTokenBucket.maxTokens) {
    return reply.status(400).send({
      error: 'Prompt too large',
      message: `This request requires ${reservedCost} tokens, which exceeds the maximum possible bucket capacity of ${globalTokenBucket.maxTokens}. This request can never be served under the current rate limit configuration — try a shorter prompt.`,
      reservedCost,
      maxPossible: globalTokenBucket.maxTokens
    });
  }

  const { allowed, retryAfterMs } = await globalTokenBucket.consume(reservedCost);

  if (!allowed) {
    const delay = retryAfterMs || 0;
    reply.header('Retry-After', String(Math.ceil(delay / 1000)));
    return reply.status(429).send({
      error: 'Rate limit exceeded',
      retryAfterMs: delay,
      message: 'Token budget exhausted. Retry after the specified delay.'
    });
  }

  // Add a job to the queue, configure retries and exponential backoff
  const job = await inferenceQueue.add('infer', { 
    prompt, 
    estimatedInputTokens, 
    maxOutputTokens: MAX_OUTPUT_TOKENS 
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  });
  
  return { jobId: job.id };
});

fastify.get('/infer/:jobId', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  
  let job = await inferenceQueue.getJob(jobId);
  if (!job) {
    return reply.status(404).send({ error: 'Job not found' });
  }

  let state = await job.getState();
  
  // BullMQ Known Behavior (Issue #1697): getJob() loads the job hash into memory, 
  // while getState() performs a fresh Redis query. If the job finishes exactly between 
  // these two operations, state will be "completed" but the in-memory job.returnvalue 
  // will still be empty/stale. We must re-fetch to ensure data consistency.
  if ((state === 'completed' && !job.returnvalue) || (state === 'failed' && !job.failedReason)) {
    const refreshedJob = await inferenceQueue.getJob(jobId);
    if (refreshedJob) {
      job = refreshedJob;
      state = await job.getState();
    }
  }

  const result = job.returnvalue;
  const failedReason = job.failedReason;
  const processedOn = job.processedOn;
  const finishedOn = job.finishedOn;

  return {
    jobId,
    state,
    result: result || null,
    error: failedReason || null,
    processedOn,
    finishedOn
  };
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`[API] Server is running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
