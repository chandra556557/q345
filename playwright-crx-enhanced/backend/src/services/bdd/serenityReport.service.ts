import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';

const API_BASE_URL = process.env.API_BASE_URL || '';

export interface SerenityReportData {
  runId: string;
  featureName: string;
  featureDescription: string;
  featureContent: string;
  featureTags: string[];
  scenarios: SerenityScenarioReport[];
  stepResults: SerenityStepResult[];
  summary: {
    status: string;
    duration: number;
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    errorMsg: string;
  };
  screenshotUrls: string[];
  narrative?: {
    asA: string;
    iWantTo: string;
    soThat: string;
  };
  screenplayTasks?: ScreenplayTaskReport[];
}

export interface SerenityScenarioReport {
  name: string;
  type: string;
  tags: string[];
  status: string;
  duration: number;
  steps: SerenityStepResult[];
}

export interface SerenityStepResult {
  keyword: string;
  name: string;
  status: string;
  duration?: number;
  errorMessage?: string;
  screenshotUrl?: string;
  task?: string;
  action?: string;
}

export interface ScreenplayTaskReport {
  taskName: string;
  actorName: string;
  actions: { name: string; status: string; duration?: number }[];
  status: string;
}

function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeCssClass(str: string | undefined | null): string {
  if (!str) return '';
  return String(str).replace(/[^a-zA-Z0-9_-]/g, '');
}

function parseNarrative(featureContent: string): { asA: string; iWantTo: string; soThat: string } | undefined {
  const lines = featureContent.split('\n').map(l => l.trim());
  let asA = '', iWantTo = '', soThat = '';

  for (const line of lines) {
    if (line.toLowerCase().startsWith('as a') || line.toLowerCase().startsWith('as an')) {
      asA = line;
    } else if (line.toLowerCase().startsWith('i want')) {
      iWantTo = line;
    } else if (line.toLowerCase().startsWith('so that')) {
      soThat = line;
    }
  }

  if (asA || iWantTo || soThat) {
    return { asA, iWantTo, soThat };
  }
  return undefined;
}

