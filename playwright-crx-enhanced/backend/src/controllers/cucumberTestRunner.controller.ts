/**
 * Cucumber Test Runner Controller
 * Integrates BDD UI with Cucumber test execution
 * Allows running tests from frontend dashboard
 */

import { Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import pool from '../db';

interface CucumberRunRequest extends Request {
  user?: any;
}

/**
 * Run Cucumber tests with optional filter
 * POST /api/bdd/run-cucumber
 */
export const runCucumberTests = asyncHandler(async (req: CucumberRunRequest, res: Response) => {
  const userId = req.user?.userId;
  const { filter = 'all', tags = '' } = req.body;

  logger.info(`🧪 Starting Cucumber tests - Filter: ${filter}, Tags: ${tags}`);

  // Validate filter
  const validFilters = ['all', 'smoke', 'api', 'forms', 'database', 'saucedemo'];
  if (!validFilters.includes(filter)) {
    return res.status(400).json({
      error: `Invalid filter. Must be one of: ${validFilters.join(', ')}`
    });
  }

  // Create run record in database
  const runId = generateRunId();
  const startTime = new Date();

  try {
    // Save run to database
    await pool.query(
      `INSERT INTO "BDDRun" (id, "userId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'running', now(), now())`,
      [runId, userId]
    );

    // Execute Cucumber in background
    executeTestsInBackground(runId, filter, tags, userId);

    // Return immediate response with run ID
    return res.status(201).json({
      success: true,
      data: {
        id: runId,
        status: 'running',
        filter,
        totalScenarios: 0,
        passedScenarios: 0,
        failedScenarios: 0,
        skippedScenarios: 0,
        totalDuration: 0,
        startedAt: startTime.toISOString(),
        features: []
      }
    });
  } catch (error: any) {
    logger.error(`Error starting test run: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to start test run',
      message: error.message
    });
  }
});

/**
 * Get test run by ID
 * GET /api/bdd/run-cucumber/:runId
 */
export const getTestRunStatus = asyncHandler(async (req: CucumberRunRequest, res: Response) => {
  const { runId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM "BDDRun" WHERE id = $1`,
      [runId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    const run = rows[0];

    return res.json({
      success: true,
      data: {
        id: run.id,
        status: run.status,
        totalScenarios: run.totalSteps || 0,
        passedScenarios: run.passedSteps || 0,
        failedScenarios: run.failedSteps || 0,
        skippedScenarios: run.skippedSteps || 0,
        totalDuration: calculateDuration(run.createdAt, run.completedAt),
        startedAt: run.createdAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMsg,
        features: []
      }
    });
  } catch (error: any) {
    logger.error(`Error getting test run status: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to get test run status'
    });
  }
});

/**
 * Get all test runs
 * GET /api/bdd/run-cucumber
 */
export const getTestRuns = asyncHandler(async (req: CucumberRunRequest, res: Response) => {
  const userId = req.user?.userId;
  const { limit = '20', offset = '0' } = req.query;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM "BDDRun" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const runs = rows.map(run => ({
      id: run.id,
      status: run.status,
      totalScenarios: run.totalSteps || 0,
      passedScenarios: run.passedSteps || 0,
      failedScenarios: run.failedSteps || 0,
      skippedScenarios: run.skippedSteps || 0,
      totalDuration: calculateDuration(run.createdAt, run.completedAt),
      startedAt: run.createdAt,
      completedAt: run.completedAt
    }));

    return res.json({
      success: true,
      data: runs
    });
  } catch (error: any) {
    logger.error(`Error getting test runs: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to get test runs'
    });
  }
});

/**
 * Execute tests in background
 */
function executeTestsInBackground(
  runId: string,
  filter: string,
  tags: string,
  userId: string
): void {
  setImmediate(async () => {
    try {
      const projectName = process.env.ACTIVE_PROJECT || 'project1';
      const backendDir = path.resolve(__dirname, '../..');

      // Build Cucumber command
      let command = 'npm';
      let args = ['run', `cucumber:${filter}`];

      if (tags) {
        args.push('--', '--tags', tags);
      }

      logger.info(`🏃 Executing: ${command} ${args.join(' ')}`);

      const process = spawn(command, args, {
        cwd: backendDir,
        stdio: 'pipe',
        env: {
          ...process.env,
          ACTIVE_PROJECT: projectName
        }
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
        logger.debug(`[${runId}] ${data}`);
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
        logger.error(`[${runId}] ${data}`);
      });

      process.on('close', async (code) => {
        try {
          const results = parseTestResults(stdout, stderr);

          // Update database with results
          await pool.query(
            `UPDATE "BDDRun" SET
              status = $1,
              "totalSteps" = $2,
              "passedSteps" = $3,
              "failedSteps" = $4,
              "skippedSteps" = $5,
              "completedAt" = now(),
              "updatedAt" = now()
            WHERE id = $6`,
            [
              results.success ? 'passed' : 'failed',
              results.total,
              results.passed,
              results.failed,
              results.skipped,
              runId
            ]
          );

          logger.info(`✅ Test run ${runId} completed: ${results.passed}/${results.total} passed`);
        } catch (updateError: any) {
          logger.error(`Error updating test results: ${updateError.message}`);

          // Mark as failed in database
          await pool.query(
            `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "completedAt" = now() WHERE id = $2`,
            [updateError.message, runId]
          );
        }
      });

      process.on('error', async (error: any) => {
        logger.error(`Error executing tests: ${error.message}`);

        await pool.query(
          `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "completedAt" = now() WHERE id = $2`,
          [error.message, runId]
        );
      });
    } catch (error: any) {
      logger.error(`Error in executeTestsInBackground: ${error.message}`);

      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "completedAt" = now() WHERE id = $2`,
        [error.message, runId]
      );
    }
  });
}

/**
 * Parse Cucumber test results from output
 */
function parseTestResults(
  stdout: string,
  stderr: string
): {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  // Parse: "16 scenarios (6 passed, 4 failed, 3 undefined, 3 skipped)"
  const scenarioMatch = stdout.match(/(\d+)\s+scenarios?\s*\(([^)]+)\)/);

  if (!scenarioMatch) {
    return { success: false, total: 0, passed: 0, failed: 0, skipped: 0 };
  }

  const total = parseInt(scenarioMatch[1], 10);
  const details = scenarioMatch[2];

  const passedMatch = details.match(/(\d+)\s+passed/);
  const failedMatch = details.match(/(\d+)\s+failed/);
  const skippedMatch = details.match(/(\d+)\s+skipped/);

  const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

  return {
    success: failed === 0,
    total,
    passed,
    failed,
    skipped
  };
}

/**
 * Generate unique run ID
 */
function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate duration between two timestamps
 */
function calculateDuration(startTime: Date, endTime?: Date | null): number {
  if (!endTime) return 0;
  return new Date(endTime).getTime() - new Date(startTime).getTime();
}
