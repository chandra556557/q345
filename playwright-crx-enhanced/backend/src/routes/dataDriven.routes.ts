import { Router } from 'express';
import { authMiddleware, optionalTenantMiddleware } from '../middleware/auth.middleware';
import {
  createDataDrivenRun,
  getDataDrivenRuns,
  getDataDrivenRun,
  startDataDrivenRun,
  stopDataDrivenRun,
  getDataDrivenRunResults,
  deleteDataDrivenRun,
  extractPlaceholders
} from '../controllers/dataDriven.controller';

const router = Router();

// List all data-driven runs
router.get('/', authMiddleware, getDataDrivenRuns);

// Get a specific data-driven run
router.get('/:id', authMiddleware, getDataDrivenRun);

// Get detailed results for a data-driven run
router.get('/:id/results', authMiddleware, getDataDrivenRunResults);

// Create a new data-driven run
router.post('/', authMiddleware, optionalTenantMiddleware, createDataDrivenRun);

// Extract placeholders from a script
router.post('/extract-placeholders', authMiddleware, extractPlaceholders);

// Start executing a data-driven run
router.post('/:id/start', authMiddleware, optionalTenantMiddleware, startDataDrivenRun);

// Stop a running data-driven run
router.post('/:id/stop', authMiddleware, stopDataDrivenRun);

// Delete a data-driven run
router.delete('/:id', authMiddleware, deleteDataDrivenRun);

export default router;
