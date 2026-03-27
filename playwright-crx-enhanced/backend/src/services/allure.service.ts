import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

const PLAYWRIGHT_CRX_RESULTS_DIR = path.join(process.cwd(), 'playwright-crx-results');
const PLAYWRIGHT_CRX_REPORTS_DIR = path.join(process.cwd(), 'playwright-crx-reports');
const ALLURE_HISTORY_DIR = path.join(process.cwd(), 'allure-history');

// ---------------------------------------------------------------------------
// Allure data model interfaces
// ---------------------------------------------------------------------------
interface AllureStep {
  name: string;
  status: 'passed' | 'failed' | 'broken' | 'skipped';
  statusDetails: { message?: string; trace?: string };
  stage: string;
  start: number;
  stop: number;
  attachments: AllureAttachment[];
}

interface AllureAttachment {
  name: string;
  source: string;
  type: string;
}

interface AllureResult {
  uuid: string;
  historyId: string;
  testCaseId: string;
  fullName: string;
  name: string;
  description?: string;
  status?: string;
  statusDetails: { message?: string; trace?: string };
  stage: string;
  start: number;
  stop?: number;
  labels: Array<{ name: string; value: string }>;
  links: Array<{ name?: string; url: string; type?: string }>;
  parameters: Array<{ name: string; value: string }>;
  steps: AllureStep[];
  attachments: AllureAttachment[];
}

