import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import pool from '../db';
import { dataDrivenRunnerService } from '../services/testRuns/dataDrivenRunner.service';

/**
 * Create a new data-driven run configuration
 * POST /api/data-driven-runs
 */
export const createDataDrivenRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const {
    scriptId,
    testSuiteId,
    testDataIds,
    dataRows: inlineDataRows,
    fieldBindings,
    name,
    browser = 'chromium',
    executionMode = 'sequential',
    executionConfig = {}
  } = req.body;

  if (!scriptId) {
    return res.status(400).json({ error: 'scriptId is required' });
  }
  if (!fieldBindings || Object.keys(fieldBindings).length === 0) {
    return res.status(400).json({ error: 'fieldBindings is required and must not be empty' });
  }

  // Verify script belongs to user
  const { rows: scriptRows } = await pool.query(
    `SELECT id, code, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
    [scriptId, userId]
  );
  if (scriptRows.length === 0) {
    return res.status(404).json({ error: 'Script not found' });
  }

  // Resolve data rows
  let dataRows: Record<string, any>[] = [];

  if (testDataIds && testDataIds.length > 0) {
    // Load data from TestData records
    const placeholders = testDataIds.map((_: string, i: number) => `$${i + 1}`).join(',');
    const { rows: testDataRows } = await pool.query(
      `SELECT data FROM "TestData" WHERE id IN (${placeholders})`,
      testDataIds
    );
    dataRows = testDataRows.map((r: any) => {
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      return data;
    });
  } else if (inlineDataRows && Array.isArray(inlineDataRows) && inlineDataRows.length > 0) {
    dataRows = inlineDataRows;
  } else {
    return res.status(400).json({ error: 'Either testDataIds or dataRows must be provided' });
  }

  if (dataRows.length === 0) {
    return res.status(400).json({ error: 'At least one data row is required' });
  }

  if (dataRows.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 data rows allowed per run' });
  }

  // Validate that placeholders exist in script code
  const scriptCode = scriptRows[0].code;
  const missingPlaceholders: string[] = [];
  for (const placeholder of Object.keys(fieldBindings)) {
    const pattern = new RegExp(`\\{\\{${placeholder}\\}\\}`);
    if (!pattern.test(scriptCode)) {
      missingPlaceholders.push(placeholder);
    }
  }
  if (missingPlaceholders.length > 0) {
    return res.status(400).json({
      error: `Placeholders not found in script: ${missingPlaceholders.join(', ')}`,
      missingPlaceholders
    });
  }

  // Insert DataDrivenRun record
  const { rows: inserted } = await pool.query(
    `INSERT INTO "DataDrivenRun" (
       id, "scriptId", "testSuiteId", "userId", "organizationId", name, status,
       "totalRows", "fieldBindings", "dataRows", "executionConfig", browser, "executionMode",
       "createdAt", "updatedAt"
     ) VALUES (
       gen_random_uuid()::text, $1, $2, $3, $4, $5, 'pending',
       $6, $7, $8, $9, $10, $11,
       now(), now()
     ) RETURNING *`,
    [
      scriptId,
      testSuiteId || null,
      userId,
      organizationId,
      name || `Data-Driven: ${scriptRows[0].name}`,
      dataRows.length,
      JSON.stringify(fieldBindings),
      JSON.stringify(dataRows),
      JSON.stringify(executionConfig),
      browser,
      executionMode
    ]
  );

  logger.info(`DataDrivenRun created: ${inserted[0].id} with ${dataRows.length} rows`);

  return res.status(201).json({
    success: true,
    data: inserted[0]
  });
});

/**
 * List all data-driven runs for the current user
 * GET /api/data-driven-runs
 */
export const getDataDrivenRuns = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { scriptId, status } = req.query;

  let query = `
    SELECT ddr.*, s.name as "scriptName", s.language as "scriptLanguage"
    FROM "DataDrivenRun" ddr
    JOIN "Script" s ON s.id = ddr."scriptId"
    WHERE ddr."userId" = $1
  `;
  const params: any[] = [userId];
  let paramIdx = 2;

  if (scriptId) {
    query += ` AND ddr."scriptId" = $${paramIdx}`;
    params.push(scriptId);
    paramIdx++;
  }

  if (status) {
    query += ` AND ddr.status = $${paramIdx}`;
    params.push(status);
    paramIdx++;
  }

  query += ' ORDER BY ddr."createdAt" DESC';

  const { rows } = await pool.query(query, params);

  return res.json({
    success: true,
    data: rows
  });
});

/**
 * Get a single data-driven run by ID
 * GET /api/data-driven-runs/:id
 */
export const getDataDrivenRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT ddr.*, s.name as "scriptName", s.code as "scriptCode", s.language as "scriptLanguage"
     FROM "DataDrivenRun" ddr
     JOIN "Script" s ON s.id = ddr."scriptId"
     WHERE ddr.id = $1 AND ddr."userId" = $2`,
    [id, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'DataDrivenRun not found' });
  }

  return res.json({
    success: true,
    data: rows[0]
  });
});

/**
 * Start executing a data-driven run
 * POST /api/data-driven-runs/:id/start
 */
