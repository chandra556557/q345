/**
 * Redis Configuration
 * 
 * Centralized Redis connection factory for BullMQ job queue.
 */

import Redis from 'ioredis';
import { logger } from '../../utils/logger';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
}

/**
 * Get Redis configuration from environment variables
 */
export function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

/**
 * Create a new Redis connection with automatic reconnection
 */
export function createRedisConnection(): Redis {
  const config = getRedisConfig();
  
  const redis = new Redis({
    ...config,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnecting... attempt ${times}, delay ${delay}ms`);
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some(e => err.message.includes(e));
    },
  });

  redis.on('connect', () => {
    logger.info('Redis connected successfully');
  });

  redis.on('ready', () => {
    logger.info('Redis ready to accept commands');
  });

  redis.on('error', (err: Error) => {
    logger.error('Redis connection error:', { error: err.message });
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redis.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  return redis;
}

/**
 * Create a duplicate Redis connection for subscribers
 */
export function createRedisSubscriber(): Redis {
  const connection = createRedisConnection();
  return connection.duplicate();
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const redis = createRedisConnection();
    const result = await redis.ping();
    await redis.quit();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis connection test failed:', { error });
    return false;
  }
}

export default {
  getRedisConfig,
  createRedisConnection,
  createRedisSubscriber,
  testRedisConnection,
};
