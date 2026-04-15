import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { fetchProjectConfig } from '../utils/projectHelpers';
import pool from '../db';
import multer from 'multer';
import { bddService, bddEventEmitter } from '../services/bdd/bdd.service';
import { testCaseConverter } from '../services/bdd/testCaseConverter.service';
import { pomGeneratorService } from '../services/bdd/pomGenerator.service';

// Multer: in-memory storage, 2 MB limit, only text/csv files
export const testCaseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/plain', 'text/csv', 'application/csv', 'text/tab-separated-values'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(txt|csv|tsv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .csv, or .tsv files are supported'));
    }
  },
});

// Multer: .feature file upload (single or bulk, max 1MB each, max 20 files)
export const featureFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const isFeatureExt = /\.(feature|gherkin)$/i.test(file.originalname);
    const isTextMime = ['text/plain', 'application/octet-stream', 'application/x-gherkin'].includes(file.mimetype);
    // Require valid extension; mimetype check is secondary (browsers vary)
    if (isFeatureExt && isTextMime) {
      cb(null, true);
    } else if (isFeatureExt) {
      // Accept if extension matches even with unexpected mimetype
      cb(null, true);
    } else {
      cb(new Error(`Only .feature or .gherkin files are supported (got: ${file.originalname})`));
    }
  },
});

