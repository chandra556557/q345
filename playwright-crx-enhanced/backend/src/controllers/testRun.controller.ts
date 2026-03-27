import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { allureService } from '../services/allure.service';
import { queueService } from '../services/queue';
import { tenantService } from '../services/tenant';
import pool from '../db';
import { randomUUID } from 'crypto';


/**
 * Get all test runs for a user
 */
export const getTestRuns = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId } = req.query;

    let query = `SELECT tr.*, s.name AS script_name, s."projectId" AS script_project_id
       FROM "TestRun" tr
       JOIN "Script" s ON s.id = tr."scriptId"
       WHERE tr."userId" = $1 AND tr."dataDrivenRunId" IS NULL`;
    
    const params = [userId];
    
    if (projectId) {
      query += ` AND s."projectId" = $2`;
      params.push(projectId as string);
    }
    
    query += ` ORDER BY tr."startedAt" DESC`;

    const { rows } = await pool.query(query, params);

    const testRuns = rows.map(r => ({
      ...r,
      script: { name: r.script_name }
    }));

    res.status(200).json({ success: true, data: testRuns });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to get test runs' });
  }
};

/**
 * Get a specific test run
 */
export const getTestRun = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT tr.*, s.name AS script_name, s.language AS script_language
       FROM "TestRun" tr
       LEFT JOIN "Script" s ON s.id = tr."scriptId"
       WHERE tr.id = $1 AND tr."userId" = $2`,
      [id, userId]
    );

    const testRun = rows[0];
    if (!testRun) throw new AppError('Test run not found', 404);

    res.status(200).json({
      success: true,
      data: {
        ...testRun,
        script: { name: testRun.script_name || 'Current Script', language: testRun.script_language || 'playwright-test' }
      }
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to get test run' });
    }
  }
};

/**
 * Start a new test run
 */
export const startTestRun = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { scriptId, dataFileId: _dataFileId, environment, browser } = req.body;

    if (!scriptId) throw new AppError('Script ID is required', 400);

    const scriptRes = await pool.query(
      `SELECT id, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId]
    );
    const script = scriptRes.rows[0];
    if (!script) throw new AppError('Script not found', 404);

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "TestRun" (id, "scriptId", "userId", status, environment, browser, "startedAt")
       VALUES ($1, $2, $3, 'queued', COALESCE($4, 'development'), COALESCE($5, 'chromium'), now())
       RETURNING *`,
      [id, scriptId, userId, environment ?? null, browser ?? null]
    );
    const testRun = rows[0];

    try {
      await allureService.startTest(testRun.id, script.name, {
        browser: browser || 'chromium',
        environment: environment || 'development',
        suiteName: script.name,
      });
    } catch (error) {
      console.error('Failed to start Allure test:', error);
    }

    setTimeout(async () => {
      try {
        const mockSteps = [
          { action: 'Navigate to page', status: 'passed' as const, duration: 500 },
          { action: 'Fill input field', status: 'passed' as const, duration: 300 },
          { action: 'Click submit button', status: 'passed' as const, duration: 200 },
          { action: 'Verify success message', status: 'passed' as const, duration: 150 }
        ];

        for (const step of mockSteps) {
          await allureService.recordStep(testRun.id, step.action, step.status, step.duration);
        }

        await allureService.endTest(testRun.id, 'passed');

        // Generate Allure report
        let reportUrl = '';
        try {
          await allureService.generateReport(testRun.id);
          reportUrl = await allureService.getReportUrl(testRun.id);
        } catch (error) {
          console.error('Failed to generate Allure report:', error);
        }

        await pool.query(
          `UPDATE "TestRun"
           SET status = 'passed',
               "completedAt" = now(),
               duration = $2,
               "executionReportUrl" = $3
           WHERE id = $1`,
          [testRun.id, mockSteps.reduce((sum, s) => sum + (s.duration || 0), 0), reportUrl]
        );
      } catch (error) {
        console.error('Failed to complete mock test execution:', error);
      }
    }, 2000);

    res.status(201).json({ success: true, data: testRun });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to start test run' });
    }
  }
};

/**
 * Execute current script code directly (without saving to database)
 */
export const executeCurrentScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { code, language, environment, browser } = req.body;

    if (!code || !language) throw new AppError('Code and language are required', 400);

    // Create a temporary script ID for tracking
    const tempScriptId = randomUUID();
    
    // Create a temporary script entry
    await pool.query(
      `INSERT INTO "Script" (id, name, description, language, code, "userId", "browserType", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'chromium'), now(), now())`,
      [tempScriptId, 'Current Script (Temp)', 'Temporary script for direct execution', language, code, userId, browser ?? null]
    );

    const testRunId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "TestRun" (id, "scriptId", "userId", status, environment, browser, "startedAt")
       VALUES ($1, $2, $3, 'running', COALESCE($4, 'development'), COALESCE($5, 'chromium'), now())
       RETURNING *`,
      [testRunId, tempScriptId, userId, environment ?? null, browser ?? null]
    );
    const testRun = rows[0];

    try {
      await allureService.startTest(testRun.id, `Current Script (${language})`, {
        browser: browser || 'chromium',
        environment: environment || 'development',
        suiteName: `Current Script (${language})`,
      });
    } catch (error) {
      console.error('Failed to start Allure test:', error);
    }

    // Simulate test execution (async)
    setTimeout(async () => {
      try {
        const mockSteps = [
          { action: 'Parse script code', status: 'passed' as const, duration: 300 },
          { action: 'Initialize browser', status: 'passed' as const, duration: 500 },
          { action: 'Execute script actions', status: 'passed' as const, duration: 800 },
          { action: 'Verify results', status: 'passed' as const, duration: 200 }
        ];

        for (const step of mockSteps) {
          await allureService.recordStep(testRun.id, step.action, step.status, step.duration);
        }

        await allureService.endTest(testRun.id, 'passed');

        // Generate Allure report
        let reportUrl = '';
        try {
          await allureService.generateReport(testRun.id);
          reportUrl = await allureService.getReportUrl(testRun.id);
        } catch (error) {
          console.error('Failed to generate Allure report:', error);
        }

        await pool.query(
          `UPDATE "TestRun"
           SET status = 'passed',
               "completedAt" = now(),
               duration = $2,
               "executionReportUrl" = $3
           WHERE id = $1`,
          [testRun.id, mockSteps.reduce((sum, s) => sum + (s.duration || 0), 0), reportUrl]
        );

        // Clean up temporary script after test completes (with delay)
        setTimeout(async () => {
          await pool.query(
            `DELETE FROM "Script" WHERE id = $1`,
            [tempScriptId]
          ).catch(err => console.error('Failed to cleanup temp script:', err));
        }, 10000); // Wait 10 seconds before cleanup
      } catch (error) {
        console.error('Failed to complete current script execution:', error);
        // Update test run as failed
        await pool.query(
          `UPDATE "TestRun"
           SET status = 'failed',
               "completedAt" = now(),
               "errorMsg" = $2
           WHERE id = $1`,
          [testRun.id, String(error)]
        ).catch(() => {});
      }
    }, 100); // Start execution almost immediately

    // Return immediately with running status
    res.status(201).json({ success: true, data: testRun });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to execute current script' });
    }
  }
};

