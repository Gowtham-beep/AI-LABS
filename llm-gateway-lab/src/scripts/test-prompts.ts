import * as fs from 'fs';
const API_URL = 'http://localhost:5000/infer';

const prompts = [
  "Count from one to five",
  "Write a short poem about a very lazy orange cat",
  "This is a twenty word prompt designed to test whether the token estimation logic properly handles medium length text inputs",
  "I am writing a slightly longer prompt to see how the system handles forty words. It is crucial to evaluate the token estimator across different length brackets to ensure the bucket reserves enough capacity and does not go negative unexpectedly.",
  "The architecture of modern web applications often involves a microservices approach where individual components are developed and deployed independently. This paradigm provides flexibility in scaling and updating distinct features without disrupting the entire system. In our scenario, separating the API server from the worker process ensures that long-running inferences do not block incoming HTTP requests. The API server quickly parses the prompt, estimates the token usage, checks the rate limit via Redis, and if allowed, pushes the task to a message queue. The worker then dequeues tasks, calls the language model, and precisely refunds any unused tokens back to the rate limit bucket, keeping everything perfectly synchronized.",
  "This is a massive prompt to test the HTTP 400 constraint. ".repeat(25)
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log("Starting Sequential Test\\n");
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const words = prompt.split(' ').length;
    console.log(`[Prompt ${i+1}] Submitting ${words}-word prompt...`);
    
    // Submit
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    if (res.status === 400) {
      const errRes = await res.json() as any;
      console.log(`  => HTTP 400 Rejected! Reason: ${errRes.message}\\n`);
      continue;
    }
    
    if (res.status === 429) {
      const retry = await res.json() as any;
      console.log(`  Rate limited! Waiting ${retry.retryAfterMs}ms...`);
      await delay(retry.retryAfterMs);
      i--; // retry this prompt
      continue;
    }
    
    const data = await res.json() as any;
    const jobId = data.jobId;
    console.log(`  Queued as Job ${jobId}. Polling...`);
    
    // Poll
    while (true) {
      const pollRes = await fetch(`${API_URL}/${jobId}`);
      const pollData = await pollRes.json() as any;
      if (pollData.state === 'completed') {
        const r = pollData.result;
        console.log(`  => DONE!`);
        console.log(`  => Estimated Input Tokens: ${r.reservedCost - 150}`);
        console.log(`  => Actual Prompt Tokens:   ${r.promptTokens}`);
        console.log(`  => Unused (Refunded):      ${r.unused}\\n`);
        break;
      } else if (pollData.state === 'failed') {
        console.log(`  => FAILED!\\n`);
        break;
      }
      await delay(2000);
    }
  }
}

run().catch(console.error);