/** Strip UTF-8 BOM from file content */
function stripBom(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

/** Parse CSV line handling quoted fields with commas */
function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Create a new BDD feature
 * POST /api/bdd/features
 */
const VALID_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
const VALID_STATUSES = ['draft', 'active', 'archived'] as const;
const VALID_RUN_STATUSES = ['pending', 'running', 'passed', 'failed', 'cancelled'] as const;

/**
 * Inject or replace navigation steps in every scenario.
 * - If no navigation step exists → inject 'Given I navigate to "/"' as first step
 * - If a custom navigation step exists (e.g., "Given I am on the pulse login page") → replace with 'Given I navigate to "/"'
 * - If 'Given I navigate to "/"' already exists → leave as-is
 */
function injectNavigationStep(featureContent: string): string {
  // Pattern to detect any navigation-like step
  const navPattern = /^(\s*)(Given|When|And|But)\s+(I navigate to|I am on|I go to|I visit|I open the url|I am on the base URL|User should launch|the user launches|I launch the application|the application is open|User is on|user is on|the user is on)\b/i;

  // The exact standard line we want
  const standardNav = 'Given I navigate to "/"';

  const lines = featureContent.split('\n');
  const result: string[] = [];
  let insideScenario = false;
  let firstStepFound = false;
  let navHandled = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect scenario start
    if (/^\s*(Scenario|Scenario Outline):/.test(line)) {
      insideScenario = true;
      firstStepFound = false;
      navHandled = false;
      result.push(line);
      continue;
    }

    // Reset on next scenario/feature/tag
    if (insideScenario && /^\s*(Scenario|Scenario Outline|Feature:|@)/.test(trimmed) && firstStepFound) {
      insideScenario = false;
      firstStepFound = false;
    }

    // Inside scenario — check each step line
    if (insideScenario && /^\s*(Given|When|Then|And|But)\s+/.test(line)) {
      const navMatch = line.match(navPattern);

      if (navMatch && !navHandled) {
        // This is a navigation step — replace it with standard nav
        const indent = navMatch[1] || '    ';

        // Check if it's already the exact standard line
        if (trimmed === standardNav) {
          // Already correct — keep as-is
          navHandled = true;
          result.push(line);
        } else {
          // Replace custom nav with standard nav
          navHandled = true;
          result.push(`${indent}${standardNav}`);
        }
        firstStepFound = true;
        continue;
      }

      if (!firstStepFound) {
        firstStepFound = true;
        // No nav step found yet and this is the first step — inject before it
        if (!navHandled) {
          const stepIndentMatch = line.match(/^(\s*)/);
          const indent = stepIndentMatch ? stepIndentMatch[1] : '    ';
          result.push(`${indent}${standardNav}`);
          navHandled = true;
        }
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

export const createFeature = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { name, description, featureContent: rawContent, tags, projectId } = req.body;

  if (!name || !rawContent) {
    return res.status(400).json({ error: 'name and featureContent are required' });
  }

  // Auto-inject navigation step as first step of each scenario
  const featureContent = injectNavigationStep(rawContent);
  const parsed = bddService.parseFeatureContent(featureContent);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO "BDDFeature" (id, "userId", "organizationId", "projectId", name, description, "featureContent", tags, status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, 'draft', now(), now())
       RETURNING *`,
      [userId, organizationId, projectId || null, name, description || parsed.description || null, featureContent, JSON.stringify(tags || parsed.tags || [])]
    );

    const feature = rows[0];
    for (let sIdx = 0; sIdx < parsed.scenarios.length; sIdx++) {
      const scenario = parsed.scenarios[sIdx];
      const { rows: scenarioRows } = await client.query(
        `INSERT INTO "BDDScenario" (id, "featureId", name, description, "scenarioType", tags, "examplesData", "sortOrder", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
         RETURNING *`,
        [feature.id, scenario.name, scenario.description || null, scenario.type, JSON.stringify(scenario.tags || []), scenario.examples ? JSON.stringify(scenario.examples) : null, sIdx]
      );
      const scenarioRow = scenarioRows[0];
      for (let stIdx = 0; stIdx < scenario.steps.length; stIdx++) {
        const step = scenario.steps[stIdx];
        await client.query(
          `INSERT INTO "BDDStep" (id, "scenarioId", keyword, text, "dataTable", "docString", "sortOrder", "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())`,
          [scenarioRow.id, step.keyword, step.text, step.dataTable ? JSON.stringify(step.dataTable) : null, step.docString || null, stIdx]
        );
      }
    }

    await client.query('COMMIT');
    logger.info(`BDD Feature created: ${feature.id} with ${parsed.scenarios.length} scenarios`);
    return res.status(201).json({ success: true, data: { ...feature, scenarioCount: parsed.scenarios.length } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * Bulk import .feature files
 * POST /api/bdd/features/import
 * Accepts multiple .feature files, creates a BDDFeature per file
 */
export const importFeatureFiles = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { projectId } = req.body;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'At least one .feature file is required' });
  }

  const results: Array<{ filename: string; featureId?: string; scenarioCount?: number; error?: string }> = [];

  for (const file of files) {
    const rawContent = stripBom(file.buffer.toString('utf-8')).trim();
    if (!rawContent) {
      results.push({ filename: file.originalname, error: 'Empty file' });
      continue;
    }

    // Auto-inject navigation step as first step of each scenario
    const featureContent = injectNavigationStep(rawContent);

    // Derive name from filename (remove extension)
    const name = file.originalname.replace(/\.(feature|gherkin)$/i, '').replace(/[-_]/g, ' ');

    try {
      const parsed = bddService.parseFeatureContent(featureContent);
      const featureName = parsed.name || name;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows } = await client.query(
          `INSERT INTO "BDDFeature" (id, "userId", "organizationId", "projectId", name, description, "featureContent", tags, status, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, 'draft', now(), now())
           RETURNING *`,
          [userId, organizationId, projectId || null, featureName, parsed.description || null, featureContent, JSON.stringify(parsed.tags || [])]
        );

        const feature = rows[0];
        for (let sIdx = 0; sIdx < parsed.scenarios.length; sIdx++) {
          const scenario = parsed.scenarios[sIdx];
          const { rows: scenarioRows } = await client.query(
            `INSERT INTO "BDDScenario" (id, "featureId", name, description, "scenarioType", tags, "examplesData", "sortOrder", "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
             RETURNING *`,
            [feature.id, scenario.name, scenario.description || null, scenario.type, JSON.stringify(scenario.tags || []), scenario.examples ? JSON.stringify(scenario.examples) : null, sIdx]
          );
          const scenarioRow = scenarioRows[0];
          for (let stIdx = 0; stIdx < scenario.steps.length; stIdx++) {
            const step = scenario.steps[stIdx];
            await client.query(
              `INSERT INTO "BDDStep" (id, "scenarioId", keyword, text, "dataTable", "docString", "sortOrder", "createdAt")
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())`,
              [scenarioRow.id, step.keyword, step.text, step.dataTable ? JSON.stringify(step.dataTable) : null, step.docString || null, stIdx]
            );
          }
        }

        await client.query('COMMIT');
        results.push({ filename: file.originalname, featureId: feature.id, scenarioCount: parsed.scenarios.length });
        logger.info(`Imported feature file: ${file.originalname} → ${feature.id} (${parsed.scenarios.length} scenarios)`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      results.push({ filename: file.originalname, error: err.message || 'Parse/import failed' });
      logger.error(`Failed to import ${file.originalname}: ${err.message}`);
    }
  }

  const imported = results.filter(r => r.featureId);
  const failed = results.filter(r => r.error);
  return res.status(201).json({
    success: true,
    data: {
      totalFiles: files.length,
      imported: imported.length,
      failed: failed.length,
      results,
    }
  });
});

/**
 * Convert CSV to Scenario Outline with Examples table
 * POST /api/bdd/features/csv-to-outline
 * Accepts a CSV file + scenario template, generates Gherkin with Examples
 */
