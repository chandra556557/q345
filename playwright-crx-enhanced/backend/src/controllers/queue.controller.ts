/**
 * Queue Controller
 * 
 * Handles job queue monitoring and management.
 */

import { Request, Response } from 'express';
import { queueService } from '../services/queue';
import { workerPoolService } from '../services/workers';
import { logger } from '../utils/logger';

/**
 * @swagger
 * /api/queue/metrics:
 *   get:
 *     summary: Get queue metrics
 *     tags: [Queue]
 */
export const getQueueMetrics = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    const metrics = await queueService.getQueueMetrics();

    res.status(200).json({ success: true, data: metrics });
  } catch (error: any) {
    logger.error('Get queue metrics error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/jobs:
 *   get:
 *     summary: Get jobs by status
 *     tags: [Queue]
 */
export const getJobs = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    const status = (req.query.status as string) || 'waiting';
    const start = parseInt(req.query.start as string) || 0;
    const end = parseInt(req.query.end as string) || 50;

    if (!['waiting', 'active', 'completed', 'failed', 'delayed'].includes(status)) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid status. Allowed: waiting, active, completed, failed, delayed' 
      });
      return;
    }

    const jobs = await queueService.getJobsByStatus(
      status as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
      start,
      end
    );

    const jobData = jobs.map(job => ({
      id: job.id,
      name: job.name,
      data: job.data,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
    }));

    res.status(200).json({ success: true, data: jobData });
  } catch (error: any) {
    logger.error('Get jobs error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/jobs/{jobId}:
 *   get:
 *     summary: Get job status
 *     tags: [Queue]
 */
export const getJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    const { jobId } = req.params;
    const jobStatus = await queueService.getJobStatus(jobId);

    if (!jobStatus) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    res.status(200).json({ success: true, data: jobStatus });
  } catch (error: any) {
    logger.error('Get job status error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/jobs/{jobId}:
 *   delete:
 *     summary: Cancel/remove a job
 *     tags: [Queue]
 */
export const cancelJob = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    const { jobId } = req.params;
    const removed = await queueService.removeJob(jobId);

    if (!removed) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Job cancelled' });
  } catch (error: any) {
    logger.error('Cancel job error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/jobs/{jobId}/retry:
 *   post:
 *     summary: Retry a failed job
 *     tags: [Queue]
 */
export const retryJob = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    const { jobId } = req.params;
    const retried = await queueService.retryJob(jobId);

    if (!retried) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Job retry initiated' });
  } catch (error: any) {
    logger.error('Retry job error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/pause:
 *   post:
 *     summary: Pause the queue
 *     tags: [Queue]
 */
export const pauseQueue = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    await queueService.pause();

    res.status(200).json({ success: true, message: 'Queue paused' });
  } catch (error: any) {
    logger.error('Pause queue error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/resume:
 *   post:
 *     summary: Resume the queue
 *     tags: [Queue]
 */
export const resumeQueue = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    await queueService.resume();

    res.status(200).json({ success: true, message: 'Queue resumed' });
  } catch (error: any) {
    logger.error('Resume queue error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/clean:
 *   post:
 *     summary: Clean old jobs
 *     tags: [Queue]
 */
export const cleanQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!queueService.isReady()) {
      res.status(503).json({ 
        success: false, 
        error: 'Queue service not initialized' 
      });
      return;
    }

    const grace = parseInt(req.body.grace) || 24 * 3600 * 1000; // 24 hours
    const limit = parseInt(req.body.limit) || 100;
    const status = req.body.status || 'completed';

    if (!['completed', 'failed'].includes(status)) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid status. Allowed: completed, failed' 
      });
      return;
    }

    const removed = await queueService.clean(grace, limit, status);

    res.status(200).json({ 
      success: true, 
      message: `Cleaned ${removed.length} jobs`,
      data: { removed: removed.length }
    });
  } catch (error: any) {
    logger.error('Clean queue error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/workers:
 *   get:
 *     summary: Get worker nodes
 *     tags: [Queue]
 */
export const getWorkers = async (_req: Request, res: Response) => {
  try {
    const workers = await workerPoolService.getAllWorkerNodes();

    res.status(200).json({ success: true, data: workers });
  } catch (error: any) {
    logger.error('Get workers error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/workers/{workerId}:
 *   get:
 *     summary: Get worker node details
 *     tags: [Queue]
 */
export const getWorkerDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workerId } = req.params;
    const worker = await workerPoolService.getWorkerNode(workerId);

    if (!worker) {
      res.status(404).json({ success: false, error: 'Worker not found' });
      return;
    }

    res.status(200).json({ success: true, data: worker });
  } catch (error: any) {
    logger.error('Get worker details error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/queue/status:
 *   get:
 *     summary: Get overall queue and worker status
 *     tags: [Queue]
 */
export const getQueueStatus = async (_req: Request, res: Response) => {
  try {
    const queueReady = queueService.isReady();
    const workerReady = workerPoolService.isReady();
    
    let metrics = null;
    if (queueReady) {
      metrics = await queueService.getQueueMetrics();
    }

    const workers = await workerPoolService.getAllWorkerNodes();
    const activeWorkers = workers.filter(w => w.status !== 'offline').length;
    const totalCapacity = workers.reduce((sum, w) => sum + w.maxConcurrency, 0);
    const currentLoad = workers.reduce((sum, w) => sum + w.currentLoad, 0);

    res.status(200).json({ 
      success: true, 
      data: {
        queue: {
          ready: queueReady,
          metrics,
        },
        workers: {
          ready: workerReady,
          total: workers.length,
          active: activeWorkers,
          totalCapacity,
          currentLoad,
          utilizationPercent: totalCapacity > 0 ? Math.round((currentLoad / totalCapacity) * 100) : 0,
        }
      }
    });
  } catch (error: any) {
    logger.error('Get queue status error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};