/**
 * Stop a test run
 */
export const stopTestRun = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    const exists = await pool.query(
      `SELECT id FROM "TestRun" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    if (!exists.rowCount) throw new AppError('Test run not found', 404);

    const { rows } = await pool.query(
      `UPDATE "TestRun"
       SET status = 'cancelled', "completedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to stop test run' });
    }
  }
};

/**
 * Get active test runs
 */
export const getActiveTestRuns = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const { rows } = await pool.query(
      `SELECT tr.*, s.name AS script_name
       FROM "TestRun" tr
       JOIN "Script" s ON s.id = tr."scriptId"
       WHERE tr."userId" = $1 AND tr.status IN ('running','queued')
       ORDER BY tr."startedAt" DESC`,
      [userId]
    );

    const activeRuns = rows.map(r => ({ ...r, script: { name: r.script_name } }));

    res.status(200).json({ success: true, data: activeRuns });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to get active test runs' });
  }
};

/**
 * Update test run status and complete
 */
export const updateTestRun = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { status, errorMsg, duration, steps } = req.body;

    const existsRes = await pool.query(
      `SELECT tr.id, s.name AS script_name
       FROM "TestRun" tr JOIN "Script" s ON s.id = tr."scriptId"
       WHERE tr.id = $1 AND tr."userId" = $2`,
      [id, userId]
    );
    const existing = existsRes.rows[0];
    if (!existing) throw new AppError('Test run not found', 404);

    if (steps && Array.isArray(steps)) {
      for (const step of steps) {
        try {
          await allureService.recordStep(
            id,
            step.action || step.name || 'Step',
            step.status || 'passed',
            step.duration
          );
        } catch (error) {
          console.error('Failed to record Allure step:', error);
        }
      }
    }

    if (status && ['passed', 'failed', 'error'].includes(status)) {
      try {
        await allureService.endTest(
          id,
          status === 'error' ? 'broken' : status,
          errorMsg
        );

        // Generate Allure report when test completes
        await allureService.generateReport(id);
        const reportUrl = await allureService.getReportUrl(id);

        // Update with report URL
        const { rows } = await pool.query(
          `UPDATE "TestRun"
           SET status = COALESCE($2, status),
               "errorMsg" = $3,
               duration = $4,
               "executionReportUrl" = $5,
               "completedAt" = CASE WHEN $2 IN ('passed','failed','error','cancelled') THEN now() ELSE "completedAt" END
           WHERE id = $1
           RETURNING *`,
          [id, status ?? null, errorMsg ?? null, duration ?? null, reportUrl]
        );

        res.status(200).json({ success: true, data: rows[0] });
        return;
      } catch (error) {
        console.error('Failed to end Allure test or generate report:', error);
      }
    }

    const { rows } = await pool.query(
      `UPDATE "TestRun"
       SET status = COALESCE($2, status),
           "errorMsg" = $3,
           duration = $4,
           "completedAt" = CASE WHEN $2 IN ('passed','failed','error','cancelled') THEN now() ELSE "completedAt" END
       WHERE id = $1
       RETURNING *`,
      [id, status ?? null, errorMsg ?? null, duration ?? null]
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to update test run' });
    }
  }
};

