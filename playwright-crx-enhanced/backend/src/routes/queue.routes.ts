/**
 * Queue Routes
 * 
 * API routes for job queue monitoring and management.
 */

import { Router } from 'express';
import { authMiddleware, requireRole, tenantMiddleware } from '../middleware/auth.middleware';
import * as queueController from '../controllers/queue.controller';

const router = Router();

/**
 * @swagger
 * /api/queue/status:
 *   get:
 *     summary: Get overall queue and worker status
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.get('/status', authMiddleware, queueController.getQueueStatus);

/**
 * @swagger
 * /api/queue/metrics:
 *   get:
 *     summary: Get queue metrics
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.get('/metrics', authMiddleware, queueController.getQueueMetrics);

/**
 * @swagger
 * /api/queue/jobs:
 *   get:
 *     summary: Get jobs by status
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [waiting, active, completed, failed, delayed]
 *       - name: start
 *         in: query
 *         schema:
 *           type: integer
 *       - name: end
 *         in: query
 *         schema:
 *           type: integer
 */
router.get('/jobs', authMiddleware, queueController.getJobs);

/**
 * @swagger
 * /api/queue/jobs/{jobId}:
 *   get:
 *     summary: Get job status
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.get('/jobs/:jobId', authMiddleware, queueController.getJobStatus);

/**
 * @swagger
 * /api/queue/jobs/{jobId}:
 *   delete:
 *     summary: Cancel/remove a job
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/jobs/:jobId', authMiddleware, queueController.cancelJob);

/**
 * @swagger
 * /api/queue/jobs/{jobId}/retry:
 *   post:
 *     summary: Retry a failed job
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.post('/jobs/:jobId/retry', authMiddleware, queueController.retryJob);

/**
 * @swagger
 * /api/queue/workers:
 *   get:
 *     summary: Get worker nodes
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.get('/workers', authMiddleware, queueController.getWorkers);

/**
 * @swagger
 * /api/queue/workers/{workerId}:
 *   get:
 *     summary: Get worker node details
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.get('/workers/:workerId', authMiddleware, queueController.getWorkerDetails);

// Admin-only routes (require organization owner/admin)
/**
 * @swagger
 * /api/queue/pause:
 *   post:
 *     summary: Pause the queue (admin only)
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/pause', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']), 
  queueController.pauseQueue
);

/**
 * @swagger
 * /api/queue/resume:
 *   post:
 *     summary: Resume the queue (admin only)
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/resume', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']), 
  queueController.resumeQueue
);

/**
 * @swagger
 * /api/queue/clean:
 *   post:
 *     summary: Clean old jobs (admin only)
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/clean', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']), 
  queueController.cleanQueue
);

export default router;
