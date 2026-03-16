/**
 * Queue Service
 * 
 * Redis + BullMQ based job queue for distributed test execution.
 * Supports priority queues, retries, and real-time metrics.
 */

import { Queue, QueueEvents, Job, JobsOptions } from 'bullmq';
import { createRedisConnection } from './redis.config';
import { logger } from '../../utils/logger';
import pool from '../../db';

export interface TestJobData {
  testRunId: string;
  scriptId: string;
  userId: string;
  organizationId: string;
  environmentId?: string;
  executionMode: 'headless' | 'headed' | 'api';
  browser?: 'chromium' | 'firefox' | 'webkit';
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface JobStatus {
  id: string;
  name: string;
  data: TestJobData;
  status: string;
  progress: number;
  attempts: number;
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
}

const QUEUE_NAME = 'test-execution';

class QueueService {
  private queue: Queue<TestJobData> | null = null;
  private queueEvents: QueueEvents | null = null;
  private isInitialized = false;
  private isRedisAvailable = false;

  /**
   * Initialize the queue service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Queue service already initialized');
      return;
    }

    // Check if queue is disabled via environment variable
    if (process.env.ENABLE_QUEUE !== 'true') {
      logger.info('Queue service is disabled (ENABLE_QUEUE is not set to true)');
      this.isInitialized = true;
      return;
    }

    try {
      const connection = createRedisConnection();

      // Test Redis connection before creating queue
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 5000);

        connection.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        connection.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this.queue = new Queue<TestJobData>(QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: {
            count: 100,
            age: 24 * 3600, // 24 hours
          },
          removeOnFail: {
            count: 500,
          },
        },
      });

      this.queueEvents = new QueueEvents(QUEUE_NAME, {
        connection: createRedisConnection(),
      });

      this.setupEventListeners();
      this.isInitialized = true;
      this.isRedisAvailable = true;
      
      logger.info('Queue service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize queue service - Redis not available:', { error });
      logger.warn('Queue features will be disabled. Tests will run synchronously.');
      this.isInitialized = true;
      this.isRedisAvailable = false;
      // Don't throw error - allow app to work without Redis
    }
  }

  /**
   * Setup queue event listeners for monitoring
   */
  private setupEventListeners(): void {
    if (!this.queueEvents) return;

    this.queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      logger.info(`Job completed: ${jobId}`, { returnvalue });
      await this.updateJobQueueStatus(jobId, 'completed');
    });

    this.queueEvents.on('failed', async ({ jobId, failedReason }) => {
      logger.error(`Job failed: ${jobId}`, { failedReason });
      await this.updateJobQueueStatus(jobId, 'failed', failedReason);
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      logger.debug(`Job progress: ${jobId}`, { data });
    });

    this.queueEvents.on('active', ({ jobId }) => {
      logger.info(`Job active: ${jobId}`);
    });

