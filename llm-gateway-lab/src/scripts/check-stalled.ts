import { inferenceQueue } from '../queue';

async function checkFailedJobs() {
  const failedJobs = await inferenceQueue.getFailed();
  
  if (failedJobs.length === 0) {
    console.log("No failed jobs found in the queue.");
  } else {
    console.log(`Found ${failedJobs.length} failed jobs. Analyzing failure reasons...`);
    for (const job of failedJobs) {
      console.log(`Job ID: ${job.id} | Failed Reason: ${job.failedReason}`);
    }
  }
  
  await inferenceQueue.close();
  process.exit(0);
}

checkFailedJobs().catch(console.error);