export const startDataDrivenRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  // Load and validate
  const { rows } = await pool.query(
    `SELECT * FROM "DataDrivenRun" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'DataDrivenRun not found' });
  }

  const run = rows[0];

  if (!['pending', 'failed', 'partial', 'cancelled'].includes(run.status)) {
    return res.status(400).json({ error: `Cannot start run with status: ${run.status}` });
  }

  // Check concurrent limit (max 3 active DDRs per user)
  const { rows: activeRuns } = await pool.query(
    `SELECT COUNT(*) as count FROM "DataDrivenRun" WHERE "userId" = $1 AND status = 'running'`,
    [userId]
  );
  if (parseInt(activeRuns[0].count) >= 3) {
    return res.status(429).json({ error: 'Maximum 3 concurrent data-driven runs allowed' });
  }

  // Reset counters if retrying
  await pool.query(
    `UPDATE "DataDrivenRun" SET "completedRows" = 0, "passedRows" = 0, "failedRows" = 0, "updatedAt" = now() WHERE id = $1`,
    [id]
  );

  // Start execution asynchronously
  setImmediate(() => {
    dataDrivenRunnerService.executeRun(id).catch((err: any) => {
      logger.error(`DDR ${id}: Unhandled execution error:`, err.message);
    });
  });

  return res.json({
    success: true,
    message: 'Data-driven run started',
    data: { id, status: 'running' }
  });
});

/**
 * Stop a running data-driven run
 * POST /api/data-driven-runs/:id/stop
 */
export const stopDataDrivenRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT * FROM "DataDrivenRun" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'DataDrivenRun not found' });
  }

  if (rows[0].status !== 'running') {
    return res.status(400).json({ error: 'Run is not currently running' });
  }

  await dataDrivenRunnerService.stopRun(id);

  return res.json({
    success: true,
    message: 'Data-driven run stopped'
  });
});

/**
 * Get detailed results for a data-driven run
 * GET /api/data-driven-runs/:id/results
 */
export const getDataDrivenRunResults = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  // Load DDR
  const { rows: ddrRows } = await pool.query(
    `SELECT ddr.*, s.name as "scriptName"
     FROM "DataDrivenRun" ddr
     JOIN "Script" s ON s.id = ddr."scriptId"
     WHERE ddr.id = $1 AND ddr."userId" = $2`,
    [id, userId]
  );

  if (ddrRows.length === 0) {
    return res.status(404).json({ error: 'DataDrivenRun not found' });
  }

  const ddr = ddrRows[0];

  // Load child test runs with steps
  const { rows: childRuns } = await pool.query(
    `SELECT tr.id, tr.status, tr.duration, tr."errorMsg", tr."dataRowIndex", tr."dataRowValues",
            tr."executionReportUrl", tr."startedAt", tr."completedAt"
     FROM "TestRun" tr
     WHERE tr."dataDrivenRunId" = $1
     ORDER BY tr."dataRowIndex"`,
    [id]
  );

  // Load steps for each child run
  const rowResults = await Promise.all(
    childRuns.map(async (childRun: any) => {
      const { rows: steps } = await pool.query(
        `SELECT "stepNumber", action, selector, value, status, duration, "errorMsg"
         FROM "TestStep" WHERE "testRunId" = $1 ORDER BY "stepNumber"`,
        [childRun.id]
      );

      return {
        rowIndex: childRun.dataRowIndex,
        dataValues: childRun.dataRowValues,
        testRunId: childRun.id,
        status: childRun.status,
        duration: childRun.duration,
        errorMsg: childRun.errorMsg,
        reportUrl: childRun.executionReportUrl,
        startedAt: childRun.startedAt,
        completedAt: childRun.completedAt,
        steps
      };
    })
  );

  const totalDuration = childRuns.reduce((sum: number, r: any) => sum + (r.duration || 0), 0);

  return res.json({
    success: true,
    dataDrivenRun: ddr,
    summary: {
      total: ddr.totalRows,
      completed: ddr.completedRows,
      passed: ddr.passedRows,
      failed: ddr.failedRows,
      passRate: ddr.totalRows > 0 ? Math.round((ddr.passedRows / ddr.totalRows) * 100 * 10) / 10 : 0,
      totalDuration
    },
    rowResults
  });
});

/**
 * Delete a data-driven run
 * DELETE /api/data-driven-runs/:id
 */
export const deleteDataDrivenRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT status FROM "DataDrivenRun" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'DataDrivenRun not found' });
  }

  if (rows[0].status === 'running') {
    return res.status(400).json({ error: 'Cannot delete a running data-driven run. Stop it first.' });
  }

  // Delete child test runs first (cascade should handle, but explicit is safer)
  await pool.query(
    `DELETE FROM "TestRun" WHERE "dataDrivenRunId" = $1`,
    [id]
  );

  await pool.query(
    `DELETE FROM "DataDrivenRun" WHERE id = $1`,
    [id]
  );

  return res.json({
    success: true,
    message: 'Data-driven run deleted'
  });
});

/**
 * Extract placeholders from a script
 * POST /api/data-driven-runs/extract-placeholders
 */
export const extractPlaceholders = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { scriptId, scriptCode } = req.body;

  let code: string;

  if (scriptId) {
    const { rows } = await pool.query(
      `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Script not found' });
    }
    code = rows[0].code;
  } else if (scriptCode) {
    code = scriptCode;
  } else {
    return res.status(400).json({ error: 'Either scriptId or scriptCode is required' });
  }

  const placeholders = dataDrivenRunnerService.extractPlaceholders(code);

  return res.json({
    success: true,
    placeholders
  });
});
