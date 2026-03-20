import pool from '../../db';
import { logger } from '../../utils/logger';
import { exec, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { generateSerenityReport, SerenityReportData, SerenityReportResult } from './serenityReport.service';
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
let sharedEnvInitPromise: Promise<void> | null = null; // Mutex for concurrent init

// Process timeout: configurable via env, default 5 minutes (scales better for large feature files)
const BDD_PROCESS_TIMEOUT_MS = parseInt(process.env.BDD_PROCESS_TIMEOUT_MS || '300000', 10);

// Concurrency control for multi-user execution
const MAX_CONCURRENT_RUNS = parseInt(process.env.BDD_MAX_CONCURRENT_RUNS || '3', 10);
const MAX_QUEUED_RUNS = parseInt(process.env.BDD_MAX_QUEUED_RUNS || '20', 10);
let activeRunCount = 0;
const pendingQueue: Array<{ runId: string; resolve: () => void; reject: (err: Error) => void }> = [];

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
    let pendingScenarioTags: string[] = [];

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
        } else {
          // Tags for the next scenario — accumulate in pendingScenarioTags
          pendingScenarioTags.push(...tags);
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
        currentScenario = {
          name: line.replace(/Scenario (Outline|Template):/, '').trim(),
          description: '',
          type: 'Scenario Outline',
          tags: pendingScenarioTags,
          steps: [],
          examples: [],
        };
        pendingScenarioTags = [];
        currentStep = null;
        continue;
      }
      if (line.startsWith('Scenario:')) {
        if (currentScenario) feature.scenarios.push(currentScenario);
        inFeatureDesc = false;
        inExamples = false;
        currentScenario = {
          name: line.replace('Scenario:', '').trim(),
          description: '',
          type: 'Scenario',
          tags: pendingScenarioTags,
          steps: [],
        };
        pendingScenarioTags = [];
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
    const quotes = (text.match(/"([^"]+)"/g) || []).map(m => m.replace(/"/g, ''));

    // Navigation
    if (lower.includes('navigate') || lower.match(/^(i )?(go to|open|visit) /)) {
      const url = quotes[0] || '/* URL */';
      return `await page.goto('${this.escapeString(url)}');`;
    }
    if (lower === 'i go back') return `await page.goBack();`;
    if (lower === 'i go forward') return `await page.goForward();`;
    if (lower.includes('refresh') || lower.includes('reload')) return `await page.reload();`;

    // Login / Credentials
    if (lower.includes('enter valid credentials') || lower.includes('login with username')) {
      if (quotes.length >= 2) {
        return `await page.getByLabel('Username').fill('${this.escapeString(quotes[0])}');\n    await page.getByLabel('Password').fill('${this.escapeString(quotes[1])}');`;
      }
    }
    if (lower.match(/^i enter (username|email) /)) {
      const val = quotes[0] || '/* value */';
      const field = lower.includes('email') ? 'Email' : 'Username';
      return `await page.getByLabel('${field}').fill('${this.escapeString(val)}');`;
    }
    if (lower.match(/^i enter password /)) {
      const val = quotes[0] || '/* value */';
      return `await page.getByLabel('Password').fill('${this.escapeString(val)}');`;
    }
    if (lower.includes('login button') || lower.includes('submit the login')) {
      return `await page.getByRole('button', { name: /sign in|login|submit/i }).click();`;
    }
    if (lower.match(/^i log ?out/)) return `await page.getByRole('button', { name: /log ?out|sign ?out/i }).click();`;

    // Click
    if (lower.includes('click on the') && lower.includes('tab')) {
      const tab = quotes[0] || '/* tab */';
      return `await page.getByRole('tab', { name: '${this.escapeString(tab)}' }).click();`;
    }
    if (lower.includes('click on the') && lower.includes('menu')) {
      const menu = quotes[0] || '/* menu */';
      return `await page.getByRole('menuitem', { name: '${this.escapeString(menu)}' }).click();`;
    }
    if (lower.includes('click') && lower.includes('button')) {
      const btn = quotes[0] || '/* button */';
      return `await page.getByRole('button', { name: '${this.escapeString(btn)}' }).click();`;
    }
    if (lower.includes('click') && lower.includes('link')) {
      const link = quotes[0] || '/* link */';
      return `await page.getByRole('link', { name: '${this.escapeString(link)}' }).click();`;
    }
    if (lower.includes('double click')) {
      const target = quotes[0] || '/* target */';
      return `await page.getByText('${this.escapeString(target)}').first().dblclick();`;
    }
    if (lower.includes('right click')) {
      const target = quotes[0] || '/* target */';
      return `await page.getByText('${this.escapeString(target)}').first().click({ button: 'right' });`;
    }
    if (lower.includes('click')) {
      const target = quotes[0] || '/* target */';
      return `await page.getByRole('button', { name: '${this.escapeString(target)}' }).click();`;
    }

    // Hover / Focus
    if (lower.includes('hover')) {
      const target = quotes[0] || '/* target */';
      return `await page.getByText('${this.escapeString(target)}').first().hover();`;
    }
    if (lower.includes('focus')) {
      const target = quotes[0] || '/* target */';
      return `await page.getByLabel('${this.escapeString(target)}').focus();`;
    }

    // Keyboard
    if (lower === 'i press enter') return `await page.keyboard.press('Enter');`;
    if (lower === 'i press tab') return `await page.keyboard.press('Tab');`;
    if (lower === 'i press escape') return `await page.keyboard.press('Escape');`;
    if (lower.includes('press')) {
      const key = quotes[0] || '/* key */';
      return `await page.keyboard.press('${this.escapeString(key)}');`;
    }

    // Fill / Type / Enter (form input) - must be after credentials check
    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter') || lower.includes('set')) {
      if (quotes.length >= 2) {
        return `await page.getByLabel('${this.escapeString(quotes[0])}').fill('${this.escapeString(quotes[1])}');`;
      }
      if (quotes.length === 1) {
        return `await page.locator('/* field */').fill('${this.escapeString(quotes[0])}');`;
      }
    }

    // Select / Dropdown
    if (lower.includes('select') && !lower.includes('radio')) {
      if (quotes.length >= 2) {
        return `await page.getByLabel('${this.escapeString(quotes[1])}').selectOption('${this.escapeString(quotes[0])}');`;
      }
      if (quotes.length === 1) {
        return `await page.selectOption('/* selector */', '${this.escapeString(quotes[0])}');`;
      }
    }

    // Checkbox / Radio
    if (lower.includes('check') && !lower.includes('uncheck')) {
      const label = quotes[0] || '/* label */';
      return `await page.getByLabel('${this.escapeString(label)}').check();`;
    }
    if (lower.includes('uncheck')) {
      const label = quotes[0] || '/* label */';
      return `await page.getByLabel('${this.escapeString(label)}').uncheck();`;
    }
    if (lower.includes('radio')) {
      const label = quotes[0] || '/* label */';
      return `await page.getByRole('radio', { name: '${this.escapeString(label)}' }).check();`;
    }

    // Upload
    if (lower.includes('upload') || lower.includes('attach')) {
      if (quotes.length >= 2) {
        return `await page.getByLabel('${this.escapeString(quotes[1])}').setInputFiles('${this.escapeString(quotes[0])}');`;
      }
      if (quotes.length === 1) {
        return `await page.locator('input[type="file"]').setInputFiles('${this.escapeString(quotes[0])}');`;
      }
    }

    // Wait
    if (lower.includes('wait')) {
      const timeMatch = text.match(/(\d+)\s*(seconds?|ms|milliseconds?)/);
      if (timeMatch) {
        const ms = timeMatch[2].startsWith('s') ? parseInt(timeMatch[1]) * 1000 : parseInt(timeMatch[1]);
        return `await page.waitForTimeout(${ms});`;
      }
      if (lower.includes('visible') && quotes[0]) {
        return `await page.getByText('${this.escapeString(quotes[0])}').first().waitFor({ state: 'visible' });`;
      }
      if (lower.includes('disappear') && quotes[0]) {
        return `await page.getByText('${this.escapeString(quotes[0])}').first().waitFor({ state: 'hidden' });`;
      }
      if (lower.includes('page to load') || lower.includes('navigation')) {
        return `await page.waitForLoadState('networkidle');`;
      }
      return `await page.waitForTimeout(1000);`;
    }

    // Scroll
    if (lower.includes('scroll to the bottom')) return `await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`;
    if (lower.includes('scroll to the top')) return `await page.evaluate(() => window.scrollTo(0, 0));`;
    if (lower.includes('scroll down')) return `await page.evaluate(() => window.scrollBy(0, 500));`;
    if (lower.includes('scroll up')) return `await page.evaluate(() => window.scrollBy(0, -500));`;
    if (lower.includes('scroll to') && quotes[0]) {
      return `await page.getByText('${this.escapeString(quotes[0])}').first().scrollIntoViewIfNeeded();`;
    }

    // Redirected / on page
    if (lower.includes('redirected') || lower.match(/should be on/)) {
      if (quotes[0]) return `await page.waitForURL(new RegExp('${this.escapeString(quotes[0])}'));`;
      return `await page.waitForLoadState('networkidle');`;
    }

    // Visibility assertions
    if (lower.includes('should not see') || lower.includes('should not be visible')) {
      const target = quotes[0] || '/* text */';
      return `await expect(page.getByText('${this.escapeString(target)}')).toBeHidden();`;
    }
    if (lower.includes('see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown')) {
      const target = quotes[0] || '/* text */';
      return `await expect(page.getByText('${this.escapeString(target)}', { exact: true })).toBeVisible();`;
    }

    // URL assertions
    if (lower.includes('url should contain')) {
      const val = quotes[0] || '/* url part */';
      return `await expect(page).toHaveURL(new RegExp('${this.escapeString(val)}'));`;
    }
    if (lower.includes('url should be')) {
      const val = quotes[0] || '/* url */';
      return `await expect(page).toHaveURL('${this.escapeString(val)}');`;
    }

    // Title
    if (lower.includes('title should be')) {
      const val = quotes[0] || '/* title */';
      return `await expect(page).toHaveTitle('${this.escapeString(val)}');`;
    }
    if (lower.includes('title should contain')) {
      const val = quotes[0] || '/* title */';
      return `await expect(page).toHaveTitle(new RegExp('${this.escapeString(val)}'));`;
    }

    // Contain text
    if (lower.includes('contain') || lower.includes('have text')) {
      const target = quotes[0] || '/* text */';
      return `await expect(page.locator('body')).toContainText('${this.escapeString(target)}');`;
    }

    // Disabled / Enabled
    if (lower.includes('disabled')) {
      const val = quotes[0] || '/* name */';
      return `await expect(page.getByRole('button', { name: '${this.escapeString(val)}' })).toBeDisabled();`;
    }
    if (lower.includes('enabled')) {
      const val = quotes[0] || '/* name */';
      return `await expect(page.getByRole('button', { name: '${this.escapeString(val)}' })).toBeEnabled();`;
    }

    // Screenshot
    if (lower.includes('screenshot')) {
      const name = quotes[0] || 'screenshot';
      return `await page.screenshot({ path: '${this.escapeString(name)}.png', fullPage: true });`;
    }

    // Drag & Drop
    if (lower.includes('drag') && quotes.length >= 2) {
      return `await page.getByText('${this.escapeString(quotes[0])}').first().dragTo(page.getByText('${this.escapeString(quotes[1])}').first());`;
    }

    // Table assertions
    if (lower.includes('table') && lower.includes('rows')) {
      const countMatch = text.match(/(\d+)/);
      if (countMatch) return `await expect(page.locator('table tbody tr')).toHaveCount(${countMatch[1]});`;
    }

    // Alert
    if (lower.includes('accept') && lower.includes('alert')) return `page.once('dialog', async d => await d.accept());`;
    if (lower.includes('dismiss') && lower.includes('alert')) return `page.once('dialog', async d => await d.dismiss());`;

    return `// TODO: Implement step - ${keyword} ${text}`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
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

    // Mutex: if another call is already initializing, wait for it
    if (sharedEnvInitPromise) {
      await sharedEnvInitPromise;
      return;
    }

    sharedEnvInitPromise = this.doEnsureSharedEnv();
    try {
      await sharedEnvInitPromise;
    } finally {
      sharedEnvInitPromise = null;
    }
  }

  private async doEnsureSharedEnv(): Promise<void> {
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

    await new Promise<void>((resolve, reject) => {
      pendingQueue.push({ runId, resolve, reject });
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
    let slotAcquired = false;

    try {
      await this.acquireSlot(runId);
      slotAcquired = true;

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

      // Build cucumber command args as array (avoids shell quoting issues with spawn)
      const cucumberEntry = path.join(SHARED_BDD_DIR, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber-js');
      const resultsPath = path.join(runDir, 'results.json');

      const spawnArgs: string[] = [
        cucumberEntry,
        '--require', stepsPath,
        '--format', `json:${resultsPath}`,
        featuresPath,
      ];

      // Tag-based filtering (e.g., "@smoke", "@smoke and not @wip")
      if (options.tags) {
        spawnArgs.push('--tags', options.tags);
        logger.info(`BDD Run ${runId}: Filtering by tags: ${options.tags}`);
      }

      // Parallel scenario execution
      const parallelWorkers = options.parallelWorkers || 1;
      if (parallelWorkers > 1) {
        spawnArgs.push('--parallel', String(parallelWorkers));
        logger.info(`BDD Run ${runId}: Running with ${parallelWorkers} parallel workers`);
      }

      logger.info(`BDD Run ${runId}: Command: node ${spawnArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

      // Run cucumber with child process tracking
      const startTime = Date.now();
      let cucumberStdout = '';
      let cucumberStderr = '';

      try {
        // Use spawn instead of exec to avoid maxBuffer limits and enable true streaming
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const child = spawn('node', spawnArgs, {
            cwd: SHARED_BDD_DIR,
            env: { ...process.env, NODE_PATH: path.join(SHARED_BDD_DIR, 'node_modules') },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
          });

          let stdoutBuf = '';
          let stderrBuf = '';
          let settled = false;

          // Configurable timeout (default 5 minutes via BDD_PROCESS_TIMEOUT_MS)
          const timer = setTimeout(() => {
            if (!settled) {
              child.kill('SIGTERM');
              reject(new Error(`Run timed out after ${BDD_PROCESS_TIMEOUT_MS / 1000}s`));
            }
          }, BDD_PROCESS_TIMEOUT_MS);

          runningProcesses.set(runId, child);

          // Stream stdout for live updates (no maxBuffer limit)
          child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stdoutBuf += text;
            this.emitEvent(runId, 'output', { text });
          });
          child.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stderrBuf += text;
            this.emitEvent(runId, 'output', { text, isError: true });
          });

          child.on('close', (_code, signal) => {
            settled = true;
            clearTimeout(timer);
            runningProcesses.delete(runId);
            if (signal === 'SIGTERM' || signal === 'SIGKILL') {
              reject(new Error('Run was cancelled'));
            } else {
              resolve({ stdout: stdoutBuf, stderr: stderrBuf });
            }
          });

          child.on('error', (err) => {
            settled = true;
            clearTimeout(timer);
            runningProcesses.delete(runId);
            reject(err);
          });
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
        if (execError.message?.includes('timed out')) {
          cucumberStdout = '';
          cucumberStderr = execError.message;
          logger.warn(`BDD Run ${runId}: Process timed out`);
        } else {
          cucumberStdout = execError.stdout || '';
          cucumberStderr = execError.stderr || execError.message || '';
          logger.info(`BDD Run ${runId}: Cucumber error: ${execError.message}`);
        }
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
      const reportResult: SerenityReportResult = await generateSerenityReport(serenityData, BDD_REPORTS_DIR);

      // Update run in DB (store HTML report in database)
      await pool.query(
        `UPDATE "BDDRun" SET
          status = $1, duration = $2,
          "totalSteps" = $3, "passedSteps" = $4, "failedSteps" = $5, "skippedSteps" = $6,
          "stepResults" = $7, "errorMsg" = $8, "reportUrl" = $10, "screenshotUrls" = $11,
          "reportHtml" = $12,
          "completedAt" = now(), "updatedAt" = now()
         WHERE id = $9`,
        [overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps,
          JSON.stringify(stepResults), errorMsg || null, runId, reportResult.reportUrl, JSON.stringify(screenshotUrls),
          reportResult.reportHtml]
      );

      // Emit live event: completed
      this.emitEvent(runId, 'completed', {
        status: overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps,
        reportUrl: reportResult.reportUrl, screenshotUrls,
      });

      logger.info(`BDD Run ${runId}: Completed - ${overallStatus} (${passedSteps}/${totalSteps} passed), screenshots: ${screenshotUrls.length}, report: ${reportResult.reportUrl}`);
    } catch (error: any) {
      logger.error(`BDD Run ${runId}: Execution error: ${error.message}`);
      this.emitEvent(runId, 'error', { message: error.message });

      // Generate report even for errored runs
      let errorReportResult: SerenityReportResult = { reportUrl: '', reportHtml: '' };
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
        errorReportResult = await generateSerenityReport(serenityData, BDD_REPORTS_DIR);
      } catch (reportErr: any) {
        logger.warn(`BDD Run ${runId}: Failed to generate error report: ${reportErr.message}`);
      }

      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "reportUrl" = $3, "reportHtml" = $4, "completedAt" = now(), "updatedAt" = now() WHERE id = $2`,
        [error.message, runId, errorReportResult.reportUrl || null, errorReportResult.reportHtml || null]
      );
    } finally {
      if (slotAcquired) {
        this.releaseSlot();
      }

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
    lines.push(`  this.page.setDefaultTimeout(60000); // 60s default for Playwright actions (fill, click, etc.)`);
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
    lines.push(`  this.page.setDefaultTimeout(120000); // 120s Playwright timeout for @slow scenarios`);
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

      // ========================================
      // Smart locator helpers
      // ========================================
      lines.push(`// Smart locator helpers`);
      lines.push(`async function findInput(page, field) {`);
      lines.push(`  // Wait for page to be fully loaded (handles SPAs that render forms dynamically)`);
      lines.push(`  await page.waitForLoadState('networkidle').catch(() => {});`);
      lines.push(`  await page.waitForLoadState('domcontentloaded');`);
      lines.push('');
      lines.push(`  // Build a combined CSS selector for waiting`);
      lines.push(`  const cssSelector = \`input[name="\${field}" i], input[id="\${field}" i], textarea[name="\${field}" i], input[aria-label="\${field}" i], input[placeholder="\${field}" i]\`;`);
      lines.push('');
      lines.push(`  // Wait for at least one matching input to appear in DOM (up to 30s)`);
      lines.push(`  try {`);
      lines.push(`    await page.waitForSelector(cssSelector, { state: 'attached', timeout: 30000 });`);
      lines.push(`  } catch (e) {`);
      lines.push(`    // If CSS selector didn't find it, try waiting for any input/textarea to appear`);
      lines.push(`    await page.waitForSelector('input, textarea', { state: 'attached', timeout: 10000 }).catch(() => {});`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Now try smart selectors in priority order`);
      lines.push(`  const byLabel = page.getByLabel(field);`);
      lines.push(`  if (await byLabel.count() > 0) return byLabel.first();`);
      lines.push(`  const byPlaceholder = page.getByPlaceholder(field);`);
      lines.push(`  if (await byPlaceholder.count() > 0) return byPlaceholder.first();`);
      lines.push(`  const byRole = page.getByRole('textbox', { name: field });`);
      lines.push(`  if (await byRole.count() > 0) return byRole.first();`);
      lines.push(`  const byTestId = page.getByTestId(field);`);
      lines.push(`  if (await byTestId.count() > 0) return byTestId.first();`);
      lines.push(`  // Fallback to CSS attribute selectors`);
      lines.push(`  const fallback = page.locator(cssSelector).first();`);
      lines.push(`  await fallback.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});`);
      lines.push(`  return fallback;`);
      lines.push('}');
      lines.push('');
      lines.push(`async function findElement(page, target) {`);
      lines.push(`  const btn = page.getByRole('button', { name: target });`);
      lines.push(`  if (await btn.count() > 0) return btn.first();`);
      lines.push(`  const link = page.getByRole('link', { name: target });`);
      lines.push(`  if (await link.count() > 0) return link.first();`);
      lines.push(`  const tab = page.getByRole('tab', { name: target });`);
      lines.push(`  if (await tab.count() > 0) return tab.first();`);
      lines.push(`  const menuitem = page.getByRole('menuitem', { name: target });`);
      lines.push(`  if (await menuitem.count() > 0) return menuitem.first();`);
      lines.push(`  const byText = page.getByText(target, { exact: true });`);
      lines.push(`  if (await byText.count() > 0) return byText.first();`);
      lines.push(`  return page.getByText(target).first();`);
      lines.push('}');
      lines.push('');

      // ========================================
      // 1. NAVIGATION
      // ========================================
      lines.push(`// --- Navigation steps ---`);
      lines.push(`Given('I navigate to {string}', async function (url) { await this.page.goto(url, { waitUntil: 'networkidle' }); });`);
      lines.push(`Given('I am on {string}', async function (url) { await this.page.goto(url, { waitUntil: 'networkidle' }); });`);
      lines.push(`Given('I open the url {string}', async function (url) { await this.page.goto(url, { waitUntil: 'networkidle' }); });`);
      lines.push(`Given('I go to {string}', async function (url) { await this.page.goto(url, { waitUntil: 'networkidle' }); });`);
      lines.push(`Given('I visit {string}', async function (url) { await this.page.goto(url, { waitUntil: 'networkidle' }); });`);
      lines.push(`Given('I am on the {string} page', async function (pageName) {`);
      lines.push(`  await this.page.waitForLoadState('domcontentloaded');`);
      lines.push(`  console.log('On page:', pageName, 'URL:', this.page.url());`);
      lines.push('});');
      lines.push(`When('I go back', async function () { await this.page.goBack(); });`);
      lines.push(`When('I go forward', async function () { await this.page.goForward(); });`);
      lines.push(`When('I refresh the page', async function () { await this.page.reload(); });`);
      lines.push(`When('I reload the page', async function () { await this.page.reload(); });`);
      lines.push('');

      // ========================================
      // 2. LOGIN / AUTHENTICATION
      // ========================================
      lines.push(`// --- Login / Authentication ---`);
      lines.push(`When('I enter valid credentials username {string} password {string}', async function (username, password) {`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(password);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I enter valid credentials user {string} password {string}', async function (username, password) {`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(password);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I login with username {string} and password {string}', async function (username, password) {`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(password);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I enter username {string}', async function (username) {`);
      lines.push(`  const input = await findInput(this.page, 'Username');`);
      lines.push(`  await input.fill(username);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I enter password {string}', async function (password) {`);
      lines.push(`  const input = await findInput(this.page, 'Password');`);
      lines.push(`  await input.fill(password);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I enter email {string}', async function (email) {`);
      lines.push(`  const input = await findInput(this.page, 'Email');`);
      lines.push(`  await input.fill(email);`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I click the login button', async function () {`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); return; }`);
      lines.push(`  await this.page.locator('button[type="submit"]').first().click();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I submit the login form', async function () {`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); return; }`);
      lines.push(`  await this.page.locator('button[type="submit"]').first().click();`);
      lines.push('});');
      lines.push('');
      lines.push(`When('I log out', async function () {`);
      lines.push(`  const logout = this.page.getByRole('button', { name: /log ?out|sign ?out/i });`);
      lines.push(`  if (await logout.count() > 0) { await logout.first().click(); return; }`);
      lines.push(`  const link = this.page.getByRole('link', { name: /log ?out|sign ?out/i });`);
      lines.push(`  if (await link.count() > 0) { await link.first().click(); return; }`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('I should be logged in', async function () {`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push(`  // Verify we're no longer on a login page`);
      lines.push(`  const url = this.page.url().toLowerCase();`);
      lines.push(`  const loginIndicators = this.page.getByRole('button', { name: /sign in|login|log in/i });`);
      lines.push(`  const onLoginPage = url.includes('login') || url.includes('signin');`);
      lines.push(`  if (onLoginPage) {`);
      lines.push(`    // If URL still contains login, check that login form is gone (e.g., redirecting)`);
      lines.push(`    await expect(loginIndicators).toHaveCount(0, { timeout: 5000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push('');
      lines.push(`Then('I should be logged out', async function () {`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push(`  // Verify a login/signin element is visible (we're back on login page)`);
      lines.push(`  const loginBtn = this.page.getByRole('button', { name: /sign in|login|log in/i });`);
      lines.push(`  const loginLink = this.page.getByRole('link', { name: /sign in|login|log in/i });`);
      lines.push(`  const hasLogin = (await loginBtn.count()) > 0 || (await loginLink.count()) > 0;`);
      lines.push(`  const url = this.page.url().toLowerCase();`);
      lines.push(`  const onLoginPage = url.includes('login') || url.includes('signin');`);
      lines.push(`  if (!hasLogin && !onLoginPage) {`);
      lines.push(`    console.warn('Warning: Could not verify logout — no login button or login URL detected');`);
      lines.push(`  }`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 3. FORM INPUT
      // ========================================
      lines.push(`// --- Form Input ---`);
      lines.push(`// Convention: "fill FIELD with VALUE" (field first), "type/enter VALUE in/into FIELD" (value first)`);
      lines.push(`When('I fill {string} with {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I type {string} into {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I type {string} in {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I enter {string} in {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I enter {string} in the {string} field', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I fill in the {string} field with {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I set {string} to {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I set the {string} field to {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I clear the {string} field', async function (field) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.clear();`);
      lines.push('});');
      lines.push(`When('I clear {string}', async function (field) {`);
      lines.push(`  const input = await findInput(this.page, field); await input.clear();`);
      lines.push('});');
      lines.push(`When('I append {string} to {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.click(); await this.page.keyboard.press('End'); await input.type(value);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 4. CLICK / INTERACTION
      // ========================================
      lines.push(`// --- Click / Interaction ---`);
      lines.push(`When('I click {string}', async function (target) { const el = await findElement(this.page, target); await el.click(); });`);
      lines.push(`When('I click the {string} button', async function (name) { await this.page.getByRole('button', { name }).click(); });`);
      lines.push(`When('I click the {string} link', async function (name) { await this.page.getByRole('link', { name }).click(); });`);
      lines.push(`When('I click on {string}', async function (target) { const el = await findElement(this.page, target); await el.click(); });`);
      lines.push(`When('I click on the {string} button', async function (name) { await this.page.getByRole('button', { name }).click(); });`);
      lines.push(`When('I click on the {string} link', async function (name) { await this.page.getByRole('link', { name }).click(); });`);
      lines.push(`When('I click on the {string} tab', async function (tabName) {`);
      lines.push(`  const tab = this.page.getByRole('tab', { name: tabName });`);
      lines.push(`  if (await tab.count() > 0) { await tab.first().click(); return; }`);
      lines.push(`  const link = this.page.getByRole('link', { name: tabName });`);
      lines.push(`  if (await link.count() > 0) { await link.first().click(); return; }`);
      lines.push(`  await this.page.getByText(tabName, { exact: true }).first().click();`);
      lines.push('});');
      lines.push(`When('I click on {string} project tab', async function (tabName) {`);
      lines.push(`  const el = await findElement(this.page, tabName); await el.click();`);
      lines.push('});');
      lines.push(`When('I click on the {string} menu', async function (name) {`);
      lines.push(`  const mi = this.page.getByRole('menuitem', { name });`);
      lines.push(`  if (await mi.count() > 0) { await mi.first().click(); return; }`);
      lines.push(`  const el = await findElement(this.page, name); await el.click();`);
      lines.push('});');
      lines.push(`When('I click on the {string} menu item', async function (name) {`);
      lines.push(`  const mi = this.page.getByRole('menuitem', { name });`);
      lines.push(`  if (await mi.count() > 0) { await mi.first().click(); return; }`);
      lines.push(`  const el = await findElement(this.page, name); await el.click();`);
      lines.push('});');
      lines.push(`When('I click the {string} icon', async function (name) {`);
      lines.push(`  const el = await findElement(this.page, name); await el.click();`);
      lines.push('});');
      lines.push(`When('I click the {string} element', async function (selector) {`);
      lines.push(`  await this.page.locator(selector).first().click();`);
      lines.push('});');
      lines.push(`When('I click the first {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target).first().click();`);
      lines.push('});');
      lines.push(`When('I click the last {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target).last().click();`);
      lines.push('});');
      lines.push(`When('I click the {int}st {string}', async function (n, target) {`);
      lines.push(`  await this.page.getByText(target).nth(n - 1).click();`);
      lines.push('});');
      lines.push(`When('I click the {int}nd {string}', async function (n, target) {`);
      lines.push(`  await this.page.getByText(target).nth(n - 1).click();`);
      lines.push('});');
      lines.push(`When('I click the {int}rd {string}', async function (n, target) {`);
      lines.push(`  await this.page.getByText(target).nth(n - 1).click();`);
      lines.push('});');
      lines.push(`When('I click the {int}th {string}', async function (n, target) {`);
      lines.push(`  await this.page.getByText(target).nth(n - 1).click();`);
      lines.push('});');
      lines.push(`When('I double click {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().dblclick();`);
      lines.push('});');
      lines.push(`When('I right click {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().click({ button: 'right' });`);
      lines.push('});');
      lines.push(`When('I hover over {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().hover();`);
      lines.push('});');
      lines.push(`When('I hover on {string}', async function (target) {`);
      lines.push(`  await this.page.getByText(target, { exact: true }).first().hover();`);
      lines.push('});');
      lines.push(`When('I focus on {string}', async function (target) {`);
      lines.push(`  const input = await findInput(this.page, target); await input.focus();`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 5. KEYBOARD
      // ========================================
      lines.push(`// --- Keyboard ---`);
      lines.push(`When('I press {string}', async function (key) { await this.page.keyboard.press(key); });`);
      lines.push(`When('I press the {string} key', async function (key) { await this.page.keyboard.press(key); });`);
      lines.push(`When('I press Enter', async function () { await this.page.keyboard.press('Enter'); });`);
      lines.push(`When('I press Tab', async function () { await this.page.keyboard.press('Tab'); });`);
      lines.push(`When('I press Escape', async function () { await this.page.keyboard.press('Escape'); });`);
      lines.push('');

      // ========================================
      // 6. SELECT / DROPDOWN / CHECKBOX / RADIO
      // ========================================
      lines.push(`// --- Dropdown / Checkbox / Radio ---`);
      lines.push(`When('I select {string} from {string}', async function (value, selector) {`);
      lines.push(`  await this.page.getByLabel(selector).selectOption(value);`);
      lines.push('});');
      lines.push(`When('I select {string} from the {string} dropdown', async function (value, selector) {`);
      lines.push(`  await this.page.getByLabel(selector).selectOption(value);`);
      lines.push('});');
      lines.push(`When('I select the option {string} in {string}', async function (value, selector) {`);
      lines.push(`  await this.page.getByLabel(selector).selectOption(value);`);
      lines.push('});');
      lines.push(`When('I check {string}', async function (label) { await this.page.getByLabel(label).check(); });`);
      lines.push(`When('I uncheck {string}', async function (label) { await this.page.getByLabel(label).uncheck(); });`);
      lines.push(`When('I check the {string} checkbox', async function (label) { await this.page.getByLabel(label).check(); });`);
      lines.push(`When('I uncheck the {string} checkbox', async function (label) { await this.page.getByLabel(label).uncheck(); });`);
      lines.push(`When('I select the {string} radio button', async function (label) {`);
      lines.push(`  await this.page.getByRole('radio', { name: label }).check();`);
      lines.push('});');
      lines.push(`When('I toggle {string}', async function (label) {`);
      lines.push(`  const cb = this.page.getByLabel(label);`);
      lines.push(`  if (await cb.isChecked()) await cb.uncheck(); else await cb.check();`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 7. FILE UPLOAD
      // ========================================
      lines.push(`// --- File Upload ---`);
      lines.push(`When('I upload {string} to {string}', async function (filePath, label) {`);
      lines.push(`  await this.page.getByLabel(label).setInputFiles(filePath);`);
      lines.push('});');
      lines.push(`When('I attach the file {string}', async function (filePath) {`);
      lines.push(`  await this.page.locator('input[type="file"]').first().setInputFiles(filePath);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 8. WAIT / TIMING
      // ========================================
      lines.push(`// --- Wait / Timing ---`);
      lines.push(`When('I wait for {int} seconds', async function (s) { await this.page.waitForTimeout(s * 1000); });`);
      lines.push(`When('I wait for {float} seconds', async function (s) { await this.page.waitForTimeout(Math.round(s * 1000)); });`);
      lines.push(`When('I wait for {string} to be visible', async function (text) {`);
      lines.push(`  await this.page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 });`);
      lines.push('});');
      lines.push(`When('I wait for {string} to disappear', async function (text) {`);
      lines.push(`  await this.page.getByText(text).first().waitFor({ state: 'hidden', timeout: 15000 });`);
      lines.push('});');
      lines.push(`When('I wait for the page to load', async function () { await this.page.waitForLoadState('networkidle'); });`);
      lines.push(`When('I wait for navigation', async function () { await this.page.waitForLoadState('networkidle'); });`);
      lines.push(`When('I wait until the page is ready', async function () { await this.page.waitForLoadState('domcontentloaded'); });`);
      lines.push(`When('I wait for the {string} element to appear', async function (selector) {`);
      lines.push(`  await this.page.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 });`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 9. SCROLL
      // ========================================
      lines.push(`// --- Scroll ---`);
      lines.push(`When('I scroll down', async function () { await this.page.evaluate(() => window.scrollBy(0, 500)); });`);
      lines.push(`When('I scroll up', async function () { await this.page.evaluate(() => window.scrollBy(0, -500)); });`);
      lines.push(`When('I scroll to the bottom', async function () { await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); });`);
      lines.push(`When('I scroll to the top', async function () { await this.page.evaluate(() => window.scrollTo(0, 0)); });`);
      lines.push(`When('I scroll to {string}', async function (text) {`);
      lines.push(`  await this.page.getByText(text, { exact: true }).first().scrollIntoViewIfNeeded();`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 10. IFRAME
      // ========================================
      lines.push(`// --- iFrame ---`);
      lines.push(`When('I switch to iframe {string}', async function (selector) {`);
      lines.push(`  const frame = this.page.frameLocator(selector);`);
      lines.push(`  this.set('iframe', frame);`);
      lines.push('});');
      lines.push(`When('I switch to the main frame', async function () {`);
      lines.push(`  this.set('iframe', null);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 11. DIALOG / ALERT
      // ========================================
      lines.push(`// --- Dialog / Alert ---`);
      lines.push(`// These steps register a handler that fires on the NEXT dialog.`);
      lines.push(`// Use them BEFORE the step that triggers the dialog.`);
      lines.push(`When('I accept the alert', async function () {`);
      lines.push(`  this.set('__dialogPromise', new Promise(resolve => {`);
      lines.push(`    this.page.once('dialog', async dialog => { resolve(dialog); await dialog.accept(); });`);
      lines.push(`  }));`);
      lines.push('});');
      lines.push(`When('I dismiss the alert', async function () {`);
      lines.push(`  this.set('__dialogPromise', new Promise(resolve => {`);
      lines.push(`    this.page.once('dialog', async dialog => { resolve(dialog); await dialog.dismiss(); });`);
      lines.push(`  }));`);
      lines.push('});');
      lines.push(`When('I accept the alert with {string}', async function (text) {`);
      lines.push(`  this.set('__dialogPromise', new Promise(resolve => {`);
      lines.push(`    this.page.once('dialog', async dialog => { resolve(dialog); await dialog.accept(text); });`);
      lines.push(`  }));`);
      lines.push('});');
      lines.push(`Then('I should see an alert with {string}', async function (expectedText) {`);
      lines.push(`  // Wait for the dialog that was set up by a prior accept/dismiss step`);
      lines.push(`  const dialogPromise = this.get('__dialogPromise');`);
      lines.push(`  if (dialogPromise) {`);
      lines.push(`    const dialog = await dialogPromise;`);
      lines.push(`    expect(dialog.message()).toContain(expectedText);`);
      lines.push(`  } else {`);
      lines.push(`    // Fallback: wait for a new dialog`);
      lines.push(`    const dialog = await new Promise(resolve => this.page.once('dialog', resolve));`);
      lines.push(`    expect(dialog.message()).toContain(expectedText);`);
      lines.push(`    await dialog.accept();`);
      lines.push(`  }`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 12. TABLE
      // ========================================
      lines.push(`// --- Table ---`);
      lines.push(`Then('the table should have {int} rows', async function (count) {`);
      lines.push(`  await expect(this.page.locator('table tbody tr')).toHaveCount(count);`);
      lines.push('});');
      lines.push(`Then('I should see {string} in row {int}', async function (text, row) {`);
      lines.push(`  await expect(this.page.locator(\`table tbody tr:nth-child(\${row})\`)).toContainText(text);`);
      lines.push('});');
      lines.push(`Then('I should see {string} in column {int}', async function (text, col) {`);
      lines.push(`  const cells = this.page.locator(\`table tbody tr td:nth-child(\${col})\`);`);
      lines.push(`  const allText = await cells.allTextContents();`);
      lines.push(`  expect(allText.some(t => t.includes(text))).toBeTruthy();`);
      lines.push('});');
      lines.push(`When('I click on row {int} in the table', async function (row) {`);
      lines.push(`  await this.page.locator(\`table tbody tr:nth-child(\${row})\`).click();`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 13. REDIRECT / DASHBOARD ASSERTIONS
      // ========================================
      lines.push(`// --- Redirect / Dashboard ---`);
      lines.push(`Then('I should be redirected to the {string}', async function (pageName) {`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push(`  // Verify URL or page content contains the page name`);
      lines.push(`  const url = this.page.url().toLowerCase();`);
      lines.push(`  const nameLC = pageName.toLowerCase();`);
      lines.push(`  if (!url.includes(nameLC)) {`);
      lines.push(`    // URL doesn't match — check page content as fallback`);
      lines.push(`    await expect(this.page.locator('body')).toContainText(pageName, { timeout: 5000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`Then('I should be redirected to {string}', async function (url) {`);
      lines.push(`  await this.page.waitForURL(new RegExp(url), { timeout: 15000 });`);
      lines.push('});');
      lines.push(`Then('I should be on the {string} page', async function (pageName) {`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push(`  // Verify URL or page content contains the page name`);
      lines.push(`  const url = this.page.url().toLowerCase();`);
      lines.push(`  const nameLC = pageName.toLowerCase();`);
      lines.push(`  if (!url.includes(nameLC)) {`);
      lines.push(`    await expect(this.page.locator('body')).toContainText(pageName, { timeout: 5000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`Then('I should see the {string} open successfully', async function (section) {`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push(`  // Verify the section text/heading is visible on the page`);
      lines.push(`  const heading = this.page.getByRole('heading', { name: section });`);
      lines.push(`  if (await heading.count() > 0) {`);
      lines.push(`    await expect(heading.first()).toBeVisible();`);
      lines.push(`  } else {`);
      lines.push(`    await expect(this.page.getByText(section).first()).toBeVisible({ timeout: 10000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 14. TEXT / VISIBILITY ASSERTIONS
      // ========================================
      lines.push(`// --- Text / Visibility Assertions ---`);
      lines.push(`Then('I should see {string}', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 10000 });`);
      lines.push('});');
      lines.push(`Then('I should not see {string}', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text, { exact: true })).toBeHidden({ timeout: 5000 });`);
      lines.push('});');
      lines.push(`Then('I should see text containing {string}', async function (text) {`);
      lines.push(`  await expect(this.page.locator('body')).toContainText(text);`);
      lines.push('});');
      lines.push(`Then('I should see {string} in the {string}', async function (text, section) {`);
      lines.push(`  await expect(this.page.locator(\`[aria-label="\${section}"], [data-testid="\${section}"], .\${section}\`).first()).toContainText(text);`);
      lines.push('});');
      lines.push(`Then('{string} should be visible', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 10000 });`);
      lines.push('});');
      lines.push(`Then('{string} should not be visible', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text)).toBeHidden({ timeout: 5000 });`);
      lines.push('});');
      lines.push(`Then('I should see a {string} message', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 10000 });`);
      lines.push('});');
      lines.push(`Then('the page should contain {string}', async function (text) {`);
      lines.push(`  await expect(this.page.locator('body')).toContainText(text);`);
      lines.push('});');
      lines.push(`Then('the page should not contain {string}', async function (text) {`);
      lines.push(`  const body = await this.page.locator('body').textContent();`);
      lines.push(`  expect(body).not.toContain(text);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 15. URL ASSERTIONS
      // ========================================
      lines.push(`// --- URL Assertions ---`);
      lines.push(`Then('the URL should contain {string}', async function (urlPart) { await expect(this.page).toHaveURL(new RegExp(urlPart)); });`);
      lines.push(`Then('the URL should be {string}', async function (url) { await expect(this.page).toHaveURL(url); });`);
      lines.push(`Then('the URL should not contain {string}', async function (urlPart) {`);
      lines.push(`  expect(this.page.url()).not.toContain(urlPart);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 16. TITLE ASSERTIONS
      // ========================================
      lines.push(`// --- Title Assertions ---`);
      lines.push(`Then('the page title should be {string}', async function (title) { await expect(this.page).toHaveTitle(title); });`);
      lines.push(`Then('the page title should contain {string}', async function (title) { await expect(this.page).toHaveTitle(new RegExp(title)); });`);
      lines.push('');

      // ========================================
      // 17. FORM FIELD ASSERTIONS
      // ========================================
      lines.push(`// --- Form Field Assertions ---`);
      lines.push(`Then('the {string} field should contain {string}', async function (field, value) { await expect(this.page.getByLabel(field)).toHaveValue(value); });`);
      lines.push(`Then('the {string} field should be empty', async function (field) { await expect(this.page.getByLabel(field)).toHaveValue(''); });`);
      lines.push(`Then('the {string} field should not be empty', async function (field) {`);
      lines.push(`  const val = await this.page.getByLabel(field).inputValue(); expect(val.length).toBeGreaterThan(0);`);
      lines.push('});');
      lines.push(`Then('the {string} checkbox should be checked', async function (label) { await expect(this.page.getByLabel(label)).toBeChecked(); });`);
      lines.push(`Then('the {string} checkbox should not be checked', async function (label) { await expect(this.page.getByLabel(label)).not.toBeChecked(); });`);
      lines.push(`Then('the {string} dropdown should have value {string}', async function (label, value) { await expect(this.page.getByLabel(label)).toHaveValue(value); });`);
      lines.push('');

      // ========================================
      // 18. BUTTON / ELEMENT STATE ASSERTIONS
      // ========================================
      lines.push(`// --- Button / Element State ---`);
      lines.push(`Then('the {string} button should be disabled', async function (name) { await expect(this.page.getByRole('button', { name })).toBeDisabled(); });`);
      lines.push(`Then('the {string} button should be enabled', async function (name) { await expect(this.page.getByRole('button', { name })).toBeEnabled(); });`);
      lines.push(`Then('the {string} button should be visible', async function (name) { await expect(this.page.getByRole('button', { name })).toBeVisible(); });`);
      lines.push(`Then('the {string} button should not be visible', async function (name) { await expect(this.page.getByRole('button', { name })).toBeHidden(); });`);
      lines.push(`Then('{string} should be disabled', async function (label) {`);
      lines.push(`  const input = await findInput(this.page, label); await expect(input).toBeDisabled();`);
      lines.push('});');
      lines.push(`Then('{string} should be enabled', async function (label) {`);
      lines.push(`  const input = await findInput(this.page, label); await expect(input).toBeEnabled();`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 19. COUNT ASSERTIONS
      // ========================================
      lines.push(`// --- Count Assertions ---`);
      lines.push(`Then('I should see {int} {string} elements', async function (count, role) { await expect(this.page.getByRole(role)).toHaveCount(count); });`);
      lines.push(`Then('there should be {int} {string}', async function (count, selector) { await expect(this.page.locator(selector)).toHaveCount(count); });`);
      lines.push(`Then('I should see at least {int} {string}', async function (count, selector) {`);
      lines.push(`  const n = await this.page.locator(selector).count(); expect(n).toBeGreaterThanOrEqual(count);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 20. ATTRIBUTE / CSS ASSERTIONS
      // ========================================
      lines.push(`// --- Attribute / CSS ---`);
      lines.push(`Then('the element {string} should have attribute {string} with value {string}', async function (selector, attr, value) {`);
      lines.push(`  await expect(this.page.locator(selector)).toHaveAttribute(attr, value);`);
      lines.push('});');
      lines.push(`Then('{string} should have class {string}', async function (selector, className) {`);
      lines.push(`  await expect(this.page.locator(selector)).toHaveClass(new RegExp(className));`);
      lines.push('});');
      lines.push(`Then('the element {string} should have CSS {string} with value {string}', async function (selector, prop, value) {`);
      lines.push(`  await expect(this.page.locator(selector)).toHaveCSS(prop, value);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 21. SCREENSHOT / DEBUGGING
      // ========================================
      lines.push(`// --- Screenshot / Debug ---`);
      lines.push(`When('I take a screenshot named {string}', async function (name) { await this.takeScreenshot(name); });`);
      lines.push(`When('I take a screenshot', async function () { await this.takeScreenshot('step-' + this.stepIndex); });`);
      lines.push(`When('I print the current URL', async function () { console.log('Current URL:', this.page.url()); });`);
      lines.push(`When('I print the page title', async function () { console.log('Page title:', await this.page.title()); });`);
      lines.push('');

      // ========================================
      // 22. STATE SHARING
      // ========================================
      lines.push(`// --- State Sharing ---`);
      lines.push(`When('I store the text of {string} as {string}', async function (selector, key) {`);
      lines.push(`  const text = await this.page.locator(selector).first().textContent(); this.set(key, text);`);
      lines.push('});');
      lines.push(`When('I store the value of {string} as {string}', async function (field, key) {`);
      lines.push(`  const input = await findInput(this.page, field); this.set(key, await input.inputValue());`);
      lines.push('});');
      lines.push(`When('I store the current URL as {string}', async function (key) { this.set(key, this.page.url()); });`);
      lines.push(`Then('the stored value {string} should equal {string}', async function (key, expected) { expect(this.get(key)).toBe(expected); });`);
      lines.push(`Then('the stored value {string} should contain {string}', async function (key, expected) { expect(this.get(key)).toContain(expected); });`);
      lines.push('');

      // ========================================
      // 23. DRAG & DROP
      // ========================================
      lines.push(`// --- Drag & Drop ---`);
      lines.push(`When('I drag {string} to {string}', async function (source, target) {`);
      lines.push(`  await this.page.getByText(source).first().dragTo(this.page.getByText(target).first());`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 24. NEW TAB / WINDOW
      // ========================================
      lines.push(`// --- New Tab / Window ---`);
      lines.push(`// Use "prepare for a new tab" BEFORE clicking a link that opens a tab, then "switch to the new tab" after.`);
      lines.push(`When('I prepare for a new tab', async function () {`);
      lines.push(`  this.set('__newTabPromise', this.context.waitForEvent('page'));`);
      lines.push('});');
      lines.push(`When('I switch to the new tab', async function () {`);
      lines.push(`  let newPage;`);
      lines.push(`  const pending = this.get('__newTabPromise');`);
      lines.push(`  if (pending) {`);
      lines.push(`    newPage = await pending;`);
      lines.push(`    this.set('__newTabPromise', null);`);
      lines.push(`  } else {`);
      lines.push(`    // Fallback: check if a new page already appeared`);
      lines.push(`    const pages = this.context.pages();`);
      lines.push(`    if (pages.length > 1) {`);
      lines.push(`      newPage = pages[pages.length - 1];`);
      lines.push(`    } else {`);
      lines.push(`      newPage = await this.context.waitForEvent('page', { timeout: 10000 });`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`  await newPage.waitForLoadState('domcontentloaded');`);
      lines.push(`  this.set('previousPage', this.page);`);
      lines.push(`  this.page = newPage;`);
      lines.push('});');
      lines.push(`When('I switch back to the original tab', async function () {`);
      lines.push(`  const prev = this.get('previousPage');`);
      lines.push(`  if (prev) this.page = prev;`);
      lines.push('});');
      lines.push(`When('I close the current tab', async function () {`);
      lines.push(`  await this.page.close();`);
      lines.push(`  const pages = this.context.pages();`);
      lines.push(`  if (pages.length > 0) this.page = pages[pages.length - 1];`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 25. API / NETWORK
      // ========================================
      lines.push(`// --- API / Network ---`);
      lines.push(`When('I intercept {string} requests to {string}', async function (method, url) {`);
      lines.push(`  const responses = [];`);
      lines.push(`  this.page.on('response', resp => {`);
      lines.push(`    if (resp.request().method() === method.toUpperCase() && resp.url().includes(url)) responses.push(resp);`);
      lines.push(`  });`);
      lines.push(`  this.set('intercepted_' + url, responses);`);
      lines.push('});');
      lines.push(`Then('I should have intercepted {int} {string} requests', async function (count, url) {`);
      lines.push(`  const responses = this.get('intercepted_' + url) || [];`);
      lines.push(`  expect(responses.length).toBe(count);`);
      lines.push('});');
      lines.push('');

      // Auto-generate any custom steps that don't match built-in patterns
      const parsed = this.parseFeatureContent(featureContent);
      const builtInPatterns = [
        // Navigation
        /^I navigate to ".*"$/, /^I am on ".*"$/, /^I open the url ".*"$/, /^I go to ".*"$/, /^I visit ".*"$/,
        /^I am on the ".*" page$/, /^I go back$/, /^I go forward$/, /^I refresh the page$/, /^I reload the page$/,
        // Login
        /^I enter valid credentials username ".*" password ".*"$/, /^I enter valid credentials user ".*" password ".*"$/,
        /^I login with username ".*" and password ".*"$/,
        /^I enter username ".*"$/, /^I enter password ".*"$/, /^I enter email ".*"$/,
        /^I click the login button$/, /^I submit the login form$/, /^I log out$/,
        /^I should be logged in$/, /^I should be logged out$/,
        // Input
        /^I fill ".*" with ".*"$/, /^I type ".*" into ".*"$/, /^I type ".*" in ".*"$/, /^I enter ".*" in ".*"$/,
        /^I enter ".*" in the ".*" field$/, /^I fill in the ".*" field with ".*"$/, /^I set ".*" to ".*"$/,
        /^I set the ".*" field to ".*"$/,
        /^I clear the ".*" field$/, /^I clear ".*"$/, /^I append ".*" to ".*"$/,
        // Click
        /^I click ".*"$/, /^I click the ".*" button$/, /^I click the ".*" link$/,
        /^I click on ".*"$/, /^I click on the ".*" button$/, /^I click on the ".*" link$/,
        /^I click on the ".*" tab$/, /^I click on ".*" project tab$/,
        /^I click on the ".*" menu$/, /^I click on the ".*" menu item$/, /^I click the ".*" icon$/,
        /^I click the ".*" element$/, /^I click the first ".*"$/, /^I click the last ".*"$/,
        /^I click the \d+(st|nd|rd|th) ".*"$/,
        /^I double click ".*"$/, /^I right click ".*"$/, /^I hover over ".*"$/, /^I hover on ".*"$/,
        /^I focus on ".*"$/,
        // Keyboard
        /^I press ".*"$/, /^I press the ".*" key$/, /^I press Enter$/, /^I press Tab$/, /^I press Escape$/,
        // Select / Checkbox
        /^I select ".*" from ".*"$/, /^I select ".*" from the ".*" dropdown$/, /^I select the option ".*" in ".*"$/,
        /^I check ".*"$/, /^I uncheck ".*"$/, /^I check the ".*" checkbox$/, /^I uncheck the ".*" checkbox$/,
        /^I select the ".*" radio button$/, /^I toggle ".*"$/,
        // File
        /^I upload ".*" to ".*"$/, /^I attach the file ".*"$/,
        // Wait
        /^I wait for \d+ seconds$/, /^I wait for [\d.]+ seconds$/,
        /^I wait for ".*" to be visible$/, /^I wait for ".*" to disappear$/,
        /^I wait for the page to load$/, /^I wait for navigation$/, /^I wait until the page is ready$/,
        /^I wait for the ".*" element to appear$/,
        // Scroll
        /^I scroll down$/, /^I scroll up$/, /^I scroll to the bottom$/, /^I scroll to the top$/, /^I scroll to ".*"$/,
        // iframe
        /^I switch to iframe ".*"$/, /^I switch to the main frame$/,
        // Dialog
        /^I accept the alert$/, /^I dismiss the alert$/, /^I accept the alert with ".*"$/, /^I should see an alert with ".*"$/,
        // Table
        /^the table should have \d+ rows$/, /^I should see ".*" in row \d+$/, /^I should see ".*" in column \d+$/,
        /^I click on row \d+ in the table$/,
        // Redirect
        /^I should be redirected to the ".*"$/, /^I should be redirected to ".*"$/,
        /^I should be on the ".*" page$/, /^I should see the ".*" open successfully$/,
        // Visibility
        /^I should see ".*"$/, /^I should not see ".*"$/, /^I should see text containing ".*"$/,
        /^I should see ".*" in the ".*"$/, /^".*" should be visible$/, /^".*" should not be visible$/,
        /^I should see a ".*" message$/,
        /^the page should contain ".*"$/, /^the page should not contain ".*"$/,
        // URL
        /^the URL should contain ".*"$/, /^the URL should be ".*"$/, /^the URL should not contain ".*"$/,
        // Title
        /^the page title should be ".*"$/, /^the page title should contain ".*"$/,
        // Form assertions
        /^the ".*" field should contain ".*"$/, /^the ".*" field should be empty$/, /^the ".*" field should not be empty$/,
        /^the ".*" checkbox should be checked$/, /^the ".*" checkbox should not be checked$/,
        /^the ".*" dropdown should have value ".*"$/,
        // Button state
        /^the ".*" button should be disabled$/, /^the ".*" button should be enabled$/,
        /^the ".*" button should be visible$/, /^the ".*" button should not be visible$/,
        /^".*" should be disabled$/, /^".*" should be enabled$/,
        // Count
        /^I should see \d+ ".*" elements$/, /^there should be \d+ ".*"$/, /^I should see at least \d+ ".*"$/,
        // Attribute
        /^the element ".*" should have attribute ".*" with value ".*"$/,
        /^".*" should have class ".*"$/,
        /^the element ".*" should have CSS ".*" with value ".*"$/,
        // Screenshot
        /^I take a screenshot named ".*"$/, /^I take a screenshot$/,
        /^I print the current URL$/, /^I print the page title$/,
        // State
        /^I store the text of ".*" as ".*"$/, /^I store the value of ".*" as ".*"$/, /^I store the current URL as ".*"$/,
        /^the stored value ".*" should equal ".*"$/, /^the stored value ".*" should contain ".*"$/,
        // Drag
        /^I drag ".*" to ".*"$/,
        // Tab
        /^I prepare for a new tab$/,
        /^I switch to the new tab$/, /^I switch back to the original tab$/, /^I close the current tab$/,
        // API
        /^I intercept ".*" requests to ".*"$/, /^I should have intercepted \d+ ".*" requests$/,
      ];

      const seenSteps = new Set<string>();
      for (const scenario of parsed.scenarios) {
        // Skip Background scenarios — their steps are shared setup, not unique test steps
        if (scenario.tags.includes('@background')) continue;
        for (const step of scenario.steps) {
          const matchesBuiltin = builtInPatterns.some(p => p.test(step.text));
          if (matchesBuiltin) continue;

          const normalizedText = step.text.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
          if (seenSteps.has(normalizedText)) continue;
          seenSteps.add(normalizedText);

          const cucumberKeyword = step.keyword === 'And' || step.keyword === 'But' ? 'Given' : step.keyword;

          // Count {string} and {int} placeholders to generate matching function parameters
          const paramMatches = normalizedText.match(/\{(string|int|float)\}/g) || [];
          const paramNames = paramMatches.map((p: string, i: number) => {
            const type = p.replace(/[{}]/g, '');
            return type === 'string' ? `arg${i + 1}` : type === 'int' ? `num${i + 1}` : `val${i + 1}`;
          });
          const paramList = paramNames.join(', ');

          lines.push(`${cucumberKeyword}('${this.escapeString(normalizedText)}', async function (${paramList}) {`);
          lines.push(`  // Auto-generated step — customize as needed`);
          lines.push(`  console.log('Step: ${this.escapeString(step.keyword)} ${this.escapeString(normalizedText)}'${paramNames.length > 0 ? `, ${paramNames.join(', ')}` : ''});`);
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
   * Parse a cron expression and return the next run time.
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

    // Standard 5-field cron: "minute hour dayOfMonth month dayOfWeek"
    const cronParts = expression.trim().split(/\s+/);
    if (cronParts.length === 5) {
      return this.getNextCronDate(cronParts, now);
    }

    // Unrecognised expression — default to 1 hour
    logger.warn(`BDD: Unrecognised cron expression "${expression}", defaulting to 1 hour`);
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  /**
   * Compute next matching date for a standard 5-field cron expression.
   * Supports: numbers, '*', comma-lists (1,15), and step values (star/N).
   * Scans up to 366 days ahead to find a match.
   */
  private getNextCronDate(parts: string[], after: Date): Date {
    const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

    const expandField = (expr: string, min: number, max: number): number[] => {
      const values: Set<number> = new Set();
      for (const segment of expr.split(',')) {
        const stepMatch = segment.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
        if (stepMatch) {
          const step = parseInt(stepMatch[2]);
          let start = min;
          let end = max;
          if (stepMatch[1] !== '*') {
            const rangeMatch = stepMatch[1].match(/^(\d+)(?:-(\d+))?$/);
            if (rangeMatch) {
              start = parseInt(rangeMatch[1]);
              end = rangeMatch[2] !== undefined ? parseInt(rangeMatch[2]) : max;
            }
          }
          for (let i = start; i <= end; i += step) values.add(i);
        } else if (segment === '*') {
          for (let i = min; i <= max; i++) values.add(i);
        } else if (segment.includes('-')) {
          const [a, b] = segment.split('-').map(Number);
          for (let i = a; i <= b; i++) values.add(i);
        } else {
          values.add(parseInt(segment));
        }
      }
      return [...values].sort((a, b) => a - b);
    };

    const minutes = expandField(minuteExpr, 0, 59);
    const hours = expandField(hourExpr, 0, 23);
    const doms = expandField(domExpr, 1, 31);
    const months = expandField(monthExpr, 1, 12);
    const dows = expandField(dowExpr, 0, 6); // 0=Sun

    // Scan forward minute-by-minute starting from after+1min, up to 366 days
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1); // start from next minute

    const limit = after.getTime() + 366 * 24 * 60 * 60 * 1000;
    while (candidate.getTime() < limit) {
      const mo = candidate.getMonth() + 1; // 1-12
      const dom = candidate.getDate();
      const dow = candidate.getDay(); // 0=Sun
      const hr = candidate.getHours();
      const mn = candidate.getMinutes();

      if (months.includes(mo) && doms.includes(dom) && dows.includes(dow) && hours.includes(hr) && minutes.includes(mn)) {
        return candidate;
      }

      // Smart jump: if month doesn't match, skip to next matching month
      if (!months.includes(mo)) {
        candidate.setMonth(candidate.getMonth() + 1, 1);
        candidate.setHours(0, 0, 0, 0);
        continue;
      }
      // If day doesn't match, skip to next day
      if (!doms.includes(dom) || !dows.includes(dow)) {
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(0, 0, 0, 0);
        continue;
      }
      // If hour doesn't match, skip to next hour
      if (!hours.includes(hr)) {
        candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
        continue;
      }
      // Otherwise advance by 1 minute
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    // Fallback: 1 hour from now
    logger.warn(`BDD: Could not find next cron match within 366 days for "${parts.join(' ')}"`);
    return new Date(after.getTime() + 60 * 60 * 1000);
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

    // Standard cron: compute interval from next two matches
    const cronParts = expression.trim().split(/\s+/);
    if (cronParts.length === 5) {
      const now = new Date();
      const first = this.getNextCronDate(cronParts, now);
      const second = this.getNextCronDate(cronParts, first);
      const interval = second.getTime() - first.getTime();
      if (interval > 0) return interval;
    }

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

    // Clean up old artifacts on startup (fire-and-forget)
    this.cleanupOldArtifacts().catch(() => {});
  }

  // ===========================
  // ARTIFACT CLEANUP
  // ===========================

  /**
   * Clean up old screenshot artifacts older than maxAgeDays (default 7 days).
   * Call periodically or on server startup.
   */
  async cleanupOldArtifacts(maxAgeDays: number = 7): Promise<number> {
    let cleaned = 0;
    try {
      if (!fs.existsSync(BDD_ARTIFACTS_DIR)) return 0;
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const dirs = fs.readdirSync(BDD_ARTIFACTS_DIR);
      for (const dir of dirs) {
        const dirPath = path.join(BDD_ARTIFACTS_DIR, dir);
        try {
          const stat = fs.statSync(dirPath);
          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            cleaned++;
          }
        } catch { /* ignore individual dir errors */ }
      }
      if (cleaned > 0) {
        logger.info(`BDD: Cleaned up ${cleaned} artifact directories older than ${maxAgeDays} days`);
      }
    } catch (e: any) {
      logger.warn(`BDD: Artifact cleanup failed: ${e.message}`);
    }
    return cleaned;
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
      const [removed] = pendingQueue.splice(queueIdx, 1);
      // Reject the promise so executeFeature caller unblocks
      removed.reject(new Error('Run was cancelled'));
      // Update DB status
      await pool.query(
        `UPDATE "BDDRun" SET status = 'cancelled', "errorMsg" = 'Run was cancelled while queued', "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
        [runId]
      );
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
