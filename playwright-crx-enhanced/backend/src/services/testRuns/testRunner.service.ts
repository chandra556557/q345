import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger';
import pool from '../../db';
import { chromium, firefox, webkit, Browser, Page } from 'playwright-core';
import { playwrightCrxService } from '../allure.service';

interface TestRunContext {
  testRunId: string;
  scriptId: string;
  userId: string;
  ws?: WebSocketServer;
  browser?: Browser;
  page?: Page;
}

/**
 * Execute a Playwright test script
 */
export class TestRunnerService {
  private activeRuns: Map<string, TestRunContext> = new Map();

  async startTestRun(testRunId: string, scriptId: string, userId: string, ws?: WebSocketServer, browserType: string = 'firefox'): Promise<void> {
    let context: TestRunContext | undefined;
    
    try {
      context = { testRunId, scriptId, userId, ws };
      this.activeRuns.set(testRunId, context);

      await pool.query(`UPDATE "TestRun" SET status = 'running', "startedAt" = now() WHERE id = $1`, [testRunId]);

      if (ws) {
        this.sendWebSocketMessage(ws, { type: 'TEST_STARTED', testRunId, scriptId, timestamp: Date.now() });
      }

      const { rows: scriptRows } = await pool.query(
        `SELECT code, language, name, "browserType" FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      const script = scriptRows[0];
      if (!script) throw new Error('Script not found');

      // Use browserType from request parameter, then from script, then default to firefox
      const effectiveBrowserType = browserType || script.browserType || 'firefox';

      // Start Allure test tracking
      await playwrightCrxService.startTest(testRunId, script.name);
      logger.info('📊 Allure test tracking started');

      const startTime = Date.now();
      
      // Execute script with Playwright
      await this.executeScriptWithPlaywright(context, script.code, effectiveBrowserType);
      
      const duration = Date.now() - startTime;

      // End Allure test as passed
      await playwrightCrxService.endTest(testRunId, 'passed');
      logger.info('📊 Allure test marked as passed');

      // Generate Allure report
      await playwrightCrxService.generateReport(testRunId);
      const reportUrl = await playwrightCrxService.getReportUrl(testRunId);
      logger.info('📊 Allure report generated:', reportUrl);

      await pool.query(
        `UPDATE "TestRun" SET status = 'passed', "completedAt" = now(), duration = $2, "executionReportUrl" = $3 WHERE id = $1`,
        [testRunId, duration, reportUrl]
      );

      if (ws) {
        this.sendWebSocketMessage(ws, { type: 'TEST_COMPLETED', testRunId, status: 'passed', duration, timestamp: Date.now() });
      }

      this.activeRuns.delete(testRunId);
    } catch (error: any) {
      logger.error('Test execution failed:', error);

      const startTime = Date.now();
      const duration = context ? Date.now() - startTime : 0;

      // End Allure test as failed
      try {
        await playwrightCrxService.endTest(testRunId, 'failed', error.message);
        await playwrightCrxService.generateReport(testRunId);
        const reportUrl = await playwrightCrxService.getReportUrl(testRunId);
        logger.info('📊 Allure report generated for failed test:', reportUrl);

        await pool.query(
          `UPDATE "TestRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now(), duration = $3, "executionReportUrl" = $4 WHERE id = $1`,
          [testRunId, error.message, duration, reportUrl]
        );
      } catch (allureError: any) {
        logger.error('Failed to generate Allure report:', allureError.message);
        await pool.query(
          `UPDATE "TestRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now(), duration = $3 WHERE id = $1`,
          [testRunId, error.message, duration]
        );
      }

      if (ws) {
        this.sendWebSocketMessage(ws, { type: 'TEST_FAILED', testRunId, error: error.message, timestamp: Date.now() });
      }

      this.activeRuns.delete(testRunId);
    } finally {
      // Cleanup browser if we launched it
      const context = this.activeRuns.get(testRunId);
      if (context?.browser) {
        await context.browser.close().catch(() => {});
      }
    }
  }

  async stopTestRun(testRunId: string): Promise<void> {
    const context = this.activeRuns.get(testRunId);
    if (context) {
      await pool.query(
        `UPDATE "TestRun" SET status = 'cancelled', "completedAt" = now() WHERE id = $1`,
        [testRunId]
      );

      if (context.ws) {
        this.sendWebSocketMessage(context.ws, { type: 'TEST_STOPPED', testRunId, timestamp: Date.now() });
      }

      this.activeRuns.delete(testRunId);
    }
  }

  private async executeScriptWithPlaywright(context: TestRunContext, code: string, browserType: string = 'firefox'): Promise<void> {
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      logger.info('Starting server-side headless test execution');
      logger.info('Test Run ID:', context.testRunId);
      logger.info('Script ID:', context.scriptId);
      logger.info('Browser Type:', browserType);
      
      // Launch browser based on browserType
      logger.info(`Launching ${browserType} in headless mode`);
      try {
        // Select browser based on type
        let browserLauncher;
        switch(browserType.toLowerCase()) {
          case 'chromium':
          case 'chrome':
            browserLauncher = chromium;
            break;
          case 'webkit':
            browserLauncher = webkit;
            break;
          case 'firefox':
          default:
            browserLauncher = firefox;
            break;
        }

        const launchOptions: any = {
          headless: true,
          args: [
            '--no-remote',
            '--foreground',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ]
        };
        // Use installed Chrome instead of bundled Chromium
        if (browserLauncher === chromium) {
          launchOptions.channel = 'chrome';
        }
        browser = await browserLauncher.launch(launchOptions);
        logger.info(`✅ ${browserType} browser launched successfully`);
      } catch (browserError: any) {
        logger.error(`${browserType} launch failed:`, browserError.message);
        logger.error('Full error:', browserError);
        throw new Error(`${browserType} browser launch failed: ${browserError.message}`);
      }

      // Create new context and page
      logger.info('Creating browser context and page...');
      const browserContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      page = await browserContext.newPage();
      logger.info('✅ Browser context and page created successfully');

      context.browser = browser;
      context.page = page;

      // Execute the actual script
      logger.info('Executing Playwright script...');
      logger.info('Script code length:', code.length, 'characters');
      await this.executePlaywrightCode(context, page, code);
      
      logger.info('✅ Script execution completed successfully');

    } catch (error: any) {
      logger.error('Error during Playwright execution:', error.message);
      logger.error('Error stack:', error.stack);
      throw error;
    }
  }

  private async executePlaywrightCode(context: TestRunContext, page: Page, code: string): Promise<void> {
    // Parse and execute Playwright commands from the code
    const lines = code.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')); 

    let stepNumber = 1;

    for (const line of lines) {
      try {
        let action = 'unknown';
        let selector = '';
        let value = '';

        // Parse and execute different Playwright commands
        if (line.includes('page.goto(')) {
          action = 'navigate';
          const url = this.extractParameter(line, 'page.goto(') || '';
          selector = url;
          
          logger.info(`Step ${stepNumber}: Navigate to ${url}`);
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            logger.info(`✅ Step ${stepNumber}: Navigation successful`);
          } catch (navError: any) {
            logger.error(`❌ Step ${stepNumber}: Navigation failed -`, navError.message);
            throw navError;
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('page.click(')) {
          action = 'click';
          selector = this.extractParameter(line, 'page.click(') || '';
          
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.click(selector);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('page.fill(')) {
          action = 'fill';
          const params = this.extractParameters(line, 'page.fill(');
          selector = params[0] || '';
          value = params[1] || '';
          
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.fill(selector, value);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('page.press(')) {
          action = 'press';
          const params = this.extractParameters(line, 'page.press(');
          selector = params[0] || '';
          value = params[1] || '';
          
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.press(selector, value);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('page.waitForSelector(')) {
          action = 'wait';
          selector = this.extractParameter(line, 'page.waitForSelector(') || '';
          
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.waitForSelector(selector, { timeout: 30000 });
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('expect(') && line.includes('toBeVisible')) {
          action = 'assert_visible';
          selector = this.extractExpectSelector(line);
          
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          const element = page.locator(selector);
          await element.waitFor({ state: 'visible', timeout: 10000 });
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('expect(') && line.includes('toHaveText')) {
          action = 'assert_text';
          selector = this.extractExpectSelector(line);
          const expectedText = this.extractExpectedText(line);
          value = expectedText;
          
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          const element = page.locator(selector);
          await element.waitFor({ state: 'visible' });
          const actualText = await element.textContent();
          if (!actualText?.includes(expectedText)) {
            throw new Error(`Expected text "${expectedText}" not found. Actual: "${actualText}"`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
        } else {
          // Skip unrecognized lines (imports, comments, etc.)
          continue;
        }

        stepNumber++;
        
        // Small delay between steps for visibility
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (stepError: any) {
        logger.error(`Step ${stepNumber} failed:`, stepError.message);
        await this.recordStep(context, stepNumber, 'unknown', '', '', 'failed', stepError.message);
        throw stepError;
      }
    }
  }

  private async recordStep(
    context: TestRunContext, 
    stepNumber: number, 
    action: string, 
    selector: string, 
    value: string, 
    status: 'running' | 'passed' | 'failed',
    errorMsg?: string
  ): Promise<void> {
    const stepId = `${context.testRunId}-${stepNumber}`;
    
    try {
      // Check if step exists
      const { rows } = await pool.query(
        `SELECT id FROM "TestStep" WHERE id = $1`,
        [stepId]
      );

      if (rows.length > 0) {
        // Update existing step
        await pool.query(
          `UPDATE "TestStep" 
           SET status = $2, "errorMsg" = $3, duration = 300 
           WHERE id = $1`,
          [stepId, status, errorMsg || null]
        );
      } else {
        // Insert new step
        await pool.query(
          `INSERT INTO "TestStep" (id, "testRunId", "stepNumber", action, selector, value, status, "errorMsg", "timestamp", duration)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), 300)`,
          [stepId, context.testRunId, stepNumber, action, selector || null, value || null, status, errorMsg || null]
        );
      }

      // Record step in Allure when completed (passed or failed)
      if (status === 'passed' || status === 'failed') {
        const stepName = `${action} ${selector || value || ''}`;
        await playwrightCrxService.recordStep(
          context.testRunId,
          stepName,
          status,
          300
        );
        logger.info(`📊 Allure step recorded: ${stepName} - ${status}`);
      }

      if (context.ws) {
        this.sendWebSocketMessage(context.ws, { 
          type: 'STEP_UPDATE', 
          testRunId: context.testRunId, 
          stepNumber, 
          action, 
          selector,
          value,
          status, 
          duration: 300, 
          errorMsg,
          timestamp: Date.now() 
        });
      }
    } catch (error: any) {
      logger.error('Failed to record step:', error);
    }
  }

  private extractExpectSelector(line: string): string {
    // Extract selector from expect(page.locator('selector'))
    const match = line.match(/locator\(['"]([^'"]+)['"]/); 
    return match ? match[1] : '';
  }

  private extractExpectedText(line: string): string {
    // Extract text from toHaveText('text') or toContainText('text')
    const match = line.match(/toHaveText\(['"]([^'"]+)['"]/i) || 
                  line.match(/toContainText\(['"]([^'"]+)['"]/i);
    return match ? match[1] : '';
  }

  private extractParameter(line: string, method: string): string | undefined {
    const startIndex = line.indexOf(method);
    if (startIndex === -1) return undefined;
    const paramStart = startIndex + method.length;
    const paramEnd = line.indexOf(')', paramStart);
    if (paramEnd === -1) return undefined;
    return line.substring(paramStart, paramEnd).replace(/['"]/g, '').trim();
  }

  private extractParameters(line: string, method: string): string[] {
    const startIndex = line.indexOf(method);
    if (startIndex === -1) return [];
    const paramStart = startIndex + method.length;
    const paramEnd = line.indexOf(')', paramStart);
    if (paramEnd === -1) return [];
    const paramsString = line.substring(paramStart, paramEnd);
    return paramsString.split(',').map(param => param.replace(/['"]/g, '').trim());
  }

  private sendWebSocketMessage(_ws: WebSocketServer, message: any): void {
    logger.info('WebSocket message:', message);
  }

  getActiveTestRuns(): string[] {
    return Array.from(this.activeRuns.keys());
  }
}

export const testRunnerService = new TestRunnerService();
