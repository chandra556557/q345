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
    // Fix #1: Join multi-line chains — lines starting with . are continuation of previous line
    const rawLines = code.split('\n');
    const joinedLines: string[] = [];
    for (const raw of rawLines) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      // Strip inline comments (but not URLs with //)
      const cleaned = trimmed.replace(/\s+\/\/(?!\/).*$/, '');
      if (!cleaned) continue;
      // Join continuation lines (starting with . or chain methods)
      if (cleaned.startsWith('.') && joinedLines.length > 0) {
        joinedLines[joinedLines.length - 1] += cleaned;
      } else if (joinedLines.length > 0 && !joinedLines[joinedLines.length - 1].match(/[;)}\]]$/) && cleaned.match(/^\.(fill|click|hover|check|uncheck|press|clear|focus|dblclick|selectOption|waitFor|scrollIntoViewIfNeeded|setInputFiles|dragTo|nth|first|last|count|textContent|innerText|getAttribute|inputValue|isVisible|isEnabled|isDisabled|isChecked)\(/)) {
        joinedLines[joinedLines.length - 1] += cleaned;
      } else {
        joinedLines.push(cleaned);
      }
    }
    const lines = joinedLines;

    // Fix #5: Extract ALL user-defined constants (const/let/var = 'value')
    const userVars: Record<string, string> = {};
    let scriptBaseUrl = '';
    for (const line of lines) {
      // BASE_URL special handling
      const baseUrlMatch = line.match(/(?:const|let|var)\s+BASE_URL\s*=\s*.*\|\|\s*['"]([^'"]+)['"]/);
      if (baseUrlMatch) { scriptBaseUrl = baseUrlMatch[1]; userVars['BASE_URL'] = baseUrlMatch[1]; continue; }
      const simpleBaseMatch = line.match(/(?:const|let|var)\s+BASE_URL\s*=\s*['"]([^'"]+)['"]/);
      if (simpleBaseMatch) { scriptBaseUrl = simpleBaseMatch[1]; userVars['BASE_URL'] = simpleBaseMatch[1]; continue; }
      // Generic const/let/var declarations with string values
      const varMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:.*\|\|\s*)?['"]([^'"]+)['"]/);
      if (varMatch && varMatch[1] !== 'BASE_URL') {
        userVars[varMatch[1]] = varMatch[2];
      }
    }
    if (!scriptBaseUrl) scriptBaseUrl = process.env.BASE_URL || '';
    logger.info(`Script BASE_URL resolved to: "${scriptBaseUrl}"`);
    if (Object.keys(userVars).length > 0) logger.info(`User variables: ${JSON.stringify(userVars)}`);

    // Fix #6: Extract configurable timeout from script
    let defaultTimeout = 30000;
    const timeoutLine = lines.find(l => l.includes('setDefaultTimeout(') || l.includes('DEFAULT_TIMEOUT'));
    if (timeoutLine) {
      const tm = timeoutLine.match(/(\d{4,})/);
      if (tm) defaultTimeout = parseInt(tm[1]);
    }

    // Fix #5: Resolve variable references in a string
    const resolveVars = (s: string): string => {
      if (!s) return s;
      // Handle BASE_URL + '/path' or ENV_PROFILE.baseUrl
      if (s.includes('BASE_URL') || s.includes('ENV_PROFILE')) {
        const plusMatch = s.match(/(?:BASE_URL|ENV_PROFILE\.baseUrl)\s*\+\s*(.*)/);
        if (plusMatch) return scriptBaseUrl + plusMatch[1].replace(/['"]/g, '').trim();
        return scriptBaseUrl || s.replace(/BASE_URL\s*\|\|\s*/, '').replace(/ENV_PROFILE\.baseUrl\s*\|\|\s*/, '').replace(/['"]/g, '').trim();
      }
      // Resolve user-defined variables
      for (const [name, val] of Object.entries(userVars)) {
        if (s === name) return val;
        if (s.includes(name)) s = s.replace(new RegExp(`\\b${name}\\b`, 'g'), val);
      }
      return s;
    };

    // Fix #3: Track active frame context for iframe support
    let activeFrameLocator: any = null;

    let stepNumber = 1;

    for (const line of lines) {
      try {
        let action = 'unknown';
        let selector = '';
        let value = '';

        // Skip non-executable lines (imports, variable declarations, describe/test blocks, braces)
        if (line.startsWith('import ') || line.startsWith('const ') || line.startsWith('let ') || line.startsWith('var ') ||
            line.startsWith('test(') || line.startsWith('test.describe(') || line.startsWith('test.beforeEach(') ||
            line === '{' || line === '}' || line === '});' || line.startsWith('});') ||
            line.startsWith('async ') || line.match(/^\w+\s*=\s*new\s+/) || line.startsWith('export ')) {
          continue;
        }

        // Fix #5: resolve variables in the line for logging
        logger.debug(`Step ${stepNumber}: Parsing line: ${line.substring(0, 120)}`);

        // Parse and execute different Playwright commands
        if (line.includes('page.goto(')) {
          action = 'navigate';
          let url = this.extractParameter(line, 'page.goto(') || '';
          url = resolveVars(url);

          if (!url || url.startsWith('if') || url.startsWith('const') || url.startsWith('throw')) {
            stepNumber++;
            continue;
          }

          selector = url;

          logger.info(`Step ${stepNumber}: Navigate to ${url}`);
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: defaultTimeout });
            logger.info(`Step ${stepNumber}: Navigation successful`);
          } catch (navError: any) {
            logger.error(`Step ${stepNumber}: Navigation failed - ${navError.message}`);
            throw navError;
          }
          activeFrameLocator = null;
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

        } else if (line.includes('page.frameLocator(') || line.includes('frameLocator(')) {
          // Fix #3: Store frame context for subsequent locator calls
          action = 'frame';
          const frameMatch = line.match(/frameLocator\(['"]([^'"]+)['"]\)/);
          selector = frameMatch ? frameMatch[1] : '';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (selector) {
            activeFrameLocator = page.frameLocator(selector);
            logger.info(`Step ${stepNumber}: Switched to iframe context: ${selector}`);
            // If the line also has a chained action (e.g., frameLocator('#f').locator('btn').click())
            if (line.includes('.locator(') && (line.includes('.click(') || line.includes('.fill(') || line.includes('.hover('))) {
              const innerLocMatch = line.match(/\.locator\(['"]([^'"]+)['"]\)/);
              if (innerLocMatch) {
                const innerLoc = activeFrameLocator.locator(innerLocMatch[1]);
                if (line.includes('.click(')) { await innerLoc.first().click(); action = 'click'; }
                else if (line.includes('.fill(')) { const fm = line.match(/\.fill\(['"]([^'"]*)['"]\)/); if (fm) await innerLoc.first().fill(fm[1]); action = 'fill'; }
                else if (line.includes('.hover(')) { await innerLoc.first().hover(); action = 'hover'; }
              }
            }
          }
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
          // Fix #8: Better regex extraction — handle escaped chars and flags
          const regexMatch = line.match(/waitForURL\(\s*new RegExp\(\s*['"](.+?)['"]\s*(?:,\s*['"]([gimsuy]*)['"]\s*)?\)/);
          const strMatch = !regexMatch ? line.match(/waitForURL\(\s*['"]([^'"]+)['"]\s*/) : null;
          selector = regexMatch ? regexMatch[1] : (strMatch ? strMatch[1] : '');
          const regexFlags = regexMatch ? (regexMatch[2] || '') : '';
          await this.recordStep(context, stepNumber, action, `url: ${selector}`, value, 'running');
          if (regexMatch) {
            await page.waitForURL(new RegExp(selector, regexFlags), { timeout: defaultTimeout });
          } else {
            await page.waitForURL(resolveVars(selector), { timeout: defaultTimeout });
          }
          await this.recordStep(context, stepNumber, action, `url: ${selector}`, value, 'passed');

        } else if (line.includes('page.evaluate(')) {
          // Fix #4: Better evaluate handling — extract full callback body
          action = 'evaluate';
          selector = 'JavaScript';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          try {
            // Try to extract the evaluate body between the outermost parens
            const evalStart = line.indexOf('page.evaluate(');
            if (evalStart !== -1) {
              const afterEval = line.substring(evalStart + 'page.evaluate('.length);
              // Simple arrow: () => expression
              const arrowMatch = afterEval.match(/^\(\)\s*=>\s*\{?\s*(.+?)\s*\}?\s*\)?\s*;?\s*$/);
              if (arrowMatch) {
                const body = arrowMatch[1].replace(/\}\s*$/, '');
                await page.evaluate(body);
              } else {
                // String argument: evaluate('code')
                const strMatch = afterEval.match(/^['"](.+)['"]\s*\)/);
                if (strMatch) {
                  await page.evaluate(strMatch[1]);
                } else {
                  // Fallback: pass the whole thing (may work for simple cases)
                  await page.evaluate(`(${afterEval.replace(/\)\s*;?\s*$/, '')})()`);
                }
              }
            }
          } catch (evalErr: any) {
            logger.warn(`Step ${stepNumber}: evaluate warning — ${evalErr.message.substring(0, 100)}`);
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.once(') && line.includes('dialog')) {
          // Fix #10: Enhanced dialog handling with message capture
          action = 'dialog';
          const isAccept = line.includes('accept');
          // Check for accept with text: d.accept('text')
          const acceptTextMatch = line.match(/accept\(['"]([^'"]*)['"]\)/);
          selector = isAccept ? 'accept' : 'dismiss';
          if (acceptTextMatch) value = acceptTextMatch[1];
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          page.once('dialog', async d => {
            logger.info(`Dialog appeared: type=${d.type()}, message="${d.message()}"`);
            if (isAccept) {
              await d.accept(acceptTextMatch ? acceptTextMatch[1] : undefined);
            } else {
              await d.dismiss();
            }
          });
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveURL')) {
          action = 'assert_url';
          // Fix #8: Better regex extraction with flags
          const regexUrlMatch = line.match(/toHaveURL\(\s*new RegExp\(\s*['"](.+?)['"]\s*(?:,\s*['"]([gimsuy]*)['"]\s*)?\)/);
          const strUrlMatch = !regexUrlMatch ? line.match(/toHaveURL\(\s*['"]([^'"]+)['"]/) : null;
          selector = regexUrlMatch ? regexUrlMatch[1] : (strUrlMatch ? strUrlMatch[1] : '');
          const urlFlags = regexUrlMatch ? (regexUrlMatch[2] || '') : '';
          value = selector;
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (regexUrlMatch) {
            await page.waitForURL(new RegExp(selector, urlFlags), { timeout: defaultTimeout });
          } else {
            const currentUrl = page.url();
            const resolvedSelector = resolveVars(selector);
            if (!currentUrl.includes(resolvedSelector) && currentUrl !== resolvedSelector) {
              throw new Error(`URL mismatch: expected "${resolvedSelector}", got "${currentUrl}"`);
            }
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('expect(') && line.includes('toHaveTitle')) {
          action = 'assert_title';
          const regexTitleMatch = line.match(/toHaveTitle\(\s*new RegExp\(\s*['"](.+?)['"]\s*(?:,\s*['"]([gimsuy]*)['"]\s*)?\)/);
          const strTitleMatch = !regexTitleMatch ? line.match(/toHaveTitle\(\s*['"]([^'"]+)['"]/) : null;
          value = regexTitleMatch ? regexTitleMatch[1] : (strTitleMatch ? strTitleMatch[1] : '');
          const titleFlags = regexTitleMatch ? (regexTitleMatch[2] || '') : '';
          selector = 'title';
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          const actualTitle = await page.title();
          if (regexTitleMatch) {
            if (!new RegExp(value, titleFlags).test(actualTitle)) {
              throw new Error(`Title mismatch: expected /${value}/${titleFlags}, got "${actualTitle}"`);
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

        } else if (line.includes('page.waitForFunction(')) {
          // Fix #7: Missing API — waitForFunction
          action = 'wait';
          selector = 'function';
          const fnBody = this.extractParameter(line, 'page.waitForFunction(') || '';
          await this.recordStep(context, stepNumber, action, selector, fnBody, 'running');
          await page.waitForFunction(fnBody, null, { timeout: defaultTimeout });
          await this.recordStep(context, stepNumber, action, selector, fnBody, 'passed');

        } else if (line.includes('page.route(')) {
          // Fix #7: Missing API — route (request interception)
          action = 'route';
          const routeUrl = this.extractParameter(line, 'page.route(') || '';
          selector = routeUrl;
          await this.recordStep(context, stepNumber, action, selector, value, 'running');
          if (line.includes('fulfill')) {
            const statusMatch = line.match(/status:\s*(\d+)/);
            const bodyMatch = line.match(/body:\s*['"]([^'"]*)['"]/);
            await page.route(routeUrl, route => route.fulfill({
              status: statusMatch ? parseInt(statusMatch[1]) : 200,
              body: bodyMatch ? bodyMatch[1] : '',
            }));
          } else if (line.includes('abort')) {
            await page.route(routeUrl, route => route.abort());
          } else {
            await page.route(routeUrl, route => route.continue());
          }
          await this.recordStep(context, stepNumber, action, selector, value, 'passed');

        } else if (line.includes('page.getByAltText(')) {
          // Fix #7: Missing API — getByAltText
          const altMatch = line.match(/getByAltText\(['"]([^'"]+)['"]/);
          if (altMatch) {
            const locator = page.getByAltText(altMatch[1]);
            selector = `alt:${altMatch[1]}`;
            if (line.includes('.click(')) { action = 'click'; await this.recordStep(context, stepNumber, action, selector, value, 'running'); await locator.first().click(); }
            else if (line.includes('.hover(')) { action = 'hover'; await this.recordStep(context, stepNumber, action, selector, value, 'running'); await locator.first().hover(); }
            else { action = 'locate'; await this.recordStep(context, stepNumber, action, selector, value, 'running'); }
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          }

        } else if (line.includes('page.getByTitle(')) {
          // Fix #7: Missing API — getByTitle
          const titleMatch = line.match(/getByTitle\(['"]([^'"]+)['"]/);
          if (titleMatch) {
            const locator = page.getByTitle(titleMatch[1]);
            selector = `title:${titleMatch[1]}`;
            if (line.includes('.click(')) { action = 'click'; await this.recordStep(context, stepNumber, action, selector, value, 'running'); await locator.first().click(); }
            else if (line.includes('.fill(')) { const fm = line.match(/\.fill\(['"]([^'"]*)['"]\)/); value = fm ? fm[1] : ''; action = 'fill'; await this.recordStep(context, stepNumber, action, selector, value, 'running'); await locator.first().fill(value); }
            else { action = 'locate'; await this.recordStep(context, stepNumber, action, selector, value, 'running'); }
            await this.recordStep(context, stepNumber, action, selector, value, 'passed');
          }

        } else if (line.includes('page.getByLabel(') || line.includes('page.getByRole(') || line.includes('page.getByText(') || line.includes('page.getByPlaceholder(') || line.includes('page.getByTestId(') || line.includes('page.locator(')) {
          // Handle modern Playwright locator API calls — use frame context if inside iframe
          const resolveTarget = activeFrameLocator || page;
          const locator = this.resolveLocator(resolveTarget, line);
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
  private resolveLocator(pageOrFrame: any, line: string): ReturnType<Page['locator']> | null {
    try {
      // page.getByText('text', { exact: false })
      const getByTextMatch = line.match(/getByText\(['"]([^'"]+)['"]/);
      if (getByTextMatch) return pageOrFrame.getByText(getByTextMatch[1], { exact: false });

      // page.getByLabel('label') — with smart fallback chain
      const getByLabelMatch = line.match(/getByLabel\(['"]([^'"]+)['"]/);
      if (getByLabelMatch) {
        const field = getByLabelMatch[1].replace(/[:\s]+$/, '').trim();
        return pageOrFrame.getByLabel(field, { exact: false })
          .or(pageOrFrame.getByPlaceholder(field, { exact: false }))
          .or(pageOrFrame.getByRole('textbox', { name: field }))
          .or(pageOrFrame.locator(`input[name="${field}" i], input[id="${field}" i], textarea[name="${field}" i], input[placeholder="${field}" i]`))
          .or(pageOrFrame.locator(`label:has-text("${field}") + input, label:has-text("${field}") input, td:has-text("${field}") + td input`));
      }

      // page.getByRole('role', { name: 'text' }) — with fallback to other roles
      const getByRoleMatch = line.match(/getByRole\(['"]([^'"]+)['"](?:,\s*\{\s*name:\s*(?:['"]([^'"]+)['"]|\/([^/]+)\/\w*)\s*\})?/);
      if (getByRoleMatch) {
        const role = getByRoleMatch[1] as any;
        const nameStr = getByRoleMatch[2];
        const nameRegex = getByRoleMatch[3];
        if (nameRegex) {
          const regex = new RegExp(nameRegex, 'i');
          return pageOrFrame.getByRole(role, { name: regex })
            .or(pageOrFrame.getByRole('link', { name: regex }))
            .or(pageOrFrame.getByRole('button', { name: regex }))
            .or(pageOrFrame.getByText(regex));
        }
        if (nameStr) {
          return pageOrFrame.getByRole(role, { name: nameStr })
            .or(pageOrFrame.getByRole(role === 'button' ? 'link' : 'button', { name: nameStr }))
            .or(pageOrFrame.getByRole('tab', { name: nameStr }))
            .or(pageOrFrame.getByRole('menuitem', { name: nameStr }))
            .or(pageOrFrame.getByText(nameStr, { exact: true }))
            .or(pageOrFrame.locator(`a:has-text("${nameStr}"), button:has-text("${nameStr}"), input[type="submit"][value="${nameStr}" i]`));
        }
        return pageOrFrame.getByRole(role);
      }

      // page.getByPlaceholder('text') — with fallback
      const getByPlaceholderMatch = line.match(/getByPlaceholder\(['"]([^'"]+)['"]/);
      if (getByPlaceholderMatch) {
        const ph = getByPlaceholderMatch[1];
        return pageOrFrame.getByPlaceholder(ph, { exact: false })
          .or(pageOrFrame.getByLabel(ph, { exact: false }))
          .or(pageOrFrame.locator(`input[placeholder="${ph}" i]`));
      }

      // page.getByTestId('id')
      const getByTestIdMatch = line.match(/getByTestId\(['"]([^'"]+)['"]/);
      if (getByTestIdMatch) return pageOrFrame.getByTestId(getByTestIdMatch[1]);

      // page.getByAltText('text')
      const getByAltMatch = line.match(/getByAltText\(['"]([^'"]+)['"]/);
      if (getByAltMatch) return pageOrFrame.getByAltText(getByAltMatch[1]);

      // page.getByTitle('text')
      const getByTitleMatch = line.match(/getByTitle\(['"]([^'"]+)['"]/);
      if (getByTitleMatch) return pageOrFrame.getByTitle(getByTitleMatch[1]);

      // Fix #2: page.locator('selector') — handle CSS selectors with inner quotes
      // e.g., page.locator('[data-testid="foo"]') — the inner " are different from outer '
      const locSingleMatch = line.match(/(?:page\.)?locator\('((?:[^'\\]|\\.)*)'\)/);
      const locDoubleMatch = line.match(/(?:page\.)?locator\("((?:[^"\\]|\\.)*)"\)/);
      const locMatch = locSingleMatch || locDoubleMatch;
      if (locMatch && locMatch[1]) {
        let loc = pageOrFrame.locator(locMatch[1]);
        const nthMatch = line.match(/\.nth\((\d+)\)/);
        if (nthMatch) loc = loc.nth(parseInt(nthMatch[1])) as any;
        else if (line.includes('.last()')) loc = loc.last() as any;
        else if (line.includes('.first()')) loc = loc.first() as any;
        // Handle .filter({ hasText: 'text' })
        const filterMatch = line.match(/\.filter\(\{\s*hasText:\s*['"]([^'"]+)['"]\s*\}\)/);
        if (filterMatch) loc = loc.filter({ hasText: filterMatch[1] }) as any;
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
    const altMatch = line.match(/getByAltText\(['"]([^'"]+)['"]/);
    if (altMatch) return `alt:${altMatch[1]}`;
    const titleMatch = line.match(/getByTitle\(['"]([^'"]+)['"]/);
    if (titleMatch) return `title:${titleMatch[1]}`;
    // Fix #2: handle CSS selectors with inner quotes
    const locSingle = line.match(/locator\('((?:[^'\\]|\\.)*)'\)/);
    if (locSingle) return locSingle[1];
    const locDouble = line.match(/locator\("((?:[^"\\]|\\.)*)"\)/);
    if (locDouble) return locDouble[1];
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
