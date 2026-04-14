import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger';
import pool from '../../db';
import { chromium, firefox, webkit, Browser, Page } from 'playwright-core';
import { bddReportService as playwrightCrxService } from '../bdd-report.service';

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

      const startTime = Date.now();

      // Execute script with Playwright
      await this.executeScriptWithPlaywright(context, script.code, effectiveBrowserType);

      const duration = Date.now() - startTime;

      // Generate BDD report
      const reportUrl = await playwrightCrxService.generateTestRunReport(
        testRunId, script.name,
        [{ action: 'Execute script', status: 'passed', duration }],
        'passed', { browser: effectiveBrowserType }
      );
      logger.info('📊 Report generated:', reportUrl);

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

      // Generate report for failed test
      try {
        const reportUrl = await playwrightCrxService.generateTestRunReport(
          testRunId, 'Test Run',
          [{ action: 'Execute script', status: 'failed', duration, errorMessage: error.message }],
          'failed'
        );
        logger.info('📊 Report generated for failed test:', reportUrl);

        await pool.query(
          `UPDATE "TestRun" SET status = 'failed', "errorMsg" = $2, "completedAt" = now(), duration = $3, "executionReportUrl" = $4 WHERE id = $1`,
          [testRunId, error.message, duration, reportUrl]
        );
      } catch (reportError: any) {
        logger.error('Failed to generate report:', reportError.message);
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

    // Extract BASE_URL from script: const BASE_URL = process.env.BASE_URL || 'https://...';
    let scriptBaseUrl = '';
    for (const line of lines) {
      const baseUrlMatch = line.match(/(?:const|let|var)\s+BASE_URL\s*=\s*.*\|\|\s*['"]([^'"]+)['"]/);
      if (baseUrlMatch) { scriptBaseUrl = baseUrlMatch[1]; break; }
      const simpleMatch = line.match(/(?:const|let|var)\s+BASE_URL\s*=\s*['"]([^'"]+)['"]/);
      if (simpleMatch) { scriptBaseUrl = simpleMatch[1]; break; }
    }
    if (!scriptBaseUrl) scriptBaseUrl = process.env.BASE_URL || '';
    logger.info(`Script BASE_URL resolved to: "${scriptBaseUrl}"`);

    let stepNumber = 1;

    for (const line of lines) {
      try {
        let action = 'unknown';
        let selector = '';
        let value = '';

        // Parse and execute different Playwright commands
        if (line.includes('page.goto(')) {
          action = 'navigate';
          let url = this.extractParameter(line, 'page.goto(') || '';

          // Resolve variable references: "BASE_URL + /path" or "BASE_URL || http://..."
          if (url.includes('BASE_URL') || url.includes('ENV_PROFILE')) {
            // Extract the path part after + if present
            const plusMatch = url.match(/(?:BASE_URL|ENV_PROFILE\.baseUrl)\s*\+\s*(.*)/);
            if (plusMatch) {
              url = scriptBaseUrl + plusMatch[1].replace(/['"]/g, '').trim();
            } else {
              // "BASE_URL || fallback" or just "BASE_URL"
              url = scriptBaseUrl || url.replace(/BASE_URL\s*\|\|\s*/, '').replace(/ENV_PROFILE\.baseUrl\s*\|\|\s*/, '').replace(/['"]/g, '').trim();
            }
          }

          // Skip non-URL lines (variable declarations, if statements)
          if (!url || url.startsWith('if') || url.startsWith('const') || url.startsWith('throw')) {
            stepNumber++;
            continue;
          }

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
          if (!selector) { logger.warn(`Step ${stepNumber}: Skipping click — empty selector`); stepNumber++; continue; }

          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.click(selector);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.fill(')) {
          action = 'fill';
          const params = this.extractParameters(line, 'page.fill(');
          selector = params[0] || '';
          value = params[1] || '';
          if (!selector) { logger.warn(`Step ${stepNumber}: Skipping fill — empty selector`); stepNumber++; continue; }

          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.fill(selector, value);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.press(')) {
          action = 'press';
          const params = this.extractParameters(line, 'page.press(');
          selector = params[0] || '';
          value = params[1] || '';
          if (!selector) { logger.warn(`Step ${stepNumber}: Skipping press — empty selector`); stepNumber++; continue; }

          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.press(selector, value);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.waitForSelector(')) {
          action = 'wait';
          selector = this.extractParameter(line, 'page.waitForSelector(') || '';
          if (!selector) { logger.warn(`Step ${stepNumber}: Skipping waitForSelector — empty selector`); stepNumber++; continue; }

          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.waitForSelector(selector, { timeout: 30000 });
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          
        } else if (line.includes('expect(') && line.includes('toBeVisible')) {
          action = 'assert_visible';
          selector = this.extractExpectSelector(line);

          await this.recordStep(context, stepNumber, action, selector || '(page element)', value, 'running');
          const element = this.resolveLocator(page, line) || (selector ? page.locator(selector) : null);
          if (!element) { logger.warn(`Step ${stepNumber}: Cannot resolve locator for visibility check`); stepNumber++; continue; }
          await element.first().waitFor({ state: 'visible', timeout: 10000 });
          await this.recordStep(context, stepNumber, action, selector || '(page element)', value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveText')) {
          action = 'assert_text';
          selector = this.extractExpectSelector(line);
          const expectedText = this.extractExpectedText(line);
          value = expectedText;

          await this.recordStep(context, stepNumber, action, selector || '(page element)', value, 'running');
          const element = this.resolveLocator(page, line) || (selector ? page.locator(selector) : null);
          if (!element) { logger.warn(`Step ${stepNumber}: Cannot resolve locator for text check`); stepNumber++; continue; }
          await element.first().waitFor({ state: 'visible' });
          const actualText = await element.first().textContent();
          if (!actualText?.includes(expectedText)) {
            throw new Error(`Expected text "${expectedText}" not found. Actual: "${actualText}"`);
          }
          await this.recordStep(context, stepNumber, action, selector || '(page element)', value, 'passed');

        } else if (line.includes('page.getByLabel(') || line.includes('page.getByRole(') || line.includes('page.getByText(') || line.includes('page.getByPlaceholder(') || line.includes('page.getByTestId(') || line.includes('page.locator(')) {
          // Handle modern Playwright locator API calls: getByLabel('X').fill('Y'), getByPlaceholder('X').fill('Y'), getByRole('button', {name: 'X'}).click()
          const locator = this.resolveLocator(page, line);
          if (!locator) { stepNumber++; continue; }

          if (line.includes('.fill(')) {
            action = 'fill';
            const fillMatch = line.match(/\.fill\(['"]([^'"]*)['"]\)/);
            value = fillMatch ? fillMatch[1] : '';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().fill(value);
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.click(')) {
            action = 'click';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().click();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.check(')) {
            action = 'check';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().check();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.selectOption(')) {
            action = 'select';
            const optMatch = line.match(/\.selectOption\(['"]([^'"]*)['"]\)/);
            value = optMatch ? optMatch[1] : '';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().selectOption(value);
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else {
            // Unknown action on locator — skip
            stepNumber++; continue;
          }
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

      // Step recorded in DB — report generated at end of test run

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

  /**
   * Resolve a Playwright locator from a code line containing getByLabel, getByRole, getByText, or locator calls.
   */
  private resolveLocator(page: Page, line: string): ReturnType<Page['locator']> | null {
    try {
      // page.getByText('text', { exact: false })
      const getByTextMatch = line.match(/getByText\(['"]([^'"]+)['"]/);
      if (getByTextMatch) return page.getByText(getByTextMatch[1], { exact: false });

      // page.getByLabel('label')
      const getByLabelMatch = line.match(/getByLabel\(['"]([^'"]+)['"]/);
      if (getByLabelMatch) return page.getByLabel(getByLabelMatch[1]);

      // page.getByRole('role', { name: 'text' }) or page.getByRole('role', { name: /regex/i })
      const getByRoleMatch = line.match(/getByRole\(['"]([^'"]+)['"](?:,\s*\{\s*name:\s*(?:['"]([^'"]+)['"]|\/([^/]+)\/\w*)\s*\})?/);
      if (getByRoleMatch) {
        const role = getByRoleMatch[1] as any;
        const nameStr = getByRoleMatch[2];
        const nameRegex = getByRoleMatch[3];
        if (nameRegex) return page.getByRole(role, { name: new RegExp(nameRegex, 'i') });
        if (nameStr) return page.getByRole(role, { name: nameStr });
        return page.getByRole(role);
      }

      // page.getByPlaceholder('text')
      const getByPlaceholderMatch = line.match(/getByPlaceholder\(['"]([^'"]+)['"]/);
      if (getByPlaceholderMatch) return page.getByPlaceholder(getByPlaceholderMatch[1]);

      // page.locator('selector')
      const locatorMatch = line.match(/(?:page\.)?locator\(['"]([^'"]+)['"]/);
      if (locatorMatch && locatorMatch[1]) return page.locator(locatorMatch[1]);
    } catch (e: any) {
      logger.warn(`Could not resolve locator from line: ${line.substring(0, 100)} — ${e.message}`);
    }
    return null;
  }

  private extractLocatorDescription(line: string): string {
    const placeholderMatch = line.match(/getByPlaceholder\(['"]([^'"]+)['"]/);
    if (placeholderMatch) return `placeholder:${placeholderMatch[1]}`;
    const labelMatch = line.match(/getByLabel\(['"]([^'"]+)['"]/);
    if (labelMatch) return `label:${labelMatch[1]}`;
    const roleMatch = line.match(/getByRole\(['"]([^'"]+)['"](?:,\s*\{\s*name:\s*['"]([^'"]+)['"])?/);
    if (roleMatch) return roleMatch[2] ? `${roleMatch[1]}:${roleMatch[2]}` : roleMatch[1];
    const textMatch = line.match(/getByText\(['"]([^'"]+)['"]/);
    if (textMatch) return `text:${textMatch[1]}`;
    const testIdMatch = line.match(/getByTestId\(['"]([^'"]+)['"]/);
    if (testIdMatch) return `testid:${testIdMatch[1]}`;
    const locatorMatch = line.match(/locator\(['"]([^'"]+)['"]/);
    if (locatorMatch) return locatorMatch[1];
    return line.substring(0, 60);
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
    const after = line.substring(startIndex + method.length);
    // Extract first quoted string parameter
    const quotedMatch = after.match(/^['"]([^'"]*)['"]/);
    if (quotedMatch) return quotedMatch[1];
    // Fallback: extract up to first comma or closing paren (for unquoted params like variables)
    const fallbackMatch = after.match(/^([^,)]+)/);
    return fallbackMatch ? fallbackMatch[1].replace(/['"]/g, '').trim() : undefined;
  }

  private extractParameters(line: string, method: string): string[] {
    const startIndex = line.indexOf(method);
    if (startIndex === -1) return [];
    const after = line.substring(startIndex + method.length);
    // Extract quoted string parameters separated by commas, stop at object literal { or )
    const params: string[] = [];
    const paramRegex = /['"]([^'"]*)['"]/g;
    let match;
    while ((match = paramRegex.exec(after)) !== null) {
      // Stop if we hit an object literal
      const before = after.substring(0, match.index);
      if (before.includes('{')) break;
      params.push(match[1]);
    }
    return params;
  }

  private sendWebSocketMessage(_ws: WebSocketServer, message: any): void {
    logger.info('WebSocket message:', message);
  }

  getActiveTestRuns(): string[] {
    return Array.from(this.activeRuns.keys());
  }
}

export const testRunnerService = new TestRunnerService();
