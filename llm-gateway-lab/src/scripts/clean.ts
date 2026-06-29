import { inferenceQueue } from '../queue';
import * as fs from 'fs';
import * as path from 'path';

async function clean() {
  console.log('Obliterating queue (this may take a moment)...');
  
  // Pause the queue first to safely obliterate it
  await inferenceQueue.pause();
  await inferenceQueue.obliterate({ force: true });
  
  console.log('✅ BullMQ Queue cleared.');

  // Delete the worker log
  const logPath = path.join(process.cwd(), 'logs', 'worker.log');
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
    console.log('✅ Worker log cleared.');
  }
  
  // Close the redis connection so the script can exit
  await inferenceQueue.close();
  console.log('✨ Fresh start ready!');
  process.exit(0);
}

clean().catch(err => {
  console.error('Failed to clean:', err);
  process.exit(1);
});
