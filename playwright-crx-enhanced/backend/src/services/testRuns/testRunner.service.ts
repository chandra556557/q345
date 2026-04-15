import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger';
import pool from '../../db';
import { chromium, firefox, webkit, Browser, Page } from 'playwright-core';
import { PlaywrightCrxService } from '../allure.service';
const allureService = new PlaywrightCrxService();

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

      // Generate Allure report from recorded TestStep rows
      const reportUrl = await this.generateAllureReport(testRunId, script.name, 'passed', effectiveBrowserType, duration);
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

      // Generate Allure report for failed test
      try {
        const reportUrl = await this.generateAllureReport(testRunId, 'Test Run', 'failed', 'chromium', duration, error.message);
        logger.info('📊 Allure report generated for failed test:', reportUrl);

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

        } else if (line.includes('page.frameLocator(')) {
          // Handle iframe: page.frameLocator('#frame') — store for subsequent locator calls
          action = 'frame';
          const frameMatch = line.match(/frameLocator\(['"]([^'"]+)['"]\)/);
          selector = frameMatch ? frameMatch[1] : '';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          // Frame locator is resolved inline — just record and continue
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.keyboard.press(')) {
          action = 'keypress';
          const keyMatch = line.match(/press\(['"]([^'"]+)['"]\)/);
          value = keyMatch ? keyMatch[1] : '';
          selector = 'keyboard';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.keyboard.press(value);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.screenshot(')) {
          action = 'screenshot';
          const pathMatch = line.match(/path:\s*['"]([^'"]+)['"]/);
          selector = pathMatch ? pathMatch[1] : 'screenshot.png';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.screenshot({ path: selector, fullPage: line.includes('fullPage: true') });
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.goBack()')) {
          action = 'navigate';
          selector = 'back';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.goBack();
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.goForward()')) {
          action = 'navigate';
          selector = 'forward';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.goForward();
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.reload()')) {
          action = 'navigate';
          selector = 'reload';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.reload();
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.waitForTimeout(')) {
          action = 'wait';
          const msMatch = line.match(/waitForTimeout\((\d+)\)/);
          value = msMatch ? msMatch[1] : '1000';
          selector = `${value}ms`;
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.waitForTimeout(parseInt(value));
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.waitForLoadState(')) {
          action = 'wait';
          const stateMatch = line.match(/waitForLoadState\(['"]([^'"]+)['"]\)/);
          selector = stateMatch ? stateMatch[1] : 'load';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          await page.waitForLoadState(selector as any);
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.waitForURL(')) {
          action = 'wait';
          const urlMatch = line.match(/waitForURL\((?:new RegExp\()?['"]([^'"]+)['"]/);
          selector = urlMatch ? urlMatch[1] : '';
          await this.recordStep(context, stepNumber, action, `url: ${selector}`, value, 'running');
          if (line.includes('new RegExp')) {
            await page.waitForURL(new RegExp(selector), { timeout: 15000 });
          } else {
            await page.waitForURL(selector, { timeout: 15000 });
          }
          await this.recordStep(context, stepNumber, action, `url: ${selector}`, value, 'passed');

        } else if (line.includes('page.evaluate(')) {
          action = 'evaluate';
          selector = 'JavaScript';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          const evalMatch = line.match(/evaluate\(\(\)\s*=>\s*(.+)\)/);
          if (evalMatch) {
            await page.evaluate(evalMatch[1]);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.once(') && line.includes('dialog')) {
          action = 'dialog';
          const isAccept = line.includes('accept');
          selector = isAccept ? 'accept' : 'dismiss';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          page.once('dialog', async d => isAccept ? await d.accept() : await d.dismiss());
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveURL')) {
          action = 'assert_url';
          const urlMatch = line.match(/toHaveURL\((?:new RegExp\()?['"]([^'"]+)['"]/);
          selector = urlMatch ? urlMatch[1] : '';
          value = selector;
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (line.includes('new RegExp')) {
            await page.waitForURL(new RegExp(selector), { timeout: 15000 });
          } else {
            const currentUrl = page.url();
            if (!currentUrl.includes(selector) && currentUrl !== selector) {
              throw new Error(`URL mismatch: expected "${selector}", got "${currentUrl}"`);
            }
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveTitle')) {
          action = 'assert_title';
          const titleMatch = line.match(/toHaveTitle\((?:new RegExp\()?['"]([^'"]+)['"]/);
          value = titleMatch ? titleMatch[1] : '';
          selector = 'title';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          const actualTitle = await page.title();
          if (line.includes('new RegExp')) {
            if (!new RegExp(value).test(actualTitle)) {
              throw new Error(`Title mismatch: expected /${value}/, got "${actualTitle}"`);
            }
          } else if (actualTitle !== value) {
            throw new Error(`Title mismatch: expected "${value}", got "${actualTitle}"`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toContainText')) {
          action = 'assert_text';
          const textMatch = line.match(/toContainText\(['"]([^'"]+)['"]\)/);
          value = textMatch ? textMatch[1] : '';
          selector = 'body';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          const bodyText = await page.locator('body').textContent() || '';
          if (!bodyText.includes(value)) {
            throw new Error(`Text "${value}" not found on page`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toBeHidden')) {
          action = 'assert_hidden';
          const locator = this.resolveLocator(page, line);
          selector = this.extractExpectSelector(line) || this.extractLocatorDescription(line);
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (locator) {
            const count = await locator.first().count();
            if (count > 0) {
              const isVisible = await locator.first().isVisible();
              if (isVisible) throw new Error(`Element "${selector}" is visible but should be hidden`);
            }
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveValue')) {
          action = 'assert_value';
          const locator = this.resolveLocator(page, line);
          const valMatch = line.match(/toHaveValue\(['"]([^'"]*)['"]\)/);
          value = valMatch ? valMatch[1] : '';
          selector = this.extractLocatorDescription(line);
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (locator) {
            const actual = await locator.first().inputValue();
            if (actual !== value) throw new Error(`Value mismatch for "${selector}": expected "${value}", got "${actual}"`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveCount')) {
          action = 'assert_count';
          const locator = this.resolveLocator(page, line);
          const countMatch = line.match(/toHaveCount\((\d+)\)/);
          value = countMatch ? countMatch[1] : '0';
          selector = this.extractLocatorDescription(line);
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (locator) {
            const actual = await locator.count();
            if (actual !== parseInt(value)) throw new Error(`Count mismatch for "${selector}": expected ${value}, got ${actual}`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveClass')) {
          action = 'assert_class';
          const locator = this.resolveLocator(page, line);
          const classMatch = line.match(/toHaveClass\((?:new RegExp\()?['"]([^'"]+)['"]/);
          value = classMatch ? classMatch[1] : '';
          selector = this.extractLocatorDescription(line);
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (locator) {
            const actual = await locator.first().getAttribute('class') || '';
            if (!new RegExp(value).test(actual)) throw new Error(`Class mismatch for "${selector}": expected /${value}/, got "${actual}"`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveAttribute')) {
          action = 'assert_attribute';
          const locator = this.resolveLocator(page, line);
          const attrMatch = line.match(/toHaveAttribute\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/);
          selector = this.extractLocatorDescription(line);
          const attrName = attrMatch ? attrMatch[1] : '';
          value = attrMatch ? attrMatch[2] : '';
          await this.recordStep(context, stepNumber, action, `${selector}[${attrName}]`, value, 'running');
          if (locator) {
            const actual = await locator.first().getAttribute(attrName) || '';
            if (actual !== value) throw new Error(`Attribute "${attrName}" mismatch: expected "${value}", got "${actual}"`);
          }
          await this.recordStep(context, stepNumber, action, `${selector}[${attrName}]`, value, 'passed');

        } else if (line.includes('expect(') && (line.includes('toBeChecked') || line.includes('not.toBeChecked'))) {
          action = 'assert_checked';
          const locator = this.resolveLocator(page, line);
          const shouldBeChecked = !line.includes('not.toBeChecked');
          selector = this.extractLocatorDescription(line);
          value = shouldBeChecked ? 'checked' : 'unchecked';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (locator) {
            const isChecked = await locator.first().isChecked();
            if (isChecked !== shouldBeChecked) throw new Error(`Checkbox "${selector}" is ${isChecked ? 'checked' : 'unchecked'}, expected ${value}`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && (line.includes('toBeDisabled') || line.includes('toBeEnabled'))) {
          action = line.includes('toBeDisabled') ? 'assert_disabled' : 'assert_enabled';
          const locator = this.resolveLocator(page, line);
          const shouldBeDisabled = line.includes('toBeDisabled');
          selector = this.extractLocatorDescription(line);
          value = shouldBeDisabled ? 'disabled' : 'enabled';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (locator) {
            const isDisabled = await locator.first().isDisabled();
            if (isDisabled !== shouldBeDisabled) throw new Error(`Element "${selector}" is ${isDisabled ? 'disabled' : 'enabled'}, expected ${value}`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.getByLabel(') || line.includes('page.getByRole(') || line.includes('page.getByText(') || line.includes('page.getByPlaceholder(') || line.includes('page.getByTestId(') || line.includes('page.locator(')) {
          // Handle modern Playwright locator API calls
          const locator = this.resolveLocator(page, line);
          if (!locator) { stepNumber++; continue; }

          // Wait for DOM stability before acting
          await page.waitForLoadState('domcontentloaded').catch(() => {});

          if (line.includes('.fill(')) {
            action = 'fill';
            const fillMatch = line.match(/\.fill\(['"]([^'"]*)['"]\)/);
            value = fillMatch ? fillMatch[1] : '';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().scrollIntoViewIfNeeded().catch(() => {});
            await locator.first().fill(value);
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.pressSequentially(')) {
            action = 'type';
            const typeMatch = line.match(/\.pressSequentially\(['"]([^'"]*)['"]/);
            value = typeMatch ? typeMatch[1] : '';
            const delayMatch = line.match(/delay:\s*(\d+)/);
            const delay = delayMatch ? parseInt(delayMatch[1]) : 50;
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().scrollIntoViewIfNeeded().catch(() => {});
            await locator.first().pressSequentially(value, { delay });
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.clear()')) {
            action = 'clear';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().clear();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.click(')) {
            action = 'click';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().scrollIntoViewIfNeeded().catch(() => {});
            if (line.includes("button: 'right'")) {
              await locator.first().click({ button: 'right' });
            } else {
              await locator.first().click();
            }
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.dblclick(')) {
            action = 'dblclick';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().scrollIntoViewIfNeeded().catch(() => {});
            await locator.first().dblclick();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.hover(')) {
            action = 'hover';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().scrollIntoViewIfNeeded().catch(() => {});
            await locator.first().hover();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.focus(')) {
            action = 'focus';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().focus();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.check(')) {
            action = 'check';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().check();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.uncheck(')) {
            action = 'uncheck';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().uncheck();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.selectOption(')) {
            action = 'select';
            const optMatch = line.match(/\.selectOption\(['"]([^'"]*)['"]\)/);
            value = optMatch ? optMatch[1] : '';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().selectOption(value);
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.setInputFiles(')) {
            action = 'upload';
            const fileMatch = line.match(/\.setInputFiles\(['"]([^'"]*)['"]\)/);
            value = fileMatch ? fileMatch[1] : '';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().setInputFiles(value);
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.dragTo(')) {
            action = 'drag';
            selector = this.extractLocatorDescription(line);
            const targetLocator = this.resolveLocator(page, line.substring(line.indexOf('.dragTo(')));
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            if (targetLocator) {
              await locator.first().dragTo(targetLocator.first());
            }
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.scrollIntoViewIfNeeded(')) {
            action = 'scroll';
            selector = this.extractLocatorDescription(line);
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().scrollIntoViewIfNeeded();
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          } else if (line.includes('.waitFor(')) {
            action = 'wait';
            selector = this.extractLocatorDescription(line);
            const stateMatch = line.match(/state:\s*['"]([^'"]+)['"]/);
            value = stateMatch ? stateMatch[1] : 'visible';
            await this.recordStep(context, stepNumber, action, selector, value, 'running');
            await locator.first().waitFor({ state: value as any, timeout: 15000 });
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
        // Take screenshot on failure for debugging
        let screenshotPath = '';
        try {
          if (page) {
            const screenshotDir = path.join(process.cwd(), 'playwright-crx-reports', 'failure-screenshots');
            if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
            screenshotPath = path.join(screenshotDir, `${context.testRunId}-step${stepNumber}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            logger.info(`Screenshot saved: ${screenshotPath}`);
          }
        } catch { /* ignore screenshot errors */ }
        await this.recordStep(context, stepNumber, 'unknown', '', '', 'failed', stepError.message);
        throw stepError;
      }
    }
  }

  private async generateAllureReport(
    testRunId: string,
    scriptName: string,
    status: 'passed' | 'failed',
    browser: string,
    duration: number,
    errorMessage?: string
  ): Promise<string> {
    try {
      // Fetch recorded steps from DB
      const { rows: stepRows } = await pool.query(
        `SELECT "stepNumber", action, selector, value, status, "errorMsg", duration FROM "TestStep" WHERE "testRunId" = $1 ORDER BY "stepNumber" ASC`,
        [testRunId]
      );

      const scenarioSteps = stepRows.map(r => ({
        keyword: r.action || 'Step',
        name: `${r.action}${r.selector ? ` ${r.selector}` : ''}${r.value ? ` = "${r.value}"` : ''}`,
        status: r.status === 'passed' ? 'passed' : r.status === 'failed' ? 'failed' : 'skipped',
        duration: r.duration || 0,
        errorMessage: r.errorMsg || undefined,
      }));

      // Look for failure screenshots for this run
      const screenshotDir = path.join(process.cwd(), 'playwright-crx-reports', 'failure-screenshots');
      if (fs.existsSync(screenshotDir)) {
        const files = fs.readdirSync(screenshotDir).filter(f => f.startsWith(testRunId));
        for (const file of files) {
          const stepMatch = file.match(/step(\d+)\.png$/);
          if (stepMatch) {
            const stepIdx = parseInt(stepMatch[1]) - 1;
            if (scenarioSteps[stepIdx]) {
              (scenarioSteps[stepIdx] as any).screenshotPath = path.join(screenshotDir, file);
            }
          }
        }
      }

      // Write Allure results for this test run
      await allureService.writeBDDResults({
        runId: testRunId,
        featureName: scriptName,
        scenarios: [{
          name: scriptName,
          status,
          duration,
          tags: [],
          steps: scenarioSteps.length > 0 ? scenarioSteps : [{
            keyword: 'Execute',
            name: scriptName,
            status,
            duration,
            errorMessage,
          }],
        }],
        browser,
      });

      // Generate Allure HTML report
      await allureService.generateReport(testRunId);
      const reportUrl = await allureService.getReportUrl(testRunId);
      return reportUrl || '';
    } catch (err: any) {
      logger.error('Allure report generation failed:', err.message);
      return '';
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

      // page.getByLabel('label') — with smart fallback chain
      const getByLabelMatch = line.match(/getByLabel\(['"]([^'"]+)['"]/);
      if (getByLabelMatch) {
        const field = getByLabelMatch[1].replace(/[:\s]+$/, '').trim();
        return page.getByLabel(field, { exact: false })
          .or(page.getByPlaceholder(field, { exact: false }))
          .or(page.getByRole('textbox', { name: field }))
          .or(page.locator(`input[name="${field}" i], input[id="${field}" i], textarea[name="${field}" i], input[placeholder="${field}" i]`))
          .or(page.locator(`label:has-text("${field}") + input, label:has-text("${field}") input, td:has-text("${field}") + td input`));
      }

      // page.getByRole('role', { name: 'text' }) — with fallback to other roles
      const getByRoleMatch = line.match(/getByRole\(['"]([^'"]+)['"](?:,\s*\{\s*name:\s*(?:['"]([^'"]+)['"]|\/([^/]+)\/\w*)\s*\})?/);
      if (getByRoleMatch) {
        const role = getByRoleMatch[1] as any;
        const nameStr = getByRoleMatch[2];
        const nameRegex = getByRoleMatch[3];
        if (nameRegex) {
          const regex = new RegExp(nameRegex, 'i');
          return page.getByRole(role, { name: regex })
            .or(page.getByRole('link', { name: regex }))
            .or(page.getByRole('button', { name: regex }))
            .or(page.getByText(regex));
        }
        if (nameStr) {
          return page.getByRole(role, { name: nameStr })
            .or(page.getByRole(role === 'button' ? 'link' : 'button', { name: nameStr }))
            .or(page.getByRole('tab', { name: nameStr }))
            .or(page.getByRole('menuitem', { name: nameStr }))
            .or(page.getByText(nameStr, { exact: true }))
            .or(page.locator(`a:has-text("${nameStr}"), button:has-text("${nameStr}"), input[type="submit"][value="${nameStr}" i]`));
        }
        return page.getByRole(role);
      }

      // page.getByPlaceholder('text') — with fallback
      const getByPlaceholderMatch = line.match(/getByPlaceholder\(['"]([^'"]+)['"]/);
      if (getByPlaceholderMatch) {
        const ph = getByPlaceholderMatch[1];
        return page.getByPlaceholder(ph, { exact: false })
          .or(page.getByLabel(ph, { exact: false }))
          .or(page.locator(`input[placeholder="${ph}" i]`));
      }

      // page.getByTestId('id')
      const getByTestIdMatch = line.match(/getByTestId\(['"]([^'"]+)['"]/);
      if (getByTestIdMatch) return page.getByTestId(getByTestIdMatch[1]);

      // page.locator('selector')
      const locatorMatch = line.match(/(?:page\.)?locator\(['"]([^'"]+)['"]/);
      if (locatorMatch && locatorMatch[1]) {
        let loc = page.locator(locatorMatch[1]);
        // Handle .nth(), .first(), .last() chaining
        const nthMatch = line.match(/\.nth\((\d+)\)/);
        if (nthMatch) loc = loc.nth(parseInt(nthMatch[1])) as any;
        else if (line.includes('.last()')) loc = loc.last() as any;
        return loc;
      }
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
    // Match quoted string with matching quote type (single OR double, not mixed)
    const singleQuoted = after.match(/^'((?:[^'\\]|\\.)*)'/);
    if (singleQuoted) return singleQuoted[1];
    const doubleQuoted = after.match(/^"((?:[^"\\]|\\.)*)"/);
    if (doubleQuoted) return doubleQuoted[1];
    // Backtick template literal
    const backtickQuoted = after.match(/^`([^`]*)`/);
    if (backtickQuoted) return backtickQuoted[1];
    // Fallback: unquoted variable up to comma or closing paren
    const fallbackMatch = after.match(/^([^,)]+)/);
    return fallbackMatch ? fallbackMatch[1].trim() : undefined;
  }

  private extractParameters(line: string, method: string): string[] {
    const startIndex = line.indexOf(method);
    if (startIndex === -1) return [];
    let after = line.substring(startIndex + method.length);
    const params: string[] = [];
    // Iteratively extract quoted strings with matching quote types
    while (after.length > 0) {
      // Stop at object literal
      const objIdx = after.indexOf('{');
      const closeIdx = after.indexOf(')');
      if (objIdx !== -1 && (closeIdx === -1 || objIdx < closeIdx)) {
        const before = after.substring(0, objIdx);
        if (!/['"`]/.test(before)) break;
      }
      // Try to match next quoted string (matching quote type)
      const singleMatch = after.match(/'((?:[^'\\]|\\.)*)'/);
      const doubleMatch = after.match(/"((?:[^"\\]|\\.)*)"/);
      const backtickMatch = after.match(/`([^`]*)`/);
      // Pick the earliest match
      const candidates = [singleMatch, doubleMatch, backtickMatch]
        .filter(m => m !== null)
        .sort((a, b) => (a!.index! - b!.index!));
      if (candidates.length === 0) break;
      const match = candidates[0]!;
      // Stop if the match is after an object literal
      const before = after.substring(0, match.index);
      if (before.includes('{')) break;
      params.push(match[1]);
      after = after.substring(match.index! + match[0].length);
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
