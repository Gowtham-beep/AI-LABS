import { Queue } from 'bullmq';
import { connection } from '../config/redis';
import { InferJobData, InferJobResult } from '../types';

export const QUEUE_NAME = 'llm-inference';

// Create the Queue instance using our singleton Redis connection
export const inferenceQueue = new Queue<InferJobData, InferJobResult, 'infer'>(QUEUE_NAME, {
  connection: connection as any
});

export async function addInferenceJob(data: InferJobData) {
  return await inferenceQueue.add('infer', data);
}
