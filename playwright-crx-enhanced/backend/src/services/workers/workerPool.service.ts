/**
 * Worker Pool Service
 * 
 * Manages distributed worker pool for parallel test execution.
 * Each worker processes jobs from the BullMQ queue.
 */

import { Worker, Job } from 'bullmq';
import os from 'os';
import { createRedisConnection } from '../queue/redis.config';
import { TestJobData } from '../queue/queue.service';
import { logger } from '../../utils/logger';
import pool from '../../db';

export interface WorkerNodeInfo {
  id: string;
  name: string;
  hostname: string;
  ipAddress: string;
  port: number;
  status: string;
  capabilities: WorkerCapabilities;
  maxConcurrency: number;
  currentLoad: number;
  lastHeartbeat: Date;
}

export interface WorkerCapabilities {
  browsers: string[];
  applicationTypes: string[];
  os: string;
  nodeVersion: string;
}

const QUEUE_NAME = 'test-execution';

class WorkerPoolService {
  private workers: Worker<TestJobData>[] = [];
  private workerNodeId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private isRedisAvailable = false;
  private concurrency: number;
  private poolSize: number;

  constructor() {
    this.concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
    this.poolSize = parseInt(process.env.WORKER_POOL_SIZE || '3', 10);
  }

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Worker pool already initialized');
      return;
    }

    // Check if worker pool is disabled via environment variable
    if (process.env.ENABLE_WORKER_POOL !== 'true') {
      logger.info('Worker pool is disabled (ENABLE_WORKER_POOL is not set to true)');
      this.isInitialized = true;
      return;
    }

    try {
      // Test Redis connection first
      const connection = createRedisConnection();
      
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

      // Register this worker node in database
      await this.registerWorkerNode();

      // Create worker instances
      for (let i = 0; i < this.poolSize; i++) {
        const worker = new Worker<TestJobData>(
          QUEUE_NAME,
          async (job: Job<TestJobData>) => this.processJob(job),
          {
            connection: createRedisConnection(),
            concurrency: this.concurrency,
            limiter: {
              max: this.concurrency,
              duration: 1000,
            },
          }
        );

        this.setupWorkerEventHandlers(worker, i);
        this.workers.push(worker);
        
        logger.info(`Worker ${i} initialized with concurrency ${this.concurrency}`);
      }

      // Start heartbeat
      this.startHeartbeat();
      this.isInitialized = true;
      this.isRedisAvailable = true;
      
      logger.info(`Worker pool initialized: ${this.poolSize} workers, ${this.concurrency} concurrent jobs each`);
    } catch (error) {
      logger.error('Failed to initialize worker pool - Redis not available:', { error });
      logger.warn('Worker pool features will be disabled. Tests will run synchronously.');
      this.isInitialized = true;
      this.isRedisAvailable = false;
      // Don't throw error - allow app to work without Redis
    }
  }

  /**
   * Setup event handlers for a worker
   */
  private setupWorkerEventHandlers(worker: Worker<TestJobData>, index: number): void {
    worker.on('completed', (job) => {
      logger.info(`Worker ${index} completed job ${job.id}`);
      this.decrementLoad();
    });

    worker.on('failed', (job, err) => {
      logger.error(`Worker ${index} failed job ${job?.id}:`, { error: err.message });
      this.decrementLoad();
    });

    worker.on('error', (err) => {
      logger.error(`Worker ${index} error:`, { error: err.message });
    });

    worker.on('active', (job) => {
      logger.debug(`Worker ${index} processing job ${job.id}`);
      this.incrementLoad();
    });

    worker.on('stalled', (jobId) => {
      logger.warn(`Worker ${index} stalled on job ${jobId}`);
    });
  }

  /**
   * Register this worker node in the database
   */
  private async registerWorkerNode(): Promise<void> {
    const hostname = os.hostname();
    const ipAddress = this.getLocalIpAddress();
    const port = parseInt(process.env.PORT || '3001', 10);
    const name = `worker-${hostname}-${port}`;

    const capabilities: WorkerCapabilities = {
      browsers: ['chromium', 'firefox', 'webkit'],
      applicationTypes: ['headless', 'headed', 'api'],
      os: process.platform,
      nodeVersion: process.version,
    };

    try {
      const { rows } = await pool.query(
        `INSERT INTO "WorkerNode" (
          id, name, hostname, "ipAddress", port, status, capabilities, 
          "maxConcurrency", "currentLoad", "lastHeartbeat", "createdAt", "updatedAt"
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 'idle', $5, $6, 0, now(), now(), now())
        ON CONFLICT (hostname, port) 
        DO UPDATE SET 
          status = 'idle', 
          capabilities = $5,
          "maxConcurrency" = $6,
          "currentLoad" = 0,
          "lastHeartbeat" = now(), 
          "updatedAt" = now()
        RETURNING id`,
        [name, hostname, ipAddress, port, JSON.stringify(capabilities), this.concurrency * this.poolSize]
      );

      this.workerNodeId = rows[0].id;
      logger.info(`Worker node registered: ${this.workerNodeId} (${name})`);
    } catch (error) {
      logger.error('Failed to register worker node:', { error });
      throw error;
    }
  }

  /**
   * Get local IP address
   */
  private getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    
    return '127.0.0.1';
  }

  /**
   * Process a job from the queue
   */
  private async processJob(job: Job<TestJobData>): Promise<void> {
    const { testRunId, scriptId, userId, organizationId, executionMode, browser } = job.data;

    logger.info(`Processing test job: ${testRunId}`, {
      scriptId,
      userId,
      organizationId,
      executionMode,
      browser,
    });

    const startTime = Date.now();

    try {
      // Update job queue status
      await pool.query(
        `UPDATE "JobQueue" SET status = 'processing', "startedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
         WHERE "testRunId" = $1`,
        [testRunId]
      );

      // Update test run status
      await pool.query(
        `UPDATE "TestRun" SET status = 'running', "workerNodeId" = $1, "startedAt" = now()
         WHERE id = $2`,
        [this.workerNodeId, testRunId]
      );

      // Execute based on application type
      switch (executionMode) {
        case 'api':
          await this.executeApiTest(testRunId, scriptId, userId);
          break;
        case 'headed':
          await this.executeBrowserTest(testRunId, scriptId, userId, browser || 'chromium', false);
          break;
        case 'headless':
        default:
          await this.executeBrowserTest(testRunId, scriptId, userId, browser || 'chromium', true);
          break;
      }

      const duration = Date.now() - startTime;

      // Update test run as completed
      await pool.query(
        `UPDATE "TestRun" SET status = 'passed', duration = $2, "completedAt" = now()
         WHERE id = $1`,
        [testRunId, duration]
      );

      // Update job progress
      await job.updateProgress(100);

      logger.info(`Test job completed: ${testRunId}`, { duration });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      logger.error(`Test job failed: ${testRunId}`, { error: error.message });

      // Update test run as failed
      await pool.query(
        `UPDATE "TestRun" SET status = 'failed', "errorMsg" = $2, duration = $3, "completedAt" = now()
         WHERE id = $1`,
        [testRunId, error.message, duration]
      );

      throw error;
    }
  }

  /**
   * Execute a browser-based test
   */
  private async executeBrowserTest(
    testRunId: string,
    scriptId: string,
    userId: string,
    browserType: string,
    headless: boolean
  ): Promise<void> {
    // Get script code
    const { rows } = await pool.query(
      `SELECT code, name, "browserType", viewport FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId]
    );

    if (!rows[0]) {
      throw new Error('Script not found or access denied');
    }

    const script = rows[0];
    
    logger.info(`Executing browser test: ${script.name}`, {
      browserType,
      headless,
      testRunId,
    });

    // Dynamic import playwright to avoid loading it when not needed
    const { chromium, firefox, webkit } = await import('playwright-core');
    
    let browser;
    try {
      // Select browser
      const browserLauncher = browserType === 'firefox' ? firefox : 
                              browserType === 'webkit' ? webkit : chromium;

      browser = await browserLauncher.launch({
        headless,
        args: headless ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
      });

      const context = await browser.newContext({
        viewport: script.viewport || { width: 1920, height: 1080 },
      });

      const page = await context.newPage();

      // Execute the script code
      // This is a simplified execution - in production, use a proper sandbox
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const scriptFn = new AsyncFunction('page', 'context', 'browser', script.code);
      
      await scriptFn(page, context, browser);

      await context.close();
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Execute an API/microservice test
   */
  private async executeApiTest(
    testRunId: string,
    scriptId: string,
    userId: string
  ): Promise<void> {
    // Get script code
    const { rows } = await pool.query(
      `SELECT code, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId]
    );

    if (!rows[0]) {
      throw new Error('Script not found or access denied');
    }

    const script = rows[0];
    
    logger.info(`Executing API test: ${script.name}`, { testRunId });

    // Execute API test script
    // This would typically use axios or fetch to make API calls
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const scriptFn = new AsyncFunction('axios', 'testRunId', script.code);
    
    const axios = (await import('axios')).default;
    await scriptFn(axios, testRunId);
  }

  /**
   * Increment worker load counter
   */
  private async incrementLoad(): Promise<void> {
    if (!this.workerNodeId) return;

    try {
      await pool.query(
        `UPDATE "WorkerNode" SET 
          "currentLoad" = "currentLoad" + 1, 
          status = 'busy', 
          "updatedAt" = now()
         WHERE id = $1`,
        [this.workerNodeId]
      );
    } catch (error) {
      logger.error('Failed to increment worker load:', { error });
    }
  }

  /**
   * Decrement worker load counter
   */
  private async decrementLoad(): Promise<void> {
    if (!this.workerNodeId) return;

    try {
      await pool.query(
        `UPDATE "WorkerNode" SET 
          "currentLoad" = GREATEST("currentLoad" - 1, 0), 
          status = CASE WHEN "currentLoad" - 1 <= 0 THEN 'idle' ELSE 'busy' END,
          "updatedAt" = now()
         WHERE id = $1`,
        [this.workerNodeId]
      );
    } catch (error) {
      logger.error('Failed to decrement worker load:', { error });
    }
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    const interval = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || '30000', 10);
    
    this.heartbeatInterval = setInterval(async () => {
      if (!this.workerNodeId) return;

      try {
        await pool.query(
          `UPDATE "WorkerNode" SET "lastHeartbeat" = now(), "updatedAt" = now()
           WHERE id = $1`,
          [this.workerNodeId]
        );
      } catch (error) {
        logger.error('Heartbeat failed:', { error });
      }
    }, interval);

    logger.info(`Worker heartbeat started: ${interval}ms interval`);
  }

  /**
   * Get all worker nodes
   */
  async getAllWorkerNodes(): Promise<WorkerNodeInfo[]> {
    const { rows } = await pool.query(
      `SELECT * FROM "WorkerNode" ORDER BY "createdAt" DESC`
    );

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      ipAddress: row.ipAddress,
      port: row.port,
      status: row.status,
      capabilities: row.capabilities,
      maxConcurrency: row.maxConcurrency,
      currentLoad: row.currentLoad,
      lastHeartbeat: row.lastHeartbeat,
    }));
  }

  /**
   * Get worker node by ID
   */
  async getWorkerNode(id: string): Promise<WorkerNodeInfo | null> {
    const { rows } = await pool.query(
      `SELECT * FROM "WorkerNode" WHERE id = $1`,
      [id]
    );

    if (!rows[0]) return null;

    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      ipAddress: row.ipAddress,
      port: row.port,
      status: row.status,
      capabilities: row.capabilities,
      maxConcurrency: row.maxConcurrency,
      currentLoad: row.currentLoad,
      lastHeartbeat: row.lastHeartbeat,
    };
  }

  /**
   * Mark offline workers
   */
  async markOfflineWorkers(thresholdMs: number = 60000): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE "WorkerNode" SET status = 'offline', "updatedAt" = now()
       WHERE "lastHeartbeat" < now() - interval '${thresholdMs} milliseconds'
       AND status != 'offline'`
    );

    if (rowCount && rowCount > 0) {
      logger.warn(`Marked ${rowCount} worker(s) as offline`);
    }

    return rowCount || 0;
  }

  /**
   * Check if worker pool is initialized and Redis is available
   */
  isReady(): boolean {
    return this.isInitialized && this.isRedisAvailable && this.workers.length > 0;
  }

  /**
   * Check if worker pool is in fallback mode (Redis not available)
   */
  isFallbackMode(): boolean {
    return this.isInitialized && !this.isRedisAvailable;
  }

  /**
   * Get current worker node ID
   */
  getWorkerNodeId(): string | null {
    return this.workerNodeId;
  }

  /**
   * Shutdown the worker pool
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down worker pool...');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all workers
    const closePromises = this.workers.map((worker, index) => {
      logger.info(`Closing worker ${index}...`);
      return worker.close();
    });

    await Promise.all(closePromises);
    this.workers = [];

    // Mark worker node as offline
    if (this.workerNodeId) {
      await pool.query(
        `UPDATE "WorkerNode" SET status = 'offline', "currentLoad" = 0, "updatedAt" = now()
         WHERE id = $1`,
        [this.workerNodeId]
      );
    }

    this.isInitialized = false;
    logger.info('Worker pool shutdown complete');
  }
}

// Export singleton instance
export const workerPoolService = new WorkerPoolService();

export default workerPoolService;
