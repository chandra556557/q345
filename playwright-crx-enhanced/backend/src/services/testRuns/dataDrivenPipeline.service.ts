/**
 * Data-Driven Pipeline Service
 *
 * Orchestrates the full 5-step data-driven testing pipeline:
 *   Step 1 – Analyze Script (field extraction + auto-parameterization)
 *   Step 2 – Generate Test Data (per strategy: positive/negative/boundary/equivalence/security)
 *   Step 3 – Bind & Parameterize (replace hardcoded values with {{placeholder}}, substitute data rows)
 *   Step 4 – Execute Rows (run each variant via TestRunnerService)
 *   Step 5 – Aggregate & Report (collect results, produce Allure report)
 */

import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import pool from '../../db';
import { testRunnerService } from './testRunner.service';
import { bddReportService as playwrightCrxService } from '../bdd-report.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataStrategy = 'positive' | 'negative' | 'boundary' | 'equivalence' | 'security';

export interface DetectedField {
  /** Original Playwright selector/locator string */
  selector?: string;
  /** Human-readable field name (from getByLabel, getByPlaceholder, etc.) */
  fieldName?: string;
  /** Inferred HTML input type (email, password, text, number, …) */
  fieldType: string;
  /** Playwright action that targets this field */
  action: string;
  /** The hardcoded value found in the script (if any) */
  hardcodedValue?: string;
  /** Line number in the script */
  line: number;
}

export interface PipelineRequest {
  scriptId: string;
  userId: string;
  organizationId?: string;
  /** Which data strategies to generate & run */
  strategies: DataStrategy[];
  /** How many data rows per strategy (default 5) */
  countPerStrategy?: number;
  /** Sequential or parallel row execution */
  executionMode?: 'sequential' | 'parallel';
  /** Max parallel rows (when executionMode=parallel) */
  maxParallel?: number;
  /** Auto-replace hardcoded fill values with {{placeholder}} */
  autoParameterize?: boolean;
  /** Stop the entire pipeline on first row failure */
  stopOnFirstFailure?: boolean;
  /** Optional manual field-type overrides */
  fieldHints?: Array<{
    fieldName?: string;
    selector?: string;
    fieldType?: string;
  }>;
  /** Browser to use */
  browser?: string;
}

export interface PipelineResult {
  pipelineRunId: string;
  scriptId: string;
  status: 'passed' | 'failed' | 'partial' | 'cancelled';
  fields: DetectedField[];
  parameterizedCode: string;
  strategies: DataStrategy[];
  /** Per-strategy summary */
  strategySummary: Record<DataStrategy, {
    total: number;
    passed: number;
    failed: number;
    rows: RowResult[];
  }>;
  totalRows: number;
  passedRows: number;
  failedRows: number;
  duration: number;
  aggregateReportUrl?: string;
}

