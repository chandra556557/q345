import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import pool from '../db';

const REPORTS_DIR = path.join(process.cwd(), 'playwright-crx-reports');

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface StepResult {
  name: string;
  keyword?: string;
  status: 'passed' | 'failed' | 'broken' | 'skipped';
  duration?: number;
  errorMessage?: string;
  screenshotPath?: string;
  attachment?: { name: string; content: Buffer; type: string };
}

interface ScenarioResult {
  name: string;
  status: string;
  duration: number;
  tags?: string[];
  steps: StepResult[];
}

interface ReportMetadata {
  browser?: string;
  environment?: string;
  featureName?: string;
  suiteName?: string;
  tags?: string[];
  description?: string;
  retryInfo?: { totalRetries: number; flakyScenarios: string[]; retriedScenarios: string[] };
  consoleErrors?: string[];
  executionStartTime?: string;
}

interface TrendPoint {
  runId: string;
  status: string;
  duration: number | null;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Failure category classifier
// ---------------------------------------------------------------------------
const FAILURE_CATEGORIES = [
  { name: 'Element Not Found', regex: /.*(element not found|locator|selector|not visible|no such element).*/i },
  { name: 'Timeouts', regex: /.*(timeout|timed out)/i },
  { name: 'Network / API Errors', regex: /.*(net::ERR|ECONNREFUSED|ECONNRESET|fetch failed|status 5\d{2}).*/i },
  { name: 'Test Infrastructure', regex: /.*(browser|launch|context|crash|EPERM).*/i },
  { name: 'Product Defects', regex: /.*/ }, // fallback
];

function classifyFailure(message: string): string {
  for (const cat of FAILURE_CATEGORIES) {
    if (cat.regex.test(message)) return cat.name;
  }
  return 'Unknown';
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// BDD Report Service
// ---------------------------------------------------------------------------
export class BddReportService {
  constructor() {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // =========================================================================
  // 1. Generate report from BDD scenario results
  // =========================================================================
  async generateBDDReport(
    runId: string,
    scenarios: ScenarioResult[],
    metadata: ReportMetadata = {}
  ): Promise<string> {
    const reportDir = path.join(REPORTS_DIR, runId);
    if (fs.existsSync(reportDir)) fs.rmSync(reportDir, { recursive: true, force: true });
    fs.mkdirSync(reportDir, { recursive: true });

    // Copy branding logo
    const logoSource = path.join(process.cwd(), 'playwright-crx-logo.png');
    if (fs.existsSync(logoSource)) {
      fs.copyFileSync(logoSource, path.join(reportDir, 'playwright-crx-logo.png'));
    }

    // Copy screenshots into report dir and build inline data
    const screenshotMap = new Map<string, string>();
    for (const scenario of scenarios) {
      for (const step of scenario.steps) {
        if (step.screenshotPath && fs.existsSync(step.screenshotPath)) {
          const filename = `screenshot-${randomUUID()}.png`;
          fs.copyFileSync(step.screenshotPath, path.join(reportDir, filename));
          screenshotMap.set(step.screenshotPath, filename);
        }
        if (step.attachment?.type?.startsWith('image/')) {
          const ext = step.attachment.type.includes('png') ? 'png' : 'jpg';
          const filename = `screenshot-${randomUUID()}.${ext}`;
          fs.writeFileSync(path.join(reportDir, filename), step.attachment.content);
          screenshotMap.set(`attachment-${step.name}`, filename);
        }
      }
    }

    const html = this.buildBDDHtml(runId, scenarios, metadata, screenshotMap);
    fs.writeFileSync(path.join(reportDir, 'index.html'), html);

    // Write JSON data for programmatic access
    fs.writeFileSync(path.join(reportDir, 'report-data.json'), JSON.stringify({
      runId,
      generatedAt: new Date().toISOString(),
      metadata,
      scenarios: scenarios.map(s => ({
        name: s.name,
        status: s.status,
        duration: s.duration,
        tags: s.tags || [],
        steps: s.steps.map(st => ({
          keyword: st.keyword || '',
          name: st.name,
          status: st.status,
          duration: st.duration || 0,
          errorMessage: st.errorMessage || null,
          hasScreenshot: !!(st.screenshotPath || st.attachment),
        })),
      })),
    }, null, 2));

    logger.info(`BDD Report: generated for run ${runId} (${scenarios.length} scenarios)`);
    return this.getReportUrl(runId);
  }

  // =========================================================================
  // 2. Generate report from test steps (used by testRunner, dataDriven, etc.)
  // =========================================================================
  async generateTestRunReport(
    testRunId: string,
    testName: string,
    steps: Array<{ action: string; status: string; duration?: number; errorMessage?: string }>,
    overallStatus: string,
    metadata: ReportMetadata = {}
  ): Promise<string> {
    const scenario: ScenarioResult = {
      name: testName,
      status: overallStatus,
      duration: steps.reduce((sum, s) => sum + (s.duration || 0), 0),
      tags: metadata.tags,
      steps: steps.map(s => ({
        name: s.action,
        keyword: 'Step',
        status: this.mapStatus(s.status),
        duration: s.duration,
        errorMessage: s.errorMessage,
      })),
    };

    return this.generateBDDReport(testRunId, [scenario], {
      ...metadata,
      featureName: metadata.suiteName || testName,
    });
  }

  // =========================================================================
  // 3. Report URL & listing
  // =========================================================================
  getReportUrl(runId: string): string {
    const reportPath = path.join(REPORTS_DIR, runId, 'index.html');
    if (fs.existsSync(reportPath)) {
      return `/playwright-crx-reports/${runId}/index.html`;
    }
    return '';
  }

  getAllReports(): Array<{ id: string; path: string; createdAt: Date }> {
    try {
      if (!fs.existsSync(REPORTS_DIR)) return [];
      return fs.readdirSync(REPORTS_DIR)
        .filter(entry => {
          const full = path.join(REPORTS_DIR, entry);
          return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'index.html'));
        })
        .map(entry => ({
          id: entry,
          path: `/playwright-crx-reports/${entry}/index.html`,
          createdAt: fs.statSync(path.join(REPORTS_DIR, entry)).birthtime,
        }));
    } catch (error) {
      logger.error('BDD Report: error listing reports', error);
      return [];
    }
  }

  async cleanupOldReports(daysToKeep = 7) {
    try {
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      if (!fs.existsSync(REPORTS_DIR)) return;
      for (const entry of fs.readdirSync(REPORTS_DIR)) {
        const full = path.join(REPORTS_DIR, entry);
        try {
          const stats = fs.statSync(full);
          if (now - stats.mtimeMs > maxAge) {
            fs.rmSync(full, { recursive: true, force: true });
            logger.info(`BDD Report: cleaned up ${full}`);
          }
        } catch { /* skip */ }
      }
    } catch (error) {
      logger.error('BDD Report: error cleaning up', error);
    }
  }

  // =========================================================================
  // 4. Trend data from DB
  // =========================================================================
  async getBDDTrends(limit = 20): Promise<TrendPoint[]> {
    try {
      const { rows } = await pool.query(
        `SELECT id as "runId", status, duration, "totalSteps", "passedSteps", "failedSteps", "skippedSteps", "createdAt"
         FROM "BDDRun"
         ORDER BY "createdAt" DESC
         LIMIT $1`,
        [limit]
      );
      return rows;
    } catch (error) {
      logger.error('BDD Report: error fetching trends', error);
      return [];
    }
  }

  async getTestRunTrends(limit = 20): Promise<any[]> {
    try {
      const { rows } = await pool.query(
        `SELECT id, status, duration, "startedAt", "completedAt"
         FROM "TestRun"
         ORDER BY "startedAt" DESC
         LIMIT $1`,
        [limit]
      );
      return rows;
    } catch (error) {
      logger.error('BDD Report: error fetching test run trends', error);
      return [];
    }
  }

  // =========================================================================
  // 5. Build the BDD HTML report (all 15 enhancements)
  // =========================================================================
  private buildBDDHtml(
    runId: string,
    scenarios: ScenarioResult[],
    metadata: ReportMetadata,
    screenshotMap: Map<string, string>
  ): string {
    const totalScenarios = scenarios.length;
    const passed = scenarios.filter(s => s.status === 'passed').length;
    const failed = scenarios.filter(s => s.status === 'failed').length;
    const skipped = scenarios.filter(s => ['skipped', 'pending', 'undefined'].includes(s.status)).length;
    const broken = totalScenarios - passed - failed - skipped;
    const totalDuration = scenarios.reduce((s, sc) => s + sc.duration, 0);
    const passRate = totalScenarios > 0 ? ((passed / totalScenarios) * 100).toFixed(1) : '0.0';

    // Collect all steps for stats
    const allSteps = scenarios.flatMap(s => s.steps);
    const stepsPassed = allSteps.filter(s => s.status === 'passed').length;
    const stepsFailed = allSteps.filter(s => s.status === 'failed').length;
    const stepsSkipped = allSteps.filter(s => s.status === 'skipped').length;

    // Failure categories
    const failureCategories = new Map<string, number>();
    for (const s of allSteps) {
      if (s.status === 'failed' && s.errorMessage) {
        const cat = classifyFailure(s.errorMessage);
        failureCategories.set(cat, (failureCategories.get(cat) || 0) + 1);
      }
    }

    // Tags
    const allTags = new Set<string>();
    for (const sc of scenarios) {
      for (const t of (sc.tags || [])) allTags.add(t);
    }

    const statusColor = (s: string) => {
      switch (s) {
        case 'passed': return '#10b981';
        case 'failed': return '#ef4444';
        case 'skipped': case 'pending': case 'undefined': return '#94a3b8';
        default: return '#f59e0b';
      }
    };

    const statusIcon = (s: string) => {
      switch (s) {
        case 'passed': return '&#10004;';
        case 'failed': return '&#10008;';
        case 'skipped': return '&#8212;';
        default: return '&#9888;';
      }
    };

    const formatDuration = (ms: number) => {
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
    };


    // Build scenario cards with all enhancements
    const scenarioCards = scenarios.map((sc, idx) => {
      // Collect all screenshots for gallery [Enhancement 10]
      const scenarioScreenshots: string[] = [];

      const stepsHtml = sc.steps.map((step, stepIdx) => {
        const screenshotFile = step.screenshotPath ? screenshotMap.get(step.screenshotPath) :
                               step.attachment ? screenshotMap.get(`attachment-${step.name}`) : null;
        if (screenshotFile) scenarioScreenshots.push(screenshotFile);

        // [Enhancement 14] Collapsible error with copy button [Enhancement 15]
        const errorHtml = step.errorMessage ? `
          <div class="step-error">
            <div class="error-header" onclick="this.parentElement.classList.toggle('collapsed')">
              <span class="error-toggle">&#9660;</span> Error Details
              <button class="copy-btn" onclick="event.stopPropagation();copyError(this)" data-error="${esc(step.errorMessage).replace(/"/g, '&quot;')}">&#128203; Copy</button>
            </div>
            <pre class="error-body">${esc(step.errorMessage)}</pre>
          </div>` : '';

        // [Enhancement 13] Step timestamp
        const stepTimestamp = step.duration !== undefined ? `<span class="step-ts" title="Step duration">${formatDuration(step.duration)}</span>` : '';

        return `
          <div class="step" data-status="${step.status}" data-index="${stepIdx}">
            <div class="step-row">
              <span class="step-icon" style="color:${statusColor(step.status)}">${statusIcon(step.status)}</span>
              <span class="step-keyword">${esc(step.keyword || '')}</span>
              <span class="step-name">${esc(step.name)}</span>
              ${stepTimestamp}
            </div>
            ${errorHtml}
            ${screenshotFile ? `<div class="step-screenshot"><img src="${screenshotFile}" alt="Step ${stepIdx + 1}" loading="lazy" onclick="event.stopPropagation();openLightbox(this.src)"/></div>` : ''}
          </div>`;
      }).join('');

      const tagsHtml = (sc.tags || []).map(t => `<span class="tag" data-tag="${esc(t)}">${esc(t)}</span>`).join('');

      // [Enhancement 2] Duration timeline bar
      const maxStepDuration = Math.max(...sc.steps.map(s => s.duration || 0), 1);
      const timelineHtml = `
        <div class="step-timeline">
          ${sc.steps.map((step) => {
            const pct = Math.max(((step.duration || 0) / maxStepDuration) * 100, 8);
            return `<div class="tl-bar" style="height:${pct}%;background:${statusColor(step.status)}" title="${esc(step.keyword || '')} ${esc(step.name)}: ${step.duration ? formatDuration(step.duration) : 'N/A'}"></div>`;
          }).join('')}
        </div>`;

      // [Enhancement 10] Screenshot gallery
      const galleryHtml = scenarioScreenshots.length > 0 ? `
        <div class="screenshot-gallery" id="gallery-${idx}">
          <div class="gallery-header" onclick="event.stopPropagation();document.getElementById('gallery-${idx}').classList.toggle('open')">
            &#128247; Screenshots (${scenarioScreenshots.length}) <span class="gallery-toggle">&#9660;</span>
          </div>
          <div class="gallery-grid">
            ${scenarioScreenshots.map((f, i) => `<img src="${f}" alt="Screenshot ${i + 1}" loading="lazy" onclick="event.stopPropagation();openLightbox(this.src)"/>`).join('')}
          </div>
        </div>` : '';

      return `
        <div class="scenario-card" data-status="${sc.status}" data-tags="${(sc.tags || []).join(' ')}" data-name="${esc(sc.name.toLowerCase())}">
          <div class="scenario-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <div class="scenario-title">
              <span class="scenario-status" style="background:${statusColor(sc.status)}">${statusIcon(sc.status)}</span>
              <span class="scenario-number">#${idx + 1}</span>
              <span class="scenario-name">${esc(sc.name)}</span>
              ${tagsHtml}
            </div>
            <div class="scenario-meta">
              <span class="scenario-duration">${formatDuration(sc.duration)}</span>
              <span class="scenario-step-count">${sc.steps.length} steps</span>
              <span class="collapse-icon">&#9660;</span>
            </div>
          </div>
          <div class="scenario-body">
            ${timelineHtml}
            ${stepsHtml}
            ${galleryHtml}
          </div>
        </div>`;
    }).join('');

    // Failure categories HTML
    const categoriesHtml = failureCategories.size > 0 ? `
      <div class="section">
        <h2>&#128308; Failure Categories</h2>
        <div class="categories-grid">
          ${Array.from(failureCategories.entries()).map(([cat, count]) => `
            <div class="category-item">
              <span class="category-name">${esc(cat)}</span>
              <span class="category-count">${count}</span>
            </div>
          `).join('')}
        </div>
      </div>` : '';

    // [Enhancement 4] Retry/Flaky info
    const retryHtml = metadata.retryInfo && metadata.retryInfo.totalRetries > 0 ? `
      <div class="section">
        <h2>&#128260; Retry / Flaky Tests</h2>
        <div class="retry-grid">
          <div class="retry-stat"><span class="retry-num">${metadata.retryInfo.totalRetries}</span><span class="retry-lbl">Total Retries</span></div>
          <div class="retry-stat"><span class="retry-num">${metadata.retryInfo.flakyScenarios.length}</span><span class="retry-lbl">Flaky Scenarios</span></div>
          <div class="retry-stat"><span class="retry-num">${metadata.retryInfo.retriedScenarios.length}</span><span class="retry-lbl">Retried Scenarios</span></div>
        </div>
        ${metadata.retryInfo.retriedScenarios.length > 0 ? `
          <div class="retry-list">
            <strong>Retried:</strong> ${metadata.retryInfo.retriedScenarios.map(s => `<span class="retry-name">${esc(s)}</span>`).join(', ')}
          </div>` : ''}
        ${metadata.retryInfo.flakyScenarios.length > 0 ? `
          <div class="retry-list flaky">
            <strong>Flaky:</strong> ${metadata.retryInfo.flakyScenarios.map(s => `<span class="retry-name flaky">${esc(s)}</span>`).join(', ')}
          </div>` : ''}
      </div>` : '';

    // [Enhancement 9] Browser console errors
    const consoleErrorsHtml = metadata.consoleErrors && metadata.consoleErrors.length > 0 ? `
      <div class="section">
        <h2>&#9888;&#65039; Browser Console Errors (${metadata.consoleErrors.length})</h2>
        <div class="console-errors">
          ${metadata.consoleErrors.map(e => `<div class="console-error">${esc(e)}</div>`).join('')}
        </div>
      </div>` : '';

    // Environment info
    const envEntries: [string, string][] = [];
    if (metadata.browser) envEntries.push(['Browser', metadata.browser]);
    if (metadata.environment) envEntries.push(['Environment', metadata.environment]);
    if (metadata.featureName) envEntries.push(['Feature', metadata.featureName]);
    envEntries.push(['Platform', process.platform]);
    envEntries.push(['Node Version', process.version]);
    envEntries.push(['Run ID', runId.substring(0, 8)]);
    if (metadata.executionStartTime) envEntries.push(['Started', new Date(metadata.executionStartTime).toLocaleString()]);
    envEntries.push(['Completed', new Date().toLocaleString()]);

    const envHtml = `
      <div class="env-grid">
        ${envEntries.map(([k, v]) => `<div class="env-item"><span class="env-key">${esc(k)}</span><span class="env-val">${esc(v)}</span></div>`).join('')}
      </div>`;

    // [Enhancement 11] Feature description
    const descriptionHtml = metadata.description ? `
      <div class="section feature-desc">
        <h2>&#128221; Feature Description</h2>
        <p>${esc(metadata.description).replace(/\n/g, '<br/>')}</p>
      </div>` : '';

    // [Enhancement 3] Tag filter buttons
    const tagFilterHtml = allTags.size > 0 ? `
      <div class="tag-filters">
        <span class="tag-filter-label">Filter by tag:</span>
        ${Array.from(allTags).map(t => `<button class="tag-filter-btn" onclick="filterByTag('${esc(t)}',this)">${esc(t)}</button>`).join('')}
        <button class="tag-filter-btn tag-clear" onclick="filterByTag('',this)">Clear</button>
      </div>` : '';

    return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BDD Test Report — ${esc(runId.substring(0, 8))}</title>
  <style>
    :root {
      --green: #10b981; --red: #ef4444; --yellow: #f59e0b; --gray: #94a3b8;
      --bg: #f8fafc; --card: #ffffff; --text: #1e293b; --muted: #64748b;
      --border: #e2e8f0; --radius: 8px; --accent: #667eea;
    }
    [data-theme="dark"] {
      --bg: #0f172a; --card: #1e293b; --text: #e2e8f0; --muted: #94a3b8;
      --border: #334155; --green: #34d399; --red: #f87171; --yellow: #fbbf24; --gray: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; transition: background .3s, color .3s; }

    /* Header */
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px 0; }
    .header-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; align-items: center; gap: 16px; }
    .header img { height: 44px; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header .subtitle { opacity: 0.85; font-size: 12px; margin-top: 2px; }
    .header-actions { margin-left: auto; display: flex; gap: 8px; }
    .header-btn { background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.3); color: white; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: background .2s; }
    .header-btn:hover { background: rgba(255,255,255,.35); }

    /* Container */
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

    /* Summary Cards */
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 24px; flex: 1; min-width: 280px; }
    .summary-card { background: var(--bg); border-radius: var(--radius); padding: 14px 12px; text-align: center; border-top: 3px solid var(--border); }
    .summary-card .num { font-size: 24px; font-weight: 700; }
    .summary-card .lbl { font-size: 10px; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .5px; }

