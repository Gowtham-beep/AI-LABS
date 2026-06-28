import Fastify from 'fastify';
import { addInferenceJob, inferenceQueue } from '../queue';
import { InferRequest } from '../types';

/**
 * Why API and worker are separate processes:
 * 
 * 1. Resource Isolation: LLM generation (even stubbed) or heavy queue processing can consume significant CPU and memory.
 *    Separating the worker ensures that the API server remains responsive to incoming HTTP requests (like health checks or new inference requests)
 *    even when workers are under heavy load.
 * 2. Scalability: We can scale API servers and worker processes independently. If we have a backlog of queue jobs,
 *    we can spin up more workers without over-provisioning API servers.
 * 3. Fault Tolerance: If a worker crashes due to a problematic job (e.g. out of memory), it does not bring down the API server,
 *    preventing disruption to users submitting new requests.
 */

const server = Fastify({
  logger: true
});

server.post<{ Body: InferRequest }>('/infer', async (request, reply) => {
  const { prompt } = request.body;
  
  if (!prompt) {
    return reply.status(400).send({ error: 'Prompt is required' });
  }

  // Add job to the queue and return the jobId immediately
  const job = await addInferenceJob({ prompt });
  
  return reply.status(202).send({ jobId: job.id });
});

server.get<{ Params: { jobId: string } }>('/infer/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  
  const job = await inferenceQueue.getJob(jobId);
  
  if (!job) {
    return reply.status(404).send({ error: 'Job not found' });
  }
  
  const state = await job.getState();
  
  return reply.send({
    jobId: job.id,
    state,
    result: job.returnvalue || null,
    failedReason: job.failedReason || null,
  });
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`API Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
