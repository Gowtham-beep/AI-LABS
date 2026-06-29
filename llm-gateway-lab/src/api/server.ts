import Fastify from 'fastify';
import { inferenceQueue } from '../queue';

const fastify = Fastify({
  logger: true,
});

fastify.post('/infer', async (request, reply) => {
  const { prompt } = request.body as { prompt: string };
  
  if (!prompt) {
    return reply.status(400).send({ error: 'prompt is required' });
  }

  // Add a job to the queue, configure retries and exponential backoff
  const job = await inferenceQueue.add('infer', { prompt }, {
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
