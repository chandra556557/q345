import { Router } from 'express';
import { authMiddleware, optionalTenantMiddleware } from '../middleware/auth.middleware';
import {
  createFeature,
  getFeatures,
  getFeature,
  updateFeature,
  deleteFeature,
  parseFeature,
  generateCode,
  runFeature,
  getRuns,
  getRun,
  deleteRun,
  cancelRun,
  getRunReport,
  getExecutionStatus,
  createStepLibEntry,
  getStepLibrary,
  updateStepLibEntry,
  deleteStepLibEntry,
  createSchedule,
  getSchedules,
  updateSchedule,
  deleteSchedule,
  streamRun,
  convertToGherkin,
  testCaseUpload,
} from '../controllers/bdd.controller';

const router = Router();

// Feature CRUD
router.get('/features', authMiddleware, getFeatures);
router.get('/features/:id', authMiddleware, getFeature);
router.post('/features', authMiddleware, optionalTenantMiddleware, createFeature);
router.put('/features/:id', authMiddleware, optionalTenantMiddleware, updateFeature);
router.delete('/features/:id', authMiddleware, deleteFeature);

// Parse / Generate
router.post('/parse', authMiddleware, parseFeature);
router.post('/features/:id/generate', authMiddleware, generateCode);

// Run execution
router.post('/features/:id/run', authMiddleware, optionalTenantMiddleware, runFeature);
router.get('/runs', authMiddleware, getRuns);
router.get('/runs/:id', authMiddleware, getRun);
router.get('/runs/:id/report', getRunReport); // No auth — serves HTML report directly (linked from UI)
router.get('/runs/:id/stream', streamRun); // No authMiddleware — SSE uses token query param (EventSource can't send headers)
router.post('/runs/:id/cancel', authMiddleware, cancelRun);
router.delete('/runs/:id', authMiddleware, deleteRun);

// Execution status (concurrency monitoring)
router.get('/status', authMiddleware, getExecutionStatus);

// Step Library (reusable step definitions)
router.get('/step-library', authMiddleware, getStepLibrary);
router.post('/step-library', authMiddleware, optionalTenantMiddleware, createStepLibEntry);
router.put('/step-library/:id', authMiddleware, optionalTenantMiddleware, updateStepLibEntry);
router.delete('/step-library/:id', authMiddleware, deleteStepLibEntry);

// Scheduled runs (cron)
router.get('/schedules', authMiddleware, getSchedules);
router.post('/schedules', authMiddleware, optionalTenantMiddleware, createSchedule);
router.put('/schedules/:id', authMiddleware, optionalTenantMiddleware, updateSchedule);
router.delete('/schedules/:id', authMiddleware, deleteSchedule);

// Test case → Gherkin conversion (supports file upload or JSON body)
router.post('/convert', authMiddleware, testCaseUpload.single('file'), convertToGherkin);

export default router;
