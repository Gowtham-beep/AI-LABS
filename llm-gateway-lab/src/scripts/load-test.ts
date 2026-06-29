import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:3000';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLoadTest() {
  console.log('Starting load test with 30 concurrent requests...');
  const startWallClock = Date.now();
  const numRequests = 30;

  // 1. Fire 30 POST requests
  const postPromises = Array.from({ length: numRequests }).map((_, i) =>
    fetch(`${API_URL}/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `Count from 1 to 5, test ${i + 1}` })
    }).then(r => r.json())
  );

  const responses = await Promise.all(postPromises) as { jobId: string }[];
  const jobIds = responses.map(r => r.jobId);
  
  console.log(`Successfully queued ${jobIds.length} jobs.`);

  // 2. Poll GET /infer/:jobId for each until completion or timeout (60 seconds)
  const MAX_POLLS = 120; // 120 * 500ms = 60 seconds timeout
  const pollPromises = jobIds.map(async (jobId) => {
    let polls = 0;
    while (polls < MAX_POLLS) {
      polls++;
      const r = await fetch(`${API_URL}/infer/${jobId}`);
      const data = await r.json() as any;
      
      if (data.state === 'completed' || data.state === 'failed') {
        return data;
      }
      await delay(500);
    }
    
    console.warn(`\n[Timeout] Job ${jobId} did not finish within 60 seconds. Stopping polling.`);
    return { jobId, state: 'timeout', result: { latencyMs: null } };
  });

  const completedJobs = await Promise.all(pollPromises);
  const totalWallClock = Date.now() - startWallClock;
  
  // 3. Analyze results
  console.log(`\n--- Load Test Results ---`);
  console.log(`Total Wall-Clock Time: ${totalWallClock}ms`);
  
  const intervals: { id: string, start: number, end: number }[] = [];
  const reportJobs: any[] = [];

  completedJobs.forEach((job: any) => {
    const state = job.state;
    const latencyMs = job.result?.latencyMs;
    const processedOn = job.processedOn;
    const finishedOn = job.finishedOn;
    
    console.log(`Job ${job.jobId} [${state}]:`);
    console.log(`  LLM Latency: ${latencyMs}ms`);
    
    const totalProcessingTime = (processedOn && finishedOn) ? finishedOn - processedOn : null;
    
    if (processedOn && finishedOn) {
      intervals.push({ id: job.jobId, start: processedOn, end: finishedOn });
      console.log(`  Total Processing Time: ${totalProcessingTime}ms`);
    }

    reportJobs.push({
      jobId: job.jobId,
      state,
      latencyMs,
      processedOn,
      finishedOn,
      totalProcessingTime
    });
  });
  
  // Calculate max concurrency based on overlapping job execution times
  let maxConcurrency = 0;
  
  intervals.forEach(i1 => {
    let currentOverlapping = 0;
    intervals.forEach(i2 => {
      // Logic for overlap: one interval starts before the other ends
      // Exclude self-comparison
      if (i1.id !== i2.id && i1.start < i2.end && i1.end > i2.start) {
        currentOverlapping++;
      }
    });
    // Add 1 to include the interval itself
    currentOverlapping++;
    if (currentOverlapping > maxConcurrency) {
      maxConcurrency = currentOverlapping;
    }
  });
  
  console.log(`\nMax Observed Concurrency: ${maxConcurrency}`);
  console.log(`This indicates how many jobs ran truly in parallel.`);
  console.log(`If WORKER_CONCURRENCY is ~5, you should see a max concurrency around 5.`);

  // Write full results to JSON file
  const resultsDir = path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const reportPath = path.join(resultsDir, `load-test-${timestamp}.json`);
  
  const reportData = {
    summary: {
      totalWallClockMs: totalWallClock,
      maxConcurrency,
      jobsCompleted: reportJobs.length
    },
    jobs: reportJobs
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\nReport written to: ${reportPath}`);
}

runLoadTest().catch(console.error);
