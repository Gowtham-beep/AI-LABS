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

  // 2. Poll GET /infer/:jobId for each until completion or timeout (10 minutes)
  const MAX_POLLS = 1200; // 1200 * 500ms = 600 seconds (10 minutes) timeout
  // Previously this was 60s, but that was far too aggressive because local LLM inference 
  // (e.g., Ollama qwen2.5) can easily take 50-90s+ per job, especially when bottlenecked by concurrency.
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
    
    console.warn(`\n[Timeout] Job ${jobId} did not finish within 10 minutes. Stopping polling.`);
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
  
  // Calculate max concurrency using a sweep-line algorithm.
  // Why pairwise overlap-counting was wrong:
  // The old approach counted "how many other jobs overlapped with this job at ANY point in its lifespan."
  // It effectively counted overlapping pairs transitively across the whole batch. If one long job 
  // overlapped with 10 fast jobs sequentially, it would log an inflated concurrency of 11 instead of 
  // measuring how many were actually active at one specific instant.
  let maxConcurrency = 0;
  let peakTime = 0;
  let currentConcurrency = 0;
  
  const events: { time: number; delta: number }[] = [];
  intervals.forEach(i => {
    events.push({ time: i.start, delta: 1 });
    events.push({ time: i.end, delta: -1 });
  });
  
  // Sort events by time ascending. If times exactly match, process decrements (-1) 
  // before increments (+1) to prevent artificially inflating instantaneous peaks on job handoffs.
  events.sort((a, b) => a.time === b.time ? a.delta - b.delta : a.time - b.time);
  
  events.forEach(event => {
    currentConcurrency += event.delta;
    if (currentConcurrency > maxConcurrency) {
      maxConcurrency = currentConcurrency;
      peakTime = event.time;
    }
  });
  
  console.log(`\nMax Observed Concurrency: ${maxConcurrency} (Peak occurred at timestamp: ${peakTime})`);
  console.log(`This indicates the true instantaneous peak of jobs running in parallel.`);
  console.log(`If WORKER_CONCURRENCY is ~5, you should see a max concurrency of exactly 5.`);

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