export const csvToScenarioOutline = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as Express.Multer.File | undefined;
  const { scenarioName, featureName, steps, tags } = req.body;

  let csvContent = '';
  if (file) {
    csvContent = stripBom(file.buffer.toString('utf-8')).trim();
  } else if (req.body.csvContent) {
    csvContent = stripBom(req.body.csvContent).trim();
  }

  if (!csvContent) {
    return res.status(400).json({ error: 'CSV content or file is required' });
  }

  // Parse CSV: first row = headers, rest = data
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must have at least a header row and one data row' });
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseCsvLine(lines[0], delimiter);
  const dataRows = lines.slice(1).map(line => parseCsvLine(line, delimiter));

  // Build steps template — if not provided, auto-generate from headers
  let stepLines: string;
  if (steps) {
    stepLines = steps;
  } else {
    // Auto-generate steps using headers as placeholders
    stepLines = headers.map((h, i) => {
      if (i === 0) return `    Given I have "${h}" set to "<${h}>"`;
      if (i === headers.length - 1) return `    Then I should see "<${h}>"`;
      return `    And I set "${h}" to "<${h}>"`;
    }).join('\n');
  }

  // Build Gherkin
  const tagLine = tags ? `  ${tags}\n` : '';
  const outlineName = scenarioName || 'Test with dynamic data';
  const fName = featureName || 'Data-Driven Testing';

  let gherkin = `Feature: ${fName}\n\n`;
  gherkin += `${tagLine}  Scenario Outline: ${outlineName}\n`;
  gherkin += `${stepLines}\n\n`;
  gherkin += `    Examples:\n`;
  gherkin += `      | ${headers.map(h => h.replace(/\|/g, '\\|')).join(' | ')} |\n`;
  for (const row of dataRows) {
    // Pad cells to match header count, escape pipes
    const paddedRow = headers.map((_, i) => (row[i] || '').replace(/\|/g, '\\|'));
    gherkin += `      | ${paddedRow.join(' | ')} |\n`;
  }

  return res.json({
    success: true,
    data: {
      featureContent: gherkin,
      totalExamples: dataRows.length,
      headers,
      scenarioCount: 1,
      effectiveTests: dataRows.length,
    }
  });
});

/**
 * List all BDD features
 * GET /api/bdd/features
 */
export const getFeatures = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { status, projectId } = req.query;

  const { page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  let query = `
    SELECT f.*,
      (SELECT COUNT(*) FROM "BDDScenario" s WHERE s."featureId" = f.id) as "scenarioCount",
      (SELECT COUNT(*) FROM "BDDRun" r WHERE r."featureId" = f.id) as "runCount"
    FROM "BDDFeature" f
    WHERE f."userId" = $1
  `;
  const params: (string | number)[] = [userId];
  let idx = 2;

  if (organizationId) { query += ` AND f."organizationId" = $${idx}`; params.push(organizationId); idx++; }
  if (status) { query += ` AND f.status = $${idx}`; params.push(status as string); idx++; }
  if (projectId) { query += ` AND f."projectId" = $${idx}`; params.push(projectId as string); idx++; }

  query += ` ORDER BY f."createdAt" DESC LIMIT $${idx} OFFSET $${idx + 1}`;
  params.push(limitNum, offset);

  const { rows } = await pool.query(query, params);
  return res.json({ success: true, data: rows, page: pageNum, limit: limitNum });
});

/**
 * Get a single BDD feature with scenarios and steps
 * GET /api/bdd/features/:id
 */
export const getFeature = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT * FROM "BDDFeature" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Feature not found' });

  const feature = rows[0];

  // Load scenarios with steps in a single JOIN query (avoids N+1)
  const { rows: joinRows } = await pool.query(
    `SELECT
       s.id as "scenarioId", s.name as "scenarioName", s.description as "scenarioDescription",
       s."scenarioType", s.tags as "scenarioTags", s."examplesData", s."sortOrder" as "scenarioSortOrder",
       s."createdAt" as "scenarioCreatedAt", s."updatedAt" as "scenarioUpdatedAt",
       st.id as "stepId", st.keyword, st.text as "stepText", st."dataTable",
       st."docString", st."sortOrder" as "stepSortOrder", st."createdAt" as "stepCreatedAt"
     FROM "BDDScenario" s
     LEFT JOIN "BDDStep" st ON st."scenarioId" = s.id
     WHERE s."featureId" = $1
     ORDER BY s."sortOrder", st."sortOrder"`,
    [id]
  );

  const scenarioMap = new Map<string, any>();
  for (const row of joinRows) {
    if (!scenarioMap.has(row.scenarioId)) {
      scenarioMap.set(row.scenarioId, {
        id: row.scenarioId,
        featureId: id,
        name: row.scenarioName,
        description: row.scenarioDescription,
        scenarioType: row.scenarioType,
        tags: row.scenarioTags,
        examplesData: row.examplesData,
        sortOrder: row.scenarioSortOrder,
        createdAt: row.scenarioCreatedAt,
        updatedAt: row.scenarioUpdatedAt,
        steps: [],
      });
    }
    if (row.stepId) {
      scenarioMap.get(row.scenarioId).steps.push({
        id: row.stepId,
        scenarioId: row.scenarioId,
        keyword: row.keyword,
        text: row.stepText,
        dataTable: row.dataTable,
        docString: row.docString,
        sortOrder: row.stepSortOrder,
        createdAt: row.stepCreatedAt,
      });
    }
  }
  const scenarios = [...scenarioMap.values()];

  return res.json({ success: true, data: { ...feature, scenarios } });
});

