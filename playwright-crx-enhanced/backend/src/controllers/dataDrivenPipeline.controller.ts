/**
 * Data-Driven Pipeline Controller
 *
 * Exposes the unified 5-step data-driven testing pipeline as REST endpoints.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import pool from '../db';
import {
  dataDrivenPipelineService,
  type DataStrategy,
  type PipelineRequest,
} from '../services/testRuns/dataDrivenPipeline.service';

const VALID_STRATEGIES: DataStrategy[] = ['positive', 'negative', 'boundary', 'equivalence', 'security'];

// ---------------------------------------------------------------------------
// POST /api/data-driven-pipeline/run
// Start a full pipeline: analyze → generate → parameterize → execute → report
// ---------------------------------------------------------------------------
export const runPipeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;

  const {
    scriptId,
    strategies = ['positive', 'negative', 'boundary', 'equivalence', 'security'],
    countPerStrategy = 5,
    executionMode = 'sequential',
    maxParallel = 3,
    autoParameterize = true,
    stopOnFirstFailure = false,
    fieldHints,
    browser = 'chromium',
  } = req.body;

  // ── Validation ────────────────────────────────────────────────────────
  if (!scriptId) {
    return res.status(400).json({ success: false, error: 'scriptId is required' });
  }

  const invalidStrategies = strategies.filter((s: string) => !VALID_STRATEGIES.includes(s as DataStrategy));
  if (invalidStrategies.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Invalid strategies: ${invalidStrategies.join(', ')}. Valid: ${VALID_STRATEGIES.join(', ')}`,
    });
  }

  if (countPerStrategy < 1 || countPerStrategy > 50) {
    return res.status(400).json({ success: false, error: 'countPerStrategy must be 1–50' });
  }

  // Verify script belongs to user
  const { rows: scriptRows } = await pool.query(
    `SELECT id, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
    [scriptId, userId],
  );
  if (scriptRows.length === 0) {
    return res.status(404).json({ success: false, error: 'Script not found' });
  }

  // Check concurrent limit (max 3 active pipelines per user)
  const { rows: activeRuns } = await pool.query(
    `SELECT COUNT(*) as count FROM "DataDrivenRun" WHERE "userId" = $1 AND status = 'running'`,
    [userId],
  );
  if (parseInt(activeRuns[0].count) >= 3) {
    return res.status(429).json({ success: false, error: 'Maximum 3 concurrent data-driven runs allowed. Wait for one to finish.' });
  }

  const request: PipelineRequest = {
    scriptId,
    userId,
    organizationId: organizationId || undefined,
    strategies,
    countPerStrategy,
    executionMode,
    maxParallel,
    autoParameterize,
    stopOnFirstFailure,
    fieldHints,
    browser,
  };

  // Fire and forget — return immediately with the pipeline ID
  // Pipeline runs asynchronously; client polls /status/:id
  logger.info(`Pipeline requested for script "${scriptRows[0].name}" by user ${userId}`);

  // We start the pipeline async and return the ID immediately
  const pipelineRunId = require('crypto').randomUUID();

  // Create a placeholder record so the client can poll status
  await pool.query(
    `INSERT INTO "DataDrivenRun" (
        id, "scriptId", "userId", "organizationId", name, status,
        "totalRows", "fieldBindings", "dataRows", "executionConfig",
        browser, "executionMode", "createdAt", "updatedAt"
     ) VALUES (
        $1, $2, $3, $4, $5, 'initializing',
        0, '{}', '[]', $6,
        $7, $8, now(), now()
     )`,
    [
      pipelineRunId,
      scriptId,
      userId,
      organizationId,
      `Pipeline: ${scriptRows[0].name}`,
      JSON.stringify({ stopOnFirstFailure, maxParallel }),
      browser,
      executionMode,
    ],
  );

  // Launch pipeline asynchronously
  setImmediate(async () => {
    try {
      // Delete the placeholder — the pipeline service will create its own record with the same ID
      await pool.query(`DELETE FROM "DataDrivenRun" WHERE id = $1`, [pipelineRunId]);
      await dataDrivenPipelineService.runPipeline(request);
    } catch (err: any) {
      logger.error(`Pipeline async launch failed: ${err.message}`);
    }
  });

  return res.status(202).json({
    success: true,
    message: 'Data-driven pipeline started',
    data: {
      scriptId,
      scriptName: scriptRows[0].name,
      strategies,
      countPerStrategy,
      executionMode,
      browser,
      autoParameterize,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/data-driven-pipeline/analyze
// Step 1 only — analyze a script to preview detected fields
// ---------------------------------------------------------------------------
export const analyzeScript = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { scriptId, scriptCode } = req.body;

  let code: string;

  if (scriptId) {
    const { rows } = await pool.query(
      `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Script not found' });
    }
    code = rows[0].code;
  } else if (scriptCode) {
    code = scriptCode;
  } else {
    return res.status(400).json({ success: false, error: 'Either scriptId or scriptCode is required' });
  }

  const fields = dataDrivenPipelineService.analyzeScript(code, req.body.fieldHints);

  return res.json({
    success: true,
    fields,
    fieldCount: fields.length,
    suggestedPlaceholders: fields.map(f => ({
      name: f.fieldName || f.selector,
      type: f.fieldType,
      hardcodedValue: f.hardcodedValue,
      line: f.line,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/data-driven-pipeline/preview
// Steps 1–3 — analyze, generate, and parameterize (dry-run, no execution)
// ---------------------------------------------------------------------------
export const previewPipeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    scriptId,
    strategies = ['positive', 'negative', 'boundary', 'equivalence', 'security'],
    countPerStrategy = 3,
    autoParameterize = true,
    fieldHints,
  } = req.body;

  if (!scriptId) {
    return res.status(400).json({ success: false, error: 'scriptId is required' });
  }

  const { rows: scriptRows } = await pool.query(
    `SELECT code, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
    [scriptId, userId],
  );
  if (scriptRows.length === 0) {
    return res.status(404).json({ success: false, error: 'Script not found' });
  }

  const scriptCode = scriptRows[0].code;

  // Step 1 – Analyze
  const fields = dataDrivenPipelineService.analyzeScript(scriptCode, fieldHints);

  // Step 2 – Generate
  const validStrategies = strategies.filter((s: string) => VALID_STRATEGIES.includes(s as DataStrategy)) as DataStrategy[];
  const datasets = dataDrivenPipelineService.generateDatasets(fields, validStrategies, countPerStrategy);

  // Step 3 – Parameterize
  let parameterizedCode: string;
  let fieldBindings: Record<string, string>;

  if (autoParameterize) {
    const result = dataDrivenPipelineService['autoParameterize'](scriptCode, fields);
    parameterizedCode = result.parameterizedCode;
    fieldBindings = result.fieldBindings;
  } else {
    parameterizedCode = scriptCode;
    fieldBindings = {};
    for (const f of fields) {
      const key = (f.fieldName || f.selector || `field_${f.line}`).toLowerCase().replace(/[^a-z0-9]+/g, '_');
      fieldBindings[key] = key;
    }
  }

  const totalRows = Object.values(datasets).reduce((sum, rows) => sum + rows.length, 0);

  return res.json({
    success: true,
    scriptName: scriptRows[0].name,
    fields,
    parameterizedCode,
    fieldBindings,
    datasets,
    summary: {
      fieldCount: fields.length,
      strategies: validStrategies,
      rowsPerStrategy: countPerStrategy,
      totalRows,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/data-driven-pipeline/status/:id
// Poll pipeline execution status
// ---------------------------------------------------------------------------
export const getPipelineStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT ddr.*, s.name as "scriptName"
     FROM "DataDrivenRun" ddr
     JOIN "Script" s ON s.id = ddr."scriptId"
     WHERE ddr.id = $1 AND ddr."userId" = $2`,
    [id, userId],
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Pipeline run not found' });
  }

  const run = rows[0];

  // Load child test runs for per-strategy breakdown
  const { rows: childRuns } = await pool.query(
    `SELECT id, status, duration, "dataRowIndex", "dataRowValues" FROM "TestRun"
     WHERE "dataDrivenRunId" = $1 ORDER BY "dataRowIndex"`,
    [id],
  );

  // Group by strategy
  const strategySummary: Record<string, { total: number; passed: number; failed: number }> = {};
  for (const child of childRuns) {
    const vals = typeof child.dataRowValues === 'string' ? JSON.parse(child.dataRowValues) : child.dataRowValues;
    const strategy = vals?._strategy || 'unknown';
    if (!strategySummary[strategy]) strategySummary[strategy] = { total: 0, passed: 0, failed: 0 };
    strategySummary[strategy].total++;
    if (child.status === 'passed') strategySummary[strategy].passed++;
    else strategySummary[strategy].failed++;
  }

  return res.json({
    success: true,
    data: {
      id: run.id,
      scriptId: run.scriptId,
      scriptName: run.scriptName,
      status: run.status,
      totalRows: run.totalRows,
      completedRows: run.completedRows,
      passedRows: run.passedRows,
      failedRows: run.failedRows,
      duration: run.duration,
      aggregateReportUrl: run.aggregateReportUrl,
      executionMode: run.executionMode,
      browser: run.browser,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      strategySummary,
      progress: run.totalRows > 0
        ? Math.round(((run.completedRows || 0) / run.totalRows) * 100)
        : 0,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/data-driven-pipeline/cancel/:id
// Cancel a running pipeline
// ---------------------------------------------------------------------------
export const cancelPipeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT id, status FROM "DataDrivenRun" WHERE id = $1 AND "userId" = $2`,
    [id, userId],
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Pipeline run not found' });
  }

  if (rows[0].status !== 'running' && rows[0].status !== 'initializing') {
    return res.status(400).json({ success: false, error: `Cannot cancel run with status: ${rows[0].status}` });
  }

  dataDrivenPipelineService.cancelPipeline(id);

  await pool.query(
    `UPDATE "DataDrivenRun" SET status = 'cancelled', "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
    [id],
  );

  return res.json({ success: true, message: 'Pipeline cancelled' });
});

// ---------------------------------------------------------------------------
// GET /api/data-driven-pipeline/results/:id
// Full results with per-strategy per-row breakdown
// ---------------------------------------------------------------------------
export const getPipelineResults = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows: ddrRows } = await pool.query(
    `SELECT ddr.*, s.name as "scriptName", s.code as "scriptCode"
     FROM "DataDrivenRun" ddr
     JOIN "Script" s ON s.id = ddr."scriptId"
     WHERE ddr.id = $1 AND ddr."userId" = $2`,
    [id, userId],
  );

  if (ddrRows.length === 0) {
    return res.status(404).json({ success: false, error: 'Pipeline run not found' });
  }

  const ddr = ddrRows[0];

  // Load child runs + steps
  const { rows: childRuns } = await pool.query(
    `SELECT tr.id, tr.status, tr.duration, tr."errorMsg", tr."dataRowIndex",
            tr."dataRowValues", tr."executionReportUrl", tr."startedAt", tr."completedAt"
     FROM "TestRun" tr
     WHERE tr."dataDrivenRunId" = $1
     ORDER BY tr."dataRowIndex"`,
    [id],
  );

  // Group by strategy
  const byStrategy: Record<string, any[]> = {};
  for (const child of childRuns) {
    const vals = typeof child.dataRowValues === 'string' ? JSON.parse(child.dataRowValues) : child.dataRowValues;
    const strategy = vals?._strategy || 'unknown';
    if (!byStrategy[strategy]) byStrategy[strategy] = [];

    // Load steps for this run
    const { rows: steps } = await pool.query(
      `SELECT "stepNumber", action, selector, value, status, duration, "errorMsg"
       FROM "TestStep" WHERE "testRunId" = $1 ORDER BY "stepNumber"`,
      [child.id],
    );

    byStrategy[strategy].push({
      rowIndex: child.dataRowIndex,
      dataValues: vals,
      testRunId: child.id,
      status: child.status,
      duration: child.duration,
      errorMsg: child.errorMsg,
      reportUrl: child.executionReportUrl,
      steps,
    });
  }

  const strategySummary: Record<string, { total: number; passed: number; failed: number; passRate: number }> = {};
  for (const [strategy, rows] of Object.entries(byStrategy)) {
    const passed = rows.filter((r: any) => r.status === 'passed').length;
    const failed = rows.length - passed;
    strategySummary[strategy] = {
      total: rows.length,
      passed,
      failed,
      passRate: rows.length > 0 ? Math.round((passed / rows.length) * 100 * 10) / 10 : 0,
    };
  }

  return res.json({
    success: true,
    pipeline: {
      id: ddr.id,
      scriptId: ddr.scriptId,
      scriptName: ddr.scriptName,
      status: ddr.status,
      totalRows: ddr.totalRows,
      passedRows: ddr.passedRows,
      failedRows: ddr.failedRows,
      duration: ddr.duration,
      aggregateReportUrl: ddr.aggregateReportUrl,
    },
    strategySummary,
    resultsByStrategy: byStrategy,
  });
});
