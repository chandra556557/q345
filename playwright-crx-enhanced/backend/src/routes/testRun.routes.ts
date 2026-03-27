import { Router } from 'express';
import { authMiddleware, tenantMiddleware, optionalTenantMiddleware } from '../middleware/auth.middleware';
import {
  getTestRuns,
  getTestRun,
  startTestRun,
  executeCurrentScript,
  stopTestRun,
  getActiveTestRuns,
  reportTestResult,
  updateTestRun,
  startQueuedTestRun,
  startBatchTestRuns,
  getOrganizationTestRuns
} from '../controllers/testRun.controller';

const router = Router();

// Get all test runs for a user
router.get('/', authMiddleware, getTestRuns);

// Get active test runs
router.get('/active', authMiddleware, getActiveTestRuns);

// Get organization test runs (multi-tenant)
router.get('/organization', authMiddleware, tenantMiddleware, getOrganizationTestRuns);

// Get a specific test run
router.get('/:id', authMiddleware, getTestRun);

// Start a new test run (legacy)
router.post('/start', authMiddleware, startTestRun);

// Start a queued test run (multi-tenant, worker-based)
router.post('/queue', authMiddleware, optionalTenantMiddleware, startQueuedTestRun);

// Start batch test runs (multiple scripts)
router.post('/batch', authMiddleware, optionalTenantMiddleware, startBatchTestRuns);

// Execute current script code directly
router.post('/execute-current', authMiddleware, executeCurrentScript);

// Update test run (status, steps, completion)
router.put('/:id', authMiddleware, updateTestRun);

// Report a test result (create completed run)
router.post('/report', authMiddleware, reportTestResult);

// Stop a test run
router.post('/:id/stop', authMiddleware, stopTestRun);

export default router;
