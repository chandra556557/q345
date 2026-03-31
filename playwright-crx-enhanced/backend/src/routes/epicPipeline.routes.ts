import { Router } from 'express';
import { authMiddleware, optionalTenantMiddleware } from '../middleware/auth.middleware';
import {
  testJiraConnection,
  saveJiraConfig,
  getJiraConfig,
  getJiraProjects,
  getJiraEpics,
  getJiraEpicWithStories,
  searchJiraIssues,
  generateTestCases,
  generateFromJira,
  startPipeline,
  listPipelineRuns,
  getPipelineRun,
  streamPipelineRun,
} from '../controllers/epicPipeline.controller';

const router = Router();

// ── Jira Integration ──────────────────────────────────────────────────
router.post('/jira/test-connection', authMiddleware, testJiraConnection);
router.post('/jira/save-config', authMiddleware, optionalTenantMiddleware, saveJiraConfig);
router.get('/jira/config', authMiddleware, optionalTenantMiddleware, getJiraConfig);
router.get('/jira/projects', authMiddleware, getJiraProjects);
router.get('/jira/epics/:projectKey', authMiddleware, getJiraEpics);
router.get('/jira/epic/:epicKey', authMiddleware, getJiraEpicWithStories);
router.post('/jira/search', authMiddleware, searchJiraIssues);

// ── Test Case Generation ──────────────────────────────────────────────
router.post('/generate', authMiddleware, optionalTenantMiddleware, generateTestCases);
router.post('/generate-from-jira', authMiddleware, optionalTenantMiddleware, generateFromJira);

// ── Full Pipeline (Epic → Test Cases → Gherkin → Playwright) ─────────
router.post('/run', authMiddleware, optionalTenantMiddleware, startPipeline);
router.get('/runs', authMiddleware, optionalTenantMiddleware, listPipelineRuns);
router.get('/runs/:id', authMiddleware, getPipelineRun);
router.get('/runs/:id/stream', streamPipelineRun);

export default router;
