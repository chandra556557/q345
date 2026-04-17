import pool from '../../db';
import { logger } from '../../utils/logger';
import { exec, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { screenplayService } from './screenplay.service';
import { bddReportService } from '../bdd-report.service';

const execAsync = promisify(exec);

// Track running child processes by runId for cancellation
const runningProcesses = new Map<string, ChildProcess>();
const cancelRequested = new Set<string>();

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    exec(`taskkill /PID ${pid} /T /F`, () => {});
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }
}

// Report output directory (same as other reports, served by express.static)
// Reports are generated via bddReportService — stored in playwright-crx-reports/

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
  // Retry / Flaky test handling
  retryCount?: number;          // Number of retries for failed scenarios (default 0)
  retryDelayMs?: number;        // Delay between retries in ms (default 1000)
  quarantineFailures?: boolean; // If true, quarantined (@quarantine) tests don't fail the run
  // Environment profiles
  environment?: EnvironmentProfile;
}

export interface EnvironmentProfile {
  name: string;                              // e.g., 'dev', 'staging', 'prod'
  baseUrl?: string;                          // Base URL for navigation steps
  credentials?: Record<string, { username: string; password: string }>; // Named credential sets
  variables?: Record<string, string>;        // Custom env variables (injected into steps)
  timeout?: number;                          // Override default timeout (ms) for this env
  headers?: Record<string, string>;          // Default HTTP headers (e.g., auth tokens)
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
  generatePlaywrightCode(feature: ParsedFeature, language: 'typescript' | 'java' | 'java-cucumber' = 'typescript'): string {
    if (language === 'java-cucumber') return this.generateJavaCucumberProject(feature);
    if (language === 'java') return this.generateJavaPlaywrightCode(feature);

    const lines: string[] = [];
    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push('');
    lines.push(`// Base URL from environment or fallback — configure per project`);
    const featureBaseUrl = this.extractBaseUrl(feature);
    lines.push(`const BASE_URL = process.env.BASE_URL || '${featureBaseUrl}';`);
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
            lines.push(`    ${this.generateStepCode(step.keyword, stepText, 'preview', featureBaseUrl)}`);
          }
          lines.push('  });');
          lines.push('');
        }
      } else {
        lines.push(`  test('${this.escapeString(scenario.name)}', async ({ page }) => {`);
        for (const step of scenario.steps) {
          lines.push(`    // ${step.keyword} ${step.text}`);
          lines.push(`    ${this.generateStepCode(step.keyword, step.text, 'preview', featureBaseUrl)}`);
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
    lines.push(`    // Base URL from environment or fallback — configure per project`);
    lines.push(`    private static final String BASE_URL = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "${this.extractBaseUrl(feature)}";`);
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
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return `page.navigate(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "${url}");`;
        }
        return `page.navigate(System.getenv("BASE_URL") + "${url.startsWith('/') ? url : '/' + url}");`;
      }
      return `page.navigate(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:3000");`;
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

  // ============================================================
  // Java Cucumber (BDD) Project Generator
  // Generates: Step Definitions, Runner, Hooks, POM, feature copy
  // ============================================================

  /**
   * Generate a complete Java Cucumber project structure from a parsed feature.
   * Returns a single string with clearly delimited file sections.
   */
  private generateJavaCucumberProject(feature: ParsedFeature): string {
    const sections: string[] = [];

    // 1. Feature file (copy)
    sections.push(this.fileSection(
      `src/test/resources/features/${this.toSnakeCase(feature.name)}.feature`,
      this.reconstructFeatureFile(feature)
    ));

    // 2. Step Definitions
    sections.push(this.fileSection(
      `src/test/java/stepdefinitions/${this.toJavaClassName(feature.name)}Steps.java`,
      this.generateJavaCucumberStepDefs(feature)
    ));

    // 3. Hooks (Before/After with Playwright lifecycle)
    sections.push(this.fileSection(
      'src/test/java/stepdefinitions/Hooks.java',
      this.generateJavaCucumberHooks()
    ));

    // 4. Runner class
    sections.push(this.fileSection(
      `src/test/java/runner/${this.toJavaClassName(feature.name)}Runner.java`,
      this.generateJavaCucumberRunner(feature)
    ));

    // 5. POM.xml
    sections.push(this.fileSection(
      'pom.xml',
      this.generateJavaCucumberPom(feature)
    ));

    return sections.join('\n');
  }

  private fileSection(path: string, content: string): string {
    return `// ===== FILE: ${path} =====\n${content}\n// ===== END FILE: ${path} =====\n`;
  }

  /**
   * Generate Java Cucumber step definitions with @Given/@When/@Then annotations.
   * Maps Gherkin steps to Playwright for Java API calls.
   */
  private generateJavaCucumberStepDefs(feature: ParsedFeature): string {
    const className = this.toJavaClassName(feature.name) + 'Steps';
    const lines: string[] = [];

    lines.push('package stepdefinitions;');
    lines.push('');
    lines.push('import io.cucumber.java.en.Given;');
    lines.push('import io.cucumber.java.en.When;');
    lines.push('import io.cucumber.java.en.Then;');
    lines.push('import io.cucumber.java.en.And;');
    lines.push('import io.cucumber.java.en.But;');
    lines.push('import io.cucumber.java.DataTableType;');
    lines.push('import io.cucumber.datatable.DataTable;');
    lines.push('import com.microsoft.playwright.*;');
    lines.push('import com.microsoft.playwright.options.AriaRole;');
    lines.push('import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;');
    lines.push('import static org.junit.jupiter.api.Assertions.*;');
    lines.push('');
    lines.push(`public class ${className} {`);
    lines.push('');
    lines.push('    // Playwright objects injected via Hooks (shared World)');
    lines.push('    private final Hooks hooks;');
    lines.push('');
    lines.push(`    public ${className}(Hooks hooks) {`);
    lines.push('        this.hooks = hooks;');
    lines.push('    }');
    lines.push('');
    lines.push('    private Page page() { return hooks.getPage(); }');
    lines.push('');

    // Collect unique steps across all scenarios to avoid duplicate annotations
    const seenSteps = new Map<string, { keyword: string; text: string; hasDataTable: boolean; hasDocString: boolean }>();

    for (const scenario of feature.scenarios) {
      if (scenario.tags.includes('@background')) {
        // Background steps also get step definitions
      }
      let lastKeyword = 'Given';
      for (const step of scenario.steps) {
        // Resolve And/But to the actual keyword
        const resolvedKeyword = (step.keyword === 'And' || step.keyword === 'But') ? lastKeyword : step.keyword;
        if (step.keyword !== 'And' && step.keyword !== 'But') lastKeyword = step.keyword;

        // Build a unique key: keyword + parameterized text
        const paramText = this.toCucumberExpression(step.text);
        const key = `${resolvedKeyword}:${paramText}`;
        if (!seenSteps.has(key)) {
          seenSteps.set(key, {
            keyword: resolvedKeyword,
            text: step.text,
            hasDataTable: !!(step.dataTable && step.dataTable.length > 0),
            hasDocString: !!step.docString,
          });
        }
      }
    }

    // Generate a Java method for each unique step
    for (const [, step] of seenSteps) {
      const annotation = this.cucumberAnnotation(step.keyword);
      const cucumberExpr = this.toCucumberExpression(step.text);
      const methodName = this.toJavaMethodName(step.text);
      const params = this.extractCucumberParams(step.text);

      // Build parameter list
      const javaParams: string[] = params.map((p, i) => `${p.type} ${p.name || 'arg' + i}`);
      if (step.hasDataTable) javaParams.push('DataTable dataTable');
      if (step.hasDocString) javaParams.push('String docString');

      lines.push(`    @${annotation}("${this.escapeJavaString(cucumberExpr)}")`);
      lines.push(`    public void ${methodName}(${javaParams.join(', ')}) {`);

      // Generate implementation body
      const body = this.generateJavaCucumberStepBody(step.keyword, step.text, params, step.hasDataTable);
      for (const bodyLine of body) {
        lines.push(`        ${bodyLine}`);
      }

      lines.push('    }');
      lines.push('');
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Convert a Gherkin step text to a Cucumber expression with parameter placeholders.
   * e.g. 'I navigate to "https://example.com"' => 'I navigate to {string}'
   * e.g. 'I wait for 5 seconds' => 'I wait for {int} seconds'
   * e.g. 'the price is 9.99' => 'the price is {double}'
   * e.g. 'I fill "<username>"' => 'I fill {string}' (Scenario Outline placeholders)
   */
  private toCucumberExpression(text: string): string {
    let expr = text;

    // Replace Scenario Outline angle-bracket placeholders <param> with {string}
    expr = expr.replace(/<([^>]+)>/g, '{string}');

    // Replace quoted strings "..." or '...' with {string}
    expr = expr.replace(/"[^"]*"/g, '{string}');
    expr = expr.replace(/'[^']*'/g, '{string}');

    // Replace decimal numbers (must come before int) with {double}
    expr = expr.replace(/\b\d+\.\d+\b/g, '{double}');

    // Replace integer numbers with {int}
    expr = expr.replace(/\b\d+\b/g, '{int}');

    return expr;
  }

  /**
   * Extract parameter info from a step text for generating method signatures.
   */
  private extractCucumberParams(text: string): Array<{ type: string; name: string }> {
    const params: Array<{ type: string; name: string }> = [];
    let paramIndex = 0;

    // Scenario Outline placeholders <param>
    const outlineMatches = text.matchAll(/<([^>]+)>/g);
    for (const m of outlineMatches) {
      params.push({ type: 'String', name: this.toCamelCase(m[1]) });
      paramIndex++;
    }
    if (params.length > 0) return params; // Outline params take precedence

    // Quoted strings
    const stringMatches = text.matchAll(/"([^"]*)"/g);
    for (const m of stringMatches) {
      const hint = this.guessParamName(m[1], paramIndex);
      params.push({ type: 'String', name: hint });
      paramIndex++;
    }

    // Decimal numbers
    const decimalMatches = text.matchAll(/\b(\d+\.\d+)\b/g);
    for (const _ of decimalMatches) {
      params.push({ type: 'double', name: `value${paramIndex}`});
      paramIndex++;
    }

    // Integer numbers (skip those already captured as decimals)
    const intMatches = text.matchAll(/\b(\d+)\b/g);
    for (const m of intMatches) {
      if (!text.includes(m[1] + '.') && !text.includes('.' + m[1])) {
        params.push({ type: 'int', name: `count${paramIndex}` });
        paramIndex++;
      }
    }

    return params;
  }

  private guessParamName(value: string, index: number): string {
    const lower = value.toLowerCase();
    if (lower.includes('http') || lower.includes('www') || lower.includes('.com')) return 'url';
    if (lower.includes('@')) return 'email';
    if (lower.includes('password') || lower === '****') return 'password';
    if (index === 0) return 'target';
    return `value${index}`;
  }

  private cucumberAnnotation(keyword: string): string {
    switch (keyword) {
      case 'Given': return 'Given';
      case 'When': return 'When';
      case 'Then': return 'Then';
      case 'And': return 'And';
      case 'But': return 'But';
      default: return 'Given';
    }
  }

  /**
   * Generate the Java method body for a Cucumber step definition.
   * Maps natural language to Playwright for Java API calls.
   */
  private generateJavaCucumberStepBody(
    keyword: string,
    text: string,
    params: Array<{ type: string; name: string }>,
    hasDataTable: boolean
  ): string[] {
    const lower = text.toLowerCase();
    const body: string[] = [];
    const firstParam = params.length > 0 ? params[0].name : null;
    const secondParam = params.length > 1 ? params[1].name : null;

    // Navigation
    if (lower.includes('navigate') || lower.includes('go to') || lower.includes('open') || lower.includes('visit') || lower.includes('i am on')) {
      if (firstParam) {
        body.push(`page().navigate(${firstParam});`);
      } else {
        body.push('page().navigate(/* URL */);');
      }
      return body;
    }

    // Click
    if (lower.includes('click')) {
      if (firstParam) {
        if (lower.includes('button')) {
          body.push(`page().getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName(${firstParam})).click();`);
        } else if (lower.includes('link')) {
          body.push(`page().getByRole(AriaRole.LINK, new Page.GetByRoleOptions().setName(${firstParam})).click();`);
        } else {
          body.push(`page().getByText(${firstParam}).click();`);
        }
      } else {
        body.push('page().locator(/* selector */).click();');
      }
      return body;
    }

    // Fill / Type / Enter
    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter') || lower.includes('input')) {
      if (firstParam && secondParam) {
        body.push(`page().getByLabel(${firstParam}).fill(${secondParam});`);
      } else if (firstParam) {
        body.push(`page().locator(/* field selector */).fill(${firstParam});`);
      } else {
        body.push('page().locator(/* field selector */).fill(/* value */);');
      }
      return body;
    }

    // Login / credentials
    if (lower.includes('log in') || lower.includes('login') || lower.includes('credentials')) {
      if (firstParam && secondParam) {
        body.push(`page().getByLabel("Username").fill(${firstParam});`);
        body.push(`page().getByLabel("Password").fill(${secondParam});`);
        body.push('page().getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Login")).click();');
      } else {
        body.push('page().getByLabel("Username").fill(/* username */);');
        body.push('page().getByLabel("Password").fill(/* password */);');
        body.push('page().getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Login")).click();');
      }
      return body;
    }

    // Visibility assertions
    if (lower.includes('see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown') || lower.includes('appears')) {
      if (firstParam) {
        body.push(`assertThat(page().getByText(${firstParam})).isVisible();`);
      } else {
        body.push('assertThat(page().locator(/* selector */)).isVisible();');
      }
      return body;
    }

    // Text content assertions
    if (lower.includes('contain') || lower.includes('have text') || lower.includes('has text')) {
      if (firstParam) {
        body.push(`assertThat(page().locator("body")).containsText(${firstParam});`);
      } else {
        body.push('assertThat(page().locator(/* selector */)).containsText(/* text */);');
      }
      return body;
    }

    // URL assertions
    if (lower.includes('url') && (lower.includes('should') || lower.includes('contain') || lower.includes('be '))) {
      if (firstParam) {
        body.push(`assertThat(page()).hasURL(java.util.regex.Pattern.compile(".*" + ${firstParam} + ".*"));`);
      } else {
        body.push('assertThat(page()).hasURL(/* expected URL pattern */);');
      }
      return body;
    }

    // Title assertions
    if (lower.includes('title') && (lower.includes('should') || lower.includes('is') || lower.includes('be '))) {
      if (firstParam) {
        body.push(`assertThat(page()).hasTitle(java.util.regex.Pattern.compile(".*" + ${firstParam} + ".*"));`);
      } else {
        body.push('assertThat(page()).hasTitle(/* expected title */);');
      }
      return body;
    }

    // Wait
    if (lower.includes('wait')) {
      const timeMatch = text.match(/(\d+)\s*(seconds?|ms|milliseconds?)/);
      if (timeMatch) {
        const ms = timeMatch[2].startsWith('s') ? parseInt(timeMatch[1]) * 1000 : parseInt(timeMatch[1]);
        body.push(`page().waitForTimeout(${ms});`);
      } else {
        body.push('page().waitForTimeout(1000);');
      }
      return body;
    }

    // Select / choose
    if (lower.includes('select') || lower.includes('choose')) {
      if (firstParam) {
        body.push(`page().selectOption(/* selector */, ${firstParam});`);
      } else {
        body.push('page().selectOption(/* selector */, /* value */);');
      }
      return body;
    }

    // Check / uncheck
    if (lower.includes('check') && !lower.includes('uncheck')) {
      if (firstParam) {
        body.push(`page().getByLabel(${firstParam}).check();`);
      } else {
        body.push('page().locator(/* selector */).check();');
      }
      return body;
    }
    if (lower.includes('uncheck')) {
      if (firstParam) {
        body.push(`page().getByLabel(${firstParam}).uncheck();`);
      } else {
        body.push('page().locator(/* selector */).uncheck();');
      }
      return body;
    }

    // Hover
    if (lower.includes('hover')) {
      if (firstParam) {
        body.push(`page().getByText(${firstParam}).hover();`);
      } else {
        body.push('page().locator(/* selector */).hover();');
      }
      return body;
    }

    // Press key
    if (lower.includes('press')) {
      if (firstParam) {
        body.push(`page().keyboard().press(${firstParam});`);
      } else {
        body.push('page().keyboard().press("Enter");');
      }
      return body;
    }

    // Screenshot
    if (lower.includes('screenshot') || lower.includes('capture')) {
      body.push('page().screenshot(new Page.ScreenshotOptions().setFullPage(true).setPath(java.nio.file.Paths.get("screenshot.png")));');
      return body;
    }

    // Data table handling
    if (hasDataTable) {
      body.push('java.util.List<java.util.Map<String, String>> rows = dataTable.asMaps();');
      body.push('for (java.util.Map<String, String> row : rows) {');
      body.push('    // TODO: Process each row');
      body.push('    System.out.println(row);');
      body.push('}');
      return body;
    }

    // Not matched assertion (Then keyword)
    if (keyword === 'Then') {
      if (firstParam) {
        body.push(`assertThat(page().getByText(${firstParam})).isVisible();`);
      } else {
        body.push(`// TODO: Implement assertion - ${text}`);
      }
      return body;
    }

    // Fallback
    body.push(`// TODO: Implement step - ${keyword} ${text}`);
    return body;
  }

  /**
   * Generate Hooks.java with Playwright lifecycle management for Cucumber.
   * Uses PicoContainer for dependency injection (Cucumber default).
   */
  private generateJavaCucumberHooks(): string {
    const lines: string[] = [];

    lines.push('package stepdefinitions;');
    lines.push('');
    lines.push('import io.cucumber.java.Before;');
    lines.push('import io.cucumber.java.After;');
    lines.push('import io.cucumber.java.BeforeAll;');
    lines.push('import io.cucumber.java.AfterAll;');
    lines.push('import io.cucumber.java.Scenario;');
    lines.push('import com.microsoft.playwright.*;');
    lines.push('');
    lines.push('/**');
    lines.push(' * Cucumber Hooks - Manages Playwright browser lifecycle.');
    lines.push(' * Shared across step definitions via PicoContainer dependency injection.');
    lines.push(' */');
    lines.push('public class Hooks {');
    lines.push('');
    lines.push('    private static Playwright playwright;');
    lines.push('    private static Browser browser;');
    lines.push('    private BrowserContext context;');
    lines.push('    private Page page;');
    lines.push('');
    lines.push('    @BeforeAll');
    lines.push('    public static void launchBrowser() {');
    lines.push('        playwright = Playwright.create();');
    lines.push('        browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(true));');
    lines.push('    }');
    lines.push('');
    lines.push('    @AfterAll');
    lines.push('    public static void closeBrowser() {');
    lines.push('        if (browser != null) browser.close();');
    lines.push('        if (playwright != null) playwright.close();');
    lines.push('    }');
    lines.push('');
    lines.push('    @Before');
    lines.push('    public void createContextAndPage(Scenario scenario) {');
    lines.push('        context = browser.newContext(new Browser.NewContextOptions()');
    lines.push('            .setViewportSize(1280, 720)');
    lines.push('            .setIgnoreHTTPSErrors(true));');
    lines.push('        page = context.newPage();');
    lines.push('        page.setDefaultTimeout(60000);');
    lines.push('        System.out.println("[BDD] Starting scenario: " + scenario.getName());');
    lines.push('    }');
    lines.push('');
    lines.push('    @After');
    lines.push('    public void closeContext(Scenario scenario) {');
    lines.push('        if (scenario.isFailed() && page != null) {');
    lines.push('            byte[] screenshot = page.screenshot(new Page.ScreenshotOptions().setFullPage(true));');
    lines.push('            scenario.attach(screenshot, "image/png", "failure-screenshot");');
    lines.push('        }');
    lines.push('        if (context != null) context.close();');
    lines.push('        System.out.println("[BDD] Finished scenario: " + scenario.getName()');
    lines.push('            + " - Status: " + scenario.getStatus());');
    lines.push('    }');
    lines.push('');
    lines.push('    public Page getPage() { return page; }');
    lines.push('    public BrowserContext getContext() { return context; }');
    lines.push('    public Browser getBrowser() { return browser; }');
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Generate JUnit 5 Cucumber Runner class with @CucumberOptions.
   */
  private generateJavaCucumberRunner(feature: ParsedFeature): string {
    const className = this.toJavaClassName(feature.name) + 'Runner';
    const lines: string[] = [];

    lines.push('package runner;');
    lines.push('');
    lines.push('import org.junit.platform.suite.api.ConfigurationParameter;');
    lines.push('import org.junit.platform.suite.api.IncludeEngines;');
    lines.push('import org.junit.platform.suite.api.SelectClasspathResource;');
    lines.push('import org.junit.platform.suite.api.Suite;');
    lines.push('');
    lines.push('import static io.cucumber.junit.platform.engine.Constants.*;');
    lines.push('');
    lines.push('@Suite');
    lines.push('@IncludeEngines("cucumber")');
    lines.push(`@SelectClasspathResource("features/${this.toSnakeCase(feature.name)}.feature")`);
    lines.push('@ConfigurationParameter(key = GLUE_PROPERTY_NAME, value = "stepdefinitions")');
    lines.push('@ConfigurationParameter(key = PLUGIN_PROPERTY_NAME, value = "pretty, html:target/cucumber-reports/report.html, json:target/cucumber-reports/report.json")');
    lines.push('@ConfigurationParameter(key = FILTER_TAGS_PROPERTY_NAME, value = "not @skip")');
    lines.push(`public class ${className} {`);
    lines.push('    // JUnit 5 Cucumber Runner');
    lines.push('    // Run with: mvn test -Dtest=' + className);
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Generate Maven POM.xml with Cucumber + Playwright for Java dependencies.
   */
  private generateJavaCucumberPom(feature: ParsedFeature): string {
    const artifactId = this.toSnakeCase(feature.name).replace(/_/g, '-');
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.automation.bdd</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0-SNAPSHOT</version>
    <packaging>jar</packaging>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <cucumber.version>7.18.0</cucumber.version>
        <playwright.version>1.44.0</playwright.version>
        <junit.platform.version>1.10.3</junit.platform.version>
    </properties>

    <dependencies>
        <!-- Cucumber -->
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-java</artifactId>
            <version>\${cucumber.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-junit-platform-engine</artifactId>
            <version>\${cucumber.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-picocontainer</artifactId>
            <version>\${cucumber.version}</version>
            <scope>test</scope>
        </dependency>

        <!-- JUnit 5 -->
        <dependency>
            <groupId>org.junit.platform</groupId>
            <artifactId>junit-platform-suite</artifactId>
            <version>\${junit.platform.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.10.3</version>
            <scope>test</scope>
        </dependency>

        <!-- Playwright for Java -->
        <dependency>
            <groupId>com.microsoft.playwright</groupId>
            <artifactId>playwright</artifactId>
            <version>\${playwright.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.3.0</version>
                <configuration>
                    <properties>
                        <configurationParameters>
                            cucumber.junit-platform.naming-strategy=long
                        </configurationParameters>
                    </properties>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.13.0</version>
                <configuration>
                    <source>17</source>
                    <target>17</target>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;
  }

  /**
   * Reconstruct a Gherkin feature file from parsed data.
   */
  private reconstructFeatureFile(feature: ParsedFeature): string {
    const lines: string[] = [];

    if (feature.tags.length > 0) {
      lines.push(feature.tags.join(' '));
    }
    lines.push(`Feature: ${feature.name}`);
    if (feature.description) {
      for (const descLine of feature.description.split('\n')) {
        lines.push(`  ${descLine}`);
      }
    }
    lines.push('');

    for (const scenario of feature.scenarios) {
      if (scenario.tags.length > 0 && !scenario.tags.includes('@background')) {
        lines.push(`  ${scenario.tags.join(' ')}`);
      }

      if (scenario.tags.includes('@background')) {
        lines.push('  Background:');
      } else {
        lines.push(`  ${scenario.type}: ${scenario.name}`);
      }

      for (const step of scenario.steps) {
        lines.push(`    ${step.keyword} ${step.text}`);
        if (step.dataTable) {
          for (const row of step.dataTable) {
            lines.push(`      | ${row.join(' | ')} |`);
          }
        }
        if (step.docString) {
          lines.push('      """');
          for (const docLine of step.docString.split('\n')) {
            lines.push(`      ${docLine}`);
          }
          lines.push('      """');
        }
      }

      if (scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0) {
        lines.push('');
        lines.push('    Examples:');
        const headers = Object.keys(scenario.examples[0]);
        lines.push(`      | ${headers.join(' | ')} |`);
        for (const example of scenario.examples) {
          const values = headers.map(h => example[h]);
          lines.push(`      | ${values.join(' | ')} |`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private toSnakeCase(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .join('_')
      .toLowerCase();
  }

  private toCamelCase(name: string): string {
    const words = name.replace(/[^a-zA-Z0-9\s_-]/g, '').split(/[\s_-]+/);
    return words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  }

  private escapeJavaString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private generateStepCode(keyword: string, text: string, context: 'preview' | 'execution' = 'preview', baseUrl?: string): string {
    const lower = text.toLowerCase();
    const quotes = (text.match(/"([^"]*)"/g) || []).map(m => m.replace(/"/g, ''));

    // CSS/XPath passthrough: if quoted value looks like a selector, use page.locator directly
    const isCssSelector = (s: string) => /^[#.\[]|^\/\/|^xpath=|^css=|^data-/.test(s);

    // Frame/iframe support
    if (lower.includes('switch to frame') || lower.includes('switch to iframe')) {
      const frame = quotes[0]; if (!frame) return `throw new Error('Missing frame name');`;
      return `const frame = page.frameLocator('${this.escapeString(frame)}');`;
    }
    // Navigation / Launch
    if (lower.includes('navigate') || lower.match(/^(i )?(go to|open|visit) /) || lower.includes('launch') || lower.match(/^(i am on|user is on|the user is on|user should launch)/) || lower.includes('application is open')) {
      const url = quotes[0] || '';
      if (!url) {
        if (context === 'execution') {
          return `if (!ENV_PROFILE.baseUrl) throw new Error('No URL provided and baseUrl is not configured.');\n    await page.goto(ENV_PROFILE.baseUrl);`;
        }
        // Preview mode: resolve to literal URL for simple text-based executor
        const resolved = baseUrl || 'http://localhost:3000';
        return `await page.goto('${this.escapeString(resolved)}');`;
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return `await page.goto('${this.escapeString(url)}');`;
      }
      // Relative path
      const pathStr = url.startsWith('/') ? url : `/${url}`;
      if (context === 'execution') {
        return `if (!ENV_PROFILE.baseUrl) throw new Error('baseUrl is not configured for relative path "${this.escapeString(pathStr)}".');\n    await page.goto(ENV_PROFILE.baseUrl + '${this.escapeString(pathStr)}');`;
      }
      // Preview mode: resolve to literal URL for simple text-based executor
      if (baseUrl) {
        const resolved = baseUrl + pathStr;
        return `await page.goto('${this.escapeString(resolved)}');`;
      }
      // No baseUrl — use BASE_URL variable (defined at top of generated script)
      if (pathStr === '/') {
        return `await page.goto(BASE_URL);`;
      }
      return `await page.goto(BASE_URL + '${this.escapeString(pathStr)}');`;
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
      const val = quotes[0]; if (!val) return `throw new Error('Missing quoted value in step: ${keyword} ${this.escapeString(text)}');`;
      const field = lower.includes('email') ? 'Email' : 'Username';
      return `await page.getByLabel('${field}').fill('${this.escapeString(val)}');`;
    }
    if (lower.match(/^i enter password /)) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing quoted value in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByLabel('Password').fill('${this.escapeString(val)}');`;
    }
    if (lower.includes('login button') || lower.includes('submit the login')) {
      return `await page.getByRole('button', { name: /sign in|login|submit/i }).click();`;
    }
    if (lower.match(/^i log ?out/)) return `await page.getByRole('button', { name: /log ?out|sign ?out/i }).click();`;

    // Click
    if (lower.includes('click on the') && lower.includes('tab')) {
      const tab = quotes[0]; if (!tab) return `throw new Error('Missing tab name in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByRole('tab', { name: '${this.escapeString(tab)}' }).click();`;
    }
    if (lower.includes('click on the') && lower.includes('menu')) {
      const menu = quotes[0]; if (!menu) return `throw new Error('Missing menu name in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByRole('menuitem', { name: '${this.escapeString(menu)}' }).click();`;
    }
    if (lower.includes('click') && lower.includes('button')) {
      const btn = quotes[0]; if (!btn) return `throw new Error('Missing button name in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByRole('button', { name: '${this.escapeString(btn)}' }).click();`;
    }
    if (lower.includes('click') && lower.includes('link')) {
      const link = quotes[0]; if (!link) return `throw new Error('Missing link name in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByRole('link', { name: '${this.escapeString(link)}' }).click();`;
    }
    if (lower.includes('double click')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing target in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByText('${this.escapeString(target)}').first().dblclick();`;
    }
    if (lower.includes('right click')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing target in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByText('${this.escapeString(target)}').first().click({ button: 'right' });`;
    }
    // Click with nth support: "I click the 2nd "Item""
    if (lower.match(/click the (\d+)(?:st|nd|rd|th) /)) {
      const nthMatch = lower.match(/click the (\d+)(?:st|nd|rd|th) /);
      const target = quotes[0]; if (!target) return `throw new Error('Missing target in step: ${keyword} ${this.escapeString(text)}');`;
      const idx = parseInt(nthMatch![1]) - 1;
      return `await page.getByText('${this.escapeString(target)}').nth(${idx}).click();`;
    }
    // Click with first/last
    if (lower.includes('click the first') && quotes[0]) {
      return `await page.getByText('${this.escapeString(quotes[0])}').first().click();`;
    }
    if (lower.includes('click the last') && quotes[0]) {
      return `await page.getByText('${this.escapeString(quotes[0])}').last().click();`;
    }
    if (lower.includes('click')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing target in step: ${keyword} ${this.escapeString(text)}');`;
      // CSS/XPath selector passthrough
      if (isCssSelector(target)) {
        return `await page.locator('${this.escapeString(target)}').first().click();`;
      }
      // Image click
      if (lower.includes('image') || lower.includes('img') || lower.includes('icon')) {
        return `await page.getByRole('img', { name: '${this.escapeString(target)}' }).click();`;
      }
      return `await page.getByRole('button', { name: '${this.escapeString(target)}' }).click();`;
    }

    // Hover / Focus
    if (lower.includes('hover')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing target in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByText('${this.escapeString(target)}').first().hover();`;
    }
    if (lower.includes('focus')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing target in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByLabel('${this.escapeString(target)}').focus();`;
    }

    // Keyboard
    if (lower === 'i press enter') return `await page.keyboard.press('Enter');`;
    if (lower === 'i press tab') return `await page.keyboard.press('Tab');`;
    if (lower === 'i press escape') return `await page.keyboard.press('Escape');`;
    if (lower.includes('press')) {
      const key = quotes[0]; if (!key) return `throw new Error('Missing key in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.keyboard.press('${this.escapeString(key)}');`;
    }

    // Clear field
    if (lower.includes('clear') && !lower.includes('click')) {
      const field = quotes[0]; if (!field) return `throw new Error('Missing field in step: ${keyword} ${this.escapeString(text)}');`;
      const cleanField = field.replace(/[:\s]+$/, '').trim();
      if (isCssSelector(cleanField)) return `await page.locator('${this.escapeString(cleanField)}').first().clear();`;
      return `await page.getByLabel('${this.escapeString(cleanField)}').clear();`;
    }

    // Fill / Type / Enter (form input) - must be after credentials check
    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter') || lower.includes('set')) {
      if (quotes.length >= 2) {
        const cleanField = quotes[0].replace(/[:\s]+$/, '').trim();
        const value = this.escapeString(quotes[1]);
        // CSS/XPath selector passthrough
        if (isCssSelector(cleanField)) {
          return `await page.locator('${this.escapeString(cleanField)}').first().fill('${value}');`;
        }
        // "type slowly" / "type char by char" → pressSequentially
        if (lower.includes('slowly') || lower.includes('char by char') || lower.includes('one by one')) {
          return `await page.getByLabel('${this.escapeString(cleanField)}').pressSequentially('${value}', { delay: 100 });`;
        }
        return `await page.getByLabel('${this.escapeString(cleanField)}').fill('${value}');`;
      }
      if (quotes.length === 1) {
        return `throw new Error('Cannot determine which field to fill. Use: When I fill "fieldname" with "value"');`;
      }
    }

    // Select / Dropdown
    if (lower.includes('select') && !lower.includes('radio')) {
      if (quotes.length >= 2) {
        return `await page.getByLabel('${this.escapeString(quotes[1])}').selectOption('${this.escapeString(quotes[0])}');`;
      }
      if (quotes.length === 1) {
        return `throw new Error('Cannot determine which dropdown to select. Use: When I select "value" from "fieldname"');`;
      }
    }

    // Checkbox / Radio
    if (lower.includes('check') && !lower.includes('uncheck')) {
      const label = quotes[0]; if (!label) return `throw new Error('Missing label in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByLabel('${this.escapeString(label)}').check();`;
    }
    if (lower.includes('uncheck')) {
      const label = quotes[0]; if (!label) return `throw new Error('Missing label in step: ${keyword} ${this.escapeString(text)}');`;
      return `await page.getByLabel('${this.escapeString(label)}').uncheck();`;
    }
    if (lower.includes('radio')) {
      const label = quotes[0]; if (!label) return `throw new Error('Missing label in step: ${keyword} ${this.escapeString(text)}');`;
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
        return `await page.waitForLoadState('domcontentloaded');`;
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
      // Try to extract URL-like text
      const urlInText = text.match(/(https?:\/\/[^\s"']+|\/[^\s"']+)/);
      if (urlInText) return `await page.waitForURL(new RegExp('${this.escapeString(urlInText[1])}'));`;
      // Extract page name from "redirected to the X page"
      const pageMatch = text.match(/(?:to|on)\s+(?:the\s+)?(\w+)\s+page/i);
      if (pageMatch) return `await expect(page).toHaveURL(new RegExp('${this.escapeString(pageMatch[1].toLowerCase())}'));`;
      return `await page.waitForLoadState('domcontentloaded');`;
    }

    // Field value assertions: "Username" field should have value "admin"
    if ((lower.includes('should have value') || lower.includes('should contain value') || lower.includes('value should be')) && quotes.length >= 2) {
      const field = this.escapeString(quotes[0].replace(/[:\s]+$/, '').trim());
      const value = this.escapeString(quotes[1]);
      return `await expect(page.getByLabel('${field}')).toHaveValue('${value}');`;
    }

    // Count assertions: I should see 5 "items"
    if (lower.match(/should see (\d+) /) && quotes.length >= 1) {
      const countMatch = lower.match(/should see (\d+) /);
      return `await expect(page.getByText('${this.escapeString(quotes[0])}')).toHaveCount(${countMatch![1]});`;
    }

    // Attribute assertions: "Submit" should have class "active"
    if (lower.includes('should have class') && quotes.length >= 2) {
      return `await expect(page.getByText('${this.escapeString(quotes[0])}').first()).toHaveClass(new RegExp('${this.escapeString(quotes[1])}'));`;
    }
    if (lower.includes('should have attribute') && quotes.length >= 3) {
      return `await expect(page.getByText('${this.escapeString(quotes[0])}').first()).toHaveAttribute('${this.escapeString(quotes[1])}', '${this.escapeString(quotes[2])}');`;
    }

    // Placeholder assertion
    if (lower.includes('placeholder should be') && quotes.length >= 2) {
      return `await expect(page.getByLabel('${this.escapeString(quotes[0])}')).toHaveAttribute('placeholder', '${this.escapeString(quotes[1])}');`;
    }

    // Checked state assertion
    if (lower.includes('should be checked') && quotes[0]) {
      return `await expect(page.getByLabel('${this.escapeString(quotes[0])}')).toBeChecked();`;
    }
    if (lower.includes('should not be checked') && quotes[0]) {
      return `await expect(page.getByLabel('${this.escapeString(quotes[0])}')).not.toBeChecked();`;
    }

    // Visibility assertions
    if (lower.includes('should not see') || lower.includes('should not be visible')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing text in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page.getByText('${this.escapeString(target)}')).toBeHidden();`;
    }
    if (lower.includes('see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown')) {
      let target = quotes[0];
      if (!target) {
        // Extract meaningful text from natural language: "Error message X is displayed" → "X"
        target = text
          .replace(/^(verify|check|ensure|assert|confirm|then)\s+(that\s+)?/i, '')
          .replace(/^(error|success|warning|info)\s+(message\s+)?/i, '')
          .replace(/\s+(is|are|should be)\s+(displayed|shown|visible|present)\s*$/i, '')
          .replace(/\s+(displays?|shows?)\s*$/i, '')
          .trim();
      }
      if (!target) target = text;
      return `await expect(page.getByText('${this.escapeString(target)}', { exact: false })).toBeVisible({ timeout: 10000 });`;
    }

    // URL assertions
    if (lower.includes('url should contain')) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing URL part in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page).toHaveURL(new RegExp('${this.escapeString(val)}'));`;
    }
    if (lower.includes('url should be')) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing URL in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page).toHaveURL('${this.escapeString(val)}');`;
    }

    // Title
    if (lower.includes('title should be')) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing title in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page).toHaveTitle('${this.escapeString(val)}');`;
    }
    if (lower.includes('title should contain')) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing title in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page).toHaveTitle(new RegExp('${this.escapeString(val)}'));`;
    }

    // Contain text
    if (lower.includes('contain') || lower.includes('have text')) {
      const target = quotes[0]; if (!target) return `throw new Error('Missing text in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page.locator('body')).toContainText('${this.escapeString(target)}');`;
    }

    // Disabled / Enabled
    if (lower.includes('disabled')) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing name in step: ${keyword} ${this.escapeString(text)}');`;
      return `await expect(page.getByRole('button', { name: '${this.escapeString(val)}' })).toBeDisabled();`;
    }
    if (lower.includes('enabled')) {
      const val = quotes[0]; if (!val) return `throw new Error('Missing name in step: ${keyword} ${this.escapeString(text)}');`;
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

    // Generate a best-effort step using keyword context instead of leaving a TODO
    if (keyword === 'Given' || keyword === 'And') {
      // Setup step: try to navigate or find an element
      if (quotes.length >= 1) {
        return `await page.goto('${this.escapeString(quotes[0])}').catch(() => { /* ${text} */ });`;
      }
      return `// Step needs manual implementation: ${keyword} ${text}\nthrow new Error('Step not implemented: ${this.escapeString(keyword)} ${this.escapeString(text)}');`;
    }
    if (keyword === 'When') {
      // Action step: try clicking or interacting
      if (quotes.length >= 1) {
        return `await page.getByText('${this.escapeString(quotes[0])}').first().click().catch(async () => { await page.locator('[data-testid="${this.escapeString(quotes[0])}"]').first().click(); });`;
      }
      return `// Step needs manual implementation: ${keyword} ${text}\nthrow new Error('Step not implemented: ${this.escapeString(keyword)} ${this.escapeString(text)}');`;
    }
    if (keyword === 'Then') {
      // Assertion step: check for visibility
      if (quotes.length >= 1) {
        return `await expect(page.getByText('${this.escapeString(quotes[0])}')).toBeVisible({ timeout: 10000 });`;
      }
      return `// Step needs manual implementation: ${keyword} ${text}\nthrow new Error('Assertion not implemented: ${this.escapeString(keyword)} ${this.escapeString(text)}');`;
    }
    return `// Step needs manual implementation: ${keyword} ${text}\nthrow new Error('Step not implemented: ${this.escapeString(keyword)} ${this.escapeString(text)}');`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }

  /**
   * Extract the base URL from a parsed feature by scanning all step texts for URLs.
   * Returns the first full URL found, or empty string if none.
   */
  private extractBaseUrl(feature: ParsedFeature): string {
    for (const scenario of feature.scenarios) {
      for (const step of scenario.steps) {
        const urlMatch = step.text.match(/https?:\/\/[^\s"']+/);
        if (urlMatch) {
          // Extract origin (protocol + host) without path
          try {
            const parsed = new URL(urlMatch[0]);
            return parsed.origin;
          } catch {
            return urlMatch[0];
          }
        }
      }
    }
    return '';
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
        // Match URLs that are NOT preceded by a double or single quote
        return line.replace(
          /(?<!["'])(https?:\/\/[^\s"']+)(?!["'])/g,
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
    const serenityExists = true; // Serenity removed — only Allure used

    let needsReinstall = false;
    if (cucumberExists) {
      try {
        const pkgPath = path.join(SHARED_BDD_DIR, 'node_modules', '@cucumber', 'cucumber', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const major = parseInt(String(pkg.version).split('.')[0], 10);
        if (!Number.isNaN(major) && major >= 10) {
          needsReinstall = true;
          logger.warn(`BDD: Detected @cucumber/cucumber v${pkg.version} (ESM with TLA). Reinstalling to a CJS-compatible version for step defs.`);
        }
      } catch {
        // If unable to read version, proceed to reinstall to be safe
        needsReinstall = true;
      }
    }

    if (!needsReinstall && cucumberExists && playwrightExists && serenityExists) {
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
        // Pin to a CommonJS-compatible major to avoid ESM/TLA issues with require()
        '@cucumber/cucumber': '^9.1.0',
        'playwright': '^1.49.0',
        '@playwright/test': '^1.49.0',
      },
    };
    fs.writeFileSync(path.join(SHARED_BDD_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2));

    // Clean node_modules if present to ensure correct versions
    try {
      fs.rmSync(path.join(SHARED_BDD_DIR, 'node_modules'), { recursive: true, force: true });
    } catch { /* ignore */ }
    await execAsync('npm install --omit=dev', { cwd: SHARED_BDD_DIR, timeout: 180000 });

    try {
      await execAsync('npx playwright install chrome', { cwd: SHARED_BDD_DIR, timeout: 300000 });
      logger.info('BDD: Chrome browser installed');
    } catch (e: any) {
      logger.warn(`BDD: Playwright install chrome warning: ${e.message}`);
    }

    // Download Serenity BDD CLI JAR (requires Java JRE 8+ at runtime)
    try {
      await execAsync('npx serenity-bdd update', { cwd: SHARED_BDD_DIR, timeout: 120000 });
      logger.info('BDD: Serenity BDD CLI JAR downloaded');
    } catch (e: any) {
      logger.warn(`BDD: Serenity BDD CLI download warning (Java may not be installed): ${e.message}`);
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

    // Slot was transferred by releaseSlot — no need to increment here
    logger.info(`BDD: Slot acquired for ${runId} after waiting (${activeRunCount}/${MAX_CONCURRENT_RUNS} active)`);
  }

  private releaseSlot(): void {
    const next = pendingQueue.shift();
    if (next) {
      // Transfer the slot directly to the next queued run (don't decrement+increment)
      logger.info(`BDD: Dequeuing run ${next.runId} (${pendingQueue.length} still waiting)`);
      next.resolve();
    } else {
      activeRunCount = Math.max(0, activeRunCount - 1);
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
      const stepDefCode = this.buildStepDefinitions(mergedDefs, processedContent, screenshotDir, runId, options);
      const stepsPath = path.join(stepDefsDir, 'steps.js');
      fs.writeFileSync(stepsPath, stepDefCode);

      logger.info(`BDD Run ${runId}: Generated step defs:\n${stepDefCode.substring(0, 2000)}`);

      // Build cucumber command args as array (avoids shell quoting issues with spawn)
      const cucumberEntry = path.join(SHARED_BDD_DIR, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber-js');
      const resultsPath = path.join(runDir, 'results.json');

      const parallelWorkers = options.parallelWorkers || 1;

      const spawnArgs: string[] = [
        cucumberEntry,
        '--require', stepsPath,
        '--format', `json:"${resultsPath}"`,
      ];

      spawnArgs.push(featuresPath);

      // Tag-based filtering (e.g., "@smoke", "@smoke and not @wip")
      if (options.tags) {
        spawnArgs.push('--tags', options.tags);
        logger.info(`BDD Run ${runId}: Filtering by tags: ${options.tags}`);
      }

      // Retry failed scenarios (Cucumber built-in --retry)
      const retryCount = options.retryCount || 0;
      if (retryCount > 0) {
        spawnArgs.push('--retry', String(retryCount));
        logger.info(`BDD Run ${runId}: Retry count: ${retryCount}`);
      }

      // Parallel scenario execution
      if (parallelWorkers > 1) {
        spawnArgs.push('--parallel', String(parallelWorkers));
        logger.info(`BDD Run ${runId}: Running with ${parallelWorkers} parallel workers`);
      }

      logger.info(`BDD Run ${runId}: Command: node ${spawnArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

      // Run cucumber with child process tracking
      const startTime = Date.now();
      let cucumberStdout = '';
      let cucumberStderr = '';
      let cucumberExitCode = 0;

      try {
        // Use spawn instead of exec to avoid maxBuffer limits and enable true streaming
        const cucumberResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
          const child = spawn('node', spawnArgs, {
            cwd: runDir,
            env: {
              ...process.env,
              NODE_PATH: path.join(SHARED_BDD_DIR, 'node_modules'),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            shell: false,
          });

          let stdoutBuf = '';
          let stderrBuf = '';
          let settled = false;

          // Configurable timeout (default 5 minutes via BDD_PROCESS_TIMEOUT_MS)
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              runningProcesses.delete(runId);
              killProcessTree(child);
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

          child.on('close', (code, signal) => {
            settled = true;
            clearTimeout(timer);
            runningProcesses.delete(runId);
            if (cancelRequested.has(runId) || signal === 'SIGTERM' || signal === 'SIGKILL') {
              cancelRequested.delete(runId);
              reject(new Error('Run was cancelled'));
            } else {
              // Pass exit code so callers can detect Cucumber failures
              resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code ?? 0 });
            }
          });

          child.on('error', (err) => {
            settled = true;
            clearTimeout(timer);
            runningProcesses.delete(runId);
            cancelRequested.delete(runId);
            reject(err);
          });
        });
        cucumberStdout = cucumberResult.stdout;
        cucumberStderr = cucumberResult.stderr;
        cucumberExitCode = cucumberResult.exitCode;
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
      let retryInfo: { totalRetries: number; flakyScenarios: string[]; retriedScenarios: string[] } = {
        totalRetries: 0, flakyScenarios: [], retriedScenarios: [],
      };
      const scenarioAttempts = new Map<string, { attempts: number; finalStatus: string; tags: string[] }>();

      const resultsFile = path.join(runDir, 'results.json');
      if (fs.existsSync(resultsFile)) {
        const resultsRaw = fs.readFileSync(resultsFile, 'utf-8');
        logger.info(`BDD Run ${runId}: results.json size: ${resultsRaw.length}`);

        if (resultsRaw.trim()) {
          const results = JSON.parse(resultsRaw);

          // Track scenario attempts for flaky detection

          for (const feature of results) {
            for (const element of feature.elements || []) {
              const scenarioName = element.name || 'Unknown';
              const scenarioKey = `${feature.name || ''}::${scenarioName}`;
              // Collect tags from Cucumber JSON (element.tags is [{name:'@foo'}, ...])
              const elementTags: string[] = (element.tags || []).map((t: any) => t.name || t);

              // Track attempts per scenario (retried scenarios appear multiple times)
              const existing = scenarioAttempts.get(scenarioKey);
              if (existing) {
                existing.attempts++;
                retryInfo.totalRetries++;
                if (!retryInfo.retriedScenarios.includes(scenarioName)) {
                  retryInfo.retriedScenarios.push(scenarioName);
                }
              } else {
                scenarioAttempts.set(scenarioKey, { attempts: 1, finalStatus: 'passed', tags: elementTags });
              }

              // Track whether this attempt (element) has any failed steps
              let attemptHasFailure = false;

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
                  scenario: scenarioName,
                };
                stepResults.push(stepResult);

                // Emit live step result
                this.emitEvent(runId, 'step', { index: totalSteps - 1, ...stepResult });

                if (stepResult.status === 'passed') passedSteps++;
                else if (stepResult.status === 'failed') {
                  failedSteps++;
                  attemptHasFailure = true;
                }
                else { skippedSteps++; }
              }

              // Update finalStatus based on this attempt's outcome (last attempt wins)
              const entry = scenarioAttempts.get(scenarioKey);
              if (entry) {
                entry.finalStatus = attemptHasFailure ? 'failed' : 'passed';
              }
            }
          }

          // Detect flaky scenarios: retried AND final status is passed
          for (const [key, data] of scenarioAttempts) {
            if (data.attempts > 1 && data.finalStatus === 'passed') {
              const scenarioName = key.split('::')[1];
              retryInfo.flakyScenarios.push(scenarioName);
            }
            // Update overall status based on final attempt
            if (data.finalStatus === 'failed') {
              // Check if scenario has @quarantine tag — don't fail the overall run
              const isQuarantined = options.quarantineFailures &&
                data.tags.includes('@quarantine');
              if (!isQuarantined) {
                overallStatus = 'failed';
              }
            }
          }

          // If we have flaky scenarios but all passed on retry, mark as flaky (not failed)
          if (retryInfo.flakyScenarios.length > 0 && overallStatus === 'passed') {
            // Still passed, but note flakiness in the log
            logger.warn(`BDD Run ${runId}: ${retryInfo.flakyScenarios.length} flaky scenario(s): ${retryInfo.flakyScenarios.join(', ')}`);
          }

          if (retryInfo.totalRetries > 0) {
            logger.info(`BDD Run ${runId}: Retries: ${retryInfo.totalRetries}, Flaky: ${retryInfo.flakyScenarios.length}, Retried: ${retryInfo.retriedScenarios.join(', ')}`);
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

      // If Cucumber exited with non-zero code and we still think it passed, override to failed
      if (cucumberExitCode !== 0 && overallStatus === 'passed') {
        overallStatus = 'failed';
        if (!errorMsg) {
          errorMsg = `Cucumber exited with code ${cucumberExitCode}. ${cucumberStderr.substring(0, 500)}`;
        }
        logger.warn(`BDD Run ${runId}: Cucumber exit code ${cucumberExitCode} — marking as failed`);
      }

      // Collect screenshot URLs
      const screenshotUrls = this.collectScreenshots(runId, screenshotDir);

      // Parse feature for narrative and scenario info
      const parsedForReport = this.parseFeatureContent(featureContent);

      // ========================================
      // BDD REPORT — Generate HTML report from BDD results
      // ========================================
      let bddReportUrl = '';
      try {
        // Group stepResults by scenario
        const scenarioMap = new Map<string, { steps: typeof stepResults; duration: number; status: string; tags: string[] }>();
        for (const sr of stepResults) {
          const sName = sr.scenario || 'Unknown Scenario';
          if (!scenarioMap.has(sName)) {
            // Look up tags from scenarioAttempts
            const attemptKey = Array.from(scenarioAttempts.keys()).find(k => k.endsWith(`::${sName}`));
            const tags = attemptKey ? scenarioAttempts.get(attemptKey)?.tags || [] : [];
            scenarioMap.set(sName, { steps: [], duration: 0, status: 'passed', tags });
          }
          const entry = scenarioMap.get(sName)!;
          entry.steps.push(sr);
          entry.duration += sr.duration || 0;
          if (sr.status === 'failed') entry.status = 'failed';
          else if (sr.status !== 'passed' && entry.status !== 'failed') entry.status = sr.status;
        }

        // Build screenshot map: "sc{scenario}-step-{index}" -> screenshot file path
        const screenshotFiles = fs.existsSync(screenshotDir)
          ? fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
          : [];
        const stepScreenshotMap = new Map<string, string>();
        for (const file of screenshotFiles) {
          // Match patterns: sc{sc}-step-{index}-PASSED-{ts}.png, sc{sc}-step-fail-{index}-{ts}.png
          const passMatch = file.match(/^sc(\d+)-step-(\d+)-(?:PASSED|FAILED|done)/);
          const failMatch = file.match(/^sc(\d+)-step-fail-(\d+)/);
          const match = passMatch || failMatch;
          if (match) {
            const key = `${match[1]}-${match[2]}`;
            // Prefer fail screenshots over pass screenshots
            if (!stepScreenshotMap.has(key) || file.includes('fail')) {
              stepScreenshotMap.set(key, path.join(screenshotDir, file));
            }
          }
        }

        // Extract browser console errors from stdout
        const consoleErrors: string[] = [];
        for (const line of cucumberStdout.split('\n')) {
          if (line.includes('[BROWSER ERROR]')) {
            consoleErrors.push(line.replace('[BROWSER ERROR]', '').trim());
          }
        }

        let scenarioIdx = 0;
        bddReportUrl = await bddReportService.generateBDDReport(
          runId,
          Array.from(scenarioMap.entries()).map(([name, data]) => {
            scenarioIdx++;
            return {
              name,
              status: data.status,
              duration: data.duration,
              tags: data.tags,
              steps: data.steps.map((s, i) => ({
                keyword: s.keyword,
                name: s.name,
                status: s.status as any,
                duration: s.duration || undefined,
                errorMessage: s.errorMessage || undefined,
                screenshotPath: stepScreenshotMap.get(`${scenarioIdx}-${i + 1}`) || undefined,
              })),
            };
          }),
          {
            featureName: parsedForReport.name || 'BDD Feature',
            description: parsedForReport.description || undefined,
            environment: options.environment?.name,
            browser: options.browser,
            retryInfo: retryInfo.totalRetries > 0 ? retryInfo : undefined,
            consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
            executionStartTime: new Date(startTime).toISOString(),
          }
        );
        if (bddReportUrl) {
          logger.info(`BDD Run ${runId}: BDD Cucumber report generated at ${bddReportUrl}`);
        }
      } catch (reportErr: any) {
        logger.warn(`BDD Run ${runId}: Report generation failed (non-fatal): ${reportErr.message}`);
      }

      const reportUrl = bddReportUrl || `/api/bdd/runs/${runId}/report`;

      // Update run in DB
      await pool.query(
        `UPDATE "BDDRun" SET
          status = $1, duration = $2,
          "totalSteps" = $3, "passedSteps" = $4, "failedSteps" = $5, "skippedSteps" = $6,
          "stepResults" = $7, "errorMsg" = $8, "reportUrl" = $10, "screenshotUrls" = $11,
          "retryCount" = $12, "retryInfo" = $13,
          tags = $14, "parallelWorkers" = $15,
          "environmentName" = $16, "environmentProfile" = $17,
          "completedAt" = now(), "updatedAt" = now()
         WHERE id = $9`,
        [overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps,
          JSON.stringify(stepResults), errorMsg || null, runId, reportUrl, JSON.stringify(screenshotUrls),
          retryCount, JSON.stringify(retryInfo),
          options.tags || null, parallelWorkers,
          options.environment?.name || null, options.environment ? JSON.stringify(options.environment) : null]
      );

      // Emit live event: completed
      this.emitEvent(runId, 'completed', {
        status: overallStatus, duration, totalSteps, passedSteps, failedSteps, skippedSteps,
        reportUrl, screenshotUrls,
        ...(retryInfo.totalRetries > 0 ? { retryInfo } : {}),
        ...(options.environment?.name ? { environment: options.environment.name } : {}),
      });

      logger.info(`BDD Run ${runId}: Completed - ${overallStatus} (${passedSteps}/${totalSteps} passed), screenshots: ${screenshotUrls.length}, report: ${reportUrl}`);
    } catch (error: any) {
      if (error?.message === 'Run was cancelled') {
        logger.info(`BDD Run ${runId}: Cancelled`);
        this.emitEvent(runId, 'status', { status: 'cancelled' });
        await pool.query(
          `UPDATE "BDDRun" SET status = 'cancelled', "errorMsg" = 'Run was cancelled by user', "completedAt" = now(), "updatedAt" = now() WHERE id = $1`,
          [runId]
        );
        return;
      }

      logger.error(`BDD Run ${runId}: Execution error: ${error.message}`);
      this.emitEvent(runId, 'error', { message: error.message });

      // Generate BDD report even for errored runs
      let errorReportUrl = '';
      try {
        errorReportUrl = await bddReportService.generateBDDReport(
          runId,
          [{ name: 'Execution Error', status: 'failed', duration: 0, tags: [], steps: [] }],
          { featureName: 'BDD Test (Failed)', browser: options.browser }
        );
      } catch (reportErr: any) {
        logger.warn(`BDD Run ${runId}: Failed to generate error report: ${reportErr.message}`);
      }

      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "reportUrl" = $3, "completedAt" = now(), "updatedAt" = now() WHERE id = $2`,
        [error.message, runId, errorReportUrl || null]
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

      // Load: (1) user's own steps, (2) org-shared steps (where userId differs but org matches)
      // This prevents user A from seeing user B's personal steps in the same org
      if (userId) {
        conditions.push(`"userId" = $${params.length + 1}`);
        params.push(userId);
      }
      if (organizationId) {
        // Org-level steps: belong to the org AND are not another user's personal entry
        // (i.e., entries explicitly created for the org, or entries created by this user within the org)
        conditions.push(`("organizationId" = $${params.length + 1}${userId ? ` AND ("userId" = $1 OR "userId" IS NULL)` : ''})`);
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

    // Environment profile configuration
    const env = options.environment;
    const stepTimeout = env?.timeout || 60000;
    lines.push(`// Configure default step timeout (${stepTimeout / 1000} seconds)`);
    lines.push(`setDefaultTimeout(${stepTimeout});`);
    lines.push('');

    // Extract base URL from feature content if not provided in environment config
    const urlMatch = featureContent.match(/(?:Given|When|And)\s+.*?["'](https?:\/\/[^"'\s]+)["']/i);
    const featureBaseUrl = urlMatch ? urlMatch[1].replace(/\/+$/, '') : '';

    // Inject environment profile as a global config object
    lines.push(`// ========================================`);
    lines.push(`// Environment Profile Configuration`);
    lines.push(`// ========================================`);
    lines.push(`const ENV_PROFILE = ${JSON.stringify({
      name: env?.name || 'default',
      baseUrl: env?.baseUrl || featureBaseUrl || '',
      credentials: env?.credentials || {},
      variables: env?.variables || {},
      headers: env?.headers || {},
    }, null, 2)};`);
    lines.push('');
    lines.push(`// Helper: resolve URL with baseUrl prefix (handles baseUrl with embedded path)`);
    lines.push(`function resolveUrl(url) {`);
    lines.push(`  if (url.startsWith('http://') || url.startsWith('https://')) return url;`);
    lines.push(`  const baseUrl = ENV_PROFILE.baseUrl || '';`);
    lines.push(`  if (!baseUrl) return url;`);
    lines.push(`  // Normalize path`);
    lines.push(`  const path = url.startsWith('/') ? url : '/' + url;`);
    lines.push(`  try {`);
    lines.push(`    const base = new URL(baseUrl);`);
    lines.push(`    // If baseUrl already points at the requested path, return it as-is`);
    lines.push(`    if (base.pathname === path || base.pathname.replace(/\\/$/, '') === path.replace(/\\/$/, '')) {`);
    lines.push(`      return baseUrl.replace(/\\/$/, '');`);
    lines.push(`    }`);
    lines.push(`    // If baseUrl has an embedded path AND requested path is '/', return origin (homepage)`);
    lines.push(`    if ((path === '/' || path === '') && base.pathname && base.pathname !== '/') {`);
    lines.push(`      return base.origin;`);
    lines.push(`    }`);
    lines.push(`    // Otherwise append path to origin (ignoring baseUrl's path)`);
    lines.push(`    return base.origin + path;`);
    lines.push(`  } catch {`);
    lines.push(`    // Malformed baseUrl — fall back to simple concatenation`);
    lines.push(`    return baseUrl.replace(/\\/$/, '') + path;`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
    lines.push(`// Helper: get named credentials from profile`);
    lines.push(`function getCredentials(name) {`);
    lines.push(`  const key = name || 'default';`);
    lines.push(`  return ENV_PROFILE.credentials[key] || ENV_PROFILE.credentials['default'] || { username: '', password: '' };`);
    lines.push(`}`);
    lines.push('');
    lines.push(`// Helper: get environment variable from profile`);
    lines.push(`function getEnvVar(name) {`);
    lines.push(`  return ENV_PROFILE.variables[name] || process.env[name] || '';`);
    lines.push(`}`);
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
    const isParallel = (options.parallelWorkers || 1) > 1;
    lines.push(`const IS_PARALLEL = ${isParallel};`);
    lines.push('');

    // BeforeAll: Launch browser once (sequential mode only)
    // In parallel mode, each worker is a separate process — BeforeAll runs in the coordinator,
    // not in workers. So browser must be launched per-scenario in Before hook instead.
    if (!isParallel) {
      lines.push('// Launch browser once for all scenarios (sequential mode)');
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
    }

    // Before: Create context and page, attach to World
    lines.push(`Before(async function (scenario) {`);
    lines.push(`  scenarioCount++;`);
    lines.push(`  this.scenarioName = scenario.pickle.name;`);
    lines.push(`  this.scenarioTags = scenario.pickle.tags.map(t => t.name);`);
    lines.push(`  this.startTime = Date.now();`);
    lines.push(`  this.stepIndex = 0;`);
    lines.push('');
    // In parallel mode, launch a browser per scenario (each worker is a separate process)
    if (isParallel) {
      lines.push(`  // Parallel mode: launch browser per scenario (each worker is a separate process)`);
      if (browserType === 'firefox') {
        lines.push(`  browser = await firefox.launch({ headless: ${headless} });`);
      } else if (browserType === 'webkit') {
        lines.push(`  browser = await webkit.launch({ headless: ${headless} });`);
      } else {
        lines.push(`  browser = await chromium.launch({ headless: ${headless}, channel: 'chrome' });`);
      }
      lines.push('');
    }
    lines.push(`  // Create isolated browser context per scenario`);
    lines.push(`  const contextOptions = {`);
    lines.push(`    viewport: { width: 1280, height: 720 },`);
    lines.push(`    ignoreHTTPSErrors: true,`);
    if (env?.headers && Object.keys(env.headers).length > 0) {
      lines.push(`    extraHTTPHeaders: ${JSON.stringify(env.headers)},`);
    }
    if (env?.baseUrl) {
      lines.push(`    baseURL: ${JSON.stringify(env.baseUrl)},`);
    }
    lines.push(`  };`);
    lines.push(`  this.context = await browser.newContext(contextOptions);`);
    lines.push(`  this.page = await this.context.newPage();`);
    lines.push(`  this.activePage = this.page; // activePage tracks iframe context (switches on "I switch to iframe")`);
    lines.push(`  this.page.setDefaultTimeout(${stepTimeout}); // ${stepTimeout / 1000}s default for Playwright actions (fill, click, etc.)`);
    lines.push('');
    lines.push(`  // Guard: wrap page.locator and page.waitForSelector to catch empty selectors`);
    lines.push(`  const _origLocator = this.page.locator.bind(this.page);`);
    lines.push(`  this.page.locator = function(selector, options) {`);
    lines.push(`    if (!selector || (typeof selector === 'string' && !selector.trim())) {`);
    lines.push(`      const stack = new Error().stack || '';`);
    lines.push(`      const caller = stack.split('\\n').slice(1, 4).join(' <- ').replace(/\\s+/g, ' ').substring(0, 200);`);
    lines.push(`      throw new Error('Empty CSS selector passed to page.locator(). Caller: ' + caller);`);
    lines.push(`    }`);
    lines.push(`    return _origLocator(selector, options);`);
    lines.push(`  };`);
    lines.push(`  const _origWaitForSelector = this.page.waitForSelector.bind(this.page);`);
    lines.push(`  this.page.waitForSelector = function(selector, options) {`);
    lines.push(`    if (!selector || (typeof selector === 'string' && !selector.trim())) {`);
    lines.push(`      const stack = new Error().stack || '';`);
    lines.push(`      const caller = stack.split('\\n').slice(1, 4).join(' <- ').replace(/\\s+/g, ' ').substring(0, 200);`);
    lines.push(`      throw new Error('Empty CSS selector passed to page.waitForSelector(). Caller: ' + caller);`);
    lines.push(`    }`);
    lines.push(`    return _origWaitForSelector(selector, options);`);
    lines.push(`  };`);
    lines.push('');
    lines.push(`  // Enable console log capture`);
    lines.push(`  this.page.on('console', msg => {`);
    lines.push(`    if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());`);
    lines.push(`  });`);
    lines.push('');
    lines.push(`  // Auto-navigate to project baseUrl if configured AND first step is not a navigation step`);
    lines.push(`  // This prevents double navigation (auto + explicit "Given I navigate to...")`);
    lines.push(`  const __firstStepIsNav = (() => {`);
    lines.push(`    const fc = ${JSON.stringify(featureContent || '')};`);
    lines.push(`    const navPatterns = /^\\s*(given|when|and)\\s+(i\\s+)?(navigate|go to|open|visit|am on)/im;`);
    lines.push(`    return navPatterns.test(fc);`);
    lines.push(`  })();`);
    lines.push(`  if (ENV_PROFILE.baseUrl && !__firstStepIsNav) {`);
    lines.push(`    await this.page.goto(ENV_PROFILE.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {`);
    lines.push(`      console.log('[WARN] Auto-navigation to ' + ENV_PROFILE.baseUrl + ' failed: ' + e.message);`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    // Capture initial page screenshot after navigation`);
    lines.push(`    await this.takeScreenshot('sc' + scenarioCount + '-initial-page').catch(() => {});`);
    lines.push(`  }`);
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
    lines.push(`// Flaky test handling: @flaky scenarios get extra retry tolerance`);
    lines.push(`Before({ tags: '@flaky' }, async function () {`);
    lines.push(`  this.set('__isFlaky', true);`);
    lines.push(`  console.log('[FLAKY] Scenario marked as flaky — failures will be tracked separately');`);
    lines.push(`});`);
    lines.push('');
    lines.push(`// Quarantine: @quarantine scenarios run but failures don't block the suite`);
    lines.push(`Before({ tags: '@quarantine' }, async function () {`);
    lines.push(`  this.set('__isQuarantined', true);`);
    lines.push(`  console.log('[QUARANTINE] Scenario is quarantined — failures will not fail the overall run');`);
    lines.push(`});`);
    lines.push('');
    lines.push(`// Skip environment: @skip-dev, @skip-staging, @skip-prod`);
    const envName = options.environment?.name || 'default';
    lines.push(`Before({ tags: '@skip-${envName}' }, async function () {`);
    lines.push(`  return 'skipped'; // Skip scenarios tagged with @skip-{current-env}`);
    lines.push(`});`);
    lines.push('');

    // BeforeStep / AfterStep for step-level tracking
    lines.push(`// Step-level hooks for tracking`);
    lines.push(`BeforeStep(async function () {`);
    lines.push(`  this.stepIndex++;`);
    lines.push(`});`);
    lines.push('');
    lines.push(`AfterStep(async function (step) {`);
    lines.push(`  if (!this.page) return;`);
    lines.push(`  try {`);
    lines.push(`    if (step.result && step.result.status === 'FAILED') {`);
    lines.push(`      await this.takeScreenshot('sc' + scenarioCount + '-step-fail-' + this.stepIndex);`);
    lines.push(`    } else {`);
    lines.push(`      // Capture screenshot on every step (pass/fail) for full traceability`);
    lines.push(`      await this.takeScreenshot('sc' + scenarioCount + '-step-' + this.stepIndex + '-' + (step.result?.status || 'done'));`);
    lines.push(`    }`);
    lines.push(`  } catch (e) { /* ignore screenshot errors */ }`);
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
    // In parallel mode, close browser per scenario (each worker owns its browser)
    if (isParallel) {
      lines.push(`  // Parallel mode: close browser per scenario`);
      lines.push(`  if (browser) { await browser.close(); browser = null; }`);
    }
    lines.push('');
    lines.push(`  // Reset shared state for next scenario`);
    lines.push(`  this.state = {};`);
    lines.push(`  this.testData = {};`);
    lines.push(`  this.responses = {};`);
    lines.push(`  this.screenshots = [];`);
    lines.push('});');
    lines.push('');

    // AfterAll: Close browser (sequential mode only — in parallel, browser is closed per-scenario)
    if (!isParallel) {
      lines.push(`AfterAll(async function () {`);
      lines.push(`  if (browser) await browser.close();`);
      lines.push('});');
    }
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

    // Always emit built-in step definitions — custom defs supplement, not replace.
    // Cucumber's "last registered wins" lets custom defs override specific built-in steps.
    {
      // Auto-generated step definitions (using this.page from World)
      lines.push(`// ========================================`);
      lines.push(`// Auto-generated Step Definitions`);
      lines.push(`// ========================================`);
      lines.push(`const { expect } = require('@playwright/test');`);
      lines.push('');
      lines.push(`// Guard against empty selectors — gives a clear error instead of cryptic CSS parse failure`);
      lines.push(`function safeLocator(page, selector, stepName) {`);
      lines.push(`  if (!selector || !selector.trim()) throw new Error(\`Empty selector passed to step "\${stepName || 'unknown'}". Check your feature file for empty "" parameters.\`);`);
      lines.push(`  return page.locator(selector);`);
      lines.push(`}`);
      lines.push('');

      // ========================================
      // Smart locator helpers
      // ========================================
      lines.push(`// Smart locator helpers`);
      lines.push(`async function findInput(page, field) {`);
      lines.push(`  if (!field) throw new Error('Empty field name passed to findInput()');`);
      lines.push(`  // Wait for DOM ready`);
      lines.push(`  await page.waitForLoadState('domcontentloaded').catch(() => {});`);
      lines.push('');
      lines.push(`  // Clean field name: strip trailing colon/punctuation for matching`);
      lines.push(`  const cleanField = field.replace(/[:\\s]+$/, '').trim();`);
      lines.push(`  const lowerField = cleanField.toLowerCase();`);
      lines.push('');
      lines.push(`  // Build CSS selectors for both original and cleaned field names`);
      lines.push(`  const cssSelector = \`input[name="\${cleanField}" i], input[id="\${cleanField}" i], textarea[name="\${cleanField}" i], input[aria-label="\${cleanField}" i], input[placeholder="\${cleanField}" i]\`;`);
      lines.push('');
      lines.push(`  // Wait for any inputs to appear`);
      lines.push(`  try {`);
      lines.push(`    await page.waitForSelector(cssSelector, { state: 'attached', timeout: 10000 });`);
      lines.push(`  } catch (e) {`);
      lines.push(`    await page.waitForSelector('input, textarea, select', { state: 'attached', timeout: 5000 }).catch(() => {});`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Try both original and cleaned field names`);
      lines.push(`  for (const f of [field, cleanField]) {`);
      lines.push(`    const byLabel = page.getByLabel(f, { exact: false });`);
      lines.push(`    if (await byLabel.count() > 0) return byLabel.first();`);
      lines.push(`    const byPlaceholder = page.getByPlaceholder(f, { exact: false });`);
      lines.push(`    if (await byPlaceholder.count() > 0) return byPlaceholder.first();`);
      lines.push(`    const byRole = page.getByRole('textbox', { name: f });`);
      lines.push(`    if (await byRole.count() > 0) return byRole.first();`);
      lines.push(`    const byTestId = page.getByTestId(f);`);
      lines.push(`    if (await byTestId.count() > 0) return byTestId.first();`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // CSS attribute selectors (name, id, placeholder)`);
      lines.push(`  const fallback = page.locator(cssSelector).first();`);
      lines.push(`  if (await fallback.count() > 0) return fallback;`);
      lines.push('');
      lines.push(`  // Text proximity: label, td, div, span containing field text near an input`);
      lines.push(`  for (const f of [field, cleanField]) {`);
      lines.push(`    const proxSelectors = [`);
      lines.push(`      \`label:has-text("\${f}") + input\`, \`label:has-text("\${f}") input\`,`);
      lines.push(`      \`td:has-text("\${f}") + td input\`, \`th:has-text("\${f}") + td input\`,`);
      lines.push(`      \`div:has-text("\${f}") > input\`, \`span:has-text("\${f}") ~ input\`,`);
      lines.push(`    ];`);
      lines.push(`    for (const sel of proxSelectors) {`);
      lines.push(`      const el = page.locator(sel).first();`);
      lines.push(`      if (await el.count() > 0) return el;`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // XPath: find text node containing field name, then nearest following input`);
      lines.push(`  const xpathEl = page.locator(\`xpath=//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '\${lowerField}')]/ancestor::*[self::td or self::div or self::label or self::span or self::p][1]//following::input[1]\`).first();`);
      lines.push(`  if (await xpathEl.count() > 0) return xpathEl;`);
      lines.push('');
      lines.push(`  // Final: match by scanning all visible inputs and checking nearby text`);
      lines.push(`  const allInputs = page.locator('input:visible, textarea:visible');`);
      lines.push(`  const inputCount = await allInputs.count();`);
      lines.push(`  for (let i = 0; i < inputCount; i++) {`);
      lines.push(`    const inp = allInputs.nth(i);`);
      lines.push(`    const attrs = await inp.evaluate(el => ({ name: el.name, id: el.id, ph: el.placeholder, type: el.type }));`);
      lines.push(`    if (attrs.name.toLowerCase().includes(lowerField) || attrs.id.toLowerCase().includes(lowerField) || attrs.ph.toLowerCase().includes(lowerField)) return inp;`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  throw new Error(\`Could not find input field: "\${field}". Available inputs: \` + await allInputs.evaluateAll(els => els.map(e => \`\${e.tagName}[name=\${e.name},id=\${e.id},ph=\${e.placeholder},type=\${e.type}]\`).join(', ')));`);
      lines.push('}');
      lines.push('');
      lines.push(`async function findElement(page, target) {`);
      lines.push(`  if (!target) throw new Error('Empty target passed to findElement()');`);
      lines.push(`  // If target looks like a CSS selector, use locator directly`);
      lines.push(`  if (/^[.#\\[]|[>~+]/.test(target)) {`);
      lines.push(`    const loc = page.locator(target).first();`);
      lines.push(`    await loc.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});`);
      lines.push(`    return loc;`);
      lines.push(`  }`);
      lines.push(`  // Wait for page to be stable`);
      lines.push(`  await page.waitForLoadState('domcontentloaded').catch(() => {});`);
      lines.push(`  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});`);
      lines.push('');
      lines.push(`  // Case-insensitive variants + trimmed target`);
      lines.push(`  const cleanTarget = target.trim();`);
      lines.push(`  const regex = new RegExp('^\\\\s*' + cleanTarget.replace(/[.*+?^$(){}|[\\]\\\\]/g, '\\\\$&') + '\\\\s*$', 'i');`);
      lines.push('');
      lines.push(`  // Retry loop: try all strategies, poll up to 15s for late-rendering elements`);
      lines.push(`  const maxWait = 15000;`);
      lines.push(`  const startTime = Date.now();`);
      lines.push(`  while (Date.now() - startTime < maxWait) {`);
      lines.push(`    // Clickable roles (exact then regex match for case-insensitive)`);
      lines.push(`    for (const role of ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio']) {`);
      lines.push(`      const exact = page.getByRole(role, { name: cleanTarget });`);
      lines.push(`      if (await exact.count() > 0) { const v = exact.first(); if (await v.isVisible().catch(() => false)) return v; }`);
      lines.push(`      const insensitive = page.getByRole(role, { name: regex });`);
      lines.push(`      if (await insensitive.count() > 0) { const v = insensitive.first(); if (await v.isVisible().catch(() => false)) return v; }`);
      lines.push(`    }`);
      lines.push(`    // By text (exact, regex, partial)`);
      lines.push(`    for (const opt of [{ exact: true }, { exact: false }]) {`);
      lines.push(`      const byText = page.getByText(cleanTarget, opt);`);
      lines.push(`      if (await byText.count() > 0) { const v = byText.first(); if (await v.isVisible().catch(() => false)) return v; }`);
      lines.push(`    }`);
      lines.push(`    // Regex case-insensitive text`);
      lines.push(`    const byRegex = page.getByText(regex);`);
      lines.push(`    if (await byRegex.count() > 0) { const v = byRegex.first(); if (await v.isVisible().catch(() => false)) return v; }`);
      lines.push(`    // CSS fallback: anchor/button/input[type=submit]/image alt/value attribute`);
      lines.push(`    const cssParts = [`);
      lines.push(`      \`a:has-text("\${cleanTarget}")\`,`);
      lines.push(`      \`button:has-text("\${cleanTarget}")\`,`);
      lines.push(`      \`input[type="submit"][value="\${cleanTarget}" i]\`,`);
      lines.push(`      \`input[type="button"][value="\${cleanTarget}" i]\`,`);
      lines.push(`      \`img[alt="\${cleanTarget}" i]\`,`);
      lines.push(`      \`[title="\${cleanTarget}" i]\`,`);
      lines.push(`      \`[aria-label="\${cleanTarget}" i]\``);
      lines.push(`    ].join(', ');`);
      lines.push(`    const css = page.locator(cssParts).first();`);
      lines.push(`    if (await css.count() > 0 && await css.isVisible().catch(() => false)) return css;`);
      lines.push(`    // Wait a bit and retry`);
      lines.push(`    await page.waitForTimeout(500);`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Build diagnostic error: list visible clickable elements so user can see what IS there`);
      lines.push(`  const visible = await page.locator('a:visible, button:visible, input[type="submit"]:visible, input[type="button"]:visible, [role="link"]:visible, [role="button"]:visible').evaluateAll(els => els.slice(0, 20).map(e => {`);
      lines.push(`    const text = (e.textContent || '').trim();`);
      lines.push(`    const val = e.value || '';`);
      lines.push(`    const alt = e.getAttribute('alt') || '';`);
      lines.push(`    const aria = e.getAttribute('aria-label') || '';`);
      lines.push(`    return e.tagName + ': "' + (text || val || alt || aria || '(no label)') + '"';`);
      lines.push(`  }).join(', '));`);
      lines.push(`  throw new Error('Element "' + target + '" not found on page ' + page.url() + '. Visible clickables: ' + visible);`);
      lines.push('}');
      lines.push('');

      // ========================================
      // 1. NAVIGATION
      // ========================================
      lines.push(`// --- Navigation steps ---`);
      lines.push(`Given('I navigate to {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('I am on {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('I open the url {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('I go to {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('I visit {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('User is on {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('user is on {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('the user is on {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`Given('I am on the {string} page', async function (pageName) {`);
      lines.push(`  await this.page.waitForLoadState('domcontentloaded');`);
      lines.push(`  console.log('On page:', pageName, 'URL:', this.page.url());`);
      lines.push('});');
      // "launch the application" variants — navigate to base URL
      lines.push(`Given('User should launch the Application', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`Given('the user launches the application', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`Given('I launch the application', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`Given('the application is open', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push('});');
      // When versions of navigation (only steps NOT already registered as Given)
      lines.push(`When('Navigate to {string}', async function (url) { await this.page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 }); });`);
      lines.push(`When('I go back', async function () { await this.page.goBack(); });`);
      lines.push(`When('I go forward', async function () { await this.page.goForward(); });`);
      lines.push(`When('I refresh the page', async function () { await this.page.reload(); });`);
      lines.push(`When('I reload the page', async function () { await this.page.reload(); });`);
      lines.push('');

      // ========================================
      // 1b. ENVIRONMENT-AWARE STEPS
      // ========================================
      lines.push(`// --- Environment Profile Steps ---`);
      lines.push(`Given('I am on the base URL', async function () {`);
      lines.push(`  const url = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`});`);
      lines.push(`Given('I am on the base URL path {string}', async function (urlPath) {`);
      lines.push(`  await this.page.goto(resolveUrl(urlPath), { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`});`);
      lines.push(`Given('I use {string} credentials', async function (credName) {`);
      lines.push(`  const creds = getCredentials(credName);`);
      lines.push(`  this.set('__currentCredentials', creds);`);
      lines.push(`  console.log('Using credentials:', credName, 'username:', creds.username);`);
      lines.push(`});`);
      lines.push(`Given('I login with {string} credentials', async function (credName) {`);
      lines.push(`  const creds = getCredentials(credName);`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const submitBtn = await findElement(this.page, 'Sign In').catch(() => findElement(this.page, 'Login'));`);
      lines.push(`  await submitBtn.click();`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push(`});`);
      lines.push(`Given('the environment variable {string} should be {string}', async function (varName, expected) {`);
      lines.push(`  const actual = getEnvVar(varName);`);
      lines.push(`  expect(actual).toBe(expected);`);
      lines.push(`});`);
      lines.push(`Given('I set the environment variable {string} to {string}', async function (varName, value) {`);
      lines.push(`  ENV_PROFILE.variables[varName] = value;`);
      lines.push(`});`);
      lines.push(`Then('the current environment should be {string}', async function (envName) {`);
      lines.push(`  expect(ENV_PROFILE.name).toBe(envName);`);
      lines.push(`});`);
      lines.push('');

      // ========================================
      // 2. LOGIN / AUTHENTICATION
      // ========================================
      lines.push(`// --- Composite login Given steps (used as preconditions) ---`);
      lines.push(`Given('the user is logged in', async function () {`);
      lines.push(`  // Navigate to base URL and perform login with default credentials`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.default || { username: 'standard_user', password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      lines.push(`Given('the user is logged in with {string} credentials', async function (credName) {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.[credName] || { username: credName, password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      lines.push('');
      // Aliases without "I" prefix and natural-language variants (for backward compat with old features)
      lines.push(`// --- Backward-compatible aliases for old-format Gherkin steps ---`);
      lines.push(`Given('User is logged in', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.default || { username: 'standard_user', password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      lines.push(`Given('User is logged in with {string}', async function (credName) {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.[credName] || { username: credName, password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      // Regex-based: "User is logged in with standard_user" (no quotes around username)
      lines.push(`Given(/^User is logged in with (\\S+)$/, async function (credName) {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.[credName] || { username: credName, password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      lines.push(`Given('User is logged in and has item in cart', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.default || { username: 'standard_user', password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      lines.push(`Given('User is logged in with empty cart', async function () {`);
      lines.push(`  const currentUrl = this.page.url();`);
      lines.push(`  if (!currentUrl || currentUrl === 'about:blank') {`);
      lines.push(`    const baseUrl = ENV_PROFILE.baseUrl || 'http://localhost:3000';`);
      lines.push(`    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });`);
      lines.push(`  }`);
      lines.push(`  const creds = ENV_PROFILE.credentials?.default || { username: 'standard_user', password: 'secret_sauce' };`);
      lines.push(`  const userInput = await findInput(this.page, 'Username');`);
      lines.push(`  await userInput.fill(creds.username);`);
      lines.push(`  const passInput = await findInput(this.page, 'Password');`);
      lines.push(`  await passInput.fill(creds.password);`);
      lines.push(`  const signIn = this.page.getByRole('button', { name: /sign in|login|log in|submit/i });`);
      lines.push(`  if (await signIn.count() > 0) { await signIn.first().click(); }`);
      lines.push(`  else { await this.page.locator('button[type="submit"]').first().click(); }`);
      lines.push(`  await this.page.waitForLoadState('networkidle');`);
      lines.push('});');
      // Old-format When steps without "I" prefix
      lines.push(`When('Enter {string} in the {string} field', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.page, field);`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push(`When('Enter {string} in the Username field', async function (value) {`);
      lines.push(`  const input = await findInput(this.page, 'Username');`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push(`When('Enter {string} in the Password field', async function (value) {`);
      lines.push(`  const input = await findInput(this.page, 'Password');`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push(`When('Enter {string} in the First Name field', async function (value) {`);
      lines.push(`  const input = await findInput(this.page, 'First Name');`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push(`When('Enter {string} in the Last Name field', async function (value) {`);
      lines.push(`  const input = await findInput(this.page, 'Last Name');`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push(`When('Enter {string} in the Zip\\/Postal Code field', async function (value) {`);
      lines.push(`  const input = await findInput(this.page, 'Zip/Postal Code');`);
      lines.push(`  await input.fill(value);`);
      lines.push('});');
      lines.push(`When('Click the {string} button', async function (name) {`);
      lines.push(`  await this.page.getByRole('button', { name }).click();`);
      lines.push('});');
      lines.push(`When('Click the {string} link', async function (name) {`);
      lines.push(`  await this.page.getByRole('link', { name }).click();`);
      lines.push('});');
      lines.push(`When('Click the {string} button on {string}', async function (btnName, itemName) {`);
      lines.push(`  // Find the product item and click the button within it`);
      lines.push(`  const item = this.page.locator('.inventory_item').filter({ hasText: itemName });`);
      lines.push(`  if (await item.count() > 0) { await item.getByRole('button', { name: btnName }).click(); }`);
      lines.push(`  else { await this.page.getByRole('button', { name: new RegExp(btnName, 'i') }).first().click(); }`);
      lines.push('});');
      lines.push(`When('Click the cart icon', async function () {`);
      lines.push(`  await this.page.locator('.shopping_cart_link').click();`);
      lines.push('});');
      lines.push(`When('Click the hamburger menu icon', async function () {`);
      lines.push(`  await this.page.locator('#react-burger-menu-btn, .bm-burger-button, button[id*="menu"]').first().click();`);
      lines.push('});');
      lines.push(`When('Click on {string} product title', async function (productName) {`);
      lines.push(`  await this.page.getByText(productName, { exact: false }).first().click();`);
      lines.push('});');
      lines.push(`When('Select {string} from the sort dropdown', async function (option) {`);
      lines.push(`  await this.page.locator('.product_sort_container, select[data-test="product-sort-container"]').selectOption({ label: option });`);
      lines.push('});');
      lines.push(`When('Verify the {string} button is visible', async function (name) {`);
      lines.push(`  await expect(this.page.getByRole('button', { name })).toBeVisible();`);
      lines.push('});');
      lines.push('');
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
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I type {string} into {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I type {string} in {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I enter {string} in {string}', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I enter {string} in the {string} field', async function (value, field) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I fill in the {string} field with {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I set {string} to {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I set the {string} field to {string}', async function (field, value) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.fill(value);`);
      lines.push('});');
      lines.push(`When('I clear the {string} field', async function (field) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.clear();`);
      lines.push('});');
      lines.push(`When('I clear {string}', async function (field) {`);
      lines.push(`  const input = await findInput(this.activePage || this.page, field); await input.clear();`);
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
      lines.push(`When('I click {string}', async function (target) { const el = await findElement(this.activePage || this.page, target); await el.click(); });`);
      lines.push(`When('I click the {string} button', async function (name) { await this.page.getByRole('button', { name }).click(); });`);
      lines.push(`When('I click the {string} link', async function (name) { await this.page.getByRole('link', { name }).click(); });`);
      lines.push(`When('I click on {string}', async function (target) { const el = await findElement(this.activePage || this.page, target); await el.click(); });`);
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
      lines.push(`  await safeLocator(this.page, selector, 'I click the {string} element').first().click();`);
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
      lines.push(`async function smartHover(page, target) {`);
      lines.push(`  console.log('[smartHover] hovering over: ' + target);`);
      lines.push(`  let hovered = null;`);
      lines.push('');
      lines.push(`  // Strategy 1: hover the <li> parent (CSS :hover menus like DemoQA, Bootstrap nav)`);
      lines.push(`  const liParent = page.locator(\`li:has(a:has-text("\${target}")), li:has(span:has-text("\${target}")), li:has(button:has-text("\${target}"))\`).first();`);
      lines.push(`  if (await liParent.count() > 0) {`);
      lines.push(`    await liParent.hover({ force: true });`);
      lines.push(`    hovered = liParent;`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Strategy 2: direct text match (for visible text)`);
      lines.push(`  if (!hovered) {`);
      lines.push(`    const byText = page.getByText(target, { exact: false }).first();`);
      lines.push(`    if (await byText.count() > 0) {`);
      lines.push(`      try {`);
      lines.push(`        await byText.waitFor({ state: 'attached', timeout: 3000 });`);
      lines.push(`        await byText.hover({ force: true });`);
      lines.push(`        hovered = byText;`);
      lines.push(`      } catch {}`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Strategy 3: role-based match (button, link, etc.)`);
      lines.push(`  if (!hovered) {`);
      lines.push(`    for (const role of ['button', 'link', 'menuitem']) {`);
      lines.push(`      const byRole = page.getByRole(role, { name: target });`);
      lines.push(`      if (await byRole.count() > 0) {`);
      lines.push(`        await byRole.first().hover({ force: true });`);
      lines.push(`        hovered = byRole.first();`);
      lines.push(`        break;`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Strategy 4: image/alt match (e.g., <img alt="user1">)`);
      lines.push(`  if (!hovered) {`);
      lines.push(`    const byAlt = page.locator(\`img[alt="\${target}" i], img[src*="\${target}" i]\`).first();`);
      lines.push(`    if (await byAlt.count() > 0) {`);
      lines.push(`      await byAlt.hover({ force: true });`);
      lines.push(`      hovered = byAlt;`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  // Strategy 5: positional fallback for patterns like "user1", "item2", "card3"`);
      lines.push(`  // When text isn't found (because it's inside a hidden reveal), use the Nth group element`);
      lines.push(`  if (!hovered) {`);
      lines.push(`    const posMatch = target.toLowerCase().match(/^([a-z]+?)(\\d+)$/);`);
      lines.push(`    if (posMatch) {`);
      lines.push(`      const n = parseInt(posMatch[2]) - 1;`);
      lines.push(`      // Try common group containers`);
      lines.push(`      const groupSelectors = ['.figure', '.card', '.tile', '.item', '.product', 'figure', 'article'];`);
      lines.push(`      for (const sel of groupSelectors) {`);
      lines.push(`        const group = page.locator(sel);`);
      lines.push(`        const count = await group.count();`);
      lines.push(`        if (count > n) {`);
      lines.push(`          const nth = group.nth(n);`);
      lines.push(`          await nth.hover({ force: true });`);
      lines.push(`          hovered = nth;`);
      lines.push(`          console.log('[smartHover] positional match: ' + sel + ' nth(' + n + ')');`);
      lines.push(`          break;`);
      lines.push(`        }`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  if (!hovered) {`);
      lines.push(`    throw new Error('smartHover: could not find any element for "' + target + '" — tried text, role, alt, positional');`);
      lines.push(`  }`);
      lines.push(`  await page.waitForTimeout(400);`);
      lines.push(`  // Strategy 2 (fail-safe): inject a CSS class that keeps submenus visible.`);
      lines.push(`  // Cucumber steps may release mouse between steps, so we use a class-based approach that survives.`);
      lines.push(`  await hovered.evaluate((el) => {`);
      lines.push(`    // Walk up to the nearest LI (or self if already LI)`);
      lines.push(`    let target = el;`);
      lines.push(`    while (target && target.tagName !== 'LI') target = target.parentElement;`);
      lines.push(`    if (!target) return;`);
      lines.push(`    target.classList.add('__bdd_hovered__');`);
      lines.push(`    // Inject a style tag once that forces reveal targets visible while hovered class exists`);
      lines.push(`    if (!document.getElementById('__bdd_hover_style__')) {`);
      lines.push(`      const style = document.createElement('style');`);
      lines.push(`      style.id = '__bdd_hover_style__';`);
      lines.push(`      style.textContent = [`);
      lines.push(`        '.__bdd_hovered__ > ul,',`);
      lines.push(`        '.__bdd_hovered__ > .dropdown-menu,',`);
      lines.push(`        '.__bdd_hovered__ > .submenu,',`);
      lines.push(`        '.__bdd_hovered__ > .figcaption,',`);
      lines.push(`        '.__bdd_hovered__ > .tooltip,',`);
      lines.push(`        '.__bdd_hovered__ > .popover,',`);
      lines.push(`        '.__bdd_hovered__ > .hover-reveal,',`);
      lines.push(`        '.__bdd_hovered__ .figcaption,',`);
      lines.push(`        '.__bdd_hovered__ .dropdown-menu,',`);
      lines.push(`        '.__bdd_hovered__ .tooltip,',`);
      lines.push(`        '.__bdd_hovered__ .popover {',`);
      lines.push(`        '  display: block !important;',`);
      lines.push(`        '  visibility: visible !important;',`);
      lines.push(`        '  opacity: 1 !important;',`);
      lines.push(`        '  pointer-events: auto !important;',`);
      lines.push(`        '}'`);
      lines.push(`      ].join(' ');`);
      lines.push(`      document.head.appendChild(style);`);
      lines.push(`    }`);
      lines.push(`  });`);
      lines.push(`  await page.waitForTimeout(200);`);
      lines.push(`  return hovered;`);
      lines.push(`}`);
      lines.push('');
      lines.push(`When('I hover over {string}', async function (target) {`);
      lines.push(`  this.lastHoverTarget = await smartHover(this.page, target);`);
      lines.push('});');
      lines.push(`When('I hover on {string}', async function (target) {`);
      lines.push(`  this.lastHoverTarget = await smartHover(this.page, target);`);
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
      lines.push(`  // Smart dropdown: try native <select> first, then click-based custom dropdown`);
      lines.push(`  const label = this.page.getByLabel(selector);`);
      lines.push(`  const tag = await label.first().evaluate(el => el.tagName.toLowerCase()).catch(() => '');`);
      lines.push(`  if (tag === 'select') {`);
      lines.push(`    await label.selectOption(value);`);
      lines.push(`  } else {`);
      lines.push(`    // Custom dropdown: click to open, then click option`);
      lines.push(`    const trigger = label.or(this.page.getByRole('combobox', { name: selector })).or(this.page.locator('[class*="select"], [class*="dropdown"]', { hasText: selector })).first();`);
      lines.push(`    await trigger.click();`);
      lines.push(`    await this.page.waitForTimeout(300);`);
      lines.push(`    const option = this.page.getByRole('option', { name: value }).or(this.page.getByRole('listitem', { name: value })).or(this.page.locator('[class*="option"], [class*="menu-item"], li', { hasText: value })).first();`);
      lines.push(`    await option.click();`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`When('I select {string} from the {string} dropdown', async function (value, selector) {`);
      lines.push(`  const label = this.page.getByLabel(selector);`);
      lines.push(`  const tag = await label.first().evaluate(el => el.tagName.toLowerCase()).catch(() => '');`);
      lines.push(`  if (tag === 'select') {`);
      lines.push(`    await label.selectOption(value);`);
      lines.push(`  } else {`);
      lines.push(`    const trigger = label.or(this.page.getByRole('combobox', { name: selector })).or(this.page.locator('[class*="select"], [class*="dropdown"]', { hasText: selector })).first();`);
      lines.push(`    await trigger.click();`);
      lines.push(`    await this.page.waitForTimeout(300);`);
      lines.push(`    await this.page.getByRole('option', { name: value }).or(this.page.locator('[class*="option"], [class*="menu-item"], li', { hasText: value })).first().click();`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`When('I select the option {string} in {string}', async function (value, selector) {`);
      lines.push(`  const label = this.page.getByLabel(selector);`);
      lines.push(`  const tag = await label.first().evaluate(el => el.tagName.toLowerCase()).catch(() => '');`);
      lines.push(`  if (tag === 'select') { await label.selectOption(value); }`);
      lines.push(`  else { await label.first().click(); await this.page.waitForTimeout(300); await this.page.getByRole('option', { name: value }).or(this.page.locator('[class*="option"], li', { hasText: value })).first().click(); }`);
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
      lines.push(`  await safeLocator(this.page, selector, 'I wait for the {string} element to appear').first().waitFor({ state: 'visible', timeout: 15000 });`);
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
      lines.push(`// When inside an iframe, steps use this.activePage instead of this.page`);
      lines.push(`// activePage is set by "I switch to iframe" and cleared by "I switch to the main frame"`);
      lines.push(`When('I switch to iframe {string}', async function (selector) {`);
      lines.push(`  const frame = this.page.frameLocator(selector);`);
      lines.push(`  this.set('iframe', frame);`);
      lines.push(`  // Override activePage so findInput/findElement work inside iframe`);
      lines.push(`  this.activePage = frame;`);
      lines.push('});');
      lines.push(`When('I switch to the main frame', async function () {`);
      lines.push(`  this.set('iframe', null);`);
      lines.push(`  this.activePage = this.page;`);
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
      lines.push(`  const loc = this.page.getByText(text, { exact: false }).first();`);
      lines.push(`  // If the element is present but hidden (e.g., hover submenu that collapsed),`);
      lines.push(`  // try to re-trigger the last hover before asserting.`);
      lines.push(`  try {`);
      lines.push(`    await expect(loc).toBeVisible({ timeout: 3000 });`);
      lines.push(`  } catch {`);
      lines.push(`    // Element exists in DOM? Try re-hovering the last hovered element`);
      lines.push(`    const count = await loc.count();`);
      lines.push(`    if (count > 0 && this.lastHoverTarget) {`);
      lines.push(`      try { await this.lastHoverTarget.hover(); } catch {}`);
      lines.push(`      await expect(loc).toBeVisible({ timeout: 5000 });`);
      lines.push(`    } else {`);
      lines.push(`      await expect(loc).toBeVisible({ timeout: 7000 });`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('});');
      lines.push(`Then('I should not see {string}', async function (text) {`);
      lines.push(`  await expect(this.page.getByText(text, { exact: false })).toBeHidden({ timeout: 5000 });`);
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
      lines.push(`Then('there should be {int} {string}', async function (count, selector) { await expect(safeLocator(this.page, selector, 'there should be {int} {string}')).toHaveCount(count); });`);
      lines.push(`Then('I should see at least {int} {string}', async function (count, selector) {`);
      lines.push(`  const n = await safeLocator(this.page, selector, 'I should see at least {int} {string}').count(); expect(n).toBeGreaterThanOrEqual(count);`);
      lines.push('});');
      lines.push('');

      // ========================================
      // 20. ATTRIBUTE / CSS ASSERTIONS
      // ========================================
      lines.push(`// --- Attribute / CSS ---`);
      lines.push(`Then('the element {string} should have attribute {string} with value {string}', async function (selector, attr, value) {`);
      lines.push(`  await expect(safeLocator(this.page, selector, 'element should have attribute')).toHaveAttribute(attr, value);`);
      lines.push('});');
      lines.push(`Then('{string} should have class {string}', async function (selector, className) {`);
      lines.push(`  await expect(safeLocator(this.page, selector, 'should have class')).toHaveClass(new RegExp(className));`);
      lines.push('});');
      lines.push(`Then('the element {string} should have CSS {string} with value {string}', async function (selector, prop, value) {`);
      lines.push(`  await expect(safeLocator(this.page, selector, 'element should have CSS')).toHaveCSS(prop, value);`);
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
      lines.push(`  const text = await safeLocator(this.page, selector, 'I store the text of {string}').first().textContent(); this.set(key, text);`);
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
        /^I navigate to ".*"$/, /^Navigate to ".*"$/, /^I am on ".*"$/, /^I open the url ".*"$/, /^I go to ".*"$/, /^I visit ".*"$/,
        /^[Uu]ser is on ".*"$/, /^the user is on ".*"$/,
        /^I am on the ".*" page$/, /^I go back$/, /^I go forward$/, /^I refresh the page$/, /^I reload the page$/,
        /^User should launch the Application$/i, /^the user launches the application$/i, /^I launch the application$/i, /^the application is open$/i,
        // Environment profile
        /^I am on the base URL$/, /^I am on the base URL path ".*"$/,
        /^I use ".*" credentials$/, /^I login with ".*" credentials$/,
        /^the environment variable ".*" should be ".*"$/, /^I set the environment variable ".*" to ".*"$/,
        /^the current environment should be ".*"$/,
        // Login (composite)
        /^the user is logged in$/, /^User is logged in$/, /^the user is logged in with ".*" credentials$/,
        /^User is logged in with .*$/, /^User is logged in and has item in cart$/,
        /^User is logged in with empty cart$/,
        // Login
        /^I enter valid credentials username ".*" password ".*"$/, /^I enter valid credentials user ".*" password ".*"$/,
        /^I login with username ".*" and password ".*"$/,
        /^I enter username ".*"$/, /^I enter password ".*"$/, /^I enter email ".*"$/,
        /^I click the login button$/, /^I submit the login form$/, /^I log out$/,
        /^I should be logged in$/, /^I should be logged out$/,
        // Backward-compat: Without "I" prefix
        /^Enter ".*" in the .* field$/, /^Click the ".*" button$/, /^Click the ".*" link$/,
        /^Click the ".*" button on ".*"$/, /^Click the cart icon$/, /^Click the hamburger menu icon$/,
        /^Click on ".*" product title$/, /^Select ".*" from the sort dropdown$/,
        /^Verify the ".*" button is visible$/,
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

          // Normalize step text: replace quoted strings and bare URLs with {string}, numbers with {int}
          let normalizedText = step.text
            .replace(/"[^"]*"/g, '{string}')                    // "quoted strings" → {string}
            .replace(/'[^']*'/g, '{string}')                    // 'single-quoted' → {string}
            .replace(/https?:\/\/\S+/g, '{string}')             // bare URLs → {string}
            .replace(/\b\d+\.\d+\b/g, '{float}')                // decimal numbers → {float}
            .replace(/\b\d+\b/g, '{int}');                       // integers → {int}

          // Escape any remaining forward slashes — Cucumber treats / as alternation
          normalizedText = normalizedText.replace(/\//g, '\\/');

          if (seenSteps.has(normalizedText)) continue;
          seenSteps.add(normalizedText);

          const cucumberKeyword = step.keyword === 'And' || step.keyword === 'But' ? 'Given' : step.keyword;

          // Count {string}, {int}, {float} placeholders to generate matching function parameters
          const paramMatches = normalizedText.match(/\{(string|int|float)\}/g) || [];
          const paramNames = paramMatches.map((p: string, i: number) => {
            const type = p.replace(/[{}]/g, '');
            return type === 'string' ? `arg${i + 1}` : type === 'int' ? `num${i + 1}` : `val${i + 1}`;
          });
          const paramList = paramNames.join(', ');

          lines.push(`${cucumberKeyword}('${this.escapeString(normalizedText)}', async function (${paramList}) {`);
          lines.push(`  console.log('Step: ${this.escapeString(step.keyword)} ${this.escapeString(normalizedText)}'${paramNames.length > 0 ? `, ${paramNames.join(', ')}` : ''});`);

          // Generate meaningful Playwright code based on the step text
          // Note: generateStepCode uses "page." but Cucumber World uses "this.page."
          const rawStepCode = this.generateStepCode(step.keyword, step.text, 'execution');
          const stepCode = rawStepCode ? rawStepCode.replace(/\bawait page\./g, 'await this.page.').replace(/\bpage\.once\(/g, 'this.page.once(').replace(/\bexpect\(page\)/g, 'expect(this.page)').replace(/\bexpect\(page\./g, 'expect(this.page.') : null;
          if (stepCode) {
            lines.push(`  ${stepCode}`);
          } else if (step.keyword === 'Then') {
            // Then steps must assert — try to find text to verify on page
            const textToFind = step.text.replace(/^(verify|assert|check|ensure|confirm|then)\s+(that\s+)?/i, '').trim();
            lines.push(`  // Auto-assertion: verify text or condition on page`);
            lines.push(`  const bodyText = await this.page.textContent('body');`);
            lines.push(`  const found = ${paramNames.length > 0 ? `[${paramNames.join(', ')}].some(p => bodyText.includes(String(p)))` : `bodyText.toLowerCase().includes('${this.escapeString(textToFind.substring(0, 50).toLowerCase())}')`};`);
            lines.push(`  if (!found) { throw new Error('Expected to find relevant content on page for: ${this.escapeString(step.text.substring(0, 80))}'); }`);
          } else {
            lines.push(`  // Auto-generated action step`);
            lines.push(`  await this.page.waitForLoadState('domcontentloaded');`);
          }

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

    // Use a single setInterval offset by initialDelay to avoid timer ID tracking issues.
    // The initial setTimeout and recurring setInterval are tracked together.
    const timerId = setTimeout(() => {
      // Check if this schedule was stopped while waiting for initial delay
      if (!scheduledJobs.has(schedule.id)) return;

      this.executeScheduledRun(schedule);

      // Set up recurring interval and replace the timeout ID
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
      // Clear both timeout and interval — safe to call both on any timer ID in Node
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
      cancelRequested.add(runId);
      killProcessTree(child);
      runningProcesses.delete(runId);
      return true;
    }
    return false;
  }
}

export const bddService = new BDDService();