/**
 * Update a BDD feature
 * PUT /api/bdd/features/:id
 */
export const updateFeature = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const { name, description, featureContent, tags, status, projectId } = req.body;

  const { rows: existing } = await pool.query(
    `SELECT * FROM "BDDFeature" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (existing.length === 0) return res.status(404).json({ error: 'Feature not found' });

  const updates: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx}`); params.push(name); idx++; }
  if (description !== undefined) { updates.push(`description = $${idx}`); params.push(description); idx++; }
  if (tags !== undefined) { updates.push(`tags = $${idx}`); params.push(JSON.stringify(tags)); idx++; }
  if (status !== undefined) { updates.push(`status = $${idx}`); params.push(status); idx++; }
  if (projectId !== undefined) { updates.push(`"projectId" = $${idx}`); params.push(projectId || null); idx++; }

  if (featureContent !== undefined) {
    updates.push(`"featureContent" = $${idx}`); params.push(featureContent); idx++;

    // Re-parse and rebuild scenarios/steps in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM "BDDScenario" WHERE "featureId" = $1`, [id]);
      const parsed = bddService.parseFeatureContent(featureContent);
      for (let sIdx = 0; sIdx < parsed.scenarios.length; sIdx++) {
        const scenario = parsed.scenarios[sIdx];
        const { rows: scenarioRows } = await client.query(
          `INSERT INTO "BDDScenario" (id, "featureId", name, description, "scenarioType", tags, "examplesData", "sortOrder", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
           RETURNING *`,
          [id, scenario.name, scenario.description || null, scenario.type, JSON.stringify(scenario.tags || []), scenario.examples ? JSON.stringify(scenario.examples) : null, sIdx]
        );
        const scenarioRow = scenarioRows[0];
        for (let stIdx = 0; stIdx < scenario.steps.length; stIdx++) {
          const step = scenario.steps[stIdx];
          await client.query(
            `INSERT INTO "BDDStep" (id, "scenarioId", keyword, text, "dataTable", "docString", "sortOrder", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())`,
            [scenarioRow.id, step.keyword, step.text, step.dataTable ? JSON.stringify(step.dataTable) : null, step.docString || null, stIdx]
          );
        }
      }
      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  }

  updates.push(`"updatedAt" = now()`);
  params.push(id);
  idx++;

  const { rows } = await pool.query(
    `UPDATE "BDDFeature" SET ${updates.join(', ')} WHERE id = $${idx - 1} RETURNING *`,
    params
  );

  return res.json({ success: true, data: rows[0] });
});

/**
 * Delete a BDD feature
 * DELETE /api/bdd/features/:id
 */
export const deleteFeature = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT id FROM "BDDFeature" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Feature not found' });

  // Stop and delete associated schedules
  const { rows: scheduleRows } = await pool.query(
    `SELECT id FROM "BDDSchedule" WHERE "featureId" = $1`,
    [id]
  );
  for (const sched of scheduleRows) {
    await bddService.deleteSchedule(sched.id, userId);
  }

  // Delete associated runs
  await pool.query(`DELETE FROM "BDDRun" WHERE "featureId" = $1`, [id]);

  // Delete scenarios (which cascade-deletes steps)
  await pool.query(`DELETE FROM "BDDScenario" WHERE "featureId" = $1`, [id]);

  await pool.query(`DELETE FROM "BDDFeature" WHERE id = $1`, [id]);
  return res.json({ success: true, message: 'Feature deleted' });
});

/**
 * Parse Gherkin feature content (preview)
 * POST /api/bdd/parse
 */
const VALID_LANGUAGES = ['typescript', 'java', 'java-cucumber'] as const;
type Language = typeof VALID_LANGUAGES[number];

export const parseFeature = asyncHandler(async (req: Request, res: Response) => {
  const { featureContent, language } = req.body;
  if (!featureContent) return res.status(400).json({ error: 'featureContent is required' });

  const lang: Language = VALID_LANGUAGES.includes(language) ? language : 'typescript';
  const parsed = bddService.parseFeatureContent(featureContent);
  const playwrightCode = bddService.generatePlaywrightCode(parsed, lang);

  return res.json({ success: true, data: { parsed, playwrightCode, language: lang } });
});

/**
 * Generate Playwright test code from a feature
 * POST /api/bdd/features/:id/generate
 */
