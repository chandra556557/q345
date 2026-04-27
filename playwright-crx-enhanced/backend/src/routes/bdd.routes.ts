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
  featureFileUpload,
  importFeatureFiles,
  csvToScenarioOutline,
  saveAsScript,
  generatePOM,
  applyPOMToFeature,
  scanPOM,
  mintStreamToken,
  healLocator,
  getProjectAuthStatus,
  saveProjectAuth,
  deleteProjectAuth,
} from '../controllers/bdd.controller';
import {
  runCucumberTests,
  getTestRunStatus,
  getTestRuns
} from '../controllers/cucumberTestRunner.controller';

const router = Router();

// Feature file import (must be before :id routes to avoid route conflict)
router.post('/features/import', authMiddleware, optionalTenantMiddleware, featureFileUpload.array('files', 20), importFeatureFiles);
router.post('/features/csv-to-outline', authMiddleware, testCaseUpload.single('file'), csvToScenarioOutline);

// Feature CRUD
router.get('/features', authMiddleware, getFeatures);
router.get('/features/:id', authMiddleware, getFeature);
router.post('/features', authMiddleware, optionalTenantMiddleware, createFeature);
router.put('/features/:id', authMiddleware, optionalTenantMiddleware, updateFeature);
router.delete('/features/:id', authMiddleware, deleteFeature);

// Parse / Generate / Save as Script
router.post('/parse', authMiddleware, parseFeature);
router.post('/features/:id/generate', authMiddleware, generateCode);
router.post('/features/:id/save-as-script', authMiddleware, optionalTenantMiddleware, saveAsScript);
router.post('/generate-pom', authMiddleware, generatePOM);
router.post('/scan-pom', authMiddleware, scanPOM);
router.post('/apply-pom', authMiddleware, applyPOMToFeature);
router.post('/heal-locator', authMiddleware, healLocator);

// Project auth (per-project storageState with TTL + encryption at rest)
router.get('/projects/:id/auth/status', authMiddleware, getProjectAuthStatus);
router.put('/projects/:id/auth', authMiddleware, saveProjectAuth);
router.delete('/projects/:id/auth', authMiddleware, deleteProjectAuth);

// Run execution
router.post('/features/:id/run', authMiddleware, optionalTenantMiddleware, runFeature);
router.get('/runs', authMiddleware, getRuns);
router.get('/runs/:id', authMiddleware, getRun);
// Report access: auth via token query param (so the report can be opened in a
// new window via window.open('/api/...?token=...') — browsers don't send our
// Authorization header through that flow).
router.get('/runs/:id/report', getRunReport);
router.post('/runs/:id/stream-token', authMiddleware, mintStreamToken); // mint short-lived HMAC stream token
router.get('/runs/:id/stream', streamRun); // No authMiddleware — SSE uses streamToken (HMAC) or legacy token query param
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

// Cucumber Test Runner - Run tests from UI dashboard
router.post('/run-cucumber', authMiddleware, runCucumberTests);
router.get('/run-cucumber', authMiddleware, getTestRuns);
router.get('/run-cucumber/:runId', authMiddleware, getTestRunStatus);

export default router;
