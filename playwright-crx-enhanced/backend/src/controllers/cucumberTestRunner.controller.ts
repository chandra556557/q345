/**
 * Cucumber Test Runner Controller
 * Integrates BDD UI with Cucumber test execution
 * Allows running tests from frontend dashboard
 */

import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { fetchProjectConfig, buildProjectEnvVars, markRunFailed } from '../utils/projectHelpers';
import pool from '../db';

// --- Constants ---

interface CucumberRunRequest extends Request {
  user?: any;
}

const VALID_FILTERS = ['all', 'smoke', 'api', 'forms', 'database', 'saucedemo'] as const;
type CucumberFilter = typeof VALID_FILTERS[number];

/** Calculate duration between two timestamps */
function calculateDuration(startTime: Date, endTime?: Date | null): number {
  if (!endTime) return 0;
  return new Date(endTime).getTime() - new Date(startTime).getTime();
}

/** Parse Cucumber test results from stdout */
function parseTestResults(stdout: string): {
  success: boolean; total: number; passed: number; failed: number; skipped: number;
} {
  const scenarioMatch = stdout.match(/(\d+)\s+scenarios?\s*\(([^)]+)\)/);
  if (!scenarioMatch) {
    return { success: false, total: 0, passed: 0, failed: 0, skipped: 0 };
  }

  const total = parseInt(scenarioMatch[1], 10);
  const details = scenarioMatch[2];
  const passed = parseInt(details.match(/(\d+)\s+passed/)?.[1] || '0', 10);
  const failed = parseInt(details.match(/(\d+)\s+failed/)?.[1] || '0', 10);
  const skipped = parseInt(details.match(/(\d+)\s+skipped/)?.[1] || '0', 10);

  return { success: failed === 0, total, passed, failed, skipped };
}

// --- Route Handlers ---

/**
 * Run Cucumber tests with optional filter
 * POST /api/bdd/run-cucumber
 */
export const runCucumberTests = asyncHandler(async (req: CucumberRunRequest, res: Response) => {
  const userId = req.user?.userId;
  const { filter = 'all', tags = '', projectId = '' } = req.body;

  logger.info(`Starting Cucumber tests - Filter: ${filter}, Tags: ${tags}, ProjectId: ${projectId}`);

  if (!VALID_FILTERS.includes(filter as CucumberFilter)) {
    return res.status(400).json({
      error: `Invalid filter. Must be one of: ${VALID_FILTERS.join(', ')}`
    });
  }

  const runId = randomUUID();
  const startTime = new Date();

  try {
    const projectConfig = await fetchProjectConfig(projectId);

    await pool.query(
      `INSERT INTO "BDDRun" (id, "userId", status, "projectId", "projectName", "projectBaseUrl", "createdAt", "updatedAt")
       VALUES ($1, $2, 'running', $3, $4, $5, now(), now())`,
      [runId, userId, projectConfig?.id || null, projectConfig?.name || null, projectConfig?.baseUrl || null]
    );

    executeTestsInBackground(runId, filter, tags, projectConfig);

    return res.status(201).json({
      success: true,
      data: {
        id: runId, status: 'running', filter,
        totalScenarios: 0, passedScenarios: 0, failedScenarios: 0, skippedScenarios: 0,
        totalDuration: 0, startedAt: startTime.toISOString(), features: []
      }
    });
  } catch (error: any) {
    logger.error(`Error starting test run: ${error.message}`);
    return res.status(500).json({ error: 'Failed to start test run' });
  }
});

/**
 * Get test run by ID
 * GET /api/bdd/run-cucumber/:runId
 */
export const getTestRunStatus = asyncHandler(async (req: CucumberRunRequest, res: Response) => {
  const userId = req.user?.userId;
  const { runId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM "BDDRun" WHERE id = $1 AND "userId" = $2`,
      [runId, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Test run not found' });

    const run = rows[0];
    return res.json({
      success: true,
      data: {
        id: run.id, status: run.status,
        totalScenarios: run.totalSteps || 0, passedScenarios: run.passedSteps || 0,
        failedScenarios: run.failedSteps || 0, skippedScenarios: run.skippedSteps || 0,
        totalDuration: calculateDuration(run.createdAt, run.completedAt),
        startedAt: run.createdAt, completedAt: run.completedAt,
        errorMessage: run.errorMsg, features: []
      }
    });
  } catch (error: any) {
    logger.error(`Error getting test run status: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get test run status' });
  }
});

/**
 * Get all test runs
 * GET /api/bdd/run-cucumber
 */
export const getTestRuns = asyncHandler(async (req: CucumberRunRequest, res: Response) => {
  const userId = req.user?.userId;
  const { limit: rawLimit = '20', offset: rawOffset = '0' } = req.query;
  const parsedLimit = Math.min(100, Math.max(1, parseInt(rawLimit as string, 10) || 20));
  const parsedOffset = Math.max(0, parseInt(rawOffset as string, 10) || 0);

  try {
    const { rows } = await pool.query(
      `SELECT * FROM "BDDRun" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
      [userId, parsedLimit, parsedOffset]
    );

    const runs = rows.map(run => ({
      id: run.id, status: run.status,
      totalScenarios: run.totalSteps || 0, passedScenarios: run.passedSteps || 0,
      failedScenarios: run.failedSteps || 0, skippedScenarios: run.skippedSteps || 0,
      totalDuration: calculateDuration(run.createdAt, run.completedAt),
      startedAt: run.createdAt, completedAt: run.completedAt
    }));

    return res.json({ success: true, data: runs });
  } catch (error: any) {
    logger.error(`Error getting test runs: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get test runs' });
  }
});

// --- Background Execution ---

function executeTestsInBackground(
  runId: string, filter: string, tags: string, projectConfig?: any
): void {
  setImmediate(async () => {
    try {
      const projectName = projectConfig?.name || process.env.ACTIVE_PROJECT || 'project1';
      const backendDir = path.resolve(__dirname, '../..');
      const args = ['run', `cucumber:${filter}`];
      if (tags) args.push('--', '--tags', tags);

      logger.info(`Executing: npm ${args.join(' ')} [Project: ${projectName}]`);

      const projectEnvVars = projectConfig
        ? buildProjectEnvVars(projectConfig)
        : { ACTIVE_PROJECT: projectName };

      const childProcess = spawn('npm', args, {
        cwd: backendDir,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, ...projectEnvVars }
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        logger.debug(`[${runId}] ${data}`);
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        logger.error(`[${runId}] ${data}`);
      });

      childProcess.on('close', async () => {
        try {
          const results = parseTestResults(stdout);
          await pool.query(
            `UPDATE "BDDRun" SET
              status = $1, "totalSteps" = $2, "passedSteps" = $3, "failedSteps" = $4, "skippedSteps" = $5,
              "completedAt" = now(), "updatedAt" = now()
            WHERE id = $6`,
            [results.success ? 'passed' : 'failed', results.total, results.passed, results.failed, results.skipped, runId]
          );
          logger.info(`Test run ${runId} completed: ${results.passed}/${results.total} passed`);
        } catch (updateError: any) {
          logger.error(`Error updating test results: ${updateError.message}`);
          await markRunFailed(runId, updateError.message);
        }
      });

      childProcess.on('error', async (error: any) => {
        logger.error(`Error executing tests: ${error.message}`);
        await markRunFailed(runId, error.message);
      });
    } catch (error: any) {
      logger.error(`Error in executeTestsInBackground: ${error.message}`);
      await markRunFailed(runId, error.message);
    }
  });
}
