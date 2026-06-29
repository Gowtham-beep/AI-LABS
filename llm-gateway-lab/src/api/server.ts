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
  
  const job = await inferenceQueue.getJob(jobId);
  if (!job) {
    return reply.status(404).send({ error: 'Job not found' });
  }

  const state = await job.getState();
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
