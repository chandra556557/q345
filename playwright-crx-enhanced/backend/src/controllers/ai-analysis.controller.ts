/**
 * AI Analysis Controller
 * Uses local Node.js services instead of deprecated Python proxy.
 * Services: scriptAnalysisService, xpathAnalysisService, visualAIService, contextAwareLocatorService
 */

import { Request, Response } from 'express';
import { scriptAnalysisService } from '../services/script-analysis.service';
import { xpathAnalysisService } from '../services/xpath-analysis.service';
import { visualAIService } from '../services/visual-ai.service';
import { contextAwareLocatorService } from '../services/context-aware-locator.service';

/**
 * POST /api/ai-analysis/generate-test
 * Generate test from natural language (local heuristic implementation)
 */
export const generateTest = async (req: Request, res: Response) => {
  try {
    const { description, language, framework } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: description'
      });
    }

    const lang = language || 'typescript';
    const fw = framework || 'playwright';

    // Generate a basic test template from the description
    const testCode = generateTestFromDescription(description, lang, fw);

    return res.json({
      success: true,
      data: {
        code: testCode,
        language: lang,
        framework: fw,
        description,
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/analyze-test
 * Analyze test code using scriptAnalysisService
 */
export const analyzeTest = async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: code'
      });
    }

    const result = await scriptAnalysisService.analyzeScript(code, true);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/suggest-locators
 * Suggest semantic locators using contextAwareLocatorService
 */
