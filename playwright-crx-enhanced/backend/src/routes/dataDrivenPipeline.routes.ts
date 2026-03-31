/**
 * Data-Driven Pipeline Routes
 *
 * Unified 5-step data-driven testing pipeline endpoints.
 */

import { Router } from 'express';
import { authMiddleware, optionalTenantMiddleware } from '../middleware/auth.middleware';
import {
  runPipeline,
  analyzeScript,
  previewPipeline,
  getPipelineStatus,
  cancelPipeline,
  getPipelineResults,
} from '../controllers/dataDrivenPipeline.controller';

const router = Router();

// Step 1 only — analyze script and return detected fields (dry-run)
router.post('/analyze', authMiddleware, analyzeScript);

// Steps 1–3 — analyze, generate data, parameterize (dry-run preview, no execution)
router.post('/preview', authMiddleware, previewPipeline);

// Full pipeline — analyze → generate → parameterize → execute → report (async)
router.post('/run', authMiddleware, optionalTenantMiddleware, runPipeline);

// Poll pipeline execution status
router.get('/status/:id', authMiddleware, getPipelineStatus);

// Get full results with per-strategy breakdown
router.get('/results/:id', authMiddleware, getPipelineResults);

// Cancel a running pipeline
router.post('/cancel/:id', authMiddleware, cancelPipeline);

export default router;