interface AllureContainer {
  uuid: string;
  name: string;
  children: string[];
  befores: AllureStep[];
  afters: AllureStep[];
  start: number;
  stop?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export class PlaywrightCrxService {
  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories() {
    for (const dir of [PLAYWRIGHT_CRX_RESULTS_DIR, PLAYWRIGHT_CRX_REPORTS_DIR, ALLURE_HISTORY_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get or create an isolated results directory for a test run.
   * Each run writes results in its own folder so `allure generate` only picks up
   * the relevant data.
   */
  private getRunResultsDir(testRunId: string): string {
    const dir = path.join(PLAYWRIGHT_CRX_RESULTS_DIR, testRunId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // =========================================================================
  // 1. START / RECORD / END — Test lifecycle
  // =========================================================================
  async startTest(
    testRunId: string,
    scriptName: string,
    meta?: {
      suiteName?: string;
      description?: string;
      browser?: string;
      environment?: string;
      tags?: string[];
    }
  ) {
    try {
      const runDir = this.getRunResultsDir(testRunId);
      const containerUuid = randomUUID();

      // --- Allure result (test case) ---
      const result: AllureResult = {
        uuid: testRunId,
        historyId: testRunId,
        testCaseId: testRunId,
        fullName: scriptName,
        name: scriptName,
        description: meta?.description || '',
        stage: 'running',
        start: Date.now(),
        statusDetails: {},
        labels: [
          { name: 'suite', value: meta?.suiteName || 'Playwright CRX Tests' },
          { name: 'parentSuite', value: 'Playwright CRX' },
          { name: 'host', value: require('os').hostname() },
          { name: 'thread', value: `thread-${testRunId.substring(0, 8)}` },
          { name: 'framework', value: 'Playwright CRX' },
          { name: 'language', value: 'typescript' },
        ],
        links: [],
        parameters: [],
        steps: [],
        attachments: [],
      };

      // Add optional labels
      if (meta?.browser) result.labels.push({ name: 'browser', value: meta.browser });
      if (meta?.environment) result.labels.push({ name: 'environment', value: meta.environment });
      if (meta?.tags) {
        for (const tag of meta.tags) {
          result.labels.push({ name: 'tag', value: tag });
        }
      }

      fs.writeFileSync(
        path.join(runDir, `${testRunId}-result.json`),
        JSON.stringify(result, null, 2)
      );

      // --- Allure container (suite grouping) ---
      const container: AllureContainer = {
        uuid: containerUuid,
        name: meta?.suiteName || 'Playwright CRX Tests',
        children: [testRunId],
        befores: [],
        afters: [],
        start: Date.now(),
      };
      fs.writeFileSync(
        path.join(runDir, `${containerUuid}-container.json`),
        JSON.stringify(container, null, 2)
      );

      // --- categories.json  (failure classification) ---
      this.writeCategoriesFile(runDir);

      // --- environment.properties ---
      this.writeEnvironmentProperties(runDir, {
        Browser: meta?.browser || 'chromium',
        Environment: meta?.environment || 'development',
        'Test Name': scriptName,
        Platform: process.platform,
        'Node Version': process.version,
        Timestamp: new Date().toISOString(),
      });

      // --- executor.json ---
      this.writeExecutorJson(runDir, testRunId);

      logger.info(`Allure: started test ${testRunId} (${scriptName})`);
      return result;
    } catch (error) {
      logger.error('Allure: error starting test', error);
      throw error;
    }
  }

  async recordStep(
    testId: string,
    stepName: string,
    status: 'passed' | 'failed' | 'broken' | 'skipped',
    duration?: number,
    attachment?: { name: string; content: Buffer; type: string }
  ) {
    try {
      const runDir = this.getRunResultsDir(testId);
      const resultsPath = path.join(runDir, `${testId}-result.json`);

      const step: AllureStep = {
        name: stepName,
        status,
        statusDetails: {},
        stage: 'finished',
        start: Date.now() - (duration || 0),
        stop: Date.now(),
        attachments: [],
      };

      // If an attachment (e.g. screenshot) is provided, write it
      if (attachment) {
        const attFile = `${randomUUID()}-attachment.${this.extensionForMime(attachment.type)}`;
        fs.writeFileSync(path.join(runDir, attFile), attachment.content);
        step.attachments.push({ name: attachment.name, source: attFile, type: attachment.type });
      }

      let result: AllureResult = this.readJson(resultsPath) || { steps: [] } as any;
      result.steps = result.steps || [];
      result.steps.push(step);

      fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error('Allure: error recording step', error);
    }
  }

  /**
   * Add a screenshot or file attachment to a test run (outside of a step).
   */
  async addAttachment(
    testId: string,
    name: string,
    content: Buffer,
    mimeType: string
  ) {
    try {
      const runDir = this.getRunResultsDir(testId);
      const resultsPath = path.join(runDir, `${testId}-result.json`);
      const attFile = `${randomUUID()}-attachment.${this.extensionForMime(mimeType)}`;

      fs.writeFileSync(path.join(runDir, attFile), content);

      let result: AllureResult = this.readJson(resultsPath) || {} as any;
      result.attachments = result.attachments || [];
      result.attachments.push({ name, source: attFile, type: mimeType });
      fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error('Allure: error adding attachment', error);
    }
  }

  async endTest(
    testId: string,
    status: 'passed' | 'failed' | 'broken',
    errorMessage?: string,
    screenshotBuffer?: Buffer
  ) {
    try {
      const runDir = this.getRunResultsDir(testId);
      const resultsPath = path.join(runDir, `${testId}-result.json`);

      let existing: AllureResult = this.readJson(resultsPath) || {} as any;
      const startTime = existing.start || Date.now();
      const stopTime = Date.now();

      // On failure, attach screenshot if provided
      if (status !== 'passed' && screenshotBuffer) {
        const attFile = `${randomUUID()}-attachment.png`;
        fs.writeFileSync(path.join(runDir, attFile), screenshotBuffer);
        existing.attachments = existing.attachments || [];
        existing.attachments.push({ name: 'Failure screenshot', source: attFile, type: 'image/png' });
      }

      const result: AllureResult = {
        ...existing,
        uuid: testId,
        historyId: testId,
        testCaseId: testId,
        fullName: existing.fullName || testId,
        name: existing.name || testId,
        status,
        statusDetails: errorMessage
          ? { message: errorMessage, trace: errorMessage }
          : existing.statusDetails || {},
        stage: 'finished',
        start: startTime,
        stop: stopTime,
        labels: existing.labels || [],
        links: existing.links || [],
        parameters: existing.parameters || [],
        steps: existing.steps || [],
        attachments: existing.attachments || [],
      };

      fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));

      // Close the container
      const containerFiles = fs.readdirSync(runDir).filter(f => f.endsWith('-container.json'));
      for (const cf of containerFiles) {
        const container: AllureContainer = this.readJson(path.join(runDir, cf));
        if (container && container.children?.includes(testId)) {
          container.stop = stopTime;
          fs.writeFileSync(path.join(runDir, cf), JSON.stringify(container, null, 2));
        }
      }

      logger.info(`Allure: ended test ${testId} — ${status}`);
    } catch (error) {
      logger.error('Allure: error ending test', error);
      throw error;
    }
  }

  // =========================================================================
  // 2. BDD / Cucumber integration — write Allure results from BDD run data
  // =========================================================================
  async writeBDDResults(opts: {
    runId: string;
    featureName: string;
    scenarios: Array<{
      name: string;
      status: string;
      duration: number;
      tags?: string[];
      steps: Array<{
        keyword: string;
        name: string;
        status: string;
        duration?: number;
        errorMessage?: string;
        screenshotPath?: string;
      }>;
    }>;
    environment?: string;
    browser?: string;
  }) {
    const runDir = this.getRunResultsDir(opts.runId);
    const containerUuid = randomUUID();
    const childIds: string[] = [];

    for (const scenario of opts.scenarios) {
      const testUuid = randomUUID();
      childIds.push(testUuid);

      const steps: AllureStep[] = scenario.steps.map(s => {
        const step: AllureStep = {
          name: `${s.keyword} ${s.name}`,
          status: this.mapStatus(s.status),
          statusDetails: s.errorMessage ? { message: s.errorMessage } : {},
          stage: 'finished',
          start: Date.now() - (s.duration || 0),
          stop: Date.now(),
          attachments: [],
        };

        // Attach screenshot if available
        if (s.screenshotPath && fs.existsSync(s.screenshotPath)) {
          const attFile = `${randomUUID()}-attachment.png`;
          fs.copyFileSync(s.screenshotPath, path.join(runDir, attFile));
          step.attachments.push({ name: 'Screenshot', source: attFile, type: 'image/png' });
        }

        return step;
      });

      const result: AllureResult = {
        uuid: testUuid,
        historyId: `${opts.runId}-${scenario.name}`,
        testCaseId: testUuid,
        fullName: `${opts.featureName} > ${scenario.name}`,
        name: scenario.name,
        status: this.mapStatus(scenario.status),
        statusDetails: {},
        stage: 'finished',
        start: Date.now() - scenario.duration,
        stop: Date.now(),
        labels: [
          { name: 'suite', value: opts.featureName },
          { name: 'parentSuite', value: 'BDD / Cucumber' },
          { name: 'feature', value: opts.featureName },
          { name: 'story', value: scenario.name },
          { name: 'framework', value: 'Cucumber BDD' },
          { name: 'language', value: 'gherkin' },
          ...(scenario.tags || []).map(t => ({ name: 'tag' as const, value: t })),
        ],
        links: [],
        parameters: [],
        steps,
        attachments: [],
      };

      fs.writeFileSync(path.join(runDir, `${testUuid}-result.json`), JSON.stringify(result, null, 2));
    }

    // Container
    const container: AllureContainer = {
      uuid: containerUuid,
      name: opts.featureName,
      children: childIds,
      befores: [],
      afters: [],
      start: Date.now() - opts.scenarios.reduce((s, sc) => s + sc.duration, 0),
      stop: Date.now(),
    };
    fs.writeFileSync(path.join(runDir, `${containerUuid}-container.json`), JSON.stringify(container, null, 2));

    // Environment + categories + executor
    this.writeCategoriesFile(runDir);
    this.writeEnvironmentProperties(runDir, {
      Browser: opts.browser || 'chromium',
      Environment: opts.environment || 'default',
      Feature: opts.featureName,
      Framework: 'Cucumber BDD',
      Platform: process.platform,
      'Node Version': process.version,
      Timestamp: new Date().toISOString(),
    });
    this.writeExecutorJson(runDir, opts.runId);

    logger.info(`Allure: wrote BDD results for run ${opts.runId} (${opts.scenarios.length} scenarios)`);
  }

  // =========================================================================
  // 3. REPORT GENERATION
  // =========================================================================
  async generateReport(testRunId: string): Promise<string> {
    try {
      const runResultsDir = this.getRunResultsDir(testRunId);
      const reportPath = path.join(PLAYWRIGHT_CRX_REPORTS_DIR, testRunId);

      // Verify we have results
      const hasResults = fs.readdirSync(runResultsDir).some(f => f.endsWith('-result.json'));

      // Copy history from previous report (for trend charts)
      this.copyHistoryToResults(testRunId, runResultsDir);

      // Clean old report
      if (fs.existsSync(reportPath)) {
        fs.rmSync(reportPath, { recursive: true, force: true });
      }
      fs.mkdirSync(reportPath, { recursive: true });

      // Copy branding logo
      const logoSource = path.join(process.cwd(), 'playwright-crx-logo.png');
      if (fs.existsSync(logoSource)) {
        fs.copyFileSync(logoSource, path.join(reportPath, 'playwright-crx-logo.png'));
      }

      if (!hasResults) {
        this.writeEmptyReport(reportPath, testRunId);
        return reportPath;
      }

      // Try Allure CLI
      try {
        const allureBin = path.join(process.cwd(), 'node_modules', '.bin', 'allure');
        const isWindows = process.platform === 'win32';
        const allureCmd = isWindows ? `"${allureBin}.cmd"` : allureBin;

        let javaHome = process.env.JAVA_HOME || '';
        if (javaHome.endsWith('\\bin') || javaHome.endsWith('/bin')) {
          javaHome = path.dirname(javaHome);
        }

        const command = `${allureCmd} generate "${runResultsDir}" -o "${reportPath}" --clean`;
        logger.info(`Allure CLI: ${command}`);

        execSync(command, {
          cwd: process.cwd(),
          stdio: 'pipe',
          encoding: 'utf-8',
          windowsHide: true,
          env: { ...process.env, JAVA_HOME: javaHome },
        });

        const indexPath = path.join(reportPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          this.brandReport(reportPath);

          // Save history for future trend support
          this.saveHistory(testRunId, reportPath);

          logger.info(`Allure: report generated at ${reportPath}`);
          return reportPath;
        }
        throw new Error('index.html not created');
      } catch (cliErr: any) {
        logger.warn(`Allure CLI failed, using fallback: ${cliErr.message}`);
        this.writeFallbackReport(reportPath, testRunId, runResultsDir);
        return reportPath;
      }
    } catch (error) {
      logger.error('Allure: error generating report', error);
      throw new Error('Failed to generate report');
    }
  }

  async getReportUrl(testRunId: string): Promise<string> {
    const reportPath = path.join(PLAYWRIGHT_CRX_REPORTS_DIR, testRunId);
    if (fs.existsSync(path.join(reportPath, 'index.html'))) {
      return `/playwright-crx-reports/${testRunId}/index.html`;
    }
    return '';
  }

  async cleanupOldReports(daysToKeep = 7) {
    try {
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      // Clean reports
      for (const dir of [PLAYWRIGHT_CRX_REPORTS_DIR, PLAYWRIGHT_CRX_RESULTS_DIR]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          try {
            const stats = fs.statSync(full);
            if (now - stats.mtimeMs > maxAge) {
              fs.rmSync(full, { recursive: true, force: true });
              logger.info(`Allure: cleaned up ${full}`);
            }
          } catch { /* skip */ }
        }
      }
    } catch (error) {
      logger.error('Allure: error cleaning up', error);
    }
  }

  getAllReports(): Array<{ id: string; path: string; createdAt: Date }> {
    try {
      if (!fs.existsSync(PLAYWRIGHT_CRX_REPORTS_DIR)) return [];
      return fs.readdirSync(PLAYWRIGHT_CRX_REPORTS_DIR)
        .filter(entry => {
          const full = path.join(PLAYWRIGHT_CRX_REPORTS_DIR, entry);
          return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'index.html'));
        })
        .map(entry => ({
          id: entry,
          path: `/playwright-crx-reports/${entry}/index.html`,
          createdAt: fs.statSync(path.join(PLAYWRIGHT_CRX_REPORTS_DIR, entry)).birthtime,
        }));
    } catch (error) {
      logger.error('Allure: error listing reports', error);
      return [];
    }
  }

  // =========================================================================
  // 4. HELPER: categories.json
  // =========================================================================
  private writeCategoriesFile(dir: string) {
    const categories = [
      {
        name: 'Product Defects',
        description: 'Tests that found real application bugs',
        matchedStatuses: ['failed'],
        messageRegex: '(?!.*timeout)(?!.*element not found).*',
      },
      {
        name: 'Element Not Found',
        description: 'UI elements could not be located — possible locator drift',
        matchedStatuses: ['failed', 'broken'],
        messageRegex: '.*(element not found|locator|selector|not visible|no such element).*',
      },
      {
        name: 'Timeouts',
        description: 'Operations exceeded allowed time',
        matchedStatuses: ['broken', 'failed'],
        messageRegex: '.*(timeout|timed out|Timeout|TIMEOUT).*',
      },
      {
        name: 'Network / API Errors',
        description: 'Network failures or unexpected HTTP status codes',
        matchedStatuses: ['broken'],
        messageRegex: '.*(net::ERR|ECONNREFUSED|ECONNRESET|fetch failed|status 5\\d{2}).*',
      },
      {
        name: 'Test Infrastructure',
        description: 'Browser or environment setup failures',
        matchedStatuses: ['broken'],
        messageRegex: '.*(browser|launch|context|crash|EPERM).*',
      },
      {
        name: 'Skipped Tests',
        description: 'Intentionally skipped',
        matchedStatuses: ['skipped'],
      },
    ];
    fs.writeFileSync(path.join(dir, 'categories.json'), JSON.stringify(categories, null, 2));
  }

  // =========================================================================
  // 5. HELPER: environment.properties
  // =========================================================================
  private writeEnvironmentProperties(dir: string, props: Record<string, string>) {
    const content = Object.entries(props)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    fs.writeFileSync(path.join(dir, 'environment.properties'), content);
  }

  // =========================================================================
  // 6. HELPER: executor.json
  // =========================================================================
  private writeExecutorJson(dir: string, testRunId: string) {
    const executor = {
      name: 'Playwright CRX',
      type: 'playwright-crx',
      buildName: `Run ${testRunId.substring(0, 8)}`,
      buildOrder: Date.now(),
      reportUrl: `/playwright-crx-reports/${testRunId}/index.html`,
      reportName: 'Playwright CRX Report',
    };
    fs.writeFileSync(path.join(dir, 'executor.json'), JSON.stringify(executor, null, 2));
  }

  // =========================================================================
  // 7. HELPER: History / Trend management
  // =========================================================================
  private copyHistoryToResults(_testRunId: string, resultsDir: string) {
    try {
      const historySource = path.join(ALLURE_HISTORY_DIR, 'latest');
      if (fs.existsSync(historySource)) {
        const historyDest = path.join(resultsDir, 'history');
        if (!fs.existsSync(historyDest)) fs.mkdirSync(historyDest, { recursive: true });
        for (const file of fs.readdirSync(historySource)) {
          fs.copyFileSync(path.join(historySource, file), path.join(historyDest, file));
        }
        logger.info(`Allure: copied history to results for trend support`);
      }
    } catch (err) {
      logger.warn('Allure: could not copy history (first run?)', err);
    }
  }

  private saveHistory(_testRunId: string, reportDir: string) {
    try {
      const historySource = path.join(reportDir, 'history');
      if (fs.existsSync(historySource)) {
        const historyDest = path.join(ALLURE_HISTORY_DIR, 'latest');
        if (fs.existsSync(historyDest)) fs.rmSync(historyDest, { recursive: true, force: true });
        fs.mkdirSync(historyDest, { recursive: true });
        for (const file of fs.readdirSync(historySource)) {
          fs.copyFileSync(path.join(historySource, file), path.join(historyDest, file));
        }
        logger.info(`Allure: saved history from report ${_testRunId}`);
      }
    } catch (err) {
      logger.warn('Allure: could not save history', err);
    }
  }

  // =========================================================================
  // 8. BRANDING — Customize generated Allure HTML
  // =========================================================================
  private brandReport(reportPath: string) {
    const indexPath = path.join(reportPath, 'index.html');
    if (!fs.existsSync(indexPath)) return;

    let html = fs.readFileSync(indexPath, 'utf-8');

    html = html.replace(/<title>Allure Report/g, '<title>Playwright CRX');

    // Inject custom CSS + JS before </head>
    const injection = `
<style>
.side-nav__brand {
  background-image: url('playwright-crx-logo.png') !important;
  background-size: contain !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  width: 200px !important; height: 60px !important;
}
.side-nav__brand svg, .side-nav__brand img { display: none !important; }
</style>
<script>
(function(){
  function brand(){
    document.querySelectorAll('*').forEach(function(el){
      if(el.children.length===0 && el.textContent && el.textContent.includes('Allure')){
        el.textContent=el.textContent.replace(/Allure Report/g,'Playwright CRX').replace(/Allure/g,'Playwright CRX');
      }
    });
    var b=document.querySelector('.side-nav__brand');
    if(b) b.innerHTML='<img src="playwright-crx-logo.png" alt="Playwright CRX" style="max-width:100%;max-height:100%;object-fit:contain"/>';
  }
  brand();
  document.addEventListener('DOMContentLoaded',brand);
  setTimeout(brand,500);setTimeout(brand,1500);
  new MutationObserver(brand).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>
`;
    html = html.replace('</head>', injection + '</head>');
    fs.writeFileSync(indexPath, html);

    // Update summary.json
    const summaryPath = path.join(reportPath, 'widgets', 'summary.json');
    if (fs.existsSync(summaryPath)) {
      let s = fs.readFileSync(summaryPath, 'utf-8');
      s = s.replace(/"reportName"\s*:\s*"Allure Report"/g, '"reportName":"Playwright CRX"');
      fs.writeFileSync(summaryPath, s);
    }
  }

  // =========================================================================
  // 9. FALLBACK HTML report (when Allure CLI / Java not available)
  // =========================================================================
  private writeFallbackReport(reportPath: string, testRunId: string, resultsDir: string) {
    // Collect all result files
    const resultFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith('-result.json'));
    const results: AllureResult[] = resultFiles.map(f => this.readJson(path.join(resultsDir, f))).filter(Boolean);

    const totalTests = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const broken = results.filter(r => r.status === 'broken').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const totalDuration = results.reduce((s, r) => s + ((r.stop || 0) - (r.start || 0)), 0);

    const statusClass = (s: string) => s === 'passed' ? '#10b981' : s === 'failed' ? '#ef4444' : s === 'broken' ? '#f59e0b' : '#94a3b8';

    const scenarioRows = results.map((r, i) => {
      const dur = ((r.stop || 0) - (r.start || 0)) / 1000;
      const stepsHtml = (r.steps || []).map((step) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
          <span style="width:8px;height:8px;border-radius:50%;background:${statusClass(step.status)};flex-shrink:0;"></span>
          <span style="flex:1;font-size:13px;">${this.escHtml(step.name)}</span>
          <span style="font-size:11px;color:#94a3b8;">${((step.stop - step.start) / 1000).toFixed(1)}s</span>
          ${step.statusDetails?.message ? `<span style="font-size:11px;color:#ef4444;" title="${this.escHtml(step.statusDetails.message)}">⚠</span>` : ''}
        </div>
      `).join('');

      const attachHtml = (r.attachments || []).map(a =>
        a.type.startsWith('image/')
          ? `<div style="margin-top:8px;"><img src="${a.source}" alt="${this.escHtml(a.name)}" style="max-width:400px;border:1px solid #e2e8f0;border-radius:4px;"/></div>`
          : `<div style="margin-top:4px;"><a href="${a.source}">${this.escHtml(a.name)}</a></div>`
      ).join('');

      return `
      <div style="background:white;border-radius:8px;padding:16px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid ${statusClass(r.status || 'skipped')};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:15px;">${i + 1}. ${this.escHtml(r.name)}</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:12px;color:#64748b;">${dur.toFixed(1)}s</span>
            <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:white;background:${statusClass(r.status || 'skipped')};">${(r.status || 'unknown').toUpperCase()}</span>
          </div>
        </div>
        ${r.steps?.length ? `<div style="margin-top:12px;">${stepsHtml}</div>` : ''}
        ${attachHtml}
        ${r.statusDetails?.message ? `<div style="margin-top:8px;padding:8px;background:#fef2f2;border-radius:4px;font-size:12px;color:#991b1b;">${this.escHtml(r.statusDetails.message)}</div>` : ''}
      </div>`;
    }).join('');

    // Read environment.properties
    const envPath = path.join(resultsDir, 'environment.properties');
    let envHtml = '';
    if (fs.existsSync(envPath)) {
      const envLines = fs.readFileSync(envPath, 'utf-8').split('\n').filter(l => l.includes('='));
      envHtml = `<div style="margin:20px 0;padding:16px;background:white;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <h3 style="margin:0 0 12px;font-size:14px;">Environment</h3>
        <table style="width:100%;font-size:13px;"><tbody>
        ${envLines.map(l => { const [k, ...v] = l.split('='); return `<tr><td style="padding:4px 8px;color:#64748b;">${this.escHtml(k)}</td><td style="padding:4px 8px;">${this.escHtml(v.join('='))}</td></tr>`; }).join('')}
        </tbody></table>
      </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Playwright CRX — ${testRunId.substring(0, 8)}</title>
  <style>
    *{box-sizing:border-box;} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;background:#f8fafc;color:#1e293b;}
    .hdr{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:32px 0;}
    .wrap{max-width:960px;margin:0 auto;padding:0 24px;}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0;}
    .card{background:white;border-radius:8px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08);}
    .card .num{font-size:28px;font-weight:700;} .card .lbl{font-size:12px;color:#64748b;margin-top:4px;}
  </style>
</head>
<body>
  <div class="hdr"><div class="wrap">
    <h1 style="margin:0 0 4px;">Playwright CRX Report</h1>
    <p style="margin:0;opacity:.85;">Run: ${testRunId} &nbsp;|&nbsp; ${new Date().toLocaleString()}</p>
  </div></div>
  <div class="wrap">
    <div class="cards">
      <div class="card"><div class="num">${totalTests}</div><div class="lbl">Total</div></div>
      <div class="card"><div class="num" style="color:#10b981">${passed}</div><div class="lbl">Passed</div></div>
      <div class="card"><div class="num" style="color:#ef4444">${failed}</div><div class="lbl">Failed</div></div>
      <div class="card"><div class="num" style="color:#f59e0b">${broken + skipped}</div><div class="lbl">Broken / Skipped</div></div>
    </div>
    <p style="font-size:13px;color:#64748b;">Duration: ${(totalDuration / 1000).toFixed(1)}s</p>
    ${envHtml}
    <h2 style="font-size:16px;margin:24px 0 8px;">Test Results</h2>
    ${scenarioRows || '<p style="color:#94a3b8;">No test results available.</p>'}
    <footer style="text-align:center;padding:32px 0;font-size:12px;color:#94a3b8;">
      Generated by Playwright CRX &mdash; ${new Date().toISOString()}
    </footer>
  </div>
</body></html>`;

    fs.writeFileSync(path.join(reportPath, 'index.html'), html);
    logger.info(`Allure: fallback report written to ${reportPath}`);
  }

  private writeEmptyReport(reportPath: string, testRunId: string) {
    const html = `<!DOCTYPE html>
<html><head><title>Playwright CRX — ${testRunId}</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;">
<div style="text-align:center;">
  <h1>Playwright CRX Report</h1>
  <p>Run: ${testRunId}</p>
  <p style="color:#94a3b8;">No test results available.</p>
</div></body></html>`;
    fs.writeFileSync(path.join(reportPath, 'index.html'), html);
  }

  // =========================================================================
  // UTILITY
  // =========================================================================
  private readJson(filePath: string): any {
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch { /* corrupt file */ }
    return null;
  }

  private escHtml(s: string): string {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private extensionForMime(mime: string): string {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('json')) return 'json';
    if (mime.includes('text')) return 'txt';
    if (mime.includes('html')) return 'html';
    return 'bin';
  }

  private mapStatus(s: string): 'passed' | 'failed' | 'broken' | 'skipped' {
    const lower = (s || '').toLowerCase();
    if (lower === 'passed') return 'passed';
    if (lower === 'failed') return 'failed';
    if (lower === 'skipped' || lower === 'pending' || lower === 'undefined') return 'skipped';
    return 'broken';
  }
}

export const playwrightCrxService = new PlaywrightCrxService();
export const allureService = playwrightCrxService;