export const generateCode = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const rawLang = (req.body.language || req.query.language) as string | undefined;
  const lang: Language = VALID_LANGUAGES.includes(rawLang as Language) ? rawLang as Language : 'typescript';

  const { rows } = await pool.query(
    `SELECT * FROM "BDDFeature" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Feature not found' });

  const feature = rows[0];
  const projectConfig = await fetchProjectConfig(feature.projectId);

  const parsed = bddService.parseFeatureContent(feature.featureContent);
  let playwrightCode = bddService.generatePlaywrightCode(parsed, lang);

  // Inject project baseUrl into BASE_URL fallback
  if (projectConfig?.baseUrl && playwrightCode.includes("process.env.BASE_URL || ''")) {
    playwrightCode = playwrightCode.replace(
      "process.env.BASE_URL || ''",
      `process.env.BASE_URL || '${projectConfig.baseUrl.replace(/'/g, "\\'")}'`
    );
  }

  return res.json({ success: true, data: { playwrightCode, language: lang } });
});

/**
 * Generate Playwright code from a BDD feature AND save it as a Script
 * POST /api/bdd/features/:id/save-as-script
 */
/**
 * Generate Page Object Model from a feature file + target URL (deterministic — no LLM)
 * POST /api/bdd/generate-pom
 * Body: { featureContent: string, targetUrl: string, className?: string, waitForSelector?: string }
 */
export const generatePOM = asyncHandler(async (req: Request, res: Response) => {
  const { featureContent, targetUrl, className, waitForSelector } = req.body;
  if (!featureContent || !targetUrl) {
    return res.status(400).json({ error: 'featureContent and targetUrl are required' });
  }
  try {
    const results = await pomGeneratorService.generateFromFeature(
      featureContent,
      targetUrl,
      { className, waitForSelector }
    );
    return res.json({ success: true, data: results });
  } catch (err: any) {
    logger.error('POM generation failed:', err.message);
    return res.status(500).json({ error: `POM generation failed: ${err.message}` });
  }
});

/**
 * Apply a generated POM to a feature — regenerate Playwright test code using POM methods
 * POST /api/bdd/apply-pom
 * Body: { featureContent: string, pom: POMResult, baseUrl: string }
 */
export const applyPOMToFeature = asyncHandler(async (req: Request, res: Response) => {
  const { featureContent, pom, poms, baseUrl } = req.body;
  if (!featureContent) {
    return res.status(400).json({ error: 'featureContent is required' });
  }
  // Accept either a single pom (legacy) or array of poms (multi-page)
  const pomArray = Array.isArray(poms) ? poms : (pom ? [pom] : null);
  if (!pomArray || pomArray.length === 0) {
    return res.status(400).json({ error: 'pom or poms array is required' });
  }
  try {
    const playwrightCode = pomGeneratorService.applyMultiplePOMsToFeature(featureContent, pomArray, baseUrl || '');
    return res.json({
      success: true,
      data: {
        playwrightCode,
        classNames: pomArray.map((p: any) => p.className),
      }
    });
  } catch (err: any) {
    logger.error('Apply POM failed:', err.message);
    return res.status(500).json({ error: `Apply POM failed: ${err.message}` });
  }
});

export const saveAsScript = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const rawLang = (req.body.language || 'typescript') as string;
  const lang: Language = VALID_LANGUAGES.includes(rawLang as Language) ? rawLang as Language : 'typescript';
  const { scriptName, browserType = 'chromium' } = req.body;

  // Fetch BDD feature
  const { rows: featureRows } = await pool.query(
    `SELECT * FROM "BDDFeature" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (featureRows.length === 0) return res.status(404).json({ error: 'Feature not found' });

  const feature = featureRows[0];

  // Fetch project config for baseUrl
  const projectConfig = await fetchProjectConfig(feature.projectId);

  // Check if script already exists for this feature
  const { rows: existingScripts } = await pool.query(
    `SELECT id, name FROM "Script" WHERE "bddFeatureId" = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (existingScripts.length > 0) {
    return res.status(409).json({
      error: 'Script already exists for this feature',
      existingScript: { id: existingScripts[0].id, name: existingScripts[0].name }
    });
  }

  // Generate Playwright code — inject project baseUrl so "/" resolves correctly
  const parsed = bddService.parseFeatureContent(feature.featureContent);
  let playwrightCode = bddService.generatePlaywrightCode(parsed, lang);

  // Replace empty BASE_URL fallback with project's baseUrl
  if (projectConfig?.baseUrl && playwrightCode.includes("process.env.BASE_URL || ''")) {
    playwrightCode = playwrightCode.replace(
      "process.env.BASE_URL || ''",
      `process.env.BASE_URL || '${projectConfig.baseUrl.replace(/'/g, "\\'")}'`
    );
  }

  // Create Script record
  const name = scriptName || feature.name;
  const description = `Generated from BDD feature: ${feature.name}`;
  const tags = feature.tags || '[]';

  const { rows: scriptRows } = await pool.query(
    `INSERT INTO "Script" (id, name, description, language, code, "projectId", "userId", "browserType", "workflowStatus", tags, "bddFeatureId", "generatedFrom", "baseUrl", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, 'bdd-feature', $10, now(), now())
     RETURNING id, name, description, language, "browserType", "workflowStatus", "projectId", "bddFeatureId", "baseUrl", "createdAt"`,
    [name, description, lang, playwrightCode, feature.projectId || null, userId, browserType, tags, id, projectConfig?.baseUrl || null]
  );

  const script = scriptRows[0];
  logger.info(`BDD Feature ${id} → Script ${script.id} (${lang}, ${parsed.scenarios.length} scenarios)`);

  return res.status(201).json({
    success: true,
    data: {
      script,
      playwrightCode,
      language: lang,
      scenarioCount: parsed.scenarios.length,
    }
  });
});

