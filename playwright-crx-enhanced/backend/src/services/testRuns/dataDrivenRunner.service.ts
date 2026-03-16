import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import pool from '../../db';
import { testRunnerService } from './testRunner.service';
import { playwrightCrxService } from '../allure.service';

interface DataDrivenRunRecord {
  id: string;
  scriptId: string;
  testSuiteId: string | null;
  userId: string;
  organizationId: string | null;
  name: string | null;
  status: string;
  totalRows: number;
  completedRows: number;
  passedRows: number;
  failedRows: number;
  fieldBindings: Record<string, string>;
  dataRows: Record<string, any>[];
  executionConfig: {
    stopOnFirstFailure?: boolean;
    delayBetweenRows?: number;
    maxParallel?: number;
  };
  browser: string;
  executionMode: string;
}

interface RowResult {
  testRunId: string;
  status: string;
  rowIndex: number;
}

export class DataDrivenRunnerService {
  private activeRuns: Map<string, { cancelled: boolean }> = new Map();

  /**
   * Execute a full data-driven run.
   * Iterates over data rows, substitutes placeholders, and delegates to TestRunnerService.
   */
  async executeRun(dataDrivenRunId: string): Promise<void> {
    const runControl = { cancelled: false };
    this.activeRuns.set(dataDrivenRunId, runControl);

    try {
      // 1. Load DataDrivenRun record
      const { rows } = await pool.query(
        `SELECT * FROM "DataDrivenRun" WHERE id = $1`,
        [dataDrivenRunId]
      );
      const run = rows[0] as DataDrivenRunRecord;
      if (!run) throw new Error('DataDrivenRun not found');

      // 2. Load the script code
      const { rows: scriptRows } = await pool.query(
        `SELECT code, name, "browserType" FROM "Script" WHERE id = $1`,
        [run.scriptId]
      );
      const script = scriptRows[0];
      if (!script) throw new Error('Script not found');

      const dataRows = run.dataRows;
      const fieldBindings = run.fieldBindings;
      const config = run.executionConfig || {};
      const browser = run.browser || script.browserType || 'chromium';

      // 3. Update status to running
      await pool.query(
        `UPDATE "DataDrivenRun" SET status = 'running', "startedAt" = now(), "totalRows" = $2 WHERE id = $1`,
        [dataDrivenRunId, dataRows.length]
      );

      logger.info(`DDR ${dataDrivenRunId}: Starting data-driven run with ${dataRows.length} rows`);

      const startTime = Date.now();
      let completedRows = 0;
      let passedRows = 0;
      let failedRows = 0;

      // 4. Execute rows
      if (run.executionMode === 'parallel') {
        const maxParallel = Math.min(config.maxParallel || 3, 5);

        for (let i = 0; i < dataRows.length; i += maxParallel) {
          if (runControl.cancelled) break;

          const batch = dataRows.slice(i, i + maxParallel);
          const results = await Promise.allSettled(
            batch.map((row, batchIdx) => {
              const rowIndex = i + batchIdx;
              const modifiedCode = this.substituteDataRow(script.code, fieldBindings, row);
              return this.executeRow(
                dataDrivenRunId, run.scriptId, run.userId,
                modifiedCode, rowIndex, row, browser
              );
            })
          );

          for (const result of results) {
            completedRows++;
            if (result.status === 'fulfilled' && result.value.status === 'passed') {
              passedRows++;
            } else {
              failedRows++;
            }

            await this.updateProgress(dataDrivenRunId, completedRows, passedRows, failedRows, dataRows.length);

            if (config.stopOnFirstFailure && failedRows > 0) break;
          }

          if (config.stopOnFirstFailure && failedRows > 0) break;
        }
      } else {
        // Sequential execution (default)
        for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
          if (runControl.cancelled) break;

          const row = dataRows[rowIndex];
          const modifiedCode = this.substituteDataRow(script.code, fieldBindings, row);

          logger.info(`DDR ${dataDrivenRunId}: Executing row ${rowIndex + 1}/${dataRows.length}`);

          const result = await this.executeRow(
            dataDrivenRunId, run.scriptId, run.userId,
            modifiedCode, rowIndex, row, browser
          );

          completedRows++;
          if (result.status === 'passed') {
            passedRows++;
          } else {
            failedRows++;
          }

          await this.updateProgress(dataDrivenRunId, completedRows, passedRows, failedRows, dataRows.length);

          if (config.stopOnFirstFailure && failedRows > 0) {
            logger.info(`DDR ${dataDrivenRunId}: Stopping on first failure at row ${rowIndex + 1}`);
            break;
          }

          // Optional delay between rows
          if (config.delayBetweenRows && rowIndex < dataRows.length - 1) {
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenRows));
          }
        }
      }

      // 5. Finalize
      const duration = Date.now() - startTime;
      const finalStatus = runControl.cancelled
        ? 'cancelled'
        : failedRows === 0
          ? 'passed'
          : passedRows === 0
            ? 'failed'
            : 'partial';

      // 6. Generate aggregate report
      let aggregateReportUrl = '';
      try {
        aggregateReportUrl = await this.generateAggregateReport(dataDrivenRunId, script.name);
      } catch (e: any) {
        logger.error('Failed to generate aggregate report:', e.message);
      }

      await pool.query(
        `UPDATE "DataDrivenRun"
         SET status = $2, "completedRows" = $3, "passedRows" = $4, "failedRows" = $5,
             duration = $6, "completedAt" = now(), "aggregateReportUrl" = $7, "updatedAt" = now()
         WHERE id = $1`,
        [dataDrivenRunId, finalStatus, completedRows, passedRows, failedRows, duration, aggregateReportUrl || null]
      );

      logger.info(`DDR ${dataDrivenRunId}: Completed with status=${finalStatus}, passed=${passedRows}, failed=${failedRows}, duration=${duration}ms`);

    } catch (error: any) {
      logger.error(`DDR ${dataDrivenRunId}: Fatal error:`, error.message);

      await pool.query(
        `UPDATE "DataDrivenRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
        [dataDrivenRunId, error.message]
      ).catch(() => {});
    } finally {
      this.activeRuns.delete(dataDrivenRunId);
    }
  }

  /**
   * Replace {{placeholder}} patterns in script code with data row values.
   */
  substituteDataRow(
    scriptCode: string,
    fieldBindings: Record<string, string>,
    dataRow: Record<string, any>
  ): string {
    let result = scriptCode;

    for (const [placeholder, dataField] of Object.entries(fieldBindings)) {
      const value = dataRow[dataField];
      if (value === undefined || value === null) continue;

      const stringValue = String(value);

      // Replace {{placeholder}} patterns
      const pattern = new RegExp(
        `\\{\\{${this.escapeRegex(placeholder)}\\}\\}`,
        'g'
      );
      result = result.replace(pattern, stringValue);
    }

    return result;
  }

  /**
   * Execute a single data row iteration.
   * Creates a child TestRun and delegates to the existing TestRunnerService.
   */
  private async executeRow(
    dataDrivenRunId: string,
    originalScriptId: string,
    userId: string,
    modifiedCode: string,
    rowIndex: number,
    dataRow: Record<string, any>,
    browser: string
  ): Promise<RowResult> {
    const testRunId = randomUUID();

    try {
      // Create a child TestRun record linked to the DataDrivenRun
      await pool.query(
        `INSERT INTO "TestRun" (id, "scriptId", "userId", status, "startedAt", "dataDrivenRunId", "dataRowIndex", "dataRowValues", browser)
         VALUES ($1, $2, $3, 'queued', now(), $4, $5, $6, $7)`,
        [testRunId, originalScriptId, userId, dataDrivenRunId, rowIndex, JSON.stringify(dataRow), browser]
      );

      // Execute using the existing TestRunnerService
      // We need to temporarily store the modified code so the runner can use it
      // Override the script code by creating a temp script
      const tempScriptId = `ddr-temp-${randomUUID()}`;
      await pool.query(
        `INSERT INTO "Script" (id, name, description, language, code, "userId", "browserType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'typescript', $4, $5, $6, now(), now())`,
        [
          tempScriptId,
          `DDR Row ${rowIndex + 1} (temp)`,
          `Data-driven iteration ${rowIndex + 1} for DDR ${dataDrivenRunId}`,
          modifiedCode,
          userId,
          browser
        ]
      );

      // Update the TestRun to point to the temp script
      await pool.query(
        `UPDATE "TestRun" SET "scriptId" = $2 WHERE id = $1`,
        [testRunId, tempScriptId]
      );

      // Execute the test run
      await testRunnerService.startTestRun(testRunId, tempScriptId, userId, undefined, browser);

      // Read back the final status
      const { rows } = await pool.query(
        `SELECT status FROM "TestRun" WHERE id = $1`,
        [testRunId]
      );
      const finalStatus = rows[0]?.status || 'failed';

      // Cleanup temp script (delayed to allow report generation)
      setTimeout(async () => {
        try {
          await pool.query(`DELETE FROM "Script" WHERE id = $1`, [tempScriptId]);
        } catch (e) {
          // Ignore cleanup errors
        }
      }, 15000);

      return { testRunId, status: finalStatus, rowIndex };

    } catch (error: any) {
      logger.error(`DDR Row ${rowIndex} execution error:`, error.message);

      // Ensure the TestRun is marked as failed
      await pool.query(
        `UPDATE "TestRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now() WHERE id = $1`,
        [testRunId, error.message]
      ).catch(() => {});

      return { testRunId, status: 'failed', rowIndex };
    }
  }

  /**
   * Stop a running data-driven run.
   */
  async stopRun(dataDrivenRunId: string): Promise<void> {
    const runControl = this.activeRuns.get(dataDrivenRunId);
    if (runControl) {
      runControl.cancelled = true;
    }

    // Cancel any active child test runs
    const { rows: activeChildren } = await pool.query(
      `SELECT id FROM "TestRun" WHERE "dataDrivenRunId" = $1 AND status IN ('running', 'queued')`,
      [dataDrivenRunId]
    );

    for (const child of activeChildren) {
      try {
        await testRunnerService.stopTestRun(child.id);
      } catch (e) {
        // Best effort
      }
      await pool.query(
        `UPDATE "TestRun" SET status = 'cancelled', "completedAt" = now() WHERE id = $1`,
        [child.id]
      );
    }

    await pool.query(
      `UPDATE "DataDrivenRun" SET status = 'cancelled', "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
      [dataDrivenRunId]
    );

    logger.info(`DDR ${dataDrivenRunId}: Run cancelled`);
  }

  /**
   * Extract {{placeholder}} patterns from script code.
   */
  extractPlaceholders(scriptCode: string): { name: string; line: number; context: string }[] {
    const placeholders: { name: string; line: number; context: string }[] = [];
    const seen = new Set<string>();
    const lines = scriptCode.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const matches = lineText.matchAll(/\{\{(\w+)\}\}/g);

      for (const match of matches) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          placeholders.push({
            name,
            line: i + 1,
            context: lineText.trim().substring(0, 80)
          });
        }
      }
    }

    return placeholders;
  }

  /**
   * Update progress counters on the parent DataDrivenRun.
   */
  private async updateProgress(
    dataDrivenRunId: string,
    completedRows: number,
    passedRows: number,
    failedRows: number,
    totalRows: number
  ): Promise<void> {
    await pool.query(
      `UPDATE "DataDrivenRun" SET "completedRows" = $2, "passedRows" = $3, "failedRows" = $4, "updatedAt" = now() WHERE id = $1`,
      [dataDrivenRunId, completedRows, passedRows, failedRows]
    );

    logger.info(`DDR ${dataDrivenRunId}: Progress ${completedRows}/${totalRows} (passed=${passedRows}, failed=${failedRows})`);
  }

  /**
   * Generate an aggregated Allure report across all child runs.
   */
  private async generateAggregateReport(dataDrivenRunId: string, scriptName: string): Promise<string> {
    // Load all child test runs
    const { rows: childRuns } = await pool.query(
      `SELECT id, status, duration, "dataRowIndex", "dataRowValues" FROM "TestRun"
       WHERE "dataDrivenRunId" = $1 ORDER BY "dataRowIndex"`,
      [dataDrivenRunId]
    );

    if (childRuns.length === 0) return '';

    // Start a parent test case in Allure
    await playwrightCrxService.startTest(dataDrivenRunId, `Data-Driven: ${scriptName}`);

    // Record each row as a step
    for (const childRun of childRuns) {
      const rowLabel = `Row ${(childRun.dataRowIndex ?? 0) + 1}`;
      const dataVals = childRun.dataRowValues
        ? JSON.stringify(childRun.dataRowValues).substring(0, 100)
        : 'N/A';

      await playwrightCrxService.recordStep(
        dataDrivenRunId,
        `${rowLabel}: ${dataVals}`,
        childRun.status === 'passed' ? 'passed' : 'failed',
        childRun.duration || 0
      );
    }

    // End the parent test
    const overallPassed = childRuns.every((r: any) => r.status === 'passed');
    await playwrightCrxService.endTest(dataDrivenRunId, overallPassed ? 'passed' : 'failed');

    // Generate the report
    await playwrightCrxService.generateReport(dataDrivenRunId);
    return await playwrightCrxService.getReportUrl(dataDrivenRunId);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  isRunning(dataDrivenRunId: string): boolean {
    return this.activeRuns.has(dataDrivenRunId);
  }
}

export const dataDrivenRunnerService = new DataDrivenRunnerService();
