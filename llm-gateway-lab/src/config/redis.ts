import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Create a singleton Redis connection for the application
// This connection is used by BullMQ and can be reused.
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const connection = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
  console.error('Redis connection error:', err);
});