/**
 * Run a BDD feature
 * POST /api/bdd/features/:id/run
 */
export const runFeature = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { id } = req.params;
  const {
    scenarioId, browser = 'chromium', executionMode = 'headless', stepDefinitions = {}, tags, parallelWorkers,
    // Retry / flaky test options
    retryCount, retryDelayMs, quarantineFailures,
    // Environment profile
    environment,
    // Dynamic project selection
    projectId,
  } = req.body;

  if (!VALID_BROWSERS.includes(browser)) {
    return res.status(400).json({ error: `browser must be one of: ${VALID_BROWSERS.join(', ')}` });
  }

  // Validate retry count (0-5)
  if (retryCount !== undefined && (retryCount < 0 || retryCount > 5)) {
    return res.status(400).json({ error: 'retryCount must be between 0 and 5' });
  }

  const { rows } = await pool.query(
    `SELECT * FROM "BDDFeature" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Feature not found' });

  const feature = rows[0];

  // Validate feature content before execution
  const parsed = bddService.parseFeatureContent(feature.featureContent);
  const validationErrors: string[] = [];
  if (!parsed.name) validationErrors.push('Feature has no name');
  // Filter out Background — it's a setup section, not a test scenario
  const nonBackgroundScenarios = parsed.scenarios.filter(s => !(s.tags || []).includes('@background'));
  if (nonBackgroundScenarios.length === 0) validationErrors.push('Feature has no scenarios');
  for (const scenario of nonBackgroundScenarios) {
    if (scenario.steps.length === 0) {
      validationErrors.push(`Scenario "${scenario.name}" has no steps`);
    }
    for (const step of scenario.steps) {
      if (!step.keyword || !step.text) {
        validationErrors.push(`Scenario "${scenario.name}" has an invalid step (missing keyword or text)`);
      }
    }
    if (scenario.type === 'Scenario Outline' && (!scenario.examples || scenario.examples.length === 0)) {
      validationErrors.push(`Scenario Outline "${scenario.name}" has no Examples table`);
    }
  }
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: 'Feature validation failed',
      validationErrors,
    });
  }
  const totalSteps = nonBackgroundScenarios.reduce((sum, s) => sum + s.steps.length, 0);

  const parsedParallelWorkers = parallelWorkers ? parseInt(parallelWorkers, 10) : 1;
  const parsedRetryCount = retryCount ? parseInt(retryCount, 10) : 0;

  // Fetch project config — use request projectId, fallback to feature's projectId
  const effectiveProjectId = projectId || feature.projectId;
  const projectConfig = await fetchProjectConfig(effectiveProjectId);

  // Create run record
  const { rows: runRows } = await pool.query(
    `INSERT INTO "BDDRun" (
      id, "featureId", "scenarioId", "userId", "organizationId",
      status, "totalSteps", browser, "executionMode",
      tags, "parallelWorkers", "retryCount", "environmentName", "environmentProfile",
      "projectId", "projectName", "projectBaseUrl",
      "createdAt", "updatedAt"
     )
     VALUES (
      gen_random_uuid()::text, $1, $2, $3, $4,
      'pending', $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15,
      now(), now()
     )
     RETURNING *`,
    [
      id, scenarioId || null, userId, organizationId,
      totalSteps, browser, executionMode,
      tags || null,
      parsedParallelWorkers,
      parsedRetryCount,
      environment?.name || null,
      environment ? JSON.stringify(environment) : null,
      projectConfig?.id || null,
      projectConfig?.name || null,
      projectConfig?.baseUrl || null,
    ]
  );

  const run = runRows[0];

  // Build environment profile — merge project config baseUrl with user-provided environment
  const envProfile = {
    ...(environment || {}),
    baseUrl: environment?.baseUrl || projectConfig?.baseUrl || undefined,
    name: environment?.name || projectConfig?.name || undefined,
  };

  // Execute asynchronously with all options
  setImmediate(() => {
    bddService.executeFeature(run.id, feature.featureContent, stepDefinitions, {
      browser, executionMode, tags,
      parallelWorkers: parsedParallelWorkers || undefined,
      retryCount: parsedRetryCount || undefined,
      retryDelayMs: retryDelayMs ? parseInt(retryDelayMs, 10) : undefined,
      quarantineFailures: quarantineFailures === true || quarantineFailures === 'true',
      environment: envProfile.baseUrl ? envProfile : undefined,
    }, userId, organizationId).catch(async (err: any) => {
      logger.error(`BDD Run ${run.id}: Unhandled error: ${err.message}`);
      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "completedAt" = now(), "updatedAt" = now() WHERE id = $2`,
        [err.message || 'Unexpected execution error', run.id]
      );
    });
  });

  return res.status(201).json({
    success: true,
    message: 'BDD run started',
    data: run
  });
});