function groupStepsByScenario(
  featureContent: string,
  stepResults: SerenityStepResult[]
): SerenityScenarioReport[] {
  const scenarios: SerenityScenarioReport[] = [];
  const lines = featureContent.split('\n').map(l => l.trim());

  // Extract scenario names from feature
  const scenarioNames: { name: string; type: string; tags: string[] }[] = [];
  let pendingTags: string[] = [];

  for (const line of lines) {
    if (line.startsWith('@')) {
      pendingTags.push(...line.split(/\s+/).filter(t => t.startsWith('@')));
    } else if (line.startsWith('Scenario Outline:') || line.startsWith('Scenario Template:')) {
      scenarioNames.push({
        name: line.replace(/Scenario (Outline|Template):/, '').trim(),
        type: 'Scenario Outline',
        tags: [...pendingTags],
      });
      pendingTags = [];
    } else if (line.startsWith('Scenario:')) {
      scenarioNames.push({
        name: line.replace('Scenario:', '').trim(),
        type: 'Scenario',
        tags: [...pendingTags],
      });
      pendingTags = [];
    } else if (!line.startsWith('Feature:') && !line.startsWith('#') && line !== '') {
      // Reset tags if we hit a non-tag, non-scenario line (unless it's a description)
    }
  }

  if (scenarioNames.length === 0) {
    // Single implicit scenario
    return [{
      name: 'Test Execution',
      type: 'Scenario',
      tags: [],
      status: stepResults.some(s => s.status === 'failed') ? 'failed' : 'passed',
      duration: stepResults.reduce((sum, s) => sum + (s.duration || 0), 0),
      steps: stepResults,
    }];
  }

  // Distribute steps across scenarios
  let stepIdx = 0;
  for (const scenarioInfo of scenarioNames) {
    const scenarioSteps: SerenityStepResult[] = [];
    // Each scenario consumes steps until the next scenario's steps start
    // Simple heuristic: count Given keywords to detect scenario boundaries
    let foundFirst = false;
    while (stepIdx < stepResults.length) {
      const step = stepResults[stepIdx];
      if (foundFirst && (step.keyword === 'Given' || step.keyword === 'Background')) {
        // Might be the start of a new scenario - check if there are more scenarios
        if (scenarios.length < scenarioNames.length - 1) break;
      }
      scenarioSteps.push(step);
      if (step.keyword === 'Given') foundFirst = true;
      stepIdx++;
    }

    scenarios.push({
      name: scenarioInfo.name,
      type: scenarioInfo.type,
      tags: scenarioInfo.tags,
      status: scenarioSteps.some(s => s.status === 'failed') ? 'failed'
        : scenarioSteps.some(s => s.status === 'skipped' || s.status === 'undefined') ? 'compromised'
        : 'passed',
      duration: scenarioSteps.reduce((sum, s) => sum + (s.duration || 0), 0),
      steps: scenarioSteps,
    });
  }

  // If there are remaining steps, add them to the last scenario
  if (stepIdx < stepResults.length && scenarios.length > 0) {
    const last = scenarios[scenarios.length - 1];
    while (stepIdx < stepResults.length) {
      last.steps.push(stepResults[stepIdx]);
      if (stepResults[stepIdx].status === 'failed') last.status = 'failed';
      stepIdx++;
    }
  }

  return scenarios;
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'passed': return '&#10004;';
    case 'failed': return '&#10008;';
    case 'skipped': case 'undefined': return '&#9679;';
    case 'compromised': return '&#9888;';
    default: return '&#8226;';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'passed': return '#2e7d32';
    case 'failed': return '#c62828';
    case 'compromised': return '#e65100';
    case 'skipped': case 'undefined': return '#757575';
    default: return '#333';
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export async function generateSerenityReport(data: SerenityReportData, reportsDir: string): Promise<string> {
  try {
    const reportDir = path.join(reportsDir, `bdd-${data.runId}`);
    await fs.promises.mkdir(reportDir, { recursive: true });

    const narrative = data.narrative || parseNarrative(data.featureContent);
    const scenarios = data.scenarios.length > 0
      ? data.scenarios
      : groupStepsByScenario(data.featureContent, data.stepResults);

    const passRate = data.summary.totalSteps > 0
      ? Math.round((data.summary.passedSteps / data.summary.totalSteps) * 100)
      : 0;

    const scenariosPassed = scenarios.filter(s => s.status === 'passed').length;
    const scenariosFailed = scenarios.filter(s => s.status === 'failed').length;
    const scenariosCompromised = scenarios.filter(s => s.status === 'compromised').length;

    // Timeline data for the donut chart
    const passedPct = data.summary.totalSteps > 0 ? (data.summary.passedSteps / data.summary.totalSteps * 100) : 0;
    const failedPct = data.summary.totalSteps > 0 ? (data.summary.failedSteps / data.summary.totalSteps * 100) : 0;
    const skippedPct = data.summary.totalSteps > 0 ? (data.summary.skippedSteps / data.summary.totalSteps * 100) : 0;

    // Scenario timeline
    const scenarioTimelineHtml = scenarios.map((s) => {
      const barWidth = s.duration > 0 && data.summary.duration > 0
        ? Math.max(5, Math.round(s.duration / data.summary.duration * 100))
        : 10;
      return `
        <div class="timeline-row">
          <div class="timeline-label">${escapeHtml(s.name)}</div>
          <div class="timeline-bar-container">
            <div class="timeline-bar" style="width:${barWidth}%;background:${getStatusColor(s.status)}"></div>
          </div>
          <div class="timeline-duration">${formatDuration(s.duration)}</div>
        </div>`;
    }).join('');

    // Scenario cards
    const scenarioCardsHtml = scenarios.map((scenario) => {
      const stepsHtml = scenario.steps.map((step, idx) => {
        const statusColor = getStatusColor(step.status);
        const icon = getStatusEmoji(step.status);
        const taskBadge = step.task ? `<span class="task-badge">${escapeHtml(step.task)}</span>` : '';
        const actionBadge = step.action ? `<span class="action-badge">${escapeHtml(step.action)}</span>` : '';
        return `
          <div class="step-row ${safeCssClass(step.status)}">
            <span class="step-number">${idx + 1}</span>
            <span class="step-icon" style="color:${statusColor}">${icon}</span>
            <span class="step-keyword">${escapeHtml(step.keyword)}</span>
            <span class="step-text">${escapeHtml(step.name)}</span>
            ${taskBadge}${actionBadge}
            <span class="step-duration">${formatDuration(step.duration)}</span>
            ${step.errorMessage ? `<div class="step-error"><pre>${escapeHtml(String(step.errorMessage).substring(0, 2000))}</pre></div>` : ''}
            ${step.screenshotUrl ? `<div class="step-screenshot"><a href="${API_BASE_URL}${step.screenshotUrl}" target="_blank"><img src="${API_BASE_URL}${step.screenshotUrl}" alt="Screenshot" /></a></div>` : ''}
          </div>`;
      }).join('');

      const tagsHtml = scenario.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');

      return `
        <div class="scenario-card">
          <div class="scenario-header" onclick="this.parentElement.classList.toggle('expanded')">
            <div class="scenario-title">
              <span class="scenario-icon" style="color:${getStatusColor(scenario.status)}">${getStatusEmoji(scenario.status)}</span>
              <span class="scenario-type">${escapeHtml(scenario.type)}</span>
              <span class="scenario-name">${escapeHtml(scenario.name)}</span>
              ${tagsHtml}
            </div>
            <div class="scenario-meta">
              <span class="scenario-status" style="color:${getStatusColor(scenario.status)}">${scenario.status.toUpperCase()}</span>
              <span class="scenario-duration">${formatDuration(scenario.duration)}</span>
              <span class="scenario-step-count">${scenario.steps.length} steps</span>
              <span class="expand-icon">&#9660;</span>
            </div>
          </div>
          <div class="scenario-body">
            ${stepsHtml}
          </div>
        </div>`;
    }).join('');

    // Screenplay Tasks section
    const screenplayHtml = data.screenplayTasks && data.screenplayTasks.length > 0 ? `
      <div class="section">
        <h2 class="section-title">
          <span class="section-icon">&#127917;</span>
          Screenplay Tasks
        </h2>
        <div class="screenplay-tasks">
          ${data.screenplayTasks.map(task => `
            <div class="task-card ${safeCssClass(task.status)}">
              <div class="task-header">
                <span class="task-icon">${getStatusEmoji(task.status)}</span>
                <span class="task-actor">${escapeHtml(task.actorName)}</span>
                <span class="task-performs">performs</span>
                <span class="task-name">${escapeHtml(task.taskName)}</span>
              </div>
              <div class="task-actions">
                ${task.actions.map(a => `
                  <div class="action-row ${safeCssClass(a.status)}">
                    <span class="action-icon" style="color:${getStatusColor(a.status)}">${getStatusEmoji(a.status)}</span>
                    <span class="action-name">${escapeHtml(a.name)}</span>
                    ${a.duration ? `<span class="action-duration">${formatDuration(a.duration)}</span>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : '';

    // Screenshots section
    const screenshotsHtml = data.screenshotUrls.length > 0 ? `
      <div class="section">
        <h2 class="section-title">
          <span class="section-icon">&#128247;</span>
          Failure Screenshots (${data.screenshotUrls.length})
        </h2>
        <div class="screenshots-grid">
          ${data.screenshotUrls.map((url, i) => `
            <div class="screenshot-card">
              <a href="${API_BASE_URL}${url}" target="_blank">
                <img src="${API_BASE_URL}${url}" alt="Screenshot ${i + 1}" />
              </a>
              <div class="screenshot-label">Capture ${i + 1}</div>
            </div>
          `).join('')}
        </div>
      </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Serenity BDD Report - ${escapeHtml(data.featureName)}</title>
  <style>
    :root {
      --passed: #2e7d32;
      --failed: #c62828;
      --compromised: #e65100;
      --skipped: #757575;
      --bg: #f8f9fa;
      --card: #ffffff;
      --border: #e8eaed;
      --text: #202124;
      --text-secondary: #5f6368;
      --accent: #1a73e8;
      --accent-dark: #1557b0;
      --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
      --shadow-hover: 0 4px 12px rgba(0,0,0,0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }

    /* Header */
    .report-header { background: linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%); color: white; padding: 32px 40px; position: relative; overflow: hidden; }
    .report-header::after { content: ''; position: absolute; top: 0; right: 0; width: 300px; height: 100%; background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.05) 100%); }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .header-brand { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.7; margin-bottom: 8px; }
    .header-title { font-size: 26px; font-weight: 600; margin-bottom: 4px; }
    .header-subtitle { font-size: 14px; opacity: 0.8; }
    .header-status { padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    .header-status.passed { background: rgba(46,125,50,0.3); border: 1px solid rgba(46,125,50,0.5); }
    .header-status.failed { background: rgba(198,40,40,0.3); border: 1px solid rgba(198,40,40,0.5); }

    /* Narrative */
    .narrative { background: var(--card); border-left: 4px solid var(--accent); margin: 24px 40px; padding: 20px 24px; border-radius: 0 8px 8px 0; box-shadow: var(--shadow); }
    .narrative-title { font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); margin-bottom: 12px; font-weight: 600; }
    .narrative-line { font-size: 15px; color: var(--text); padding: 4px 0; }
    .narrative-line strong { color: var(--accent-dark); }

    /* Container */
    .container { max-width: 1100px; margin: 0 auto; padding: 24px 20px; }

    /* Summary Grid */
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
    .summary-donut-card { background: var(--card); border-radius: 12px; padding: 24px; box-shadow: var(--shadow); display: flex; align-items: center; gap: 24px; }
    .donut-container { position: relative; width: 120px; height: 120px; flex-shrink: 0; }
    .donut-container svg { transform: rotate(-90deg); }
    .donut-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); text-align: center; }
    .donut-center .pct { font-size: 28px; font-weight: 700; color: var(--text); }
    .donut-center .label { font-size: 11px; color: var(--text-secondary); }
    .donut-legend { flex: 1; }
    .legend-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .legend-row:last-child { border-bottom: none; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; }
    .legend-label { font-size: 13px; color: var(--text-secondary); }
    .legend-value { font-size: 14px; font-weight: 600; }

    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .stat-card { background: var(--card); border-radius: 12px; padding: 20px; text-align: center; box-shadow: var(--shadow); transition: transform 0.15s; }
    .stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
    .stat-value { font-size: 32px; font-weight: 700; }
    .stat-label { font-size: 12px; color: var(--text-secondary); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Timeline */
    .section { background: var(--card); border-radius: 12px; box-shadow: var(--shadow); margin-bottom: 24px; overflow: hidden; }
    .section-title { padding: 18px 24px; border-bottom: 1px solid var(--border); font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
    .section-icon { font-size: 18px; }
    .timeline-row { display: flex; align-items: center; padding: 10px 24px; border-bottom: 1px solid var(--border); }
    .timeline-row:last-child { border-bottom: none; }
    .timeline-label { flex: 0 0 200px; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .timeline-bar-container { flex: 1; height: 8px; background: #e8eaed; border-radius: 4px; margin: 0 16px; overflow: hidden; }
    .timeline-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .timeline-duration { flex: 0 0 60px; text-align: right; font-size: 12px; color: var(--text-secondary); }

    /* Scenario Cards */
    .scenario-card { border-bottom: 1px solid var(--border); }
    .scenario-card:last-child { border-bottom: none; }
    .scenario-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; cursor: pointer; transition: background 0.15s; }
    .scenario-header:hover { background: #f1f3f4; }
    .scenario-title { display: flex; align-items: center; gap: 10px; flex: 1; }
    .scenario-icon { font-size: 16px; }
    .scenario-type { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; background: #f1f3f4; padding: 2px 8px; border-radius: 4px; }
    .scenario-name { font-size: 14px; font-weight: 500; }
    .scenario-meta { display: flex; align-items: center; gap: 16px; font-size: 12px; }
    .scenario-status { font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .scenario-duration { color: var(--text-secondary); }
    .scenario-step-count { color: var(--text-secondary); }
    .expand-icon { font-size: 10px; color: var(--text-secondary); transition: transform 0.2s; }
    .scenario-card.expanded .expand-icon { transform: rotate(180deg); }
    .scenario-body { display: none; padding: 0 24px 16px; }
    .scenario-card.expanded .scenario-body { display: block; }
    .tag { display: inline-block; background: #e8f0fe; color: var(--accent); font-size: 11px; padding: 2px 8px; border-radius: 12px; }

    /* Steps */
    .step-row { display: flex; align-items: flex-start; flex-wrap: wrap; padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; font-size: 13px; transition: background 0.15s; }
    .step-row:hover { background: #f8f9fa; }
    .step-row.failed { background: #fef2f2; }
    .step-row.failed:hover { background: #fee2e2; }
    .step-number { flex: 0 0 24px; color: var(--text-secondary); font-size: 11px; padding-top: 1px; }
    .step-icon { flex: 0 0 20px; font-size: 13px; }
    .step-keyword { flex: 0 0 auto; font-weight: 600; color: #5c6bc0; margin-right: 6px; }
    .step-text { flex: 1; color: var(--text); }
    .step-duration { flex: 0 0 60px; text-align: right; color: var(--text-secondary); font-size: 11px; }
    .step-error { width: 100%; margin-top: 8px; padding-left: 44px; }
    .step-error pre { background: #fff5f5; color: #c62828; padding: 10px 14px; border-radius: 6px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; border-left: 3px solid #c62828; }
    .step-screenshot { width: 100%; margin-top: 8px; padding-left: 44px; }
    .step-screenshot img { max-width: 400px; max-height: 250px; border-radius: 6px; border: 1px solid var(--border); }
    .task-badge { background: #f3e8ff; color: #7c3aed; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
    .action-badge { background: #ecfdf5; color: #059669; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 4px; }

    /* Screenplay Tasks */
    .screenplay-tasks { padding: 16px 24px; }
    .task-card { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
    .task-card.passed { border-left: 3px solid var(--passed); }
    .task-card.failed { border-left: 3px solid var(--failed); }
    .task-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #fafbfc; border-bottom: 1px solid var(--border); font-size: 14px; }
    .task-icon { font-size: 14px; }
    .task-actor { font-weight: 600; color: var(--accent); }
    .task-performs { color: var(--text-secondary); font-size: 13px; }
    .task-name { font-weight: 500; }
    .task-actions { padding: 8px 16px; }
    .action-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #f1f3f4; }
    .action-row:last-child { border-bottom: none; }
    .action-icon { font-size: 12px; }
    .action-name { flex: 1; }
    .action-duration { color: var(--text-secondary); font-size: 11px; }

    /* Screenshots */
    .screenshots-grid { display: flex; flex-wrap: wrap; gap: 16px; padding: 16px 24px; }
    .screenshot-card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; transition: transform 0.15s; }
    .screenshot-card:hover { transform: scale(1.02); box-shadow: var(--shadow-hover); }
    .screenshot-card img { max-width: 350px; max-height: 250px; display: block; }
    .screenshot-label { padding: 6px 12px; font-size: 11px; color: var(--text-secondary); background: #fafbfc; }

    /* Feature Content */
    .feature-content { padding: 20px 24px; }
    .feature-content pre { background: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 8px; font-size: 13px; line-height: 1.8; overflow-x: auto; white-space: pre-wrap; }
    .feature-content pre .keyword { color: #89b4fa; font-weight: 600; }
    .feature-content pre .tag { color: #94e2d5; }
    .feature-content pre .string { color: #a6e3a1; }
    .feature-content pre .comment { color: #6c7086; font-style: italic; }

    /* Footer */
    .report-footer { text-align: center; padding: 24px; color: var(--text-secondary); font-size: 12px; border-top: 1px solid var(--border); margin-top: 16px; }
    .report-footer a { color: var(--accent); text-decoration: none; }

    /* Print */
    @media print {
      .report-header { break-after: avoid; }
      .scenario-card { break-inside: avoid; }
      .scenario-body { display: block !important; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="header-brand">Serenity BDD Report</div>
    <div class="header-top">
      <div>
        <div class="header-title">${escapeHtml(data.featureName)}</div>
        <div class="header-subtitle">
          Run ID: ${data.runId.substring(0, 8)} &bull;
          ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} &bull;
          ${formatDuration(data.summary.duration)}
        </div>
      </div>
      <div class="header-status ${safeCssClass(data.summary.status)}">${escapeHtml(data.summary.status).toUpperCase()}</div>
    </div>
    ${data.featureTags.length > 0 ? `<div style="margin-top:8px">${data.featureTags.map(t => `<span class="tag" style="background:rgba(255,255,255,0.15);color:white">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
  </div>

  ${narrative ? `
  <div class="narrative">
    <div class="narrative-title">User Story</div>
    ${narrative.asA ? `<div class="narrative-line"><strong>As a</strong> ${escapeHtml(narrative.asA.replace(/^as an?\s*/i, ''))}</div>` : ''}
    ${narrative.iWantTo ? `<div class="narrative-line"><strong>I want to</strong> ${escapeHtml(narrative.iWantTo.replace(/^i want\s*(to\s*)?/i, ''))}</div>` : ''}
    ${narrative.soThat ? `<div class="narrative-line"><strong>So that</strong> ${escapeHtml(narrative.soThat.replace(/^so that\s*/i, ''))}</div>` : ''}
  </div>` : ''}

  ${data.featureDescription ? `
  <div class="narrative" style="border-left-color: #5c6bc0;">
    <div class="narrative-title">Description</div>
    <div class="narrative-line">${escapeHtml(data.featureDescription)}</div>
  </div>` : ''}

  <div class="container">
    <!-- Summary -->
    <div class="summary-grid">
      <div class="summary-donut-card">
        <div class="donut-container">
          <svg viewBox="0 0 36 36" width="120" height="120">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e8eaed" stroke-width="3"/>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--passed)" stroke-width="3"
              stroke-dasharray="${passedPct} ${100 - passedPct}" stroke-dashoffset="0"/>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--failed)" stroke-width="3"
              stroke-dasharray="${failedPct} ${100 - failedPct}" stroke-dashoffset="${-passedPct}"/>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--skipped)" stroke-width="3"
              stroke-dasharray="${skippedPct} ${100 - skippedPct}" stroke-dashoffset="${-(passedPct + failedPct)}"/>
          </svg>
          <div class="donut-center">
            <div class="pct">${passRate}%</div>
            <div class="label">Pass Rate</div>
          </div>
        </div>
        <div class="donut-legend">
          <div class="legend-row"><span><span class="legend-dot" style="background:var(--passed)"></span><span class="legend-label">Passed</span></span><span class="legend-value" style="color:var(--passed)">${data.summary.passedSteps}</span></div>
          <div class="legend-row"><span><span class="legend-dot" style="background:var(--failed)"></span><span class="legend-label">Failed</span></span><span class="legend-value" style="color:var(--failed)">${data.summary.failedSteps}</span></div>
          <div class="legend-row"><span><span class="legend-dot" style="background:var(--skipped)"></span><span class="legend-label">Skipped</span></span><span class="legend-value" style="color:var(--skipped)">${data.summary.skippedSteps}</span></div>
          <div class="legend-row"><span><span class="legend-dot" style="background:var(--text)"></span><span class="legend-label">Total</span></span><span class="legend-value">${data.summary.totalSteps}</span></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-value" style="color:var(--passed)">${scenariosPassed}</div><div class="stat-label">Scenarios Passed</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--failed)">${scenariosFailed}</div><div class="stat-label">Scenarios Failed</div></div>
          <div class="stat-card"><div class="stat-value" style="color:var(--compromised)">${scenariosCompromised}</div><div class="stat-label">Compromised</div></div>
          <div class="stat-card"><div class="stat-value">${formatDuration(data.summary.duration)}</div><div class="stat-label">Duration</div></div>
        </div>
      </div>
    </div>

    ${data.summary.errorMsg ? `<div style="background:#fef2f2;color:#c62828;padding:14px 18px;border-radius:8px;margin-bottom:24px;font-size:13px;border-left:3px solid #c62828">${escapeHtml(data.summary.errorMsg)}</div>` : ''}

    <!-- Scenario Timeline -->
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon">&#9202;</span>
        Execution Timeline
      </h2>
      ${scenarioTimelineHtml}
    </div>

    <!-- Scenario Details -->
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon">&#128203;</span>
        Scenarios (${scenarios.length})
      </h2>
      ${scenarioCardsHtml}
    </div>

    ${screenplayHtml}

    ${screenshotsHtml}

    <!-- Feature Content -->
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon">&#128196;</span>
        Feature File
      </h2>
      <div class="feature-content">
        <pre>${highlightGherkin(data.featureContent)}</pre>
      </div>
    </div>
  </div>

  <div class="report-footer">
    Generated by <strong>Playwright CRX</strong> &bull; Serenity-style BDD Report &bull; ${new Date().toISOString()}
  </div>

  <script>
    // Auto-expand failed scenarios
    document.querySelectorAll('.scenario-card').forEach(card => {
      const status = card.querySelector('.scenario-status');
      if (status && status.textContent.trim() === 'FAILED') {
        card.classList.add('expanded');
      }
    });
  </script>
</body>
</html>`;

    await fs.promises.writeFile(path.join(reportDir, 'index.html'), html);
    const reportUrl = `/playwright-crx-reports/bdd-${data.runId}/index.html`;
    logger.info(`BDD Run ${data.runId}: Serenity-style report generated at ${reportUrl}`);
    return reportUrl;
  } catch (e: any) {
    logger.warn(`BDD Run ${data.runId}: Failed to generate Serenity report: ${e.message}\n${e.stack}`);
    return '';
  }
}

function highlightGherkin(content: string): string {
  return escapeHtml(content)
    .replace(/^(\s*)(Feature:|Scenario Outline:|Scenario Template:|Scenario:|Background:|Examples:|Scenarios:|Given|When|Then|And|But)/gm,
      '$1<span class="keyword">$2</span>')
    .replace(/(@\w+)/g, '<span class="tag">$1</span>')
    .replace(/(&quot;[^&]*&quot;)/g, '<span class="string">$1</span>')
    .replace(/^(\s*#.*)$/gm, '<span class="comment">$1</span>');
}