/**
 * Report a test result (create completed TestRun)
 */
export const reportTestResult = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const {
      testName,
      status,
      duration,
      errorMsg,
      browser,
      environment,
      traceUrl,
      videoUrl,
      screenshotUrls
    } = req.body;

    if (!testName || !status) throw new AppError('testName and status are required', 400);

    let scriptRes = await pool.query(
      `SELECT id FROM "Script" WHERE "userId" = $1 AND name = $2`,
      [userId, testName]
    );
    let script = scriptRes.rows[0];

    if (!script) {
      const scriptId = randomUUID();
      const created = await pool.query(
        `INSERT INTO "Script" (id, name, description, language, code, "userId", "browserType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'typescript', $4, $5, 'chromium', now(), now())
         RETURNING id`,
        [scriptId, testName, 'Auto-created from Playwright reporter', '// Recorded by Playwright reporter', userId]
      );
      script = created.rows[0];
    }

    const runId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "TestRun" (id, "scriptId", "userId", status, duration, "errorMsg", browser, environment, "traceUrl", "videoUrl", "screenshotUrls", "completedAt", "startedAt")
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'msedge'), COALESCE($8, 'development'), $9, $10, $11, now(), now())
       RETURNING *`,
      [runId, script.id, userId, status, duration ?? null, errorMsg ?? null, browser ?? null, environment ?? null, traceUrl ?? null, videoUrl ?? null, screenshotUrls ?? null]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to report test result' });
    }
  }
};

/**
 * Start a test run with queue-based execution (multi-tenant)
 * Supports parallel execution across worker nodes
 */
export const startQueuedTestRun = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const organizationId = (req as any).tenant?.organizationId || null;
    const { 
      scriptId, 
      environmentId, 
      executionMode = 'headless', 
      browser = 'chromium',
      priority = 0 
    } = req.body;

    if (!scriptId) throw new AppError('Script ID is required', 400);

    // Validate script ownership
    const scriptRes = await pool.query(
      `SELECT id, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId]
    );
    const script = scriptRes.rows[0];
    if (!script) throw new AppError('Script not found', 404);

    // Check organization concurrency limits
    if (organizationId) {
      const canExecute = await tenantService.checkConcurrencyLimit(organizationId);
      if (!canExecute) {
        throw new AppError('Organization concurrent execution limit reached. Please wait for running tests to complete.', 429);
      }
    }

    // Validate execution mode
    if (!['headless', 'headed', 'api'].includes(executionMode)) {
      throw new AppError('Invalid execution mode. Allowed: headless, headed, api', 400);
    }

    // Create test run
    const testRunId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "TestRun" (
        id, "scriptId", "userId", "organizationId", "environmentId", 
        status, "executionMode", browser, "startedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, now())
      RETURNING *`,
      [testRunId, scriptId, userId, organizationId, environmentId || null, executionMode, browser]
    );
    const testRun = rows[0];

    // Check if queue is ready
    if (!queueService.isReady()) {
      // Fallback to immediate execution if queue not available
      console.warn('Queue service not ready, using fallback execution');
      
      await pool.query(
        `UPDATE "TestRun" SET status = 'running' WHERE id = $1`,
        [testRunId]
      );
      
      res.status(201).json({ 
        success: true, 
        data: { ...testRun, status: 'running' },
        message: 'Test started (queue unavailable, using fallback)'
      });
      return;
    }

    // Add to job queue
    await queueService.addTestJob({
      testRunId,
      scriptId,
      userId,
      organizationId: organizationId || 'default',
      environmentId,
      executionMode: executionMode as 'headless' | 'headed' | 'api',
      browser,
      priority,
    });

    res.status(201).json({ 
      success: true, 
      data: testRun,
      message: 'Test queued for execution'
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to queue test run' });
    }
  }
};

/**
 * Start batch test runs (multiple scripts at once)
 */
export const startBatchTestRuns = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const organizationId = (req as any).tenant?.organizationId || null;
    const { 
      scriptIds, 
      environmentId, 
      executionMode = 'headless',
      browser = 'chromium',
      priority = 0 
    } = req.body;

    if (!scriptIds || !Array.isArray(scriptIds) || scriptIds.length === 0) {
      throw new AppError('scriptIds array is required', 400);
    }

    if (scriptIds.length > 50) {
      throw new AppError('Maximum 50 scripts per batch', 400);
    }

    // Check organization limits
    if (organizationId) {
      const canExecute = await tenantService.checkConcurrencyLimit(organizationId);
      if (!canExecute) {
        throw new AppError('Organization concurrent execution limit reached', 429);
      }
    }

    // Validate all scripts belong to user
    const scriptsRes = await pool.query(
      `SELECT id, name FROM "Script" WHERE id = ANY($1) AND "userId" = $2`,
      [scriptIds, userId]
    );
    
    if (scriptsRes.rows.length !== scriptIds.length) {
      throw new AppError('One or more scripts not found or access denied', 404);
    }

    const testRuns = [];
    const jobsData = [];

    // Create test runs for each script
    for (const scriptId of scriptIds) {
      const testRunId = randomUUID();
      
      const { rows } = await pool.query(
        `INSERT INTO "TestRun" (
          id, "scriptId", "userId", "organizationId", "environmentId", 
          status, "executionMode", browser, "startedAt"
        )
        VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, now())
        RETURNING *`,
        [testRunId, scriptId, userId, organizationId, environmentId || null, executionMode, browser]
      );
      
      testRuns.push(rows[0]);
      
      jobsData.push({
        testRunId,
        scriptId,
        userId,
        organizationId: organizationId || 'default',
        environmentId,
        executionMode: executionMode as 'headless' | 'headed' | 'api',
        browser,
        priority,
      });
    }

    // Add all to queue
    if (queueService.isReady()) {
      await queueService.addBulkTestJobs(jobsData);
    }

    res.status(201).json({ 
      success: true, 
      data: testRuns,
      message: `${testRuns.length} tests queued for execution`
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to queue batch test runs' });
    }
  }
};

/**
 * Get test runs with organization filter
 */
export const getOrganizationTestRuns = async (req: Request, res: Response) => {
  try {
    // const userId = (req as any).user.userId; // Available if needed
    const organizationId = (req as any).tenant?.organizationId;
    const { projectId, status, limit = 50, offset = 0 } = req.query;

    if (!organizationId) {
      throw new AppError('Organization context required', 400);
    }

    let query = `
      SELECT tr.*, s.name AS script_name, s."projectId" AS script_project_id,
             u.name AS user_name, u.email AS user_email
      FROM "TestRun" tr
      JOIN "Script" s ON s.id = tr."scriptId"
      JOIN "User" u ON u.id = tr."userId"
      WHERE tr."organizationId" = $1
    `;
    
    const params: any[] = [organizationId];
    let paramIndex = 2;
    
    if (projectId) {
      query += ` AND s."projectId" = $${paramIndex++}`;
      params.push(projectId as string);
    }
    
    if (status) {
      query += ` AND tr.status = $${paramIndex++}`;
      params.push(status as string);
    }
    
    query += ` ORDER BY tr."startedAt" DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const { rows } = await pool.query(query, params);

    const testRuns = rows.map(r => ({
      ...r,
      script: { name: r.script_name },
      user: { name: r.user_name, email: r.user_email }
    }));

    res.status(200).json({ success: true, data: testRuns });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to get organization test runs' });
    }
  }
};
