import { Queue, Worker } from 'bullmq';
import { connection } from '../config/redis';

const q = new Queue('test-events', { connection: connection as any});

const w = new Worker('test-events', async (job) => {
  console.log(`Job ${job.id} running attempt ${job.attemptsMade}`);
  if (job.attemptsMade < 2) {
    throw new Error('Fail first attempt');
  }
  return 'Success';
}, { connection: connection as any});

w.on('active', () => console.log('active emitted'));
w.on('completed', () => console.log('completed emitted'));
w.on('failed', () => console.log('failed emitted'));

async function test() {
  await q.obliterate({ force: true });
  await q.add('test', {}, { attempts: 2 });
  setTimeout(() => process.exit(0), 3000);
}
test();
