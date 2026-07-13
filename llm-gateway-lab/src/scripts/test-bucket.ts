import { globalTokenBucket } from '../ratelimiter/tokenBucket';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- Initial Status ---');
  const initialStatus = await globalTokenBucket.status();
  console.log(initialStatus);

  console.log('\n--- Calling consume(50) 10 times ---');
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(globalTokenBucket.consume(50));
  }

  const results = await Promise.all(promises);
  results.forEach((res, i) => {
    console.log(`Call ${i + 1}: allowed=${res.allowed}, tokensRemaining=${res.tokensRemaining.toFixed(2)}, retryAfterMs=${res.retryAfterMs ?? 'N/A'}`);
  });

  console.log('\n--- Waiting 12 seconds for refill... ---');
  await delay(12000);

  console.log('\n--- Status after wait ---');
  const waitStatus = await globalTokenBucket.status();
  console.log({
    tokens: waitStatus.tokens.toFixed(2),
    maxTokens: waitStatus.maxTokens,
    refillRatePerMinute: waitStatus.refillRatePerMinute
  });

  console.log('\n--- Calling consume(50) again ---');
  const finalCall = await globalTokenBucket.consume(50);
  console.log(`Final Call: allowed=${finalCall.allowed}, tokensRemaining=${finalCall.tokensRemaining.toFixed(2)}, retryAfterMs=${finalCall.retryAfterMs ?? 'N/A'}`);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
