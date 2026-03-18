import pool from '../../db';
import { logger } from '../../utils/logger';
import { exec, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { generateSerenityReport, SerenityReportData } from './serenityReport.service';
import { screenplayService } from './screenplay.service';

const execAsync = promisify(exec);

// Track running child processes by runId for cancellation
const runningProcesses = new Map<string, ChildProcess>();

// Report output directory (same as other reports, served by express.static)
const BDD_REPORTS_DIR = path.join(process.cwd(), 'playwright-crx-reports');

// Screenshots/artifacts directory (served statically)
const BDD_ARTIFACTS_DIR = path.join(process.cwd(), 'playwright-crx-reports', 'bdd-artifacts');

// Shared Cucumber environment to avoid per-run npm install
const SHARED_BDD_DIR = path.join(os.tmpdir(), 'bdd-shared-env');
let sharedEnvReady = false;

// Concurrency control for multi-user execution
const MAX_CONCURRENT_RUNS = parseInt(process.env.BDD_MAX_CONCURRENT_RUNS || '3', 10);
const MAX_QUEUED_RUNS = parseInt(process.env.BDD_MAX_QUEUED_RUNS || '20', 10);
let activeRunCount = 0;
const pendingQueue: Array<{ runId: string; resolve: () => void }> = [];

// Live execution streaming via SSE
export const bddEventEmitter = new EventEmitter();
bddEventEmitter.setMaxListeners(100);

// Scheduled runs tracking
const scheduledJobs = new Map<string, NodeJS.Timeout>();

export interface ParsedFeature {
  name: string;
  description: string;
  tags: string[];
  scenarios: ParsedScenario[];
}

export interface ParsedScenario {
  name: string;
  description: string;
  type: 'Scenario' | 'Scenario Outline';
  tags: string[];
  steps: ParsedStep[];
  examples?: Record<string, string>[];
}

export interface ParsedStep {
  keyword: string;
  text: string;
  dataTable?: string[][];
  docString?: string;
}

export interface ExecuteOptions {
  browser?: string;
  executionMode?: string;
  tags?: string;
  parallelWorkers?: number;
}

class BDDService {

  /**
   * Parse Gherkin feature content into structured data
   */
  parseFeatureContent(content: string): ParsedFeature {
    const lines = content.split('\n').map(l => l.trimEnd());
    const feature: ParsedFeature = { name: '', description: '', tags: [], scenarios: [] };

    let currentScenario: ParsedScenario | null = null;
    let currentStep: ParsedStep | null = null;
    let inDocString = false;
    let docStringLines: string[] = [];
    let inExamples = false;
    let exampleHeaders: string[] = [];
    let featureDescLines: string[] = [];
    let inFeatureDesc = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Doc string delimiter
      if (line.startsWith('"""') || line.startsWith("'''")) {
        if (inDocString) {
          if (currentStep) currentStep.docString = docStringLines.join('\n');
          inDocString = false;
          docStringLines = [];
        } else {
          inDocString = true;
        }
        continue;
      }
      if (inDocString) {
        docStringLines.push(rawLine);
        continue;
      }

      // Skip comments and empty lines in certain contexts
      if (line.startsWith('#')) continue;

      // Tags
      if (line.startsWith('@')) {
        const tags = line.split(/\s+/).filter(t => t.startsWith('@'));
        if (!feature.name) {
          feature.tags.push(...tags);
        } else if (currentScenario === null || !currentStep) {
          // Tags for next scenario
          if (currentScenario) {
            feature.scenarios.push(currentScenario);
          }
          currentScenario = null;
          // Store tags temporarily - they'll be picked up by the next Scenario line
          feature.tags.push(...tags.map(t => `scenario:${t}`));
        }
        continue;
      }

      // Feature line
      if (line.startsWith('Feature:')) {
        feature.name = line.replace('Feature:', '').trim();
        inFeatureDesc = true;
        continue;
      }

      // Scenario / Scenario Outline
      if (line.startsWith('Scenario Outline:') || line.startsWith('Scenario Template:')) {
        if (currentScenario) feature.scenarios.push(currentScenario);
        inFeatureDesc = false;
        inExamples = false;
        const scenarioTags = feature.tags.filter(t => t.startsWith('scenario:')).map(t => t.replace('scenario:', ''));
        feature.tags = feature.tags.filter(t => !t.startsWith('scenario:'));
        currentScenario = {
          name: line.replace(/Scenario (Outline|Template):/, '').trim(),
          description: '',
          type: 'Scenario Outline',
          tags: scenarioTags,
          steps: [],
          examples: [],
        };
        currentStep = null;
        continue;
      }
      if (line.startsWith('Scenario:')) {
        if (currentScenario) feature.scenarios.push(currentScenario);
        inFeatureDesc = false;
        inExamples = false;
        const scenarioTags = feature.tags.filter(t => t.startsWith('scenario:')).map(t => t.replace('scenario:', ''));
        feature.tags = feature.tags.filter(t => !t.startsWith('scenario:'));
        currentScenario = {
          name: line.replace('Scenario:', '').trim(),
          description: '',
          type: 'Scenario',
          tags: scenarioTags,
          steps: [],
        };
        currentStep = null;
        continue;
      }

      // Background
      if (line.startsWith('Background:')) {
        if (currentScenario) feature.scenarios.push(currentScenario);
        inFeatureDesc = false;
        inExamples = false;
        currentScenario = {
          name: 'Background',
          description: '',
          type: 'Scenario',
          tags: ['@background'],
          steps: [],
        };
        currentStep = null;
        continue;
      }

      // Examples
      if (line.startsWith('Examples:') || line.startsWith('Scenarios:')) {
        inExamples = true;
        exampleHeaders = [];
        continue;
      }

      // Data table / examples row
      if (line.startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim());
        if (inExamples && currentScenario) {
          if (exampleHeaders.length === 0) {
            exampleHeaders = cells;
          } else {
            const row: Record<string, string> = {};
            cells.forEach((cell, i) => { row[exampleHeaders[i]] = cell; });
            if (!currentScenario.examples) currentScenario.examples = [];
            currentScenario.examples.push(row);
          }
        } else if (currentStep) {
          if (!currentStep.dataTable) currentStep.dataTable = [];
          currentStep.dataTable.push(cells);
        }
        continue;
      }

      // Step keywords
      const stepMatch = line.match(/^(Given|When|Then|And|But)\s+(.*)/);
      if (stepMatch && currentScenario) {
        inExamples = false;
        currentStep = { keyword: stepMatch[1], text: stepMatch[2] };
        currentScenario.steps.push(currentStep);
        continue;
      }

      // Feature description
      if (inFeatureDesc && line) {
        featureDescLines.push(line);
      }
    }

    if (currentScenario) feature.scenarios.push(currentScenario);
    feature.description = featureDescLines.join('\n');

    return feature;
  }

  /**
   * Generate Playwright test code from a parsed feature
   * @param language - 'typescript' (default) or 'java'
   */
  generatePlaywrightCode(feature: ParsedFeature, language: 'typescript' | 'java' = 'typescript'): string {
    if (language === 'java') return this.generateJavaPlaywrightCode(feature);

    const lines: string[] = [];
    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push('');
    lines.push(`test.describe('${this.escapeString(feature.name)}', () => {`);

    for (const scenario of feature.scenarios) {
      if (scenario.tags.includes('@background')) continue;

      if (scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0) {
        for (let i = 0; i < scenario.examples.length; i++) {
          const example = scenario.examples[i];
          const paramStr = Object.entries(example).map(([k, v]) => `${k}=${v}`).join(', ');
          lines.push(`  test('${this.escapeString(scenario.name)} (${paramStr})', async ({ page }) => {`);
          for (const step of scenario.steps) {
            let stepText = step.text;
            for (const [key, value] of Object.entries(example)) {
              stepText = stepText.replace(new RegExp(`<${key}>`, 'g'), value);
            }
            lines.push(`    // ${step.keyword} ${stepText}`);
            lines.push(`    ${this.generateStepCode(step.keyword, stepText)}`);
          }
          lines.push('  });');
          lines.push('');
        }
      } else {
        lines.push(`  test('${this.escapeString(scenario.name)}', async ({ page }) => {`);
        for (const step of scenario.steps) {
          lines.push(`    // ${step.keyword} ${step.text}`);
          lines.push(`    ${this.generateStepCode(step.keyword, step.text)}`);
        }
        lines.push('  });');
        lines.push('');
      }
    }

    lines.push('});');
    return lines.join('\n');
  }

  /**
   * Generate Java (JUnit 5 + Playwright for Java) test code from a parsed feature
   */
  private generateJavaPlaywrightCode(feature: ParsedFeature): string {
    const className = this.toJavaClassName(feature.name) + 'Test';
    const lines: string[] = [];

    lines.push(`import com.microsoft.playwright.*;`);
    lines.push(`import com.microsoft.playwright.options.AriaRole;`);
    lines.push(`import org.junit.jupiter.api.*;`);
    lines.push(`import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;`);
    lines.push('');
    lines.push(`public class ${className} {`);
    lines.push('');

    for (const scenario of feature.scenarios) {
      if (scenario.tags.includes('@background')) continue;

      if (scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0) {
        for (let i = 0; i < scenario.examples.length; i++) {
          const example = scenario.examples[i];
          const paramStr = Object.entries(example).map(([k, v]) => `${k}=${v}`).join('_');
          const methodName = this.toJavaMethodName(`${scenario.name}_${paramStr}`);
          lines.push(`    @Test`);
          lines.push(`    public void ${methodName}() {`);
          lines.push(`        try (Playwright playwright = Playwright.create()) {`);
          lines.push(`            Browser browser = playwright.chromium().launch();`);
          lines.push(`            BrowserContext context = browser.newContext();`);
          lines.push(`            Page page = context.newPage();`);
          lines.push('');
          for (const step of scenario.steps) {
            let stepText = step.text;
            for (const [key, value] of Object.entries(example)) {
              stepText = stepText.replace(new RegExp(`<${key}>`, 'g'), value);
            }
            lines.push(`            // ${step.keyword} ${stepText}`);
            lines.push(`            ${this.generateJavaStepCode(step.keyword, stepText)}`);
          }
          lines.push('');
          lines.push(`            context.close();`);
          lines.push(`            browser.close();`);
          lines.push(`        }`);
          lines.push(`    }`);
          lines.push('');
        }
      } else {
        const methodName = this.toJavaMethodName(scenario.name);
        lines.push(`    @Test`);
        lines.push(`    public void ${methodName}() {`);
        lines.push(`        try (Playwright playwright = Playwright.create()) {`);
        lines.push(`            Browser browser = playwright.chromium().launch();`);
        lines.push(`            BrowserContext context = browser.newContext();`);
        lines.push(`            Page page = context.newPage();`);
        lines.push('');
        for (const step of scenario.steps) {
          lines.push(`            // ${step.keyword} ${step.text}`);
          lines.push(`            ${this.generateJavaStepCode(step.keyword, step.text)}`);
        }
        lines.push('');
        lines.push(`            context.close();`);
        lines.push(`            browser.close();`);
        lines.push(`        }`);
        lines.push(`    }`);
        lines.push('');
      }
    }

    lines.push(`}`);
    return lines.join('\n');
  }

  private generateJavaStepCode(keyword: string, text: string): string {
    const lower = text.toLowerCase();

    if (lower.includes('navigate') || lower.includes('go to') || lower.includes('open') || lower.includes('visit')) {
      const urlMatch = text.match(/"([^"]+)"|'([^']+)'|(\S+(?:\.com|\.org|\.net|\.io)\S*)/);
      if (urlMatch) {
        const url = urlMatch[1] || urlMatch[2] || urlMatch[3];
        return `page.navigate("${url}");`;
      }
      return `page.navigate(/* URL */);`;
    }

    if (lower.includes('click')) {
      const targetMatch = text.match(/"([^"]+)"|'([^']+)'/);
      if (targetMatch) {
        const target = (targetMatch[1] || targetMatch[2]).replace(/"/g, '\\"');
        return `page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("${target}")).click();`;
      }
      return `page.locator(/* selector */).click();`;
    }

    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter')) {
      const matches = text.match(/"([^"]+)"/g);
      if (matches && matches.length >= 2) {
        const field = matches[0].replace(/"/g, '');
        const value = matches[matches.length - 1].replace(/"/g, '');
        return `page.getByLabel("${field.replace(/"/g, '\\"')}").fill("${value.replace(/"/g, '\\"')}");`;
      }
      if (matches && matches.length === 1) {
        const value = matches[0].replace(/"/g, '');
        return `page.locator(/* field selector */).fill("${value.replace(/"/g, '\\"')}");`;
      }
      return `page.locator(/* field selector */).fill(/* value */);`;
    }

    if (lower.includes('see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown')) {
      const targetMatch = text.match(/"([^"]+)"|'([^']+)'/);
      if (targetMatch) {
        const target = (targetMatch[1] || targetMatch[2]).replace(/"/g, '\\"');
        return `assertThat(page.getByText("${target}")).isVisible();`;
      }
      return `assertThat(page.locator(/* selector */)).isVisible();`;
    }

    if (lower.includes('contain') || lower.includes('have text')) {
      const targetMatch = text.match(/"([^"]+)"|'([^']+)'/);
      if (targetMatch) {
        const target = (targetMatch[1] || targetMatch[2]).replace(/"/g, '\\"');
        return `assertThat(page.locator("body")).containsText("${target}");`;
      }
      return `assertThat(page.locator(/* selector */)).containsText(/* text */);`;
    }

    if (lower.includes('wait')) {
      const timeMatch = text.match(/(\d+)\s*(seconds?|ms|milliseconds?)/);
      if (timeMatch) {
        const ms = timeMatch[2].startsWith('s') ? parseInt(timeMatch[1]) * 1000 : parseInt(timeMatch[1]);
        return `page.waitForTimeout(${ms});`;
      }
      return `page.waitForTimeout(1000);`;
    }

    if (lower.includes('select') || lower.includes('choose')) {
      const matches = text.match(/"([^"]+)"/g);
      if (matches && matches.length >= 1) {
        const value = matches[matches.length - 1].replace(/"/g, '');
        return `page.selectOption(/* selector */, "${value.replace(/"/g, '\\"')}");`;
      }
    }

    return `// TODO: Implement step - ${keyword} ${text}`;
  }

  private toJavaClassName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  }

  private toJavaMethodName(name: string): string {
    const words = name.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/);
    return words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  }

  private generateStepCode(keyword: string, text: string): string {
    const lower = text.toLowerCase();

    if (lower.includes('navigate') || lower.includes('go to') || lower.includes('open') || lower.includes('visit')) {
      const urlMatch = text.match(/"([^"]+)"|'([^']+)'|(\S+(?:\.com|\.org|\.net|\.io)\S*)/);
      if (urlMatch) {
        const url = urlMatch[1] || urlMatch[2] || urlMatch[3];
        return `await page.goto('${url}');`;
      }
      return `await page.goto('/* URL */');`;
    }

    if (lower.includes('click')) {
      const targetMatch = text.match(/"([^"]+)"|'([^']+)'/);
      if (targetMatch) {
        const target = targetMatch[1] || targetMatch[2];
        return `await page.getByRole('button', { name: '${this.escapeString(target)}' }).click();`;
      }
      return `await page.click('/* selector */');`;
    }

    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter')) {
      const matches = text.match(/"([^"]+)"/g);
      if (matches && matches.length >= 2) {
        const value = matches[matches.length - 1].replace(/"/g, '');
        const field = matches[0].replace(/"/g, '');
        return `await page.getByLabel('${this.escapeString(field)}').fill('${this.escapeString(value)}');`;
      }
      if (matches && matches.length === 1) {
        const value = matches[0].replace(/"/g, '');
        return `await page.locator('/* field selector */').fill('${this.escapeString(value)}');`;
      }
      return `await page.locator('/* field selector */').fill('/* value */');`;
    }

    if (lower.includes('see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown')) {
      const targetMatch = text.match(/"([^"]+)"|'([^']+)'/);
      if (targetMatch) {
        const target = targetMatch[1] || targetMatch[2];
        return `await expect(page.getByText('${this.escapeString(target)}', { exact: true })).toBeVisible();`;
      }
      return `await expect(page.locator('/* selector */')).toBeVisible();`;
    }

    if (lower.includes('contain') || lower.includes('have text')) {
      const targetMatch = text.match(/"([^"]+)"|'([^']+)'/);
      if (targetMatch) {
        const target = targetMatch[1] || targetMatch[2];
        return `await expect(page.locator('body')).toContainText('${this.escapeString(target)}');`;
      }
      return `await expect(page.locator('/* selector */')).toContainText('/* text */');`;
    }

    if (lower.includes('wait')) {
      const timeMatch = text.match(/(\d+)\s*(seconds?|ms|milliseconds?)/);
      if (timeMatch) {
        const ms = timeMatch[2].startsWith('s') ? parseInt(timeMatch[1]) * 1000 : parseInt(timeMatch[1]);
        return `await page.waitForTimeout(${ms});`;
      }
      return `await page.waitForTimeout(1000);`;
    }

    if (lower.includes('select') || lower.includes('choose')) {
      const matches = text.match(/"([^"]+)"/g);
      if (matches && matches.length >= 1) {
        const value = matches[matches.length - 1].replace(/"/g, '');
        return `await page.selectOption('/* selector */', '${this.escapeString(value)}');`;
      }
    }

    return `// TODO: Implement step - ${keyword} ${text}`;
  }

  private escapeString(s: string): string {
    return s.replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }

  /**
   * Preprocess feature content to auto-quote raw URLs in step text.
   * Cucumber Expression treats '/' as alternative separator and '{...}' as parameter types,
   * so raw URLs like https://foo.com/{bar}/path break parsing.
   * This wraps unquoted URLs in double quotes so they become {string} parameters.
   */
  private preprocessFeatureContent(content: string): string {
    return content.split('\n').map(line => {
      const trimmed = line.trim();
      // Only process step lines (Given/When/Then/And/But)
      if (/^(Given|When|Then|And|But)\s+/i.test(trimmed)) {
        // Find unquoted URLs (http:// or https:// not already inside quotes)
        // Match URLs that are NOT preceded by a double quote
        return line.replace(
          /(?<!")(https?:\/\/[^\s"]+)/g,
          '"$1"'
        );
      }
      return line;
    }).join('\n');
  }

  /**
   * Ensure shared Cucumber environment is set up (one-time)
   */
  private async ensureSharedEnv(): Promise<void> {
    if (sharedEnvReady) return;

    const cucumberBin = path.join(SHARED_BDD_DIR, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber-js');
    const cucumberExists = fs.existsSync(cucumberBin);
    const playwrightExists = fs.existsSync(path.join(SHARED_BDD_DIR, 'node_modules', 'playwright'));

    if (cucumberExists && playwrightExists) {
      logger.info('BDD: Shared environment already exists on disk, skipping install');
      sharedEnvReady = true;
      return;
    }

    logger.info('BDD: Setting up shared Cucumber environment...');
    fs.mkdirSync(SHARED_BDD_DIR, { recursive: true });

    const pkgJson = {
      name: 'bdd-shared',
      private: true,
      dependencies: {
        '@cucumber/cucumber': '^10.0.0',
        'playwright': '^1.49.0',
        '@playwright/test': '^1.49.0',
      },
    };
    fs.writeFileSync(path.join(SHARED_BDD_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2));

    await execAsync('npm install --omit=dev', { cwd: SHARED_BDD_DIR, timeout: 180000 });

    try {
      await execAsync('npx playwright install chrome', { cwd: SHARED_BDD_DIR, timeout: 300000 });
      logger.info('BDD: Chrome browser installed');
    } catch (e: any) {
      logger.warn(`BDD: Playwright install chrome warning: ${e.message}`);
    }

    sharedEnvReady = true;
    logger.info('BDD: Shared environment ready');
  }

  private async acquireSlot(runId: string): Promise<void> {
    if (activeRunCount < MAX_CONCURRENT_RUNS) {
      activeRunCount++;
      logger.info(`BDD: Slot acquired for ${runId} (${activeRunCount}/${MAX_CONCURRENT_RUNS} active)`);
      return;
    }

    if (pendingQueue.length >= MAX_QUEUED_RUNS) {
      throw new Error(`BDD queue is full (${MAX_QUEUED_RUNS} runs waiting). Try again later.`);
    }

    logger.info(`BDD: Run ${runId} queued (${pendingQueue.length + 1} waiting, ${activeRunCount} active)`);

    await pool.query(
      `UPDATE "BDDRun" SET status = 'queued', "updatedAt" = now() WHERE id = $1`,
      [runId]
    );

    await new Promise<void>((resolve) => {
      pendingQueue.push({ runId, resolve });
    });

    activeRunCount++;
    logger.info(`BDD: Slot acquired for ${runId} after waiting (${activeRunCount}/${MAX_CONCURRENT_RUNS} active)`);
  }

  private releaseSlot(): void {
    activeRunCount = Math.max(0, activeRunCount - 1);
    const next = pendingQueue.shift();
    if (next) {
      logger.info(`BDD: Dequeuing run ${next.runId} (${pendingQueue.length} still waiting)`);
      next.resolve();
    }
  }

  getExecutionStatus(): { activeRuns: number; queuedRuns: number; maxConcurrent: number } {
    return {
      activeRuns: activeRunCount,
      queuedRuns: pendingQueue.length,
      maxConcurrent: MAX_CONCURRENT_RUNS,
    };
  }

  /**
   * Emit a live execution event via SSE
   */
  private emitEvent(runId: string, event: string, data: any): void {
    bddEventEmitter.emit(`run:${runId}`, { event, data, timestamp: Date.now() });
  }

  /**
   * Execute a BDD feature using Cucumber.js
   * Enhanced with: tags, parallel, screenshots, live streaming
   */
  async executeFeature(
    runId: string,
    featureContent: string,
    stepDefinitions: Record<string, string>,
    options: ExecuteOptions = {},
    userId?: string,
    organizationId?: string | null
  ): Promise<void> {
    const runDir = path.join(SHARED_BDD_DIR, 'runs', runId);
    const screenshotDir = path.join(BDD_ARTIFACTS_DIR, runId);

    try {
      await this.acquireSlot(runId);

      // Emit live event: started
      this.emitEvent(runId, 'status', { status: 'running' });

      await pool.query(
        `UPDATE "BDDRun" SET status = 'running', "startedAt" = now(), "updatedAt" = now() WHERE id = $1`,
        [runId]
      );

      await this.ensureSharedEnv();

      // Create run-specific directories
      const featuresDir = path.join(runDir, 'features');
      const stepDefsDir = path.join(featuresDir, 'step_definitions');
      fs.mkdirSync(stepDefsDir, { recursive: true });
      fs.mkdirSync(screenshotDir, { recursive: true });

      // Write feature file
      const featuresPath = path.join(featuresDir, 'test.feature');
      const processedContent = this.preprocessFeatureContent(featureContent);
      fs.writeFileSync(featuresPath, processedContent);

      // Load reusable step library definitions from DB (scoped to user/org)
      const librarySteps = await this.loadStepLibrary(options, userId, organizationId);

      // Load Screenplay Pattern task definitions
      let screenplayDefs: Record<string, string> = {};
      if (userId) {
        try {
          const screenplayCode = await screenplayService.loadScreenplayStepDefinitions(userId, organizationId || null);
          if (screenplayCode) {
            screenplayDefs = { __screenplay__: screenplayCode };
          }
        } catch (e: any) {
          logger.warn(`BDD Run ${runId}: Failed to load Screenplay defs: ${e.message}`);
        }
      }

      // Merge library steps, screenplay defs, and custom defs
      const mergedDefs = { ...librarySteps, ...screenplayDefs, ...stepDefinitions };

      // Write step definitions (with screenshot support and World class)
      const stepDefCode = this.buildStepDefinitions(mergedDefs, featureContent, screenshotDir, runId, options);
      const stepsPath = path.join(stepDefsDir, 'steps.js');
      fs.writeFileSync(stepsPath, stepDefCode);

      logger.info(`BDD Run ${runId}: Generated step defs:\n${stepDefCode.substring(0, 2000)}`);

      // Build cucumber command with optional tags and parallel workers
      const cucumberEntry = path.join(SHARED_BDD_DIR, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber-js');
      const resultsPath = path.join(runDir, 'results.json');

      let cmd = `node "${cucumberEntry}" --require "${stepsPath}" --format json:"${resultsPath}" "${featuresPath}"`;

      // Tag-based filtering (e.g., "@smoke", "@smoke and not @wip")
      if (options.tags) {
        cmd += ` --tags "${options.tags}"`;
        logger.info(`BDD Run ${runId}: Filtering by tags: ${options.tags}`);
      }

      // Parallel scenario execution
      const parallelWorkers = options.parallelWorkers || 1;
      if (parallelWorkers > 1) {
        cmd += ` --parallel ${parallelWorkers}`;
        logger.info(`BDD Run ${runId}: Running with ${parallelWorkers} parallel workers`);
      }

      logger.info(`BDD Run ${runId}: Command: ${cmd}`);

      // Run cucumber with child process tracking
      const startTime = Date.now();
      let cucumberStdout = '';
      let cucumberStderr = '';

      try {
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const child = exec(cmd, {
            cwd: SHARED_BDD_DIR,
            timeout: 120000,
            env: { ...process.env, NODE_PATH: path.join(SHARED_BDD_DIR, 'node_modules') },
          }, (error, stdout, stderr) => {
            runningProcesses.delete(runId);
            if (error && (error as any).killed) {
              reject(new Error('Run was cancelled'));
            } else {
              resolve({ stdout: stdout || '', stderr: stderr || '' });
            }
          });
          runningProcesses.set(runId, child);

          // Stream stdout lines for live updates
          if (child.stdout) {
            child.stdout.on('data', (chunk: string) => {
              this.emitEvent(runId, 'output', { text: chunk.toString() });
            });
          }
          if (child.stderr) {
            child.stderr.on('data', (chunk: string) => {
              this.emitEvent(runId, 'output', { text: chunk.toString(), isError: true });
            });
          }
        });
        cucumberStdout = stdout;
        cucumberStderr = stderr;
      } catch (execError: any) {
        if (execError.message === 'Run was cancelled') {
          this.emitEvent(runId, 'status', { status: 'cancelled' });
          await pool.query(
            `UPDATE "BDDRun" SET status = 'cancelled', "errorMsg" = 'Run was cancelled by user', "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
            [runId]
          );
          return;
        }
        cucumberStdout = execError.stdout || '';
        cucumberStderr = execError.stderr || '';
        logger.info(`BDD Run ${runId}: Cucumber exit code: ${execError.code}`);
      }

      logger.info(`BDD Run ${runId}: stdout: ${cucumberStdout.substring(0, 1000)}`);
      if (cucumberStderr) logger.info(`BDD Run ${runId}: stderr: ${cucumberStderr.substring(0, 1000)}`);

      const duration = Date.now() - startTime;

      // Parse results
      let stepResults: any[] = [];
      let totalSteps = 0, passedSteps = 0, failedSteps = 0, skippedSteps = 0;
      let overallStatus = 'passed';
      let errorMsg = '';

      const resultsFile = path.join(runDir, 'results.json');
      if (fs.existsSync(resultsFile)) {
        const resultsRaw = fs.readFileSync(resultsFile, 'utf-8');
        logger.info(`BDD Run ${runId}: results.json size: ${resultsRaw.length}`);

        if (resultsRaw.trim()) {
          const results = JSON.parse(resultsRaw);
          for (const feature of results) {
            for (const element of feature.elements || []) {
              for (const step of element.steps || []) {
                // Skip Cucumber's internal Before/After hooks (no keyword or name)
                if (!step.keyword && !step.name) continue;
                totalSteps++;
                const stepResult: any = {
                  keyword: step.keyword?.trim() || '',
                  name: step.name || '',
                  status: step.result?.status || 'undefined',
                  duration: step.result?.duration ? Math.round(step.result.duration / 1e6) : null,
                  errorMessage: step.result?.error_message || null,
                };
                stepResults.push(stepResult);

                // Emit live step result
                this.emitEvent(runId, 'step', { index: totalSteps - 1, ...stepResult });

                if (stepResult.status === 'passed') passedSteps++;
                else if (stepResult.status === 'failed') { failedSteps++; overallStatus = 'failed'; }
                else { skippedSteps++; }
              }
            }
          }
        } else {
          overallStatus = 'failed';
          errorMsg = 'results.json was empty';
        }
      } else {
        overallStatus = 'failed';
        errorMsg = `Cucumber did not produce results. Output: ${(cucumberStderr || cucumberStdout).substring(0, 2000)}`;
        logger.error(`BDD Run ${runId}: results.json not found`);
      }

      // Collect screenshot URLs
      const screenshotUrls = this.collectScreenshots(runId, screenshotDir);

      // Parse feature for narrative and scenario info
      const parsedForReport = this.parseFeatureContent(featureContent);

      // Generate Serenity-style HTML report with narrative/business context
      const serenityData: SerenityReportData = {
        runId,
        featureName: parsedForReport.name || 'BDD Test',
        featureDescription: parsedForReport.description,
        featureContent,
        featureTags: parsedForReport.tags,
        scenarios: [],  // will be auto-grouped from stepResults
        stepResults,
        summary: { status: overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps, errorMsg },
        screenshotUrls,
      };
      const reportUrl = await generateSerenityReport(serenityData, BDD_REPORTS_DIR);

      // Update run in DB
      await pool.query(
        `UPDATE "BDDRun" SET
          status = $1, duration = $2,
          "totalSteps" = $3, "passedSteps" = $4, "failedSteps" = $5, "skippedSteps" = $6,
          "stepResults" = $7, "errorMsg" = $8, "reportUrl" = $10, "screenshotUrls" = $11,
          "completedAt" = now(), "updatedAt" = now()
         WHERE id = $9`,
        [overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps,
          JSON.stringify(stepResults), errorMsg || null, runId, reportUrl, JSON.stringify(screenshotUrls)]
      );

      // Emit live event: completed
      this.emitEvent(runId, 'completed', {
        status: overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps,
        reportUrl, screenshotUrls,
      });

      logger.info(`BDD Run ${runId}: Completed - ${overallStatus} (${passedSteps}/${totalSteps} passed), screenshots: ${screenshotUrls.length}, report: ${reportUrl}`);
    } catch (error: any) {
      logger.error(`BDD Run ${runId}: Execution error: ${error.message}`);
      this.emitEvent(runId, 'error', { message: error.message });

      // Generate report even for errored runs
      let reportUrl = '';
      try {
        const parsedForReport = this.parseFeatureContent(featureContent);
        const serenityData: SerenityReportData = {
          runId,
          featureName: parsedForReport.name || 'BDD Test',
          featureDescription: parsedForReport.description,
          featureContent,
          featureTags: parsedForReport.tags,
          scenarios: [],
          stepResults: [],
          summary: { status: 'failed', duration: 0, totalSteps: 0, passedSteps: 0, failedSteps: 0, skippedSteps: 0, errorMsg: error.message },
          screenshotUrls: [],
        };
        reportUrl = await generateSerenityReport(serenityData, BDD_REPORTS_DIR);
      } catch (reportErr: any) {
        logger.warn(`BDD Run ${runId}: Failed to generate error report: ${reportErr.message}`);
      }

      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "reportUrl" = $3, "completedAt" = now(), "updatedAt" = now() WHERE id = $2`,
        [error.message, runId, reportUrl || null]
      );
    } finally {
      this.releaseSlot();

      // Cleanup run directory only (keep shared env and screenshots)
      try {
        fs.rmSync(runDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  /**
   * Load step library definitions from DB for the user/org
   */
  private async loadStepLibrary(_options: ExecuteOptions, userId?: string, organizationId?: string | null): Promise<Record<string, string>> {
    try {
      let query = `SELECT id, pattern, code, keyword FROM "BDDStepLibrary"`;
      const params: any[] = [];
      const conditions: string[] = [];

      if (userId) {
        conditions.push(`"userId" = $${conditions.length + 1}`);
        params.push(userId);
      }
      if (organizationId) {
        conditions.push(`"organizationId" = $${conditions.length + 1}`);
        params.push(organizationId);
      }

      if (conditions.length > 0) {
        query += ` WHERE (${conditions.join(' OR ')})`;
      }
      query += ` ORDER BY "usageCount" DESC`;

      const { rows } = await pool.query(query, params);
      if (rows.length === 0) return {};

      const libraryCode = rows.map(row => row.code).join('\n\n');
      // Increment usage counts using id (primary key)
      const ids = rows.map(r => r.id);
      if (ids.length > 0) {
        await pool.query(
          `UPDATE "BDDStepLibrary" SET "usageCount" = "usageCount" + 1 WHERE id = ANY($1)`,
          [ids]
        );
      }
      return { __library__: libraryCode };
    } catch {
      return {};
    }
  }

  /**
   * Collect screenshot files from the screenshot directory
   */
  private collectScreenshots(runId: string, screenshotDir: string): string[] {
    const urls: string[] = [];
    try {
      if (!fs.existsSync(screenshotDir)) return urls;
      const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
      for (const file of files) {
        urls.push(`/playwright-crx-reports/bdd-artifacts/${runId}/${file}`);
      }
    } catch {
      // ignore
    }
    return urls;
  }

  /**
   * Build step definition code with Cucumber World, hooks, screenshot capture, and library support
   */
  private buildStepDefinitions(
    customDefs: Record<string, string>,
    featureContent: string,
    screenshotDir: string,
    _runId: string,
    options: ExecuteOptions = {}
  ): string {
    const lines: string[] = [];
    lines.push(`const { Given, When, Then, Before, After, BeforeAll, AfterAll, BeforeStep, AfterStep, setWorldConstructor, setDefaultTimeout } = require('@cucumber/cucumber');`);
    lines.push(`const { chromium, firefox, webkit } = require('playwright');`);
    lines.push(`const path = require('path');`);
    lines.push(`const fs = require('fs');`);
    lines.push('');

    // Default timeout configuration
    lines.push(`// Configure default step timeout (60 seconds)`);
    lines.push(`setDefaultTimeout(60 * 1000);`);
    lines.push('');

    // Cucumber World class for shared state between steps
    lines.push(`// ========================================`);
    lines.push(`// Cucumber World - Shared State Management`);
    lines.push(`// ========================================`);
    lines.push(`class PlaywrightWorld {`);
    lines.push(`  constructor(options) {`);
    lines.push(`    // Playwright objects (set by hooks)`);
    lines.push(`    this.browser = null;`);
    lines.push(`    this.context = null;`);
    lines.push(`    this.page = null;`);
    lines.push('');
    lines.push(`    // Shared state between steps`);
    lines.push(`    this.state = {};`);
    lines.push(`    this.testData = {};`);
    lines.push(`    this.responses = {};`);
    lines.push(`    this.screenshots = [];`);
    lines.push('');
    lines.push(`    // Scenario metadata`);
    lines.push(`    this.scenarioName = '';`);
    lines.push(`    this.scenarioTags = [];`);
    lines.push(`    this.stepIndex = 0;`);
    lines.push(`    this.startTime = Date.now();`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  // Store a value for sharing between steps`);
    lines.push(`  set(key, value) { this.state[key] = value; }`);
    lines.push(`  get(key) { return this.state[key]; }`);
    lines.push('');
    lines.push(`  // Store test data (e.g., from data tables)`);
    lines.push(`  setTestData(key, value) { this.testData[key] = value; }`);
    lines.push(`  getTestData(key) { return this.testData[key]; }`);
    lines.push('');
    lines.push(`  // Store API/action responses`);
    lines.push(`  setResponse(key, value) { this.responses[key] = value; }`);
    lines.push(`  getResponse(key) { return this.responses[key]; }`);
    lines.push('');
    lines.push(`  // Take a screenshot and store it`);
    lines.push(`  async takeScreenshot(name) {`);
    lines.push(`    if (!this.page) return null;`);
    lines.push(`    const screenshotDir = ${JSON.stringify(screenshotDir.replace(/\\/g, '/'))};`);
    lines.push(`    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });`);
    lines.push(`    const fileName = name + '-' + Date.now() + '.png';`);
    lines.push(`    const filePath = path.join(screenshotDir, fileName);`);
    lines.push(`    const screenshot = await this.page.screenshot({ fullPage: true });`);
    lines.push(`    fs.writeFileSync(filePath, screenshot);`);
    lines.push(`    this.screenshots.push(fileName);`);
    lines.push(`    try { this.attach(screenshot, 'image/png'); } catch(e) {}`);
    lines.push(`    return fileName;`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
    lines.push(`setWorldConstructor(PlaywrightWorld);`);
    lines.push('');

    // Browser selection based on options
    const browserType = options.browser || 'chromium';
    const headless = options.executionMode !== 'headed';

    lines.push(`// ========================================`);
    lines.push(`// Lifecycle Hooks`);
    lines.push(`// ========================================`);
    lines.push(`let browser;`);
    lines.push(`let scenarioCount = 0;`);
    lines.push('');

    // BeforeAll: Launch browser once
    lines.push('// Launch browser once for all scenarios');
    lines.push(`BeforeAll(async function () {`);
    if (browserType === 'firefox') {
      lines.push(`  const launchOptions = { headless: ${headless} };`);
      lines.push(`  browser = await firefox.launch(launchOptions);`);
    } else if (browserType === 'webkit') {
      lines.push(`  const launchOptions = { headless: ${headless} };`);
      lines.push(`  browser = await webkit.launch(launchOptions);`);
    } else {
      lines.push(`  const launchOptions = { headless: ${headless}, channel: 'chrome' };`);
      lines.push(`  browser = await chromium.launch(launchOptions);`);
    }
    lines.push('});');
    lines.push('');

    // Before: Create context and page, attach to World
    lines.push(`Before(async function (scenario) {`);
    lines.push(`  scenarioCount++;`);
    lines.push(`  this.scenarioName = scenario.pickle.name;`);
    lines.push(`  this.scenarioTags = scenario.pickle.tags.map(t => t.name);`);
    lines.push(`  this.startTime = Date.now();`);
    lines.push(`  this.stepIndex = 0;`);
    lines.push('');
    lines.push(`  // Create isolated browser context per scenario`);
    lines.push(`  this.context = await browser.newContext({`);
    lines.push(`    viewport: { width: 1280, height: 720 },`);
    lines.push(`    ignoreHTTPSErrors: true,`);
    lines.push(`  });`);
    lines.push(`  this.page = await this.context.newPage();`);
    lines.push('');
    lines.push(`  // Enable console log capture`);
    lines.push(`  this.page.on('console', msg => {`);
    lines.push(`    if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());`);
    lines.push(`  });`);
    lines.push('});');
    lines.push('');

    // Before with tag filter: database setup for @database tagged scenarios
    lines.push(`// Tag-based hooks`);
    lines.push(`Before({ tags: '@api' }, async function () {`);
    lines.push(`  this.set('isApiTest', true);`);
    lines.push(`});`);
    lines.push('');
    lines.push(`Before({ tags: '@slow' }, async function () {`);
    lines.push(`  this.page.setDefaultTimeout(30000);`);
    lines.push(`});`);
    lines.push('');

    // BeforeStep / AfterStep for step-level tracking
    lines.push(`// Step-level hooks for tracking`);
    lines.push(`BeforeStep(async function () {`);
    lines.push(`  this.stepIndex++;`);
    lines.push(`});`);
    lines.push('');
    lines.push(`AfterStep(async function (step) {`);
    lines.push(`  // Auto-screenshot on step failure`);
    lines.push(`  if (step.result && step.result.status === 'FAILED' && this.page) {`);
    lines.push(`    try {`);
    lines.push(`      await this.takeScreenshot('step-fail-' + this.stepIndex);`);
    lines.push(`    } catch (e) { /* ignore */ }`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');

    // After: Capture screenshots on failure, cleanup context
    lines.push(`After(async function (scenario) {`);
    lines.push(`  const duration = Date.now() - this.startTime;`);
    lines.push(`  console.log('[SCENARIO] ' + this.scenarioName + ' - ' + scenario.result.status + ' (' + duration + 'ms)');`);
    lines.push('');
    lines.push(`  if (scenario.result && scenario.result.status === 'FAILED' && this.page) {`);
    lines.push(`    try {`);
    lines.push(`      await this.takeScreenshot('failure-scenario-' + scenarioCount);`);
    lines.push(`    } catch (e) { console.error('Screenshot error:', e.message); }`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  // Cleanup browser context`);
    lines.push(`  if (this.context) {`);
    lines.push(`    await this.context.close();`);
    lines.push(`    this.context = null;`);
    lines.push(`    this.page = null;`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  // Reset shared state for next scenario`);
    lines.push(`  this.state = {};`);
    lines.push(`  this.testData = {};`);
    lines.push(`  this.responses = {};`);
    lines.push(`  this.screenshots = [];`);
    lines.push('});');
    lines.push('');

    // AfterAll: Close browser
    lines.push(`AfterAll(async function () {`);
    lines.push(`  if (browser) await browser.close();`);
    lines.push('});');
    lines.push('');

    // Convenience aliases so step definitions can use `page` directly
    lines.push(`// ========================================`);
    lines.push(`// Helper: Access page from World in steps`);
    lines.push(`// ========================================`);
    lines.push(`// In step definitions, use: this.page, this.context, this.state`);
    lines.push(`// Example: Given('I navigate to {string}', async function(url) { await this.page.goto(url); });`);
    lines.push('');

    // Separate library defs, screenplay defs, and custom defs
    const hasLibrary = '__library__' in customDefs;
    const hasScreenplay = '__screenplay__' in customDefs;
    const hasCustom = Object.keys(customDefs).some(k => k !== '__library__' && k !== '__screenplay__');

    if (hasLibrary) {
      lines.push('// Step Library definitions');
      lines.push(customDefs.__library__);
      lines.push('');
    }

    if (hasScreenplay) {
      lines.push(customDefs.__screenplay__);
      lines.push('');
    }

    if (hasCustom) {
      for (const [key, code] of Object.entries(customDefs)) {
        if (key === '__library__' || key === '__screenplay__') continue;
        lines.push(code);
        lines.push('');
      }
    }

    if (!hasCustom) {
      // Auto-generated step definitions (using this.page from World)
      lines.push(`// ========================================`);
      lines.push(`// Auto-generated Step Definitions`);
      lines.push(`// ========================================`);
      lines.push(`const { expect } = require('@playwright/test');`);
      lines.push('');

      // Navigation steps
      lines.push(`// Navigation steps`);
      lines.push(`Given('I navigate to {string}', async function (url) {`);
      lines.push(`  await this.page.goto(url);`);
      lines.push('});');
      lines.push('');
      lines.push(`Given('I am on {string}', async function (url) {`);
      lines.push(`  await this.page.goto(url);`);
      lines.push('});');
      lines.push('');
      lines.push(`Given('I open the url {string}', async function (url) {`);
      lines.push(`  await this.page.goto(url);`);
      lines.push('});');
      lines.push('');

      // Helper to find input by label, placeholder, role, or test-id
      lines.push(`// Smart input locator helper`);
      lines.push(`async function findInput(page, field) {`);
      lines.push(`  const byLabel = page.getByLabel(field);`);
      lines.push(`  if (await byLabel.count() > 0) return byLabel.first();`);
      lines.push(`  const byPlaceholder = page.getByPlaceholder(field);`);
      lines.push(`  if (await byPlaceholder.count() > 0) return byPlaceholder.first();`);
      lines.push(`  const byRole = page.getByRole('textbox', { name: field });`);
      lines.push(`  if (await byRole.count() > 0) return byRole.first();`);
      lines.push(`  const byTestId = page.getByTestId(field);`);
      lines.push(`  if (await byTestId.count() > 0) return byTestId.first();`);
      lines.push(`  return page.locator(\`input[name="\${field}" i], input[id="\${field}" i], textarea[name="\${field}" i]\`).first();`);
      lines.push('}');
      lines.push('');

      // Input steps with {string} parameter types
      lines.push(`// Input steps`);
      lines.push(`When('I fill {string} with {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I type {string} into {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I enter {string} in {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I fill in the {string} field with {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I clear the {string} field', async function (field) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.clear();`);
      lines.push('});');
      lines.push('');

      // Interaction steps
      lines.push(`// Interaction steps`);
      lines.push(`When('I click {string}', async function (target) {`);
      lines.push(`  const btn = this.page.getByRole('button', { name: target });`);
      lines.push(`  if (await btn.count() > 0) { await btn.first().click(); return; }`);
      lines.push(`  const link = this.page.getByRole('link', { name: target });`);
      lines.push(`  if (await link.count() > 0) { await link.first().click(); return; }`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().click();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I click the {string} button', async function (name) {`);
      lines.push(`  await this.page.getByRole('button', { name }).click();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I click the {string} link', async function (name) {`);
      lines.push(`  await this.page.getByRole('link', { name }).click();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I double click {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().dblclick();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I right click {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().click({ button: 'right' });`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I hover over {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().hover();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I press {string}', async function (key) {`);
      lines.push(`  await this.page.keyboard.press(key);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I select {string} from {string}', async function (value, selector) {`);
      lines.push(`  await this.page.getByLabel(selector).selectOption(value);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I check {string}', async function (label) {`);
      lines.push(`  await this.page.getByLabel(label).check();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I uncheck {string}', async function (label) {`);
      lines.push(`  await this.page.getByLabel(label).uncheck();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I upload {string} to {string}', async function (filePath, label) {`);
      lines.push(`  await this.page.getByLabel(label).setInputFiles(filePath);`);
      lines.push('});');
      lines.push('');

      // Wait steps with {int} and {float} parameter types
      lines.push(`// Wait steps`);
      lines.push(`When('I wait for {int} seconds', async function (seconds) {`);
      lines.push(`  await this.page.waitForTimeout(seconds * 1000);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I wait for {float} seconds', async function (seconds) {`);
      lines.push(`  await this.page.waitForTimeout(Math.round(seconds * 1000));`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I wait for {string} to be visible', async function (text) {`);
      lines.push(`  await this.page.getByText(text).first().waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I wait for the page to load', async function () {`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      lines.push('');

      // Assertion steps
      lines.push(`// Assertion steps`);
      lines.push(`Then('I should see {string}', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 10000 });`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('I should not see {string}', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text, { exact: true })).toBeHidden({ timeout: 5000 });`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the page title should be {string}', async function (title) {`);
      lines.push(`  await expect(this.page).toHaveTitle(title);`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the page title should contain {string}', async function (title) {`);
      lines.push(`  await expect(this.page).toHaveTitle(new RegExp(title));`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the page should contain {string}', async function (text) {`);
      lines.push(`  await expect(this.page.locator('body')).toContainText(text);`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the URL should contain {string}', async function (urlPart) {`);
      lines.push(`  await expect(this.page).toHaveURL(new RegExp(urlPart));`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the URL should be {string}', async function (url) {`);
      lines.push(`  await expect(this.page).toHaveURL(url);`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the {string} field should contain {string}', async function (field, value) {`);
      lines.push(`  await expect(this.page.getByLabel(field)).toHaveValue(value);`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the {string} field should be empty', async function (field) {`);
      lines.push(`  await expect(this.page.getByLabel(field)).toHaveValue('');`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the {string} checkbox should be checked', async function (label) {`);
      lines.push(`  await expect(this.page.getByLabel(label)).toBeChecked();`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the {string} button should be disabled', async function (name) {`);
      lines.push(`  await expect(this.page.getByRole('button', { name })).toBeDisabled();`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the {string} button should be enabled', async function (name) {`);
      lines.push(`  await expect(this.page.getByRole('button', { name })).toBeEnabled();`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('I should see {int} {string} elements', async function (count, role) {`);
      lines.push(`  await expect(this.page.getByRole(role)).toHaveCount(count);`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the element {string} should have attribute {string} with value {string}', async function (selector, attr, value) {`);
      lines.push(`  await expect(this.page.locator(selector)).toHaveAttribute(attr, value);`);
      lines.push('});');
      lines.push('');

      // Screenshot step
      lines.push(`// Screenshot step`);
      lines.push(`When('I take a screenshot named {string}', async function (name) {`);
      lines.push(`  await this.takeScreenshot(name);`);
      lines.push('});');
      lines.push('');

      // State sharing steps
      lines.push(`// State sharing steps`);
      lines.push(`When('I store the text of {string} as {string}', async function (selector, key) {`);
      lines.push(`  const text = await this.page.locator(selector).first().textContent();`);
      lines.push(`  this.set(key, text);`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('the stored value {string} should equal {string}', async function (key, expected) {`);
      lines.push(`  expect(this.get(key)).toBe(expected);`);
      lines.push('});');
      lines.push('');

      // Auto-generate any custom steps that don't match built-in patterns
      const parsed = this.parseFeatureContent(featureContent);
      const builtInPatterns = [
        /^I navigate to ".*"$/, /^I am on ".*"$/,
        /^I fill ".*" with ".*"$/, /^I type ".*" into ".*"$/, /^I enter ".*" in ".*"$/,
        /^I click ".*"$/, /^I press ".*"$/,
        /^I select ".*" from ".*"$/, /^I wait for \d+ seconds$/,
        /^I should see ".*"$/, /^I should not see ".*"$/,
        /^the page title should be ".*"$/, /^the page should contain ".*"$/,
        /^the URL should contain ".*"$/,
      ];

      const seenSteps = new Set<string>();
      for (const scenario of parsed.scenarios) {
        for (const step of scenario.steps) {
          const matchesBuiltin = builtInPatterns.some(p => p.test(step.text));
          if (matchesBuiltin) continue;

          const normalizedText = step.text.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
          if (seenSteps.has(normalizedText)) continue;
          seenSteps.add(normalizedText);

          const cucumberKeyword = step.keyword === 'And' || step.keyword === 'But' ? 'Given' : step.keyword;
          lines.push(`${cucumberKeyword}('${this.escapeString(normalizedText)}', async function () {`);
          lines.push(`  // TODO: Implement custom step`);
          lines.push(`  console.log('Step: ${this.escapeString(step.text)}');`);
          lines.push('});');
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }


  // ===========================
  // STEP LIBRARY CRUD
  // ===========================

  async createStepLibraryEntry(
    userId: string,
    organizationId: string | null,
    data: { pattern: string; code: string; keyword: string; description?: string; tags?: string[] }
  ): Promise<any> {
    const { rows } = await pool.query(
      `INSERT INTO "BDDStepLibrary" (id, "userId", "organizationId", pattern, code, keyword, description, tags, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
       RETURNING *`,
      [userId, organizationId, data.pattern, data.code, data.keyword, data.description || null, JSON.stringify(data.tags || [])]
    );
    return rows[0];
  }

  async getStepLibrary(userId: string, organizationId: string | null): Promise<any[]> {
    let query = `SELECT * FROM "BDDStepLibrary" WHERE ("userId" = $1`;
    const params: any[] = [userId];
    if (organizationId) {
      query += ` OR "organizationId" = $2`;
      params.push(organizationId);
    }
    query += `)`;
    query += ` ORDER BY "usageCount" DESC, "createdAt" DESC`;
    const { rows } = await pool.query(query, params);
    return rows;
  }

  async updateStepLibraryEntry(id: string, userId: string, data: Partial<{ pattern: string; code: string; keyword: string; description: string; tags: string[] }>): Promise<any> {
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (data.pattern !== undefined) { updates.push(`pattern = $${idx}`); params.push(data.pattern); idx++; }
    if (data.code !== undefined) { updates.push(`code = $${idx}`); params.push(data.code); idx++; }
    if (data.keyword !== undefined) { updates.push(`keyword = $${idx}`); params.push(data.keyword); idx++; }
    if (data.description !== undefined) { updates.push(`description = $${idx}`); params.push(data.description); idx++; }
    if (data.tags !== undefined) { updates.push(`tags = $${idx}`); params.push(JSON.stringify(data.tags)); idx++; }
    updates.push(`"updatedAt" = now()`);

    params.push(id, userId);
    const { rows } = await pool.query(
      `UPDATE "BDDStepLibrary" SET ${updates.join(', ')} WHERE id = $${idx} AND "userId" = $${idx + 1} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  async deleteStepLibraryEntry(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM "BDDStepLibrary" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    return (rowCount || 0) > 0;
  }

  // ===========================
  // SCHEDULED EXECUTION (CRON)
  // ===========================

  async createSchedule(
    userId: string,
    organizationId: string | null,
    data: { featureId: string; cronExpression: string; tags?: string; browser?: string; executionMode?: string }
  ): Promise<any> {
    const nextRun = this.getNextCronRun(data.cronExpression);

    const { rows } = await pool.query(
      `INSERT INTO "BDDSchedule" (id, "featureId", "userId", "organizationId", "cronExpression", tags, browser, "executionMode", enabled, "nextRunAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, true, $8, now(), now())
       RETURNING *`,
      [data.featureId, userId, organizationId, data.cronExpression, data.tags || null, data.browser || 'chromium', data.executionMode || 'headless', nextRun]
    );

    const schedule = rows[0];
    this.startScheduleTimer(schedule);
    return schedule;
  }

  async getSchedules(userId: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT s.*, f.name as "featureName"
       FROM "BDDSchedule" s
       JOIN "BDDFeature" f ON f.id = s."featureId"
       WHERE s."userId" = $1
       ORDER BY s."createdAt" DESC`,
      [userId]
    );
    return rows;
  }

  async updateSchedule(id: string, userId: string, data: Partial<{ cronExpression: string; tags: string; browser: string; executionMode: string; enabled: boolean }>): Promise<any> {
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (data.cronExpression !== undefined) {
      updates.push(`"cronExpression" = $${idx}`); params.push(data.cronExpression); idx++;
      const nextRun = this.getNextCronRun(data.cronExpression);
      updates.push(`"nextRunAt" = $${idx}`); params.push(nextRun); idx++;
    }
    if (data.tags !== undefined) { updates.push(`tags = $${idx}`); params.push(data.tags); idx++; }
    if (data.browser !== undefined) { updates.push(`browser = $${idx}`); params.push(data.browser); idx++; }
    if (data.executionMode !== undefined) { updates.push(`"executionMode" = $${idx}`); params.push(data.executionMode); idx++; }
    if (data.enabled !== undefined) { updates.push(`enabled = $${idx}`); params.push(data.enabled); idx++; }
    updates.push(`"updatedAt" = now()`);

    params.push(id, userId);
    const { rows } = await pool.query(
      `UPDATE "BDDSchedule" SET ${updates.join(', ')} WHERE id = $${idx} AND "userId" = $${idx + 1} RETURNING *`,
      params
    );

    const schedule = rows[0];
    if (schedule) {
      // Restart timer
      this.stopScheduleTimer(id);
      if (schedule.enabled) {
        this.startScheduleTimer(schedule);
      }
    }
    return schedule || null;
  }

  async deleteSchedule(id: string, userId: string): Promise<boolean> {
    this.stopScheduleTimer(id);
    const { rowCount } = await pool.query(
      `DELETE FROM "BDDSchedule" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    return (rowCount || 0) > 0;
  }

  /**
   * Parse a simple cron expression and return the next run time.
   * Supports: "every Xm", "every Xh", "every Xd", or standard 5-field cron (minute hour day month weekday).
   */
  private getNextCronRun(expression: string): Date {
    const now = new Date();

    // Simple interval formats
    const intervalMatch = expression.match(/^every\s+(\d+)\s*(m|h|d|min|hour|day|minutes?|hours?|days?)$/i);
    if (intervalMatch) {
      const value = parseInt(intervalMatch[1]);
      const unit = intervalMatch[2].toLowerCase();
      if (unit.startsWith('m')) return new Date(now.getTime() + value * 60 * 1000);
      if (unit.startsWith('h')) return new Date(now.getTime() + value * 60 * 60 * 1000);
      if (unit.startsWith('d')) return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
    }

    // Standard cron: just add 1 hour as fallback
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  /**
   * Get interval in ms from a cron expression
   */
  private getCronIntervalMs(expression: string): number {
    const intervalMatch = expression.match(/^every\s+(\d+)\s*(m|h|d|min|hour|day|minutes?|hours?|days?)$/i);
    if (intervalMatch) {
      const value = parseInt(intervalMatch[1]);
      const unit = intervalMatch[2].toLowerCase();
      if (unit.startsWith('m')) return value * 60 * 1000;
      if (unit.startsWith('h')) return value * 60 * 60 * 1000;
      if (unit.startsWith('d')) return value * 24 * 60 * 60 * 1000;
    }

    // Standard cron fields: default to 1 hour
    return 60 * 60 * 1000;
  }

  /**
   * Start a scheduled timer for a BDD schedule
   */
  private startScheduleTimer(schedule: any): void {
    if (!schedule.enabled) return;

    const intervalMs = this.getCronIntervalMs(schedule.cronExpression);

    // Calculate delay until first run
    const now = Date.now();
    const nextRun = schedule.nextRunAt ? new Date(schedule.nextRunAt).getTime() : now;
    const initialDelay = Math.max(nextRun - now, 1000);

    const timerId = setTimeout(async () => {
      await this.executeScheduledRun(schedule);

      // Set up recurring interval
      const recurringId = setInterval(async () => {
        await this.executeScheduledRun(schedule);
      }, intervalMs);
      scheduledJobs.set(schedule.id, recurringId);
    }, initialDelay);

    scheduledJobs.set(schedule.id, timerId);
    logger.info(`BDD: Schedule ${schedule.id} started (interval: ${intervalMs}ms, first run in ${initialDelay}ms)`);
  }

  private stopScheduleTimer(scheduleId: string): void {
    const timer = scheduledJobs.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      scheduledJobs.delete(scheduleId);
    }
  }

  /**
   * Execute a scheduled BDD run
   */
  private async executeScheduledRun(schedule: any): Promise<void> {
    try {
      // Verify schedule is still enabled
      const { rows } = await pool.query(
        `SELECT s.*, f."featureContent" FROM "BDDSchedule" s JOIN "BDDFeature" f ON f.id = s."featureId" WHERE s.id = $1 AND s.enabled = true`,
        [schedule.id]
      );
      if (rows.length === 0) {
        this.stopScheduleTimer(schedule.id);
        return;
      }

      const scheduleData = rows[0];

      // Count steps
      const parsed = this.parseFeatureContent(scheduleData.featureContent);
      const totalSteps = parsed.scenarios.reduce((sum, s) => sum + s.steps.length, 0);

      // Create run record
      const { rows: runRows } = await pool.query(
        `INSERT INTO "BDDRun" (id, "featureId", "userId", "organizationId", status, "totalSteps", browser, "executionMode", tags, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending', $4, $5, $6, $7, now(), now())
         RETURNING *`,
        [scheduleData.featureId, scheduleData.userId, scheduleData.organizationId, totalSteps,
          scheduleData.browser, scheduleData.executionMode, scheduleData.tags]
      );

      const run = runRows[0];

      // Update schedule timestamps
      const nextRun = this.getNextCronRun(scheduleData.cronExpression);
      await pool.query(
        `UPDATE "BDDSchedule" SET "lastRunAt" = now(), "nextRunAt" = $2, "updatedAt" = now() WHERE id = $1`,
        [schedule.id, nextRun]
      );

      // Execute
      await this.executeFeature(run.id, scheduleData.featureContent, {}, {
        browser: scheduleData.browser,
        executionMode: scheduleData.executionMode,
        tags: scheduleData.tags || undefined,
      }, scheduleData.userId, scheduleData.organizationId);

      logger.info(`BDD: Scheduled run completed for schedule ${schedule.id}, run ${run.id}`);
    } catch (error: any) {
      logger.error(`BDD: Scheduled run failed for schedule ${schedule.id}: ${error.message}`);
    }
  }

  /**
   * Initialize all enabled schedules on server startup
   */
  async initializeSchedules(): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM "BDDSchedule" WHERE enabled = true`
      );
      for (const schedule of rows) {
        this.startScheduleTimer(schedule);
      }
      if (rows.length > 0) {
        logger.info(`BDD: Initialized ${rows.length} scheduled runs`);
      }
    } catch (error: any) {
      logger.warn(`BDD: Failed to initialize schedules: ${error.message}`);
    }
  }

  // ===========================
  // WARMUP & CANCEL
  // ===========================

  async warmup(): Promise<void> {
    try {
      await this.ensureSharedEnv();
      logger.info('BDD: Environment pre-warmed successfully');
    } catch (e: any) {
      logger.warn(`BDD: Warmup failed (will retry on first run): ${e.message}`);
    }
  }

  async cancelRun(runId: string): Promise<boolean> {
    const queueIdx = pendingQueue.findIndex(item => item.runId === runId);
    if (queueIdx !== -1) {
      pendingQueue.splice(queueIdx, 1);
      logger.info(`BDD: Cancelled queued run ${runId}`);
      return true;
    }

    const child = runningProcesses.get(runId);
    if (child) {
      child.kill('SIGTERM');
      runningProcesses.delete(runId);
      return true;
    }
    return false;
  }
}

export const bddService = new BDDService();
