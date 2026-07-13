import { connection as redis } from '../config/redis';

export class TokenBucket {
  private bucketKey: string;
  private maxTokens: number;
  private refillRatePerMinute: number;

  constructor(bucketKey: string, maxTokens: number, refillRatePerMinute: number) {
    this.bucketKey = bucketKey;
    this.maxTokens = maxTokens;
    this.refillRatePerMinute = refillRatePerMinute;
  }

  async consume(cost: number): Promise<{ allowed: boolean, tokensRemaining: number, retryAfterMs?: number }> {
    const now = Date.now();

    const script = `
-- Atomicity is required here because read-modify-write operations on a token bucket
-- without isolation can cause race conditions. If multiple workers read the current
-- tokens concurrently, they might all assume they have enough tokens, overdraw the bucket,
-- and then overwrite each other's updated balances. This is the same class of bug as
-- the BullMQ state/returnvalue race condition found in Stage 1. EVAL executes scripts
-- atomically, preventing this.

local key = KEYS[1]
local cost = tonumber(ARGV[1])
local maxTokens = tonumber(ARGV[2])
local refillRatePerMinute = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local refillRatePerMs = refillRatePerMinute / 60000

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if not tokens then
  tokens = maxTokens
  last_refill = now
else
  local elapsedMs = math.max(0, now - last_refill)
  local refilled = elapsedMs * refillRatePerMs
  tokens = math.min(maxTokens, tokens + refilled)
  last_refill = now
end

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(last_refill))
  return {1, tostring(tokens), 0}
else
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(last_refill))
  local missing = cost - tokens
  local ms_until_sufficient = math.ceil(missing / refillRatePerMs)
  return {0, tostring(tokens), ms_until_sufficient}
end
    `;

    const result = await redis.eval(
      script,
      1,
      this.bucketKey,
      cost,
      this.maxTokens,
      this.refillRatePerMinute,
      now
    ) as [number, string, number];

    const [allowedFlag, tokensRemainingStr, retryAfterMs] = result;
    const allowed = allowedFlag === 1;
    const tokensRemaining = parseFloat(tokensRemainingStr);

    if (allowed) {
      return { allowed: true, tokensRemaining };
    } else {
      return { allowed: false, tokensRemaining, retryAfterMs };
    }
  }

  async refund(tokens: number): Promise<void> {
    const now = Date.now();
    const script = `
local key = KEYS[1]
local refundAmount = tonumber(ARGV[1])
local maxTokens = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local currentTokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if not currentTokens then
  currentTokens = maxTokens
  last_refill = now
else
  currentTokens = math.min(maxTokens, currentTokens + refundAmount)
end

redis.call('HMSET', key, 'tokens', tostring(currentTokens), 'last_refill', tostring(last_refill))
return 1
    `;

    await redis.eval(script, 1, this.bucketKey, tokens, this.maxTokens, now);
  }

  async status(): Promise<{ tokens: number, maxTokens: number, refillRatePerMinute: number }> {
    const now = Date.now();
    
    const bucket = await redis.hmget(this.bucketKey, 'tokens', 'last_refill');
    
    let tokens = this.maxTokens;
    if (bucket[0] !== null && bucket[1] !== null) {
      const storedTokens = parseFloat(bucket[0]);
      const lastRefill = parseFloat(bucket[1]);
      const refillRatePerMs = this.refillRatePerMinute / 60000;
      const elapsedMs = Math.max(0, now - lastRefill);
      const refilled = elapsedMs * refillRatePerMs;
      tokens = Math.min(this.maxTokens, storedTokens + refilled);
    }

    return {
      tokens,
      maxTokens: this.maxTokens,
      refillRatePerMinute: this.refillRatePerMinute
    };
  }
}

// Export single instance based on instructions
export const globalTokenBucket = new TokenBucket('llm:tpm:global', 200, 500);
