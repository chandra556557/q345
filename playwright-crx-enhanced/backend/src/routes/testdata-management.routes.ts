import { Router } from 'express';
import multer from 'multer';
import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';
import pool from '../db';
import { TestDataService } from '../services/testdata.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import {
  getTestSuites,
  createTestSuite,
  updateTestSuite,
  deleteTestSuite,
  getTestData,
  createTestData,
  updateTestData,
  deleteTestData,
  generateSecurityTestData,
  generateBoundaryTestData,
  generateEquivalenceTestData,
  generatePositiveTestData,
  generateNegativeTestData,
  generateFromScriptTestData,
  extractPlaceholders,
  analyzeFieldBindings,
  previewFieldBindingSubstitution,
  generateWithFieldBindings
} from '../controllers/testData.controller';
import {
  uploadCsvAndBind,
  parseCsvInline,
  previewCsvBinding,
  exportSuiteAsCsv
} from '../controllers/csvTestData.controller';
import { analyzeXPath } from '../controllers/ai-analysis.controller';

const router = Router();

// Configure multer for CSV uploads
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5_000_000 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// Skip authentication for external API forwarding endpoints (only generation endpoints)
router.use((req, res, next) => {
  // Skip auth for external API generation endpoints (NO AUTH REQUIRED)
  if (req.path.startsWith('/generate/')) {
    return next();
  }
  // Apply auth middleware for ALL other routes (including field-bindings and csv)
  return authMiddleware(req, res, next);
});

// Test Suite routes
router.get('/suites', getTestSuites);
router.post('/suites', createTestSuite);
router.put('/suites/:id', updateTestSuite);
router.delete('/suites/:id', deleteTestSuite);

// Test Data routes
router.get('/data', getTestData);
router.post('/data', createTestData);
router.put('/data/:id', updateTestData);
router.delete('/data/:id', deleteTestData);