interface RowResult {
  rowIndex: number;
  strategy: DataStrategy;
  dataValues: Record<string, any>;
  testRunId: string;
  status: string;
  duration?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DataDrivenPipelineService {
  private activeRuns: Map<string, { cancelled: boolean }> = new Map();

  // =========================================================================
  // Public entry point
  // =========================================================================

  async runPipeline(request: PipelineRequest): Promise<PipelineResult> {
    const pipelineRunId = randomUUID();
    const runControl = { cancelled: false };
    this.activeRuns.set(pipelineRunId, runControl);

    const startTime = Date.now();

    try {
      // Load script ----------------------------------------------------------
      const { rows: scriptRows } = await pool.query(
        `SELECT id, code, name, "browserType" FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [request.scriptId, request.userId],
      );
      const script = scriptRows[0];
      if (!script) throw new Error('Script not found');

      const browser = request.browser || script.browserType || 'chromium';
      const strategies = request.strategies?.length ? request.strategies : ['positive', 'negative', 'boundary', 'equivalence', 'security'] as DataStrategy[];
      const countPerStrategy = request.countPerStrategy ?? 5;
      const autoParam = request.autoParameterize !== false; // default true

      logger.info(`Pipeline ${pipelineRunId}: Starting for script "${script.name}" with strategies [${strategies}]`);

      // ── Step 1 – Analyze Script ──────────────────────────────────────────
      logger.info(`Pipeline ${pipelineRunId}: Step 1 – Analyzing script`);
      const fields = this.analyzeScript(script.code, request.fieldHints);
      logger.info(`Pipeline ${pipelineRunId}: Detected ${fields.length} input fields`);

      if (fields.length === 0) {
        throw new Error('No input fields detected in the script. Ensure the script contains fill(), getByLabel(), getByPlaceholder(), or similar Playwright commands with values.');
      }

      // ── Step 2 – Generate Test Data ──────────────────────────────────────
      logger.info(`Pipeline ${pipelineRunId}: Step 2 – Generating test data`);
      const datasets = this.generateDatasets(fields, strategies, countPerStrategy);
      logger.info(`Pipeline ${pipelineRunId}: Generated datasets — ${Object.entries(datasets).map(([s, rows]) => `${s}:${rows.length}`).join(', ')}`);

      // ── Step 3 – Bind & Parameterize ─────────────────────────────────────
      logger.info(`Pipeline ${pipelineRunId}: Step 3 – Parameterizing script`);
      const { parameterizedCode, fieldBindings } = autoParam
        ? this.autoParameterize(script.code, fields)
        : { parameterizedCode: script.code, fieldBindings: this.buildDefaultBindings(fields) };

      // Persist a DataDrivenRun parent record (for UI tracking) ──────────────
      const allRows: Array<{ strategy: DataStrategy; data: Record<string, any> }> = [];
      for (const strategy of strategies) {
        for (const row of datasets[strategy] ?? []) {
          allRows.push({ strategy, data: row });
        }
      }

      await pool.query(
        `INSERT INTO "DataDrivenRun" (
            id, "scriptId", "userId", "organizationId", name, status,
            "totalRows", "fieldBindings", "dataRows", "executionConfig",
            browser, "executionMode", "createdAt", "updatedAt"
         ) VALUES (
            $1, $2, $3, $4, $5, 'running',
            $6, $7, $8, $9,
            $10, $11, now(), now()
         )`,
        [
          pipelineRunId,
          request.scriptId,
          request.userId,
          request.organizationId || null,
          `Pipeline: ${script.name}`,
          allRows.length,
          JSON.stringify(fieldBindings),
          JSON.stringify(allRows.map(r => r.data)),
          JSON.stringify({ stopOnFirstFailure: request.stopOnFirstFailure, maxParallel: request.maxParallel }),
          browser,
          request.executionMode || 'sequential',
        ],
      );

      // ── Step 4 – Execute Rows ────────────────────────────────────────────
      logger.info(`Pipeline ${pipelineRunId}: Step 4 – Executing ${allRows.length} rows`);
      const strategySummary: PipelineResult['strategySummary'] = {} as any;
      for (const s of strategies) {
        strategySummary[s] = { total: 0, passed: 0, failed: 0, rows: [] };
      }

      let totalPassed = 0;
      let totalFailed = 0;

      if (request.executionMode === 'parallel') {
        const batchSize = Math.min(request.maxParallel ?? 3, 5);
        for (let i = 0; i < allRows.length; i += batchSize) {
          if (runControl.cancelled) break;
          const batch = allRows.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map((entry, batchIdx) =>
              this.executeSingleRow(pipelineRunId, request.scriptId, request.userId, parameterizedCode, fieldBindings, entry.data, i + batchIdx, entry.strategy, browser),
            ),
          );

          for (const result of results) {
            const row: RowResult = result.status === 'fulfilled' ? result.value : { rowIndex: -1, strategy: batch[0]?.strategy ?? 'positive', dataValues: {}, testRunId: '', status: 'failed', error: (result as PromiseRejectedResult).reason?.message };
            strategySummary[row.strategy].total++;
            if (row.status === 'passed') { strategySummary[row.strategy].passed++; totalPassed++; } else { strategySummary[row.strategy].failed++; totalFailed++; }
            strategySummary[row.strategy].rows.push(row);
          }

          if (request.stopOnFirstFailure && totalFailed > 0) break;
        }
      } else {
        // Sequential
        for (let idx = 0; idx < allRows.length; idx++) {
          if (runControl.cancelled) break;
          const entry = allRows[idx];

          const row = await this.executeSingleRow(
            pipelineRunId, request.scriptId, request.userId,
            parameterizedCode, fieldBindings, entry.data, idx, entry.strategy, browser,
          );

          strategySummary[row.strategy].total++;
          if (row.status === 'passed') { strategySummary[row.strategy].passed++; totalPassed++; } else { strategySummary[row.strategy].failed++; totalFailed++; }
          strategySummary[row.strategy].rows.push(row);

          // Update progress
          await pool.query(
            `UPDATE "DataDrivenRun" SET "completedRows" = $2, "passedRows" = $3, "failedRows" = $4, "updatedAt" = now() WHERE id = $1`,
            [pipelineRunId, totalPassed + totalFailed, totalPassed, totalFailed],
          );

          if (request.stopOnFirstFailure && totalFailed > 0) break;
        }
      }

      // ── Step 5 – Aggregate & Report ──────────────────────────────────────
      logger.info(`Pipeline ${pipelineRunId}: Step 5 – Aggregating results`);
      const aggregateReportUrl = await this.generatePipelineReport(pipelineRunId, script.name, strategySummary, strategies);

      const duration = Date.now() - startTime;
      const finalStatus = runControl.cancelled
        ? 'cancelled'
        : totalFailed === 0 ? 'passed' : totalPassed === 0 ? 'failed' : 'partial';

      await pool.query(
        `UPDATE "DataDrivenRun"
         SET status = $2, "completedRows" = $3, "passedRows" = $4, "failedRows" = $5,
             duration = $6, "completedAt" = now(), "aggregateReportUrl" = $7, "updatedAt" = now()
         WHERE id = $1`,
        [pipelineRunId, finalStatus, totalPassed + totalFailed, totalPassed, totalFailed, duration, aggregateReportUrl || null],
      );

      logger.info(`Pipeline ${pipelineRunId}: Completed — status=${finalStatus}, passed=${totalPassed}, failed=${totalFailed}, duration=${duration}ms`);

      return {
        pipelineRunId,
        scriptId: request.scriptId,
        status: finalStatus as PipelineResult['status'],
        fields,
        parameterizedCode,
        strategies,
        strategySummary,
        totalRows: allRows.length,
        passedRows: totalPassed,
        failedRows: totalFailed,
        duration,
        aggregateReportUrl,
      };

    } catch (error: any) {
      logger.error(`Pipeline ${pipelineRunId}: Fatal error — ${error.message}`);
      await pool.query(
        `UPDATE "DataDrivenRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
        [pipelineRunId, error.message],
      ).catch(() => {});
      throw error;
    } finally {
      this.activeRuns.delete(pipelineRunId);
    }
  }

  /** Cancel a running pipeline */
  cancelPipeline(pipelineRunId: string) {
    const ctrl = this.activeRuns.get(pipelineRunId);
    if (ctrl) ctrl.cancelled = true;
  }

  isRunning(pipelineRunId: string): boolean {
    return this.activeRuns.has(pipelineRunId);
  }

  // =========================================================================
  // Step 1 – Analyze Script
  // =========================================================================

  analyzeScript(
    scriptCode: string,
    fieldHints?: PipelineRequest['fieldHints'],
  ): DetectedField[] {
    const fields: DetectedField[] = [];
    const seen = new Set<string>();
    const lines = scriptCode.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // ── getByLabel('Label').fill('value') ──
      const byLabelFill = /getByLabel\(\s*['"]([^'"]+)['"]\s*\)\.fill\(\s*['"]([^'"]*)['"]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = byLabelFill.exec(line))) {
        const key = `label:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ fieldName: m[1], fieldType: inferFieldType(m[1]), action: 'fill', hardcodedValue: m[2], line: lineIdx + 1 }); }
      }

      // ── getByPlaceholder('…').fill('value') ──
      const byPlaceholder = /getByPlaceholder\(\s*['"]([^'"]+)['"]\s*\)\.fill\(\s*['"]([^'"]*)['"]\s*\)/g;
      while ((m = byPlaceholder.exec(line))) {
        const key = `placeholder:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ fieldName: m[1], fieldType: inferFieldType(m[1]), action: 'fill', hardcodedValue: m[2], line: lineIdx + 1 }); }
      }

      // ── getByRole('textbox', { name: '…' }).fill('value') ──
      const byRole = /getByRole\(\s*['"]textbox['"]\s*,\s*\{[^}]*name:\s*['"]([^'"]+)['"]\s*[^}]*\}\s*\)\.fill\(\s*['"]([^'"]*)['"]\s*\)/g;
      while ((m = byRole.exec(line))) {
        const key = `role:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ fieldName: m[1], fieldType: inferFieldType(m[1]), action: 'fill', hardcodedValue: m[2], line: lineIdx + 1 }); }
      }

      // ── page.fill('selector', 'value') ──
      const pageFill = /page\.fill\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g;
      while ((m = pageFill.exec(line))) {
        const key = `selector:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ selector: m[1], fieldType: inferFieldType(m[1]), action: 'fill', hardcodedValue: m[2], line: lineIdx + 1 }); }
      }

      // ── locator('selector').fill('value') ──
      const locatorFill = /locator\(\s*['"]([^'"]+)['"]\s*\)\.fill\(\s*['"]([^'"]*)['"]\s*\)/g;
      while ((m = locatorFill.exec(line))) {
        const key = `locator:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ selector: m[1], fieldType: inferFieldType(m[1]), action: 'fill', hardcodedValue: m[2], line: lineIdx + 1 }); }
      }

      // ── page.type('selector', 'value') ──
      const pageType = /page\.type\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g;
      while ((m = pageType.exec(line))) {
        const key = `type:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ selector: m[1], fieldType: inferFieldType(m[1]), action: 'type', hardcodedValue: m[2], line: lineIdx + 1 }); }
      }

      // ── selectOption ──
      const selectOpt = /(?:page\.selectOption|\.selectOption)\(\s*['"]([^'"]+)['"]\s*,/g;
      while ((m = selectOpt.exec(line))) {
        const key = `select:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ selector: m[1], fieldType: 'select', action: 'selectOption', line: lineIdx + 1 }); }
      }

      // ── check/uncheck ──
      const check = /(?:page\.check|\.check)\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = check.exec(line))) {
        const key = `check:${m[1]}`;
        if (!seen.has(key)) { seen.add(key); fields.push({ selector: m[1], fieldType: 'checkbox', action: 'check', line: lineIdx + 1 }); }
      }
    }

    // Apply optional fieldHints overrides
    if (fieldHints?.length) {
      for (const field of fields) {
        const hint = fieldHints.find(h =>
          (h.fieldName && field.fieldName?.toLowerCase().includes(h.fieldName.toLowerCase())) ||
          (h.selector && field.selector === h.selector),
        );
        if (hint?.fieldType) {
          field.fieldType = hint.fieldType;
        }
      }
    }

    return fields;
  }

  // =========================================================================
  // Step 2 – Generate Test Data
  // =========================================================================

  generateDatasets(
    fields: DetectedField[],
    strategies: DataStrategy[],
    countPerStrategy: number,
  ): Record<DataStrategy, Record<string, any>[]> {
    const datasets: Record<DataStrategy, Record<string, any>[]> = {
      positive: [],
      negative: [],
      boundary: [],
      equivalence: [],
      security: [],
    };

    for (const strategy of strategies) {
      const rows: Record<string, any>[] = [];

      for (let i = 0; i < countPerStrategy; i++) {
        const row: Record<string, any> = {};
        for (const field of fields) {
          const name = this.fieldKey(field);
          row[name] = generateValueForField(field, strategy, i);
        }
        rows.push(row);
      }

      datasets[strategy] = rows;
    }

    return datasets;
  }

  // =========================================================================
  // Step 3 – Auto-Parameterize
  // =========================================================================

  /**
   * Replaces hardcoded fill/type values in the script with {{placeholder}}
   * tokens and returns the parameterized code + the field binding map.
   */
  autoParameterize(
    scriptCode: string,
    fields: DetectedField[],
  ): { parameterizedCode: string; fieldBindings: Record<string, string> } {
    let code = scriptCode;
    const fieldBindings: Record<string, string> = {};

    for (const field of fields) {
      if (!field.hardcodedValue && field.hardcodedValue !== '') continue;
      const key = this.fieldKey(field);
      const placeholder = `{{${key}}}`;
      fieldBindings[key] = key; // identity mapping — placeholder name equals data column name

      // Escape the hardcoded value for safe regex replacement
      const escaped = escapeRegex(field.hardcodedValue!);

      // Replace the first occurrence of the hardcoded value inside a fill/type call
      // We target the pattern  .fill('hardcoded')  or  .type('hardcoded')
      const pattern = new RegExp(
        `((?:fill|type)\\(\\s*(?:['"][^'"]*['"]\\s*,\\s*)?)(['"])${escaped}\\2`,
      );
      code = code.replace(pattern, `$1$2${placeholder}$2`);
    }

    return { parameterizedCode: code, fieldBindings };
  }

  /** Fallback: build bindings from existing {{placeholder}} tokens */
  private buildDefaultBindings(fields: DetectedField[]): Record<string, string> {
    const bindings: Record<string, string> = {};
    for (const f of fields) {
      const key = this.fieldKey(f);
      bindings[key] = key;
    }
    return bindings;
  }

  // =========================================================================
  // Step 4 – Execute Single Row
  // =========================================================================

  private async executeSingleRow(
    pipelineRunId: string,
    scriptId: string,
    userId: string,
    parameterizedCode: string,
    fieldBindings: Record<string, string>,
    dataRow: Record<string, any>,
    rowIndex: number,
    strategy: DataStrategy,
    browser: string,
  ): Promise<RowResult> {
    const testRunId = randomUUID();
    const startTime = Date.now();

    try {
      // Substitute placeholders
      let code = parameterizedCode;
      for (const [placeholder, dataField] of Object.entries(fieldBindings)) {
        const value = dataRow[dataField];
        if (value === undefined || value === null) continue;
        const pattern = new RegExp(`\\{\\{${escapeRegex(placeholder)}\\}\\}`, 'g');
        code = code.replace(pattern, String(value));
      }

      // Create a TestRun record linked to the pipeline
      await pool.query(
        `INSERT INTO "TestRun" (id, "scriptId", "userId", status, "startedAt", "dataDrivenRunId", "dataRowIndex", "dataRowValues", browser)
         VALUES ($1, $2, $3, 'running', now(), $4, $5, $6, $7)`,
        [testRunId, scriptId, userId, pipelineRunId, rowIndex, JSON.stringify({ ...dataRow, _strategy: strategy }), browser],
      );

      logger.info(`Pipeline ${pipelineRunId} Row ${rowIndex} [${strategy}]: Executing`);

      // Execute in-memory using TestRunnerService's internal method.
      // We create a lightweight temp script, run, then clean up.
      const tempScriptId = `pipeline-${randomUUID()}`;
      await pool.query(
        `INSERT INTO "Script" (id, name, description, language, code, "userId", "browserType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'typescript', $4, $5, $6, now(), now())`,
        [tempScriptId, `Pipeline Row ${rowIndex + 1} [${strategy}]`, `Auto-generated by pipeline ${pipelineRunId}`, code, userId, browser],
      );

      await pool.query(`UPDATE "TestRun" SET "scriptId" = $2 WHERE id = $1`, [testRunId, tempScriptId]);

      await testRunnerService.startTestRun(testRunId, tempScriptId, userId, undefined, browser);

      // Read final status
      const { rows } = await pool.query(`SELECT status, duration FROM "TestRun" WHERE id = $1`, [testRunId]);
      const finalStatus = rows[0]?.status || 'failed';
      const duration = rows[0]?.duration || (Date.now() - startTime);

      // Cleanup temp script (delayed)
      setTimeout(async () => {
        await pool.query(`DELETE FROM "Script" WHERE id = $1`, [tempScriptId]).catch(() => {});
      }, 15_000);

      return { rowIndex, strategy, dataValues: dataRow, testRunId, status: finalStatus, duration };

    } catch (error: any) {
      logger.error(`Pipeline ${pipelineRunId} Row ${rowIndex} [${strategy}]: ${error.message}`);

      await pool.query(
        `UPDATE "TestRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now() WHERE id = $1`,
        [testRunId, error.message],
      ).catch(() => {});

      return { rowIndex, strategy, dataValues: dataRow, testRunId, status: 'failed', error: error.message, duration: Date.now() - startTime };
    }
  }

  // =========================================================================
  // Step 5 – Aggregate & Report
  // =========================================================================

  private async generatePipelineReport(
    pipelineRunId: string,
    scriptName: string,
    strategySummary: PipelineResult['strategySummary'],
    strategies: DataStrategy[],
  ): Promise<string> {
    try {
      const steps: Array<{ action: string; status: string; duration: number }> = [];

      for (const strategy of strategies) {
        const summary = strategySummary[strategy];
        if (!summary) continue;

        // Strategy-level step
        steps.push({
          action: `Strategy: ${strategy} — ${summary.passed}/${summary.total} passed`,
          status: summary.failed === 0 ? 'passed' : 'failed',
          duration: summary.rows.reduce((sum, r) => sum + (r.duration ?? 0), 0),
        });

        // Individual row results
        for (const row of summary.rows) {
          steps.push({
            action: `[${strategy}] Row ${row.rowIndex + 1}: ${JSON.stringify(row.dataValues).substring(0, 80)}`,
            status: row.status === 'passed' ? 'passed' : 'failed',
            duration: row.duration ?? 0,
          });
        }
      }

      const allPassed = strategies.every(s => (strategySummary[s]?.failed ?? 0) === 0);
      return await playwrightCrxService.generateTestRunReport(
        pipelineRunId, `Data-Driven Pipeline: ${scriptName}`, steps, allPassed ? 'passed' : 'failed'
      );
    } catch (e: any) {
      logger.error(`Pipeline report generation failed: ${e.message}`);
      return '';
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Derive a stable key/placeholder name for a field */
  private fieldKey(field: DetectedField): string {
    if (field.fieldName) {
      return field.fieldName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    }
    if (field.selector) {
      // Extract meaningful part from selector like '#email' or '[name="email"]'
      const nameMatch = field.selector.match(/(?:name|id|data-testid)=["']?([^"'\]]+)/);
      if (nameMatch) return nameMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, '_');
      return field.selector.replace(/[^a-z0-9]+/gi, '_').toLowerCase().substring(0, 30);
    }
    return `field_${field.line}`;
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

function inferFieldType(nameOrSelector: string): string {
  const s = (nameOrSelector || '').toLowerCase();
  if (/email/.test(s)) return 'email';
  if (/pass|password/.test(s)) return 'password';
  if (/phone|mobile|tel/.test(s)) return 'tel';
  if (/url|website|link/.test(s)) return 'url';
  if (/date|dob|birth/.test(s)) return 'date';
  if (/amount|age|price|count|number|qty|quantity/.test(s)) return 'number';
  if (/name|first|last|user/.test(s)) return 'name';
  if (/zip|postal/.test(s)) return 'zip';
  if (/city|state|country|address/.test(s)) return 'address';
  return 'text';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate a single value for a field given a strategy and row index.
 */
function generateValueForField(field: DetectedField, strategy: DataStrategy, index: number): any {
  const t = field.fieldType;

  // ── Positive ─────────────────────────────────────────────────────────────
  if (strategy === 'positive') {
    const positivePool: Record<string, string[]> = {
      email: ['user@example.com', 'john.doe@company.org', 'jane.smith@mail.com', 'admin@test.net', 'support@acme.io'],
      password: ['Password123!', 'Str0ngP@ss!', 'Test!ng456#', 'SecureVal!d1', 'MyP@ssw0rd!'],
      name: ['John Smith', 'Jane Doe', 'Michael Brown', 'Sarah Wilson', 'David Garcia'],
      tel: ['1234567890', '9876543210', '5551234567', '8005551234', '2125551234'],
      url: ['https://example.com', 'https://test.org', 'https://www.company.com', 'https://app.io', 'https://portal.net'],
      date: ['2025-01-15', '2024-06-30', '2025-12-01', '2024-03-20', '2025-08-10'],
      number: ['25', '100', '42', '7', '250'],
      zip: ['10001', '90210', '60601', '30301', '85001'],
      address: ['123 Main St', '456 Oak Ave', '789 Pine Blvd', '321 Elm Dr', '654 Maple Rd'],
      text: ['Hello World', 'Test Value', 'Sample Input', 'Valid Text', 'Example Data'],
      select: ['option1', 'option2', 'option3', 'option4', 'option5'],
      checkbox: ['true', 'true', 'false', 'true', 'false'],
    };
    const pool = positivePool[t] || positivePool.text;
    return pool[index % pool.length];
  }

  // ── Negative ─────────────────────────────────────────────────────────────
  if (strategy === 'negative') {
    const negativePool: Record<string, string[]> = {
      email: ['invalid-email', '@missing-user.com', 'user@', 'user@.com', 'user name@test.com'],
      password: ['123', 'password', 'short', '', 'nouppercase1!'],
      name: ['', '   ', '12345', '@#$%^', 'A'],
      tel: ['abc', '12345', '', 'not-a-phone', '12345678901234567890123'],
      url: ['not-a-url', 'http://', 'ftp://invalid', '', 'www.no-protocol.com'],
      date: ['2025-13-01', 'not-a-date', '99/99/9999', '', '0000-00-00'],
      number: ['NaN', 'abc', '-99999999', '', '1.2.3'],
      zip: ['ABCDE', '1', '12345678901', '', '!@#$%'],
      address: ['', '   ', '@#$%^&*()', 'A', '!'],
      text: ['', '   ', '\x00', '<>', '!@#$%^&*()'],
      select: ['', 'nonexistent_option', '   ', '<script>', 'null'],
      checkbox: ['', 'invalid', 'null', 'undefined', '2'],
    };
    const pool = negativePool[t] || negativePool.text;
    return pool[index % pool.length];
  }

  // ── Boundary ─────────────────────────────────────────────────────────────
  if (strategy === 'boundary') {
    const boundaryPool: Record<string, string[]> = {
      email: ['a@b.c', `${'a'.repeat(64)}@example.com`, 'u@x.co', 'test@test.t', `user@${'d'.repeat(63)}.com`],
      password: ['A1!', 'Aa1!5678', `${'A'.repeat(127)}1!`, 'Pa1!', `Pass${'1'.repeat(120)}!`],
      name: ['A', 'AB', `${'A'.repeat(100)}`, `${'B'.repeat(255)}`, 'Jo'],
      tel: ['0', '1234567890', '12345678901', '00000000000', '99999999999'],
      number: ['0', '1', '-1', '2147483647', '-2147483648'],
      text: ['a', 'ab', `${'x'.repeat(255)}`, `${'y'.repeat(256)}`, ''],
      zip: ['0', '00000', '99999', '100000', '1'],
      date: ['1900-01-01', '2099-12-31', '2000-02-29', '1970-01-01', '2038-01-19'],
      url: ['https://a.b', `https://example.com/${'p'.repeat(2000)}`, 'https://x.co', 'http://a.b.c.d.e.f', 'https://test.com/a'],
      address: ['A', `${'1'.repeat(200)} Main St`, '1 A', 'Suite 1, 123 Main St, Apt 456, Floor 7', '0 Street'],
      select: ['', 'first', 'last', 'middle', 'default'],
      checkbox: ['true', 'false', 'true', 'false', 'true'],
    };
    const pool = boundaryPool[t] || boundaryPool.text;
    return pool[index % pool.length];
  }

  // ── Equivalence ──────────────────────────────────────────────────────────
  if (strategy === 'equivalence') {
    const eqPool: Record<string, string[]> = {
      email: ['valid@example.com', 'test.user+tag@domain.co.uk', 'UPPER@CASE.COM', 'user123@test.org', 'a@b.io'],
      password: ['ValidPass1!', 'Another$ecure2', 'ALLCAPS123!', 'alllower123!', 'MixCase1@'],
      name: ['John', 'Jane Marie', 'O\'Connor', 'Mary-Jane', 'José García'],
      tel: ['1234567890', '(123) 456-7890', '+1-234-567-8901', '123.456.7890', '1 234 567 8901'],
      number: ['-100', '0', '50', '999', '1000000'],
      text: ['lowercase', 'UPPERCASE', 'MixedCase', 'with spaces', 'with-dashes'],
      date: ['2025-01-01', '2024-12-31', '2000-06-15', '1990-01-01', '2030-12-31'],
      url: ['https://example.com', 'http://example.com', 'https://sub.domain.example.com', 'https://example.com/path?q=1', 'https://example.com:8080'],
      zip: ['10001', '90210', '00501', '99950', '12345'],
      address: ['123 Main St', 'Apt 4, 567 Oak Ave', 'P.O. Box 123', '1/2 Elm Street', 'Suite 200, 890 Pine Blvd'],
      select: ['option1', 'option2', 'option3', 'option1', 'option2'],
      checkbox: ['true', 'false', 'true', 'false', 'true'],
    };
    const pool = eqPool[t] || eqPool.text;
    return pool[index % pool.length];
  }

  // ── Security ─────────────────────────────────────────────────────────────
  if (strategy === 'security') {
    const secPool: Record<string, string[]> = {
      default: [
        "' OR '1'='1",
        '<script>alert("XSS")</script>',
        '"; DROP TABLE users; --',
        '../../../etc/passwd',
        '{{7*7}}',
        '${7*7}',
        '%00%0d%0aInjected-Header: value',
        '<img src=x onerror=alert(1)>',
        'admin\' --',
        '\'; EXEC xp_cmdshell(\'dir\'); --',
      ],
    };
    const pool = secPool.default;
    return pool[index % pool.length];
  }

  return `value_${index}`;
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
export const dataDrivenPipelineService = new DataDrivenPipelineService();
