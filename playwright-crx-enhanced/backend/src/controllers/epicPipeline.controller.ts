import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { jiraService } from '../services/bdd/jira.service';
import { testCaseGenerator } from '../services/bdd/testCaseGenerator.service';
import { workflowOrchestrator, workflowEventEmitter } from '../services/bdd/workflowOrchestrator.service';

// =========================================================================
// Jira Integration Endpoints
// =========================================================================

/**
 * POST /api/epic-pipeline/jira/test-connection
 */
export const testJiraConnection = asyncHandler(async (req: Request, res: Response) => {
  const { baseUrl, email, apiToken, apiVersion } = req.body;
  if (!baseUrl || !email || !apiToken) {
    return res.status(400).json({ error: 'baseUrl, email, and apiToken are required' });
  }
  const result = await jiraService.testConnection({ baseUrl, email, apiToken, apiVersion });
  return res.json(result);
});

/**
 * POST /api/epic-pipeline/jira/save-config
 */
export const saveJiraConfig = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { baseUrl, email, apiToken, apiVersion } = req.body;

  if (!baseUrl || !email || !apiToken) {
    return res.status(400).json({ error: 'baseUrl, email, and apiToken are required' });
  }

  await jiraService.saveConfig(userId, organizationId, { baseUrl, email, apiToken, apiVersion });
  return res.json({ success: true, message: 'Jira configuration saved' });
});

/**
 * GET /api/epic-pipeline/jira/config
 */
export const getJiraConfig = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;

  const config = await jiraService.loadConfig(userId, organizationId);
  if (!config) return res.json({ configured: false });

  return res.json({
    configured: true,
    baseUrl: config.baseUrl,
    email: config.email,
    apiVersion: config.apiVersion,
  });
});

/**
 * GET /api/epic-pipeline/jira/projects
 */
export const getJiraProjects = asyncHandler(async (req: Request, res: Response) => {
  const config = await getJiraConfigForUser(req);
  const projects = await jiraService.getProjects(config);
  return res.json({ data: projects });
});

/**
 * GET /api/epic-pipeline/jira/epics/:projectKey
 */
export const getJiraEpics = asyncHandler(async (req: Request, res: Response) => {
  const config = await getJiraConfigForUser(req);
  const { projectKey } = req.params;
  if (!projectKey) return res.status(400).json({ error: 'projectKey is required' });

  const epics = await jiraService.getEpics(config, projectKey);
  return res.json({ data: epics });
});

/**
 * GET /api/epic-pipeline/jira/epic/:epicKey
 */
export const getJiraEpicWithStories = asyncHandler(async (req: Request, res: Response) => {
  const config = await getJiraConfigForUser(req);
  const { epicKey } = req.params;
  if (!epicKey) return res.status(400).json({ error: 'epicKey is required' });

  const epic = await jiraService.getEpicWithStories(config, epicKey);
  return res.json({ data: epic });
});

/**
 * POST /api/epic-pipeline/jira/search
 */
export const searchJiraIssues = asyncHandler(async (req: Request, res: Response) => {
  const config = await getJiraConfigForUser(req);
  const { jql, maxResults } = req.body;
  if (!jql) return res.status(400).json({ error: 'jql is required' });

  const result = await jiraService.searchIssues(config, jql, maxResults || 50);
  return res.json({ data: result });
});

// =========================================================================
// Test Case Generation Endpoints
// =========================================================================

/**
 * POST /api/epic-pipeline/generate
 * Generate test cases from manual input (no Jira required)
 */
export const generateTestCases = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { summary, description, acceptanceCriteria, priority, options } = req.body;

  if (!summary) return res.status(400).json({ error: 'summary is required' });

  const result = await workflowOrchestrator.generateFromManualInput(
    userId, organizationId,
    { summary, description: description || '', acceptanceCriteria: acceptanceCriteria || [], priority },
    options || {}
  );

  return res.json({ success: true, data: result });
});

/**
 * POST /api/epic-pipeline/generate-from-jira
 * Generate test cases from a specific Jira story
 */