/**
 * Get all BDD runs
 * GET /api/bdd/runs
 */
export const getRuns = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { featureId, status, projectId, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  if (status && !VALID_RUN_STATUSES.includes(status as typeof VALID_RUN_STATUSES[number])) {
    return res.status(400).json({ error: `status must be one of: ${VALID_RUN_STATUSES.join(', ')}` });
  }

  let query = `
    SELECT r.*, f.name as "featureName"
    FROM "BDDRun" r
    JOIN "BDDFeature" f ON f.id = r."featureId"
    WHERE r."userId" = $1
  `;
  const params: (string | number)[] = [userId];
  let idx = 2;

  if (organizationId) { query += ` AND r."organizationId" = $${idx}`; params.push(organizationId); idx++; }
  if (projectId) { query += ` AND r."featureId" IN (SELECT id FROM "BDDFeature" WHERE "projectId" = $${idx})`; params.push(projectId as string); idx++; }
  if (featureId) { query += ` AND r."featureId" = $${idx}`; params.push(featureId as string); idx++; }
  if (status) { query += ` AND r.status = $${idx}`; params.push(status as string); idx++; }

  query += ` ORDER BY r."createdAt" DESC LIMIT $${idx} OFFSET $${idx + 1}`;
  params.push(limitNum, offset);

  const { rows } = await pool.query(query, params);
  return res.json({ success: true, data: rows, page: pageNum, limit: limitNum });
});

/**
 * Get a single BDD run with results
 * GET /api/bdd/runs/:id
 */
export const getRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT r.*, f.name as "featureName", f."featureContent"
     FROM "BDDRun" r
     JOIN "BDDFeature" f ON f.id = r."featureId"
     WHERE r.id = $1 AND r."userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Run not found' });

  return res.json({ success: true, data: rows[0] });
});

/**
 * Get BDD run report HTML from database
 * GET /api/bdd/runs/:id/report
 */
export const getRunReport = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT "reportUrl", status FROM "BDDRun" WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Run not found' });

  const run = rows[0];

  // Redirect to BDD report if available
  if (run.reportUrl && run.reportUrl.startsWith('/playwright-crx-reports/')) {
    return res.redirect(run.reportUrl);
  }

  // Fallback: try report path by convention
  const reportPath = `/playwright-crx-reports/${id}/index.html`;
  const reportFile = path.join(process.cwd(), reportPath);
  if (fs.existsSync(reportFile)) {
    return res.redirect(reportPath);
  }

  return res.status(404).json({ error: 'BDD report not yet generated or unavailable' });
});

/**
 * Cancel a running BDD execution
 * POST /api/bdd/runs/:id/cancel
 */