    this.queueEvents.on('stalled', ({ jobId }) => {
      logger.warn(`Job stalled: ${jobId}`);
    });
  }

  /**
   * Update job queue status in database
   */
  private async updateJobQueueStatus(
    testRunId: string,
    status: string,
    errorMsg?: string
  ): Promise<void> {
    try {
      const completedAt = ['completed', 'failed'].includes(status) ? 'now()' : 'NULL';
      
      await pool.query(
        `UPDATE "JobQueue" 
         SET status = $2, 
             "errorMsg" = $3, 
             "completedAt" = ${completedAt === 'NULL' ? 'NULL' : 'now()'},
             "updatedAt" = now()
         WHERE "testRunId" = $1`,
        [testRunId, status, errorMsg || null]
      );
    } catch (error) {
      logger.error('Failed to update job queue status:', { error, testRunId, status });
    }
  }

  /**
   * Add a test job to the queue
   */
  async addTestJob(data: TestJobData, options?: Partial<JobsOptions>): Promise<string> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    try {
      // Create job queue entry in database
      await pool.query(
        `INSERT INTO "JobQueue" (id, "testRunId", "organizationId", priority, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'pending', now(), now())
         ON CONFLICT ("testRunId") DO UPDATE SET status = 'pending', "updatedAt" = now()`,
        [data.testRunId, data.organizationId, data.priority]
      );

      const job = await this.queue.add('execute-test', data, {
        priority: data.priority,
        jobId: data.testRunId,
        ...options,
      });

      logger.info(`Test job added to queue: ${job.id}`, {
        testRunId: data.testRunId,
        executionMode: data.executionMode,
        priority: data.priority,
      });

      return job.id!;
    } catch (error) {
      logger.error('Failed to add test job:', { error, data });
      throw error;
    }
  }

  /**
   * Add multiple test jobs in bulk
   */
  async addBulkTestJobs(jobs: TestJobData[]): Promise<string[]> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    const bulkJobs = jobs.map(data => ({
      name: 'execute-test',
      data,
      opts: {
        priority: data.priority,
        jobId: data.testRunId,
      },
    }));

    const addedJobs = await this.queue.addBulk(bulkJobs);
    
    logger.info(`Added ${addedJobs.length} jobs to queue`);
    
    return addedJobs.map(job => job.id!);
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(): Promise<QueueMetrics> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
      this.queue.isPaused(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused: paused ? 1 : 0,
    };
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job<TestJobData> | undefined> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    return this.queue.getJob(jobId);
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobStatus | null> {
    const job = await this.getJob(jobId);
    
    if (!job) {
      return null;
    }

    const state = await job.getState();

    return {
      id: job.id!,
      name: job.name,
      data: job.data,
      status: state,
      progress: job.progress as number,
      attempts: job.attemptsMade,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
    };
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    start = 0,
    end = 50
  ): Promise<Job<TestJobData>[]> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    switch (status) {
      case 'waiting':
        return this.queue.getWaiting(start, end);
      case 'active':
        return this.queue.getActive(start, end);
      case 'completed':
        return this.queue.getCompleted(start, end);
      case 'failed':
        return this.queue.getFailed(start, end);
      case 'delayed':
        return this.queue.getDelayed(start, end);
      default:
        return [];
    }
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    
    if (!job) {
      return false;
    }

    await job.remove();
    
    // Update database
    await pool.query(
      `UPDATE "JobQueue" SET status = 'cancelled', "updatedAt" = now() WHERE "testRunId" = $1`,
      [jobId]
    );

    logger.info(`Job removed: ${jobId}`);
    return true;
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    
    if (!job) {
      return false;
    }

    await job.retry();
    
    // Update database
    await pool.query(
      `UPDATE "JobQueue" SET status = 'pending', attempts = attempts + 1, "updatedAt" = now() WHERE "testRunId" = $1`,
      [jobId]
    );

    logger.info(`Job retry requested: ${jobId}`);
    return true;
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    await this.queue.pause();
    logger.info('Queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    await this.queue.resume();
    logger.info('Queue resumed');
  }

  /**
   * Clean old jobs
   */
  async clean(
    grace: number = 24 * 3600 * 1000, // 24 hours
    limit: number = 100,
    status: 'completed' | 'failed' = 'completed'
  ): Promise<string[]> {
    if (!this.queue) {
      throw new Error('Queue service not initialized');
    }

    const removed = await this.queue.clean(grace, limit, status);
    logger.info(`Cleaned ${removed.length} ${status} jobs`);
    return removed;
  }

  /**
   * Get the queue instance
   */
  getQueue(): Queue<TestJobData> | null {
    return this.queue;
  }

  /**
   * Check if queue is initialized and Redis is available
   */
  isReady(): boolean {
    return this.isInitialized && this.isRedisAvailable && this.queue !== null;
  }

  /**
   * Check if queue is in fallback mode (Redis not available)
   */
  isFallbackMode(): boolean {
    return this.isInitialized && !this.isRedisAvailable;
  }

  /**
   * Shutdown the queue service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down queue service...');

    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    this.isInitialized = false;
    logger.info('Queue service shutdown complete');
  }
}

// Export singleton instance
export const queueService = new QueueService();

export default queueService;