export const generateFromJira = asyncHandler(async (req: Request, res: Response) => {
  const config = await getJiraConfigForUser(req);
  const { storyKey, options } = req.body;
  if (!storyKey) return res.status(400).json({ error: 'storyKey is required' });

  const stories = await jiraService.getStoriesByJQL(config, `key = "${storyKey}"`);
  if (stories.length === 0) return res.status(404).json({ error: `Story ${storyKey} not found` });

  const result = await testCaseGenerator.generateFromStory(stories[0], options || {});
  return res.json({ success: true, data: result });
});

// =========================================================================
// Full Workflow Pipeline Endpoints
// =========================================================================

/**
 * POST /api/epic-pipeline/run
 * Start the full Epic → Test Cases → Gherkin → Playwright pipeline
 */
export const startPipeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;

  const {
    epicKey, storyKeys, jql, sprintId, projectKey,
    categories, maxCasesPerCategory, includeDataVariations,
    securityDepth, aiProvider, aiApiKey, aiModel, applicationContext,
    autoCreateFeatures, autoExecute, executionBrowser, executionMode,
  } = req.body;

  if (!epicKey && !storyKeys?.length && !jql && !(sprintId && projectKey)) {
    return res.status(400).json({ error: 'Provide epicKey, storyKeys, jql, or sprintId+projectKey' });
  }

  // Resolve Jira config
  let jiraConfig;
  if (req.body.jiraBaseUrl && req.body.jiraEmail && req.body.jiraApiToken) {
    jiraConfig = {
      baseUrl: req.body.jiraBaseUrl,
      email: req.body.jiraEmail,
      apiToken: req.body.jiraApiToken,
      apiVersion: req.body.jiraApiVersion || 'v3',
    };
  } else {
    jiraConfig = await jiraService.loadConfig(userId, organizationId);
    if (!jiraConfig) {
      return res.status(400).json({ error: 'No Jira config found. Save config first or provide credentials.' });
    }
  }

  const run = await workflowOrchestrator.executeWorkflow(userId, organizationId, {
    jiraConfig,
    epicKey, storyKeys, jql, sprintId, projectKey,
    generation: {
      categories,
      maxCasesPerCategory: maxCasesPerCategory || 5,
      includeDataVariations,
      securityDepth: securityDepth || 'basic',
      aiProvider: aiProvider || 'none',
      aiApiKey, aiModel, applicationContext,
    },
    autoCreateFeatures: autoCreateFeatures !== false,
    autoExecute: autoExecute || false,
    executionBrowser, executionMode,
  });

  return res.status(201).json({ success: true, data: { id: run.id, status: run.status } });
});

/**
 * GET /api/epic-pipeline/runs
 */
export const listPipelineRuns = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const runs = await workflowOrchestrator.listWorkflowRuns(userId, organizationId);
  return res.json({ data: runs });
});

/**
 * GET /api/epic-pipeline/runs/:id
 */
export const getPipelineRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const run = await workflowOrchestrator.getWorkflowRun(req.params.id, userId);
  if (!run) return res.status(404).json({ error: 'Pipeline run not found' });
  return res.json({ data: run });
});

/**
 * GET /api/epic-pipeline/runs/:id/stream
 * SSE stream for live pipeline progress
 */
export const streamPipelineRun = (req: Request, res: Response) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const handler = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  workflowEventEmitter.on(`workflow:${id}`, handler);
  req.on('close', () => {
    workflowEventEmitter.off(`workflow:${id}`, handler);
  });
};

// =========================================================================
// Helper
// =========================================================================

async function getJiraConfigForUser(req: Request) {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;

  if (req.body?.baseUrl && req.body?.email && req.body?.apiToken) {
    return { baseUrl: req.body.baseUrl, email: req.body.email, apiToken: req.body.apiToken, apiVersion: req.body.apiVersion || 'v3' };
  }

  const config = await jiraService.loadConfig(userId, organizationId);
  if (!config) throw Object.assign(new Error('Jira not configured'), { statusCode: 400 });
  return config;
}