    /* Donut chart [Enhancement 1] */
    .donut-section { display: flex; align-items: center; gap: 32px; margin-bottom: 24px; flex-wrap: wrap; background: var(--card); border-radius: var(--radius); padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .donut-container { position: relative; width: 160px; height: 160px; flex-shrink: 0; }
    .donut-container svg { transform: rotate(-90deg); }
    .donut-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); text-align: center; }
    .donut-center .pct { font-size: 28px; font-weight: 700; }
    .donut-center .pct-lbl { font-size: 11px; color: var(--muted); }
    .donut-legend { display: flex; flex-direction: column; gap: 6px; }
    .donut-legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .donut-legend-dot { width: 12px; height: 12px; border-radius: 3px; }

    /* Progress bar */
    .progress-bar { height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; margin: 0 0 16px; display: flex; }
    .progress-segment { height: 100%; transition: width .3s; }

    /* Search [Enhancement 8] */
    .search-bar { margin-bottom: 12px; }
    .search-bar input { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; background: var(--card); color: var(--text); outline: none; }
    .search-bar input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(102,126,234,.15); }

    /* Filter bar */
    .filter-bar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .filter-btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: 20px; background: var(--card); color: var(--text); cursor: pointer; font-size: 12px; transition: all .2s; }
    .filter-btn:hover, .filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

    /* Tag filters [Enhancement 3] */
    .tag-filters { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
    .tag-filter-label { font-size: 12px; color: var(--muted); margin-right: 4px; }
    .tag-filter-btn { padding: 3px 10px; border: 1px solid #c4b5fd; border-radius: 12px; background: #ede9fe; color: #6366f1; cursor: pointer; font-size: 11px; transition: all .2s; }
    .tag-filter-btn:hover, .tag-filter-btn.active { background: #6366f1; color: white; }
    .tag-filter-btn.tag-clear { background: var(--card); color: var(--muted); border-color: var(--border); }
    [data-theme="dark"] .tag-filter-btn { background: #312e81; color: #a5b4fc; border-color: #4338ca; }

    /* Sections */
    .section { margin-bottom: 24px; background: var(--card); border-radius: var(--radius); padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .section h2 { font-size: 15px; margin-bottom: 12px; color: var(--text); }

    /* Feature description [Enhancement 11] */
    .feature-desc p { font-size: 13px; color: var(--muted); line-height: 1.7; }

    /* Scenario cards */
    .scenario-card { background: var(--card); border-radius: var(--radius); margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.06); overflow: hidden; border-left: 4px solid var(--border); }
    .scenario-card[data-status="passed"] { border-left-color: var(--green); }
    .scenario-card[data-status="failed"] { border-left-color: var(--red); }
    .scenario-card[data-status="skipped"], .scenario-card[data-status="pending"] { border-left-color: var(--gray); }

    .scenario-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; cursor: pointer; user-select: none; }
    .scenario-header:hover { background: rgba(0,0,0,.02); }
    [data-theme="dark"] .scenario-header:hover { background: rgba(255,255,255,.03); }
    .scenario-title { display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap; }
    .scenario-status { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; color: white; font-size: 12px; flex-shrink: 0; }
    .scenario-number { font-size: 12px; color: var(--muted); }
    .scenario-name { font-weight: 600; font-size: 14px; }
    .scenario-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted); }
    .collapse-icon { transition: transform .2s; font-size: 10px; }
    .scenario-card.collapsed .collapse-icon { transform: rotate(-90deg); }
    .scenario-card.collapsed .scenario-body { display: none; }

    .scenario-body { padding: 4px 16px 16px; }

    /* Step timeline [Enhancement 2] */
    .step-timeline { display: flex; gap: 3px; margin: 4px 0 14px; padding: 8px 12px; align-items: flex-end; height: 40px; background: var(--bg); border-radius: 6px; }
    .tl-bar { flex: 1; border-radius: 3px 3px 0 0; min-height: 4px; opacity: .85; transition: all .2s; cursor: pointer; position: relative; }
    .tl-bar:hover { opacity: 1; filter: brightness(1.1); transform: scaleY(1.15); transform-origin: bottom; }

    /* Steps */
    .step { display: flex; align-items: baseline; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .step:last-child { border-bottom: none; }
    .step-row { display: flex; align-items: baseline; gap: 8px; width: 100%; }
    .step-icon { width: 20px; text-align: center; flex-shrink: 0; font-weight: 700; font-size: 13px; }
    .step-keyword { font-weight: 600; color: #6366f1; font-size: 13px; min-width: 56px; flex-shrink: 0; }
    [data-theme="dark"] .step-keyword { color: #a5b4fc; }
    .step-name { flex: 1; font-size: 13px; min-width: 0; }
    .step-ts { font-size: 11px; color: var(--muted); min-width: 55px; text-align: right; flex-shrink: 0; white-space: nowrap; }

    /* Error [Enhancement 14, 15] */
    .step-error { width: calc(100% - 28px); margin-top: 6px; margin-left: 28px; border-radius: 6px; overflow: hidden; border: 1px solid #fecaca; }
    [data-theme="dark"] .step-error { border-color: #7f1d1d; }
    .error-header { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #fef2f2; font-size: 12px; color: #991b1b; cursor: pointer; user-select: none; }
    [data-theme="dark"] .error-header { background: #450a0a; color: #fca5a5; }
    .error-toggle { font-size: 10px; transition: transform .2s; }
    .step-error.collapsed .error-toggle { transform: rotate(-90deg); }
    .step-error.collapsed .error-body { display: none; }
    .error-body { padding: 8px 12px; background: #fff5f5; font-size: 11px; color: #7f1d1d; word-break: break-word; white-space: pre-wrap; max-height: 300px; overflow-y: auto; font-family: 'SF Mono', Consolas, monospace; }
    [data-theme="dark"] .error-body { background: #1c0a0a; color: #fca5a5; }
    .copy-btn { margin-left: auto; padding: 2px 8px; border: 1px solid #fca5a5; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; font-size: 11px; }
    .copy-btn:hover { background: rgba(0,0,0,.05); }
    .copy-btn.copied { background: var(--green); color: white; border-color: var(--green); }

    /* Screenshots */
    .step-screenshot { width: calc(100% - 28px); margin-top: 6px; margin-left: 28px; }
    .step-screenshot img { max-width: 350px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; transition: max-width .3s; }
    .step-screenshot img:hover { box-shadow: 0 4px 12px rgba(0,0,0,.15); }

    /* Screenshot gallery [Enhancement 10] */
    .screenshot-gallery { margin-top: 14px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--bg); }
    .gallery-header { padding: 10px 14px; background: var(--bg); cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text); user-select: none; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); }
    .gallery-header:hover { background: rgba(102,126,234,.05); }
    [data-theme="dark"] .gallery-header { background: rgba(255,255,255,.03); }
    .gallery-toggle { font-size: 10px; transition: transform .2s; margin-left: auto; }
    .screenshot-gallery:not(.open) .gallery-grid { display: none; }
    .screenshot-gallery:not(.open) .gallery-header { border-bottom: none; }
    .screenshot-gallery:not(.open) .gallery-toggle { transform: rotate(-90deg); }
    .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; padding: 12px; }
    .gallery-grid img { width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; transition: all .2s; }
    .gallery-grid img:hover { transform: scale(1.02); box-shadow: 0 4px 16px rgba(0,0,0,.2); border-color: var(--accent); }

    /* Lightbox */
    .lightbox { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,.85); z-index: 1000; justify-content: center; align-items: center; cursor: pointer; }
    .lightbox.active { display: flex; }
    .lightbox img { max-width: 90%; max-height: 90%; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
    .lightbox-close { position: absolute; top: 20px; right: 24px; color: white; font-size: 28px; cursor: pointer; }

    /* Tags */
    .tag { display: inline-block; padding: 2px 8px; background: #ede9fe; color: #6366f1; border-radius: 10px; font-size: 11px; }
    [data-theme="dark"] .tag { background: #312e81; color: #a5b4fc; }

    /* Environment */
    .env-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .env-item { display: flex; justify-content: space-between; padding: 8px 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; }
    .env-key { color: var(--muted); }
    .env-val { font-weight: 500; }

    /* Categories */
    .categories-grid { display: flex; gap: 8px; flex-wrap: wrap; }
    .category-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: #fef2f2; border-radius: var(--radius); font-size: 13px; }
    [data-theme="dark"] .category-item { background: #450a0a; }
    .category-name { color: #991b1b; }
    [data-theme="dark"] .category-name { color: #fca5a5; }
    .category-count { background: #ef4444; color: white; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }

    /* Retry/Flaky [Enhancement 4] */
    .retry-grid { display: flex; gap: 16px; margin-bottom: 12px; }
    .retry-stat { text-align: center; padding: 12px 20px; background: rgba(251,191,36,.1); border-radius: var(--radius); border: 1px solid rgba(251,191,36,.3); }
    .retry-num { display: block; font-size: 24px; font-weight: 700; color: var(--yellow); }
    .retry-lbl { font-size: 11px; color: var(--muted); }
    .retry-list { margin-top: 8px; font-size: 13px; }
    .retry-name { padding: 2px 8px; background: rgba(251,191,36,.15); border-radius: 4px; font-size: 12px; }
    .retry-name.flaky { background: rgba(239,68,68,.15); color: var(--red); }

    /* Console errors [Enhancement 9] */
    .console-errors { max-height: 300px; overflow-y: auto; }
    .console-error { padding: 6px 12px; margin-bottom: 4px; background: #fef2f2; border-left: 3px solid var(--red); border-radius: 0 4px 4px 0; font-size: 12px; font-family: 'SF Mono', Consolas, monospace; color: #991b1b; word-break: break-word; }
    [data-theme="dark"] .console-error { background: #450a0a; color: #fca5a5; }


    /* Steps summary */
    .steps-summary { display: flex; gap: 16px; font-size: 13px; color: var(--muted); margin-bottom: 16px; }
    .steps-summary span { display: flex; align-items: center; gap: 4px; }
    .steps-summary .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

    /* Footer */
    footer { text-align: center; padding: 32px 0; font-size: 12px; color: var(--muted); }

    /* Print */
    @media print { .filter-bar, .search-bar, .tag-filters, .header-actions { display: none; } .scenario-card.collapsed .scenario-body { display: block; } }
    @media (max-width: 768px) { .donut-section { flex-direction: column; align-items: center; } .summary-grid { grid-template-columns: repeat(3, 1fr); } }
  </style>
</head>
<body>
  <!-- Lightbox overlay -->
  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <span class="lightbox-close">&times;</span>
    <img id="lightbox-img" src="" alt="Screenshot"/>
  </div>

  <div class="header">
    <div class="header-inner">
      <img src="playwright-crx-logo.png" alt="Logo" onerror="this.style.display='none'"/>
      <div>
        <h1>BDD Test Report</h1>
        <div class="subtitle">${esc(metadata.featureName || metadata.suiteName || 'Test Execution')} &mdash; Run: ${esc(runId.substring(0, 8))} &nbsp;|&nbsp; ${new Date().toLocaleString()}</div>
      </div>
      <div class="header-actions">
        <button class="header-btn" onclick="toggleTheme()">&#127763; Dark Mode</button>
        <button class="header-btn" onclick="exportPDF()">&#128196; PDF</button>
        <button class="header-btn" onclick="exportJSON()">&#128190; JSON</button>
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Donut Chart + Summary [Enhancement 1] -->
    <div class="donut-section">
      <div class="donut-container">
        <svg viewBox="0 0 160 160" width="160" height="160">
          ${this.buildDonutSegments(passed, failed, broken, skipped, totalScenarios)}
        </svg>
        <div class="donut-center">
          <div class="pct">${passRate}%</div>
          <div class="pct-lbl">Pass Rate</div>
        </div>
      </div>
      <div>
        <div class="summary-grid" style="margin-bottom:0">
          <div class="summary-card"><div class="num">${totalScenarios}</div><div class="lbl">Scenarios</div></div>
          <div class="summary-card"><div class="num" style="color:var(--green)">${passed}</div><div class="lbl">Passed</div></div>
          <div class="summary-card"><div class="num" style="color:var(--red)">${failed}</div><div class="lbl">Failed</div></div>
          <div class="summary-card"><div class="num" style="color:var(--yellow)">${broken}</div><div class="lbl">Broken</div></div>
          <div class="summary-card"><div class="num" style="color:var(--gray)">${skipped}</div><div class="lbl">Skipped</div></div>
          <div class="summary-card"><div class="num">${formatDuration(totalDuration)}</div><div class="lbl">Duration</div></div>
        </div>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-segment" style="width:${totalScenarios ? (passed/totalScenarios)*100 : 0}%;background:var(--green)"></div>
      <div class="progress-segment" style="width:${totalScenarios ? (failed/totalScenarios)*100 : 0}%;background:var(--red)"></div>
      <div class="progress-segment" style="width:${totalScenarios ? (broken/totalScenarios)*100 : 0}%;background:var(--yellow)"></div>
      <div class="progress-segment" style="width:${totalScenarios ? (skipped/totalScenarios)*100 : 0}%;background:var(--gray)"></div>
    </div>

    <!-- Steps summary -->
    <div class="steps-summary">
      <span>Steps: <strong>${allSteps.length}</strong></span>
      <span><span class="dot" style="background:var(--green)"></span> ${stepsPassed} passed</span>
      <span><span class="dot" style="background:var(--red)"></span> ${stepsFailed} failed</span>
      <span><span class="dot" style="background:var(--gray)"></span> ${stepsSkipped} skipped</span>
    </div>

    ${descriptionHtml}
    ${categoriesHtml}
    ${retryHtml}
    ${consoleErrorsHtml}


    <!-- Search [Enhancement 8] -->
    <div class="search-bar">
      <input type="text" id="scenarioSearch" placeholder="&#128269; Search scenarios by name..." oninput="searchScenarios(this.value)"/>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar">
      <button class="filter-btn active" onclick="filterScenarios('all',this)">All (${totalScenarios})</button>
      <button class="filter-btn" onclick="filterScenarios('passed',this)">Passed (${passed})</button>
      <button class="filter-btn" onclick="filterScenarios('failed',this)">Failed (${failed})</button>
      ${broken > 0 ? `<button class="filter-btn" onclick="filterScenarios('broken',this)">Broken (${broken})</button>` : ''}
      ${skipped > 0 ? `<button class="filter-btn" onclick="filterScenarios('skipped',this)">Skipped (${skipped})</button>` : ''}
    </div>

    ${tagFilterHtml}

    <!-- Scenarios -->
    <div id="scenarios">
      ${scenarioCards || '<p style="color:var(--muted);">No test results available.</p>'}
    </div>

    <!-- Environment -->
    <div class="section">
      <h2>&#9881;&#65039; Environment</h2>
      ${envHtml}
    </div>

    <footer>
      Generated by Playwright CRX &mdash; BDD Report &mdash; ${new Date().toISOString()}
    </footer>
  </div>

  <script>
    // [Enhancement 6] Dark mode toggle
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
      localStorage.setItem('bdd-report-theme', html.getAttribute('data-theme'));
    }
    // Restore theme
    const savedTheme = localStorage.getItem('bdd-report-theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    // Filter by status
    let currentFilter = 'all';
    function filterScenarios(status, btn) {
      currentFilter = status;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      applyFilters();
    }

    // [Enhancement 3] Filter by tag
    let currentTag = '';
    function filterByTag(tag, btn) {
      currentTag = tag;
      document.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.remove('active'));
      if (tag && btn) btn.classList.add('active');
      applyFilters();
    }

    // [Enhancement 8] Search scenarios
    let currentSearch = '';
    function searchScenarios(query) {
      currentSearch = query.toLowerCase();
      applyFilters();
    }

    function applyFilters() {
      document.querySelectorAll('.scenario-card').forEach(card => {
        const matchStatus = currentFilter === 'all' || card.dataset.status === currentFilter;
        const matchTag = !currentTag || (card.dataset.tags || '').includes(currentTag);
        const matchSearch = !currentSearch || (card.dataset.name || '').includes(currentSearch);
        card.style.display = (matchStatus && matchTag && matchSearch) ? '' : 'none';
      });
    }

    // [Enhancement 15] Copy error
    function copyError(btn) {
      const text = btn.getAttribute('data-error').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '&#10004; Copied';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '&#128203; Copy'; }, 2000);
      });
    }

    // Lightbox
    function openLightbox(src) {
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox').classList.add('active');
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('active');
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

    // [Enhancement 7] Export PDF
    function exportPDF() { window.print(); }

    // [Enhancement 7] Export JSON
    function exportJSON() {
      fetch('report-data.json').then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'bdd-report-${runId.substring(0, 8)}.json'; a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Auto-collapse passed scenarios when there are failures
    if (${failed} > 0) {
      document.querySelectorAll('.scenario-card[data-status="passed"]').forEach(card => card.classList.add('collapsed'));
    }

  </script>
</body>
</html>`;
  }

  // Helper: build SVG donut segments
  private buildDonutSegments(passed: number, failed: number, broken: number, skipped: number, total: number): string {
    if (total === 0) {
      return `<circle cx="80" cy="80" r="60" fill="none" stroke="#e2e8f0" stroke-width="20"/>`;
    }
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    const segments = [
      { value: passed, color: '#10b981' },
      { value: failed, color: '#ef4444' },
      { value: broken, color: '#f59e0b' },
      { value: skipped, color: '#94a3b8' },
    ].filter(s => s.value > 0);

    let offset = 0;
    return segments.map(seg => {
      const pct = seg.value / total;
      const dashLen = pct * circumference;
      const dashGap = circumference - dashLen;
      const svg = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${seg.color}" stroke-width="20" stroke-dasharray="${dashLen} ${dashGap}" stroke-dashoffset="${-offset}" stroke-linecap="butt"/>`;
      offset += dashLen;
      return svg;
    }).join('');
  }

  // =========================================================================
  // Utility
  // =========================================================================
  private mapStatus(s: string): 'passed' | 'failed' | 'broken' | 'skipped' {
    const lower = (s || '').toLowerCase();
    if (lower === 'passed') return 'passed';
    if (lower === 'failed') return 'failed';
    if (lower === 'skipped' || lower === 'pending' || lower === 'undefined') return 'skipped';
    return 'broken';
  }
}

export const bddReportService = new BddReportService();

// Backward-compatible aliases
export const playwrightCrxService = bddReportService;
export const allureService = bddReportService;