export const suggestLocators = async (req: Request, res: Response) => {
  try {
    const { element_context, page_url } = req.body;

    if (!element_context || !page_url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: element_context, page_url'
      });
    }

    // Build attributes map from the various input fields
    const attrs: Record<string, string> = element_context.attributes || {};
    if (element_context.id) attrs['id'] = element_context.id;
    if (element_context.className || element_context.class) attrs['class'] = element_context.className || element_context.class;
    if (element_context.role) attrs['role'] = element_context.role;
    if (element_context.ariaLabel) attrs['aria-label'] = element_context.ariaLabel;

    const suggestions = contextAwareLocatorService.generateLocators({
      tag: element_context.tagName || element_context.tag || 'div',
      attributes: attrs,
      text: element_context.textContent || element_context.text,
      position: element_context.position || { index: 0, total: 1 },
      formContext: element_context.formContext,
      tableContext: element_context.tableContext,
      modalContext: element_context.modalContext,
    });

    return res.json({
      success: true,
      data: {
        locators: suggestions,
        page_url,
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/suggest-assertions
 * Suggest assertions based on code context
 */
export const suggestAssertions = async (req: Request, res: Response) => {
  try {
    const { code, page_state, action } = req.body;

    if (!code || !action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: code, action'
      });
    }

    const assertions = generateAssertionSuggestions(code, action, page_state);

    return res.json({
      success: true,
      data: {
        assertions,
        action,
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/repair-test
 * Suggest repairs for a failing test
 */
export const repairTest = async (req: Request, res: Response) => {
  try {
    const { failing_code, error_message } = req.body;

    if (!failing_code || !error_message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: failing_code, error_message'
      });
    }

    const repairs = generateRepairSuggestions(failing_code, error_message);

    return res.json({
      success: true,
      data: {
        repairs,
        original_error: error_message,
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/review-code
 * Review code quality using scriptAnalysisService
 */
export const reviewCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: code'
      });
    }

    const analysis = await scriptAnalysisService.analyzeScript(code, true);

    return res.json({
      success: true,
      data: {
        quality_score: analysis.data?.quality_score || 0,
        recommendations: analysis.data?.recommendations || [],
        locator_quality: analysis.data?.locator_quality,
        reviewed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/expand-scenarios
 * Expand test scenarios
 */
export const expandScenarios = async (req: Request, res: Response) => {
  try {
    const { base_scenario, coverage_level } = req.body;

    if (!base_scenario) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: base_scenario'
      });
    }

    const expanded = expandTestScenarios(base_scenario, coverage_level || 'comprehensive');

    return res.json({
      success: true,
      data: {
        scenarios: expanded,
        base_scenario,
        coverage_level: coverage_level || 'comprehensive',
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/visual-regression
 * Analyze visual regression using visualAIService
 */
export const analyzeVisualRegression = async (req: Request, res: Response) => {
  try {
    const { before_screenshot, after_screenshot, tolerance } = req.body;

    if (!before_screenshot || !after_screenshot) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: before_screenshot, after_screenshot'
      });
    }

    const result = visualAIService.detectLayoutChanges(before_screenshot, after_screenshot);

    return res.json({
      success: true,
      data: {
        ...result,
        tolerance: tolerance || 0.95,
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/predict-failures
 * Predict test failures based on code patterns
 */
export const predictFailures = async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: code'
      });
    }

    const analysis = await scriptAnalysisService.analyzeScript(code, true);
    const predictions = (analysis.data?.recommendations || [])
      .filter((r: any) => r.priority === 'high')
      .map((r: any) => ({
        risk: r.title,
        description: r.description,
        likelihood: r.priority === 'high' ? 0.8 : 0.5,
        category: r.category
      }));

    return res.json({
      success: true,
      data: {
        predictions,
        risk_score: predictions.length > 0 ? Math.min(predictions.length * 0.2, 1.0) : 0.1,
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * GET /api/ai-analysis/health
 * Health check — always healthy since we use local Node.js services
 */
export const getHealth = async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'ai-analysis (Node.js)',
      services: {
        scriptAnalysis: 'available',
        xpathAnalysis: 'available',
        visualAI: 'available',
        contextAwareLocators: 'available'
      },
      checked_at: new Date().toISOString()
    }
  });
};

/**
 * POST /api/ai-analysis/xpath-analyze
 * Deep XPath analysis using xpathAnalysisService
 */
export const analyzeXPath = async (req: Request, res: Response) => {
  try {
    const { xpath } = req.body;

    if (!xpath) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: xpath'
      });
    }

    const analysis = xpathAnalysisService.analyzeXPath(xpath);

    return res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/playwright-metrics
 * Get Playwright metrics using scriptAnalysisService
 */
export const getPlaywrightMetrics = async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: code'
      });
    }

    const analysis = await scriptAnalysisService.analyzeScript(code, true);

    return res.json({
      success: true,
      data: {
        quality_score: analysis.data?.quality_score || 0,
        test_pattern: analysis.data?.test_pattern || 'unknown',
        locator_quality: analysis.data?.locator_quality,
        total_lines: analysis.data?.metadata?.total_lines || 0,
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/locator-health
 * Analyze locator health using xpathAnalysisService
 */
export const analyzeLocatorHealth = async (req: Request, res: Response) => {
  try {
    const { locators } = req.body;

    if (!locators || !Array.isArray(locators)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: locators (array)'
      });
    }

    const analyses = locators.map((locator: string) => {
      if (xpathAnalysisService.isXPathExpression(locator)) {
        const analysis = xpathAnalysisService.analyzeXPath(locator);
        return {
          locator,
          type: 'xpath',
          stability: analysis.stability,
          complexity: analysis.complexity,
          issues: analysis.issues,
          suggestions: analysis.suggestions
        };
      }
      return {
        locator,
        type: 'css-or-other',
        stability: 'high' as const,
        complexity: 1,
        issues: [],
        suggestions: []
      };
    });

    return res.json({
      success: true,
      data: {
        locators: analyses,
        summary: {
          total: analyses.length,
          healthy: analyses.filter((a: any) => a.stability === 'high').length,
          at_risk: analyses.filter((a: any) => a.stability === 'medium').length,
          unhealthy: analyses.filter((a: any) => a.stability === 'low').length
        },
        analyzed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-analysis/optimize
 * Playwright optimization suggestions
 */
export const optimizePlaywright = async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: code'
      });
    }

    const analysis = await scriptAnalysisService.analyzeScript(code, true);

    return res.json({
      success: true,
      data: {
        optimizations: analysis.data?.recommendations || [],
        quality_score: analysis.data?.quality_score || 0,
        optimized_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

// ─────────────────────────────────────────────────
// Helper functions for local heuristic analysis
// ─────────────────────────────────────────────────

function generateTestFromDescription(description: string, language: string, framework: string): string {
  const steps = description.split(/[.,;]\s*/).filter(s => s.trim());

  if (framework === 'playwright' && language === 'typescript') {
    const lines = steps.map(step => {
      const s = step.trim().toLowerCase();
      if (s.includes('navigate') || s.includes('go to') || s.includes('open')) {
        return `  await page.goto('https://example.com');`;
      }
      if (s.includes('click')) {
        const target = s.replace(/click\s*(on\s*)?/i, '').trim() || 'button';
        return `  await page.getByRole('button', { name: '${target}' }).click();`;
      }
      if (s.includes('type') || s.includes('enter') || s.includes('fill')) {
        return `  await page.getByRole('textbox').fill('test value');`;
      }
      if (s.includes('verify') || s.includes('check') || s.includes('assert') || s.includes('expect')) {
        return `  await expect(page).toHaveTitle(/expected/);`;
      }
      return `  // TODO: ${step.trim()}`;
    });

    return `import { test, expect } from '@playwright/test';

test('${description.substring(0, 60)}', async ({ page }) => {
${lines.join('\n')}
});`;
  }

  return `// Generated test for: ${description}\n// Language: ${language}, Framework: ${framework}\n// TODO: implement test steps`;
}

function generateAssertionSuggestions(_code: string, action: string, _pageState: any): any[] {
  const suggestions: any[] = [];

  if (action.includes('click') || action.includes('submit')) {
    suggestions.push(
      { assertion: 'await expect(page).toHaveURL(/expected-path/);', reason: 'Verify navigation after action', confidence: 0.8 },
      { assertion: 'await expect(page.getByText("Success")).toBeVisible();', reason: 'Verify success feedback', confidence: 0.7 }
    );
  }
  if (action.includes('fill') || action.includes('type')) {
    suggestions.push(
      { assertion: 'await expect(page.getByRole("textbox")).toHaveValue("expected");', reason: 'Verify input value', confidence: 0.9 }
    );
  }
  if (action.includes('navigate') || action.includes('goto')) {
    suggestions.push(
      { assertion: 'await expect(page).toHaveTitle(/expected/);', reason: 'Verify page title after navigation', confidence: 0.85 },
      { assertion: 'await expect(page).toHaveURL(/expected/);', reason: 'Verify URL after navigation', confidence: 0.9 }
    );
  }

  if (suggestions.length === 0) {
    suggestions.push(
      { assertion: 'await expect(page.locator("selector")).toBeVisible();', reason: 'Verify element visibility', confidence: 0.6 }
    );
  }

  return suggestions;
}

function generateRepairSuggestions(_failingCode: string, errorMessage: string): any[] {
  const repairs: any[] = [];
  const errLower = errorMessage.toLowerCase();

  if (errLower.includes('timeout') || errLower.includes('waiting')) {
    repairs.push({
      suggestion: 'Increase timeout or add explicit wait',
      code: 'await page.waitForSelector("selector", { timeout: 30000 });',
      confidence: 0.85
    });
  }
  if (errLower.includes('not found') || errLower.includes('no element') || errLower.includes('locator resolved to')) {
    repairs.push({
      suggestion: 'Use more resilient locator strategy',
      code: 'await page.getByRole("button", { name: "Submit" }).click(); // Use role-based locator',
      confidence: 0.8
    });
  }
  if (errLower.includes('navigation') || errLower.includes('net::err')) {
    repairs.push({
      suggestion: 'Add waitForNavigation or waitForLoadState',
      code: 'await page.waitForLoadState("networkidle");',
      confidence: 0.75
    });
  }
  if (errLower.includes('strict mode') || errLower.includes('resolved to') && errLower.includes('elements')) {
    repairs.push({
      suggestion: 'Make locator more specific to match single element',
      code: 'await page.getByRole("button", { name: "Submit" }).first().click();',
      confidence: 0.8
    });
  }

  if (repairs.length === 0) {
    repairs.push({
      suggestion: 'Review error details and check element selectors',
      code: '// Review the error and consider updating selectors or adding waits',
      confidence: 0.5
    });
  }

  return repairs;
}

function expandTestScenarios(baseScenario: string, coverageLevel: string): any[] {
  const scenarios: any[] = [];
  const base = baseScenario.toLowerCase();

  // Positive scenario
  scenarios.push({
    name: `${baseScenario} - Happy Path`,
    description: `Verify ${baseScenario} works with valid inputs`,
    type: 'positive',
    priority: 'high'
  });

  // Negative scenarios
  scenarios.push({
    name: `${baseScenario} - Invalid Input`,
    description: `Verify ${baseScenario} handles invalid input gracefully`,
    type: 'negative',
    priority: 'high'
  });
  scenarios.push({
    name: `${baseScenario} - Empty Input`,
    description: `Verify ${baseScenario} handles empty/missing input`,
    type: 'negative',
    priority: 'medium'
  });

  // Edge cases
  if (coverageLevel === 'comprehensive') {
    scenarios.push({
      name: `${baseScenario} - Boundary Values`,
      description: `Test with minimum and maximum boundary values`,
      type: 'boundary',
      priority: 'medium'
    });
    scenarios.push({
      name: `${baseScenario} - Concurrent Access`,
      description: `Verify behavior under concurrent access`,
      type: 'stress',
      priority: 'low'
    });
  }

  if (base.includes('login') || base.includes('auth')) {
    scenarios.push(
      { name: 'Login with wrong password', description: 'Verify error shown for wrong password', type: 'negative', priority: 'high' },
      { name: 'Login with locked account', description: 'Verify locked account handling', type: 'negative', priority: 'medium' },
      { name: 'Session timeout', description: 'Verify session timeout behavior', type: 'edge-case', priority: 'medium' }
    );
  }

  if (base.includes('form') || base.includes('submit') || base.includes('register')) {
    scenarios.push(
      { name: 'Form submission with special characters', description: 'Test with unicode and special chars', type: 'boundary', priority: 'medium' },
      { name: 'Double form submission', description: 'Verify double-submit prevention', type: 'edge-case', priority: 'medium' }
    );
  }

  return scenarios;
}