// Get test data by scriptId (for validation modal)
router.get('/', async (req, res) => {
  try {
    const { scriptId } = req.query;
    const userId = (req as any).user?.userId;

    if (!scriptId) {
      return res.status(400).json({
        success: false,
        error: 'scriptId query parameter is required'
      });
    }

    // Find test data associated with this script
    // Look for test suite matching the script name or ID
    const { rows: scriptRows } = await pool.query(
      `SELECT name FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [scriptId, userId]
    );

    if (scriptRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Script not found'
      });
    }

    const scriptName = scriptRows[0].name;

    // Find test suites related to this script
    const { rows: suiteRows } = await pool.query(
      `SELECT id FROM "TestSuite" WHERE "userId" = $1 AND (name LIKE $2 OR name LIKE $3)`,
      [userId, `%${scriptName}%`, `%${scriptId}%`]
    );

    if (suiteRows.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No test data found for this script'
      });
    }

    // Get all test data from these suites
    const suiteIds = suiteRows.map(s => s.id);
    const { rows: testDataRows } = await pool.query(
      `SELECT td.*, ts.name as "suiteName" 
       FROM "TestData" td 
       INNER JOIN "TestSuite" ts ON td."suiteId" = ts.id
       WHERE td."suiteId" = ANY($1)
       ORDER BY td."createdAt" DESC`,
      [suiteIds]
    );

    // Parse and format test data
    const testData = testDataRows.map((row: any) => ({
      id: row.id,
      suiteId: row.suiteId,
      suiteName: row.suiteName,
      name: row.name,
      environment: row.environment,
      type: row.type,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      _testDataType: row.type, // For frontend grouping
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));

    return res.json({
      success: true,
      data: testData,
      count: testData.length
    });
  } catch (error: any) {
    logger.error('Error fetching test data by scriptId:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch test data'
    });
  }
});

// Generate test data via external Python API
router.post('/generate', async (req, res) => {
  const traceId = Math.random().toString(36).slice(2);
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Invalid request', message: 'Body is required', traceId });
    }
    const apiUrl = process.env.PYTHON_API_URL || 'http://34.46.36.105:3000/genieapi';
    const timeout = parseInt(process.env.PYTHON_API_TIMEOUT || '30000');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PYTHON_API_TOKEN) {
      const t = process.env.PYTHON_API_TOKEN;
      headers['Authorization'] = t.startsWith('Bearer') ? t : `Bearer ${t}`;
    }
    const client = axios.create({ timeout, headers });
    const fullUrl = apiUrl.includes('/assistant/generate-test-data')
      ? apiUrl
      : apiUrl.replace(/\/+$/, '') + '/assistant/generate-test-data';
    logger.info('Forwarding test data generation request to Python API', { traceId });
    const response = await client.post(fullUrl, req.body);
    const list = (response.data?.data || response.data?.records || response.data?.users || response.data?.result || []) as any[];
    if (Array.isArray(list) && list.length > 0) {
      return res.status(response.status || 200).json({ traceId, data: list, success: true });
    }
    const { dataType = 'user', count = 10, sample_data } = req.body || {};
    const svc = new TestDataService();
    const gen = await svc.generateTestData({ dataType, count });
    const records = (gen.data || []).map((rec) => ({
      ...(typeof rec === 'object' ? rec : {}),
      ...(sample_data && typeof sample_data === 'object' ? sample_data : {}),
    }));
    return res.status(200).json({ traceId, success: true, source: 'local_fallback_no_data', data: records });
  } catch (error) {
    const err = error as AxiosError;
    const status = err.response?.status ?? 502;
    const data = err.response?.data ?? { message: err.message || 'Upstream error' };
    logger.warn('Python API error while generating test data, using local fallback', { traceId, status, data });

    try {
      const { dataType = 'user', count = 10, sample_data } = req.body || {};
      const svc = new TestDataService();
      const gen = await svc.generateTestData({ dataType, count });
      const records = (gen.data || []).map((rec) => ({
        ...(typeof rec === 'object' ? rec : {}),
        ...(sample_data && typeof sample_data === 'object' ? sample_data : {}),
      }));
      return res.status(200).json({ traceId, success: true, source: 'local_fallback', data: records });
    } catch (localErr: any) {
      return res.status(status).json({ error: 'UpstreamError', traceId, ...(typeof data === 'object' ? data : { message: String(data) }) });
    }
  }
});

// Generate test data from a Playwright script (Python first, Node fallback)
router.post('/generate/from-script', generateFromScriptTestData);

router.post('/generate-save', async (req, res) => {
  const traceId = Math.random().toString(36).slice(2);
  try {
    const userId = (req as any).user?.userId;
    const {
      suiteId: inputSuiteId,
      suiteName,
      suiteDescription,
      dataType = 'user',
      count = 2,
      environment = 'dev',
      type,
      schema,
      options,
      seed,
      sample_data,
    } = req.body || {};

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', traceId });
    }

    const apiUrl = process.env.PYTHON_API_URL || 'http://34.46.36.105:3000/genieapi';
    const timeout = parseInt(process.env.PYTHON_API_TIMEOUT || '30000');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PYTHON_API_TOKEN) {
      const t = process.env.PYTHON_API_TOKEN;
      headers['Authorization'] = t.startsWith('Bearer') ? t : `Bearer ${t}`;
    }
    const client = axios.create({ timeout, headers });
    const fullUrl = apiUrl.includes('/assistant/generate-test-data')
      ? apiUrl
      : apiUrl.replace(/\/+$/, '') + '/assistant/generate-test-data';

    const bodyPayload: any = {
      dataType,
      count,
      schema,
      options,
      seed,
      sample_data: sample_data || { username: 'testuser@example.com', password: 'Test@123', role: 'admin' },
    };

    logger.info('Generating and persisting test data via Python API', { traceId, dataType, count });
    let items: any[] = [];
    try {
      const response = await client.post(fullUrl, bodyPayload);
      const list = (response.data?.data || response.data?.records || response.data?.users || response.data?.result || []) as any[];
      items = Array.isArray(list) ? list.slice(0, count) : [];
      if (!items.length) {
        throw new Error('Upstream returned empty data');
      }
    } catch (upErr) {
      logger.warn('Upstream generator failed, using local fallback for generate-save', { traceId });
      const svc = new TestDataService();
      const gen = await svc.generateTestData({ dataType, count });
      items = gen.data || [];
    }

    let suiteId = inputSuiteId as string | undefined;
    if (!suiteId) {
      const newSuiteId = randomUUID();
      const name = suiteName || `Generated ${new Date().toISOString().slice(0, 10)}`;
      const desc = suiteDescription || 'Generated via Python API';
      const createdSuite = await pool.query(
        `INSERT INTO "TestSuite" (id, name, description, "userId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now()) RETURNING *`,
        [newSuiteId, name, desc, userId]
      );
      suiteId = createdSuite.rows[0].id;
    } else {
      const own = await pool.query(
        `SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`,
        [suiteId, userId]
      );
      if (!own.rowCount) {
        return res.status(404).json({ error: 'Test suite not found', traceId });
      }
    }

    const created: any[] = [];
    for (const r of items) {
      const record = typeof r === 'object' ? r : {};
      const name = record.username || record.email || record.name || `Generated ${dataType}`;
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO "TestData" (id, "suiteId", name, environment, type, data, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now(), now()) RETURNING *`,
        [id, suiteId, name, environment || 'dev', type || dataType, JSON.stringify(record)]
      );
      created.push(result.rows[0]);
    }

    return res.status(201).json({ success: true, traceId, suiteId, data: created });
  } catch (error) {
    const err = error as AxiosError;
    const status = err.response?.status ?? 500;
    const data = err.response?.data ?? { message: err.message || 'Failed to generate and save test data' };
    logger.error('Error generating and persisting test data', { traceId, status, data });
    return res.status(status).json({ error: 'GenerationPersistError', traceId, ...(typeof data === 'object' ? data : { message: String(data) }) });
  }
});

// External API forwarding routes - Test Data Generation (NO AUTH REQUIRED)
router.post('/generate/security', generateSecurityTestData);
router.post('/generate/boundary', generateBoundaryTestData);
router.post('/generate/equivalence', generateEquivalenceTestData);
router.post('/generate/positive', generatePositiveTestData);
router.post('/generate/negative', generateNegativeTestData);

// XPath Analysis endpoint (NO AUTH REQUIRED)
router.post('/xpath-analysis', analyzeXPath);

// ============================================
// Field Binding endpoints (requires auth)
// ============================================
router.post('/field-bindings/extract-placeholders', authMiddleware, extractPlaceholders);
router.post('/field-bindings/analyze', authMiddleware, analyzeFieldBindings);
router.post('/field-bindings/preview', authMiddleware, previewFieldBindingSubstitution);
router.post('/field-bindings/generate', authMiddleware, generateWithFieldBindings);

// ============================================
// CSV Data-Driven Testing endpoints (requires auth)
// ============================================
router.post('/csv/upload-and-bind', authMiddleware, csvUpload.single('file'), uploadCsvAndBind);
router.post('/csv/parse', authMiddleware, parseCsvInline);
router.post('/csv/preview-binding', authMiddleware, previewCsvBinding);
router.get('/csv/export/:suiteId', authMiddleware, exportSuiteAsCsv);

export default router;