export const cancelRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT id, status FROM "BDDRun" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Run not found' });
  if (rows[0].status !== 'running' && rows[0].status !== 'pending') {
    return res.status(400).json({ error: 'Run is not currently running' });
  }

  const cancelled = await bddService.cancelRun(id);
  if (!cancelled) {
    await pool.query(
      `UPDATE "BDDRun" SET status = 'cancelled', "errorMsg" = 'Run was cancelled by user', "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
      [id]
    );
  }

  return res.json({ success: true, message: 'Run cancelled' });
});

/**
 * Delete a BDD run
 * DELETE /api/bdd/runs/:id
 */
export const deleteRun = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT id, status FROM "BDDRun" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Run not found' });
  if (rows[0].status === 'running') return res.status(400).json({ error: 'Cannot delete a running execution' });

  await pool.query(`DELETE FROM "BDDRun" WHERE id = $1`, [id]);
  return res.json({ success: true, message: 'Run deleted' });
});

/**
 * Get BDD execution status (concurrency info)
 * GET /api/bdd/status
 */
export const getExecutionStatus = asyncHandler(async (_req: Request, res: Response) => {
  const status = bddService.getExecutionStatus();
  return res.json({ success: true, data: status });
});

// ===========================
// STEP LIBRARY ENDPOINTS
// ===========================

/**
 * Create a reusable step definition
 * POST /api/bdd/step-library
 */
export const createStepLibEntry = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { pattern, code, keyword, description, tags } = req.body;

  if (!pattern || !code || !keyword) {
    return res.status(400).json({ error: 'pattern, code, and keyword are required' });
  }

  const entry = await bddService.createStepLibraryEntry(userId, organizationId, { pattern, code, keyword, description, tags });
  return res.status(201).json({ success: true, data: entry });
});

/**
 * Get all step library entries for user/org
 * GET /api/bdd/step-library
 */
export const getStepLibrary = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const entries = await bddService.getStepLibrary(userId, organizationId);
  return res.json({ success: true, data: entries });
});

/**
 * Update a step library entry
 * PUT /api/bdd/step-library/:id
 */
export const updateStepLibEntry = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const entry = await bddService.updateStepLibraryEntry(id, userId, req.body);
  if (!entry) return res.status(404).json({ error: 'Step not found' });
  return res.json({ success: true, data: entry });
});

/**
 * Delete a step library entry
 * DELETE /api/bdd/step-library/:id
 */
export const deleteStepLibEntry = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const deleted = await bddService.deleteStepLibraryEntry(id, userId);
  if (!deleted) return res.status(404).json({ error: 'Step not found' });
  return res.json({ success: true, message: 'Step deleted' });
});

// ===========================
// SCHEDULE ENDPOINTS
// ===========================

/**
 * Create a scheduled BDD run
 * POST /api/bdd/schedules
 */
export const createSchedule = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { featureId, cronExpression, tags, browser, executionMode } = req.body;

  if (!featureId || !cronExpression) {
    return res.status(400).json({ error: 'featureId and cronExpression are required' });
  }

  const schedule = await bddService.createSchedule(userId, organizationId, { featureId, cronExpression, tags, browser, executionMode });
  return res.status(201).json({ success: true, data: schedule });
});

/**
 * Get all schedules
 * GET /api/bdd/schedules
 */
export const getSchedules = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const schedules = await bddService.getSchedules(userId);
  return res.json({ success: true, data: schedules });
});

/**
 * Update a schedule
 * PUT /api/bdd/schedules/:id
 */
export const updateSchedule = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const schedule = await bddService.updateSchedule(id, userId, req.body);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  return res.json({ success: true, data: schedule });
});

/**
 * Delete a schedule
 * DELETE /api/bdd/schedules/:id
 */
export const deleteSchedule = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const deleted = await bddService.deleteSchedule(id, userId);
  if (!deleted) return res.status(404).json({ error: 'Schedule not found' });
  return res.json({ success: true, message: 'Schedule deleted' });
});

// ===========================
// LIVE EXECUTION STREAMING (SSE)
// ===========================

/**
 * SSE endpoint for live BDD run streaming
 * GET /api/bdd/runs/:id/stream
 */
export const streamRun = (req: Request, res: Response) => {
  const { id } = req.params;

  // SSE auth: EventSource API cannot send custom headers,
  // so we accept the JWT token as a query parameter (?token=...)
  const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Token is required' });
  }
  try {
    const { authService } = require('../services/auth/auth.service');
    authService.verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({ event: 'connected', runId: id })}\n\n`);

  const listener = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Close connection when run completes
    if (data.event === 'completed' || data.event === 'error') {
      setTimeout(() => res.end(), 500);
    }
  };

  bddEventEmitter.on(`run:${id}`, listener);

  req.on('close', () => {
    bddEventEmitter.off(`run:${id}`, listener);
  });

  // explicit void return to satisfy TS (function has early returns above)
  return;
};

// ===========================
// TEST CASE → GHERKIN CONVERSION
// ===========================

/**
 * Convert plain test cases to Gherkin feature file
 * POST /api/bdd/convert
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (.txt, .csv, .tsv)
 *   - application/json with { content: string, filename?: string }
 */
export const convertToGherkin = asyncHandler(async (req: Request, res: Response) => {
  let content: string;
  let filename: string | undefined;

  if (req.file) {
    // File upload path
    content = req.file.buffer.toString('utf-8');
    filename = req.file.originalname;
  } else if (req.body?.content) {
    // JSON body path
    content = req.body.content as string;
    filename = req.body.filename as string | undefined;
  } else {
    return res.status(400).json({ error: 'Provide either a file upload or a JSON body with "content"' });
  }

  if (!content.trim()) {
    return res.status(400).json({ error: 'Input is empty' });
  }

  let result;
  try {
    result = testCaseConverter.convert(content, filename);
  } catch (convErr: any) {
    logger.error('Test case conversion error:', convErr);
    return res.status(500).json({ error: 'Conversion failed', details: convErr.message });
  }

  logger.info(`Test case conversion: ${result.scenarioCount} scenario(s) generated`);

  return res.json({
    success: true,
    data: {
      gherkin: result.gherkin,
      scenarioCount: result.scenarioCount,
      warnings: result.warnings,
    },
  });
});
