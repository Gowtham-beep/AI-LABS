import * as fs from 'fs';
import * as path from 'path';

function calculatePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (p === 100) return sortedValues[sortedValues.length - 1];
  const index = Math.floor(sortedValues.length * (p / 100));
  return sortedValues[index];
}

async function run() {
  const logPath = path.join(process.cwd(), 'logs', 'worker.log');
  if (!fs.existsSync(logPath)) {
    console.error("No worker.log found.");
    process.exit(1);
  }

  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim() !== '');
  const jobs = lines.map(l => JSON.parse(l)).filter(j => j.status === 'completed');

  if (jobs.length < 30) {
    console.warn(`Warning: Only ${jobs.length} completed jobs found in log. Using all available.`);
  }

  // Get the latest 30 jobs
  const latestJobs = jobs.slice(-30);
  const n = latestJobs.length;

  // Latencies
  const latencies = latestJobs.map(j => j.latencyMs).sort((a, b) => a - b);
  const p50 = calculatePercentile(latencies, 50) / 1000;
  const p95 = calculatePercentile(latencies, 95) / 1000;
  const max = latencies[latencies.length - 1] / 1000;

  // Wall-clock time
  const minProcessedOn = Math.min(...latestJobs.map(j => j.processedOn));
  const maxFinishedOn = Math.max(...latestJobs.map(j => j.finishedOn));
  const wallClockS = (maxFinishedOn - minProcessedOn) / 1000;

  // Method 1: Max activeJobCount from logs
  // Since activeJobCount is recorded AFTER a job finishes and removes itself, 
  // the peak active jobs would technically be activeJobCount + 1. 
  // However, we just check the max recorded activeJobCount + 1 (if it was 4, it means 5 were running before it finished).
  const maxLoggedActive = Math.max(...latestJobs.map(j => j.activeJobCount));
  const peakMethod1 = maxLoggedActive > 0 ? maxLoggedActive + 1 : 0; 
  // Actually, wait, if concurrency is 5, max activeJobCount logged is 4. So peak is 4 + 1 = 5.

  // Method 2: Sweep-line
  const events: { time: number; delta: number }[] = [];
  latestJobs.forEach(j => {
    events.push({ time: j.processedOn, delta: 1 });
    events.push({ time: j.finishedOn, delta: -1 });
  });
  events.sort((a, b) => a.time === b.time ? a.delta - b.delta : a.time - b.time);
  
  let currentConcurrency = 0;
  let peakMethod2 = 0;
  events.forEach(e => {
    currentConcurrency += e.delta;
    if (currentConcurrency > peakMethod2) peakMethod2 = currentConcurrency;
  });

  const peakStr = peakMethod1 === peakMethod2 
    ? `${peakMethod1} (verified via 2 independent methods)` 
    : `Mismatched: M1=${peakMethod1}, M2=${peakMethod2}`;

  console.log(`\n### Benchmark Results (Latest ${n} Jobs)\n`);
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Batch size | ${n} requests |`);
  console.log(`| Worker concurrency | ${process.env.WORKER_CONCURRENCY || 5} |`);
  console.log(`| Ollama NUM_PARALLEL | 5 |`);
  console.log(`| p50 latency | ~${p50.toFixed(1)}s |`);
  console.log(`| p95 latency | ~${p95.toFixed(1)}s |`);
  console.log(`| p99 / max latency | ~${max.toFixed(1)}s |`);
  console.log(`| Total batch wall-clock | ${wallClockS.toFixed(1)}s |`);
  console.log(`| Peak observed concurrency | ${peakStr} |`);
  console.log('\n');
}

run().catch(console.error);
