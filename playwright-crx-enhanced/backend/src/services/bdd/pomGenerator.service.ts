import { chromium, Page } from 'playwright-core';
import { logger } from '../../utils/logger';
import { bddService } from './bdd.service';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ElementInfo {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  text: string;
  testId: string;
  value: string;
  href: string;
  role: string;
  visible: boolean;
  className?: string;
  parentTag?: string;
  isInsideHeader?: boolean;
  isInsideFooter?: boolean;
  isInsideNav?: boolean;
  isInsideModal?: boolean;
  isInsideSidebar?: boolean;
  isInsideTable?: boolean;
  boundingRect?: { x: number; y: number; width: number; height: number };
}

interface POMLocator {
  fieldName: string;
  variableName: string;
  locator: string;
  elementType: 'input' | 'button' | 'link' | 'select' | 'combobox' | 'checkbox' | 'radio' | 'menu' | 'text' | 'other';
  locatorStrategy: string;
  confidence: number;
}

interface LocatorValidationResult {
  variableName: string;
  locator: string;
  matchCount: number;
  status: 'ok' | 'ambiguous' | 'broken';
  suggestion?: string;
}

interface ComponentFragment {
  name: string;
  type: 'header' | 'footer' | 'nav' | 'sidebar' | 'modal' | 'table';
  locators: POMLocator[];
  methods: Array<{ name: string; code: string }>;
}

interface POMResult {
  className: string;
  url: string;
  pagePath: string;
  locators: POMLocator[];
  methods: string[];
  generatedCode: string;
  basePageCode: string;
  fixtureCode: string;
  barrelExport: string;
  dataInterface: string;
  validationReport: LocatorValidationResult[];
  components: ComponentFragment[];
  envConfig: string;
}

interface FeatureStep {
  idx: number;
  action: 'navigate' | 'click' | 'fill' | 'select' | 'check' | 'hover' | 'assert' | 'other';
  target: string;
  value?: string;
  optionValue?: string;
}

// ─── Locator Priority Chain (Tier 1, Item 1) ─────────────────────────────────

const LOCATOR_STRATEGIES = [
  { name: 'testId',      weight: 100, build: (el: ElementInfo) => el.testId ? `this.page.getByTestId('${esc(el.testId)}')` : null },
  { name: 'role+name',   weight: 95,  build: (el: ElementInfo, _c: string, role: string) => {
    const accessibleName = el.ariaLabel || el.text || el.value;
    return (role && accessibleName) ? `this.page.getByRole('${role}', { name: ${JSON.stringify(accessibleName)} })` : null;
  }},
  { name: 'ariaLabel',   weight: 90,  build: (el: ElementInfo) => el.ariaLabel ? `this.page.getByLabel(${JSON.stringify(el.ariaLabel)})` : null },
  { name: 'label',       weight: 85,  build: (el: ElementInfo, candidate: string) => {
    if (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') {
      return `this.page.getByLabel(${JSON.stringify(candidate.replace(/[:\s]+$/, '').trim())})`;
    }
    return null;
  }},
  { name: 'placeholder', weight: 80,  build: (el: ElementInfo) => el.placeholder ? `this.page.getByPlaceholder(${JSON.stringify(el.placeholder)})` : null },
  { name: 'text',        weight: 70,  build: (el: ElementInfo) => (el.text && el.text.length < 50) ? `this.page.getByText(${JSON.stringify(el.text)})` : null },
  { name: 'css-id',      weight: 60,  build: (el: ElementInfo) => el.id ? `this.page.locator('#${esc(el.id)}')` : null },
  { name: 'css-name',    weight: 50,  build: (el: ElementInfo) => el.name ? `this.page.locator('${el.tag}[name="${esc(el.name)}"]')` : null },
  { name: 'css-generic', weight: 30,  build: (el: ElementInfo) => `this.page.locator('${el.tag}')` },
];

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── BasePage Code (Tier 1, Item 2) ──────────────────────────────────────────

function generateBasePageCode(): string {
  return `import { Page, Locator, expect } from '@playwright/test';

/**
 * BasePage — Enterprise base class for all Page Objects.
 * Provides shared utilities: navigation, waits, retry logic, screenshots.
 */
export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Wait for page to fully load (DOM + network idle) */
  async waitForPageLoad(timeout = 30000) {
    await this.page.waitForLoadState('domcontentloaded', { timeout });
    await this.page.waitForLoadState('networkidle', { timeout }).catch(() => {});
    return this;
  }

  /** Take a screenshot and return the buffer */
  async screenshot(name?: string) {
    const path = name ? \`screenshots/\${name}.png\` : undefined;
    return this.page.screenshot({ path, fullPage: true });
  }

  /** Click with auto-retry: scrolls into view, waits for visible, retries up to N times */
  async retryClick(locator: Locator, options: { retries?: number; timeout?: number } = {}) {
    const { retries = 3, timeout = 5000 } = options;
    for (let i = 0; i < retries; i++) {
      try {
        await locator.scrollIntoViewIfNeeded({ timeout });
        await locator.click({ timeout });
        return this;
      } catch (e) {
        if (i === retries - 1) throw e;
        await this.page.waitForTimeout(500);
      }
    }
    return this;
  }

  /** Fill with auto-wait: waits for element, clears, then fills */
  async safeFill(locator: Locator, value: string, timeout = 5000) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await locator.clear();
    await locator.fill(value);
    return this;
  }

  /** Wait for navigation to complete after an action */
  async waitForNavigation(timeout = 10000) {
    await this.page.waitForLoadState('domcontentloaded', { timeout });
    return this;
  }

  /** Wait for a specific URL pattern */
  async waitForURL(urlPattern: string | RegExp, timeout = 10000) {
    await this.page.waitForURL(urlPattern, { timeout });
    return this;
  }

  /** Assert current URL matches pattern */
  async assertURL(urlPattern: string | RegExp) {
    await expect(this.page).toHaveURL(urlPattern);
    return this;
  }

  /** Assert page title */
  async assertTitle(title: string | RegExp) {
    await expect(this.page).toHaveTitle(title);
    return this;
  }

  /** Get current page URL */
  getCurrentURL(): string {
    return this.page.url();
  }

  /** Check if element is visible without throwing */
  async isVisible(locator: Locator, timeout = 3000): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /** Hover with smart wait */
  async safeHover(locator: Locator, timeout = 5000) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await locator.hover();
    return this;
  }

  /** Select option from native dropdown with wait */
  async safeSelect(locator: Locator, option: string, timeout = 5000) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.selectOption(option);
    return this;
  }
}
`;
}

// ─── Environment Config (Tier 2, Item 10) ─────────────────────────────────────

function generateEnvConfig(baseUrl: string): string {
  let origin = baseUrl;
  try { origin = new URL(baseUrl).origin; } catch { /* use as-is */ }
  return `/**
 * Environment-aware configuration for test suites.
 * Reads from environment variables with sensible defaults.
 *
 * Usage in playwright.config.ts:
 *   import { getConfig } from './config/env.config';
 *   const config = getConfig();
 *   export default defineConfig({ use: { baseURL: config.baseUrl } });
 */

export type Environment = 'dev' | 'staging' | 'prod' | 'local';

interface EnvConfig {
  baseUrl: string;
  environment: Environment;
  timeout: number;
  retries: number;
  headless: boolean;
  slowMo: number;
  video: 'on' | 'off' | 'retain-on-failure';
  screenshot: 'on' | 'off' | 'only-on-failure';
  trace: 'on' | 'off' | 'retain-on-failure';
}

const ENV_CONFIGS: Record<Environment, Partial<EnvConfig>> = {
  local: {
    baseUrl: 'http://localhost:3000',
    timeout: 30000,
    retries: 0,
    headless: false,
    slowMo: 100,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  dev: {
    baseUrl: '${esc(origin)}',
    timeout: 30000,
    retries: 1,
    headless: true,
    slowMo: 0,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  staging: {
    baseUrl: '${esc(origin)}',
    timeout: 45000,
    retries: 2,
    headless: true,
    slowMo: 0,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  prod: {
    baseUrl: '${esc(origin)}',
    timeout: 60000,
    retries: 2,
    headless: true,
    slowMo: 0,
    video: 'off',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
};

export function getConfig(): EnvConfig {
  const env = (process.env.TEST_ENV || process.env.NODE_ENV || 'dev') as Environment;
  const defaults = ENV_CONFIGS[env] || ENV_CONFIGS.dev;
  return {
    environment: env,
    baseUrl: process.env.BASE_URL || defaults.baseUrl || '${esc(origin)}',
    timeout: Number(process.env.TEST_TIMEOUT) || defaults.timeout || 30000,
    retries: Number(process.env.TEST_RETRIES) ?? defaults.retries ?? 1,
    headless: process.env.HEADLESS !== 'false' && (defaults.headless ?? true),
    slowMo: Number(process.env.SLOW_MO) || defaults.slowMo || 0,
    video: (process.env.VIDEO as EnvConfig['video']) || defaults.video || 'retain-on-failure',
    screenshot: (process.env.SCREENSHOT as EnvConfig['screenshot']) || defaults.screenshot || 'only-on-failure',
    trace: (process.env.TRACE as EnvConfig['trace']) || defaults.trace || 'retain-on-failure',
  };
}
`;
}

// ─── POM Generator Service ────────────────────────────────────────────────────

class POMGeneratorService {

  async generateFromFeature(
    featureContent: string,
    targetUrl: string,
    options: { className?: string; waitForSelector?: string } = {}
  ): Promise<POMResult[]> {
    const parsed = bddService.parseFeatureContent(featureContent);
    logger.info(`POM Generator: parsing feature with ${(parsed.scenarios || []).length} scenarios`);

    const scenarioForFlow = this.pickFlowFollowingScenario(parsed);
    logger.info(`POM Generator: using scenario "${scenarioForFlow?.name || 'none'}" for flow-following`);

    const allSteps: FeatureStep[] = this.parseFeatureIntoSteps(parsed);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    interface Snapshot {
      url: string;
      pagePath: string;
      className: string;
      elements: ElementInfo[];
      candidateTargets: Set<string>;
      domHash: string;
    }
    const snapshots: Snapshot[] = [];

    const takeSnapshot = async (preferredClassName?: string): Promise<Snapshot> => {
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {});
      }
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const url = page.url();
      const urlObj = new URL(url);
      const pagePath = urlObj.pathname + urlObj.search;
      const elements = await this.extractDOMElements(page);
      const domHash = await this.computeDomHash(page);

      const existing = snapshots.find(s => s.url === url && s.domHash === domHash);
      if (existing) return existing;

      let className = preferredClassName || this.generateClassName(url, parsed.name);
      const sameUrlCount = snapshots.filter(s => s.url === url).length;
      if (sameUrlCount > 0) className = `${className}State${sameUrlCount + 1}`;
      let finalClassName = className;
      let collisionCounter = 2;
      while (snapshots.some(s => s.className === finalClassName)) {
        finalClassName = `${className}${collisionCounter++}`;
      }

      const snapshot: Snapshot = { url, pagePath, className: finalClassName, elements, candidateTargets: new Set(), domHash };
      snapshots.push(snapshot);
      logger.info(`POM Generator: snapshot for ${finalClassName} at ${url} — ${elements.length} elements`);
      return snapshot;
    };

    try {
      logger.info(`POM Generator: navigating to ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      let currentSnapshot = await takeSnapshot(options.className);

      const flowSteps: FeatureStep[] = scenarioForFlow
        ? this.parseScenarioIntoSteps(scenarioForFlow)
        : allSteps;

      for (const step of flowSteps) {
        currentSnapshot.candidateTargets.add(step.target);

        if (step.action === 'click') {
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) {
            logger.warn(`POM Generator: no match for click "${step.target}" on ${currentSnapshot.className}`);
            continue;
          }
          const urlBefore = page.url();
          const domHashBefore = currentSnapshot.domHash;
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            await locator.click({ timeout: 10000 });
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(500);
            const urlAfter = page.url();
            const domHashAfter = await this.computeDomHash(page);
            if (urlAfter !== urlBefore || domHashAfter !== domHashBefore) {
              currentSnapshot = await takeSnapshot();
            }
          } catch (e: any) {
            logger.warn(`POM Generator: click on "${step.target}" failed — ${e.message.substring(0, 100)}`);
          }
        } else if (step.action === 'fill') {
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) continue;
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            await locator.fill(step.value || 'test', { timeout: 5000 }).catch(() => {});
          } catch { /* ignore */ }
        } else if (step.action === 'hover') {
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) continue;
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            await locator.hover({ timeout: 5000 });
            await page.waitForTimeout(500);
            const newHash = await this.computeDomHash(page);
            if (newHash !== currentSnapshot.domHash) {
              currentSnapshot = await takeSnapshot();
            }
          } catch (e: any) {
            logger.warn(`POM Generator: hover on "${step.target}" failed — ${e.message.substring(0, 100)}`);
          }
        } else if (step.action === 'select') {
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) continue;
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            if (match.elementType === 'select') {
              await locator.selectOption(step.optionValue || '', { timeout: 3000 }).catch(() => {});
            } else {
              await locator.click({ timeout: 3000 });
              await page.waitForTimeout(300);
              if (step.optionValue) {
                await page.getByRole('option', { name: step.optionValue }).first().click({ timeout: 3000 }).catch(() => {});
              }
            }
          } catch { /* ignore */ }
        }
      }

      // Associate unconsumed targets to best-matching snapshots
      const consumedTargets = new Set<string>();
      for (const snap of snapshots) snap.candidateTargets.forEach(t => consumedTargets.add(t));
      const unconsumedSteps = allSteps.filter(s => !consumedTargets.has(s.target));
      for (const step of unconsumedSteps) {
        let bestSnap: Snapshot | null = null;
        let bestScore = 0;
        for (const snap of snapshots) {
          const match = this.matchCandidate(step.target, snap.elements);
          if (match) {
            const score = this.scoreMatch(step.target.toLowerCase().replace(/[:\s]+$/, '').trim(), match.element);
            if (score > bestScore) { bestScore = score; bestSnap = snap; }
          }
        }
        if (bestSnap) bestSnap.candidateTargets.add(step.target);
      }

      // ─── Locator Validation (Tier 2, Item 9) ─────────────────────────
      const validateLocators = async (locators: POMLocator[]): Promise<LocatorValidationResult[]> => {
        const results: LocatorValidationResult[] = [];
        for (const loc of locators) {
          try {
            const rawLocator = loc.locator.replace(/^this\.page\./, 'page.');
            let matchCount = 0;
            try {
              const pwLocator = eval(`(function(page) { return ${rawLocator}; })`)(page);
              matchCount = await pwLocator.count().catch(() => 0);
            } catch {
              matchCount = -1;
            }
            let status: 'ok' | 'ambiguous' | 'broken' = 'ok';
            let suggestion: string | undefined;
            if (matchCount === 0) {
              status = 'broken';
              suggestion = `Locator "${loc.locator}" resolves to 0 elements. Consider using a different strategy.`;
            } else if (matchCount > 1) {
              status = 'ambiguous';
              suggestion = `Locator "${loc.locator}" resolves to ${matchCount} elements. Add .first() or use a more specific selector.`;
            }
            results.push({ variableName: loc.variableName, locator: loc.locator, matchCount, status, suggestion });
          } catch {
            results.push({ variableName: loc.variableName, locator: loc.locator, matchCount: -1, status: 'broken', suggestion: 'Could not evaluate locator' });
          }
        }
        return results;
      };

      // Generate POM results
      const results: POMResult[] = [];
      const allClassNames: string[] = [];

      for (const snapshot of snapshots) {
        const locators: POMLocator[] = [];
        const usedVarNames = new Set<string>();

        for (const candidate of snapshot.candidateTargets) {
          const match = this.matchCandidate(candidate, snapshot.elements);
          if (!match) continue;
          let varName = this.toVariableName(candidate, match.elementType);
          let counter = 2;
          const originalVar = varName;
          while (usedVarNames.has(varName)) varName = `${originalVar}${counter++}`;
          usedVarNames.add(varName);
          locators.push({
            fieldName: candidate,
            variableName: varName,
            locator: match.locator,
            elementType: match.elementType,
            locatorStrategy: match.strategy,
            confidence: match.confidence,
          });
        }

        if (locators.length === 0) continue;

        // Detect component fragments (Tier 1, Item 4)
        const components = this.detectComponents(snapshot.elements, locators);

        const { methods, consumedByCompound } = this.generateMethods(locators, snapshot);
        const assertions = this.extractAssertionMethods(allSteps, snapshot);
        const allMethods = [...methods, ...assertions];

        // Data interfaces (Tier 2, Item 7)
        const dataInterface = this.generateDataInterface(snapshot.className, locators);

        const hasAssertions = assertions.length > 0;
        const generatedCode = this.buildPOMCode(snapshot.className, snapshot.url, snapshot.pagePath, locators, allMethods, consumedByCompound, hasAssertions, components);

        // Fixture code (Tier 2, Item 6)
        const fixtureCode = this.generateFixtureCode(snapshot.className);

        // Validation
        const validationReport = await validateLocators(locators);

        // Barrel export line
        const barrelExport = `export { ${snapshot.className} } from './${snapshot.className}';`;

        allClassNames.push(snapshot.className);

        results.push({
          className: snapshot.className,
          url: snapshot.url,
          pagePath: snapshot.pagePath,
          locators,
          methods: allMethods.map(m => m.name),
          generatedCode,
          basePageCode: generateBasePageCode(),
          fixtureCode,
          barrelExport,
          dataInterface,
          validationReport,
          components,
          envConfig: generateEnvConfig(snapshot.url),
        });
      }

      // Generate combined barrel index (Tier 2, Item 8)
      if (results.length > 0) {
        const combinedBarrel = this.generateBarrelIndex(results);
        results[0].barrelExport = combinedBarrel;
      }

      return results;
    } finally {
      await browser.close();
    }
  }

  // ─── Component/Fragment Detection (Tier 1, Item 4) ──────────────────────────

  private detectComponents(elements: ElementInfo[], locators: POMLocator[]): ComponentFragment[] {
    const components: ComponentFragment[] = [];
    const regionTypes: Array<{ type: ComponentFragment['type']; filter: (el: ElementInfo) => boolean }> = [
      { type: 'header',  filter: el => !!el.isInsideHeader },
      { type: 'footer',  filter: el => !!el.isInsideFooter },
      { type: 'nav',     filter: el => !!el.isInsideNav },
      { type: 'sidebar', filter: el => !!el.isInsideSidebar },
      { type: 'modal',   filter: el => !!el.isInsideModal },
      { type: 'table',   filter: el => !!el.isInsideTable },
    ];

    for (const region of regionTypes) {
      const regionElements = elements.filter(region.filter);
      if (regionElements.length < 2) continue;

      const regionLocators = locators.filter(loc => {
        const fieldLower = loc.fieldName.toLowerCase();
        return regionElements.some(el =>
          el.text.toLowerCase().includes(fieldLower) ||
          el.ariaLabel.toLowerCase().includes(fieldLower) ||
          el.name.toLowerCase().includes(fieldLower)
        );
      });

      if (regionLocators.length > 0) {
        const name = region.type.charAt(0).toUpperCase() + region.type.slice(1) + 'Component';
        const methods = this.generateComponentMethods(regionLocators, region.type);
        components.push({ name, type: region.type, locators: regionLocators, methods });
      }
    }

    return components;
  }

  private generateComponentMethods(locators: POMLocator[], type: string): Array<{ name: string; code: string }> {
    const methods: Array<{ name: string; code: string }> = [];

    if (type === 'nav') {
      for (const loc of locators.filter(l => l.elementType === 'link' || l.elementType === 'button')) {
        const cleanName = loc.fieldName.replace(/[^a-zA-Z0-9]/g, '');
        const methodName = `navigateTo${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
        methods.push({
          name: methodName,
          code: `  async ${methodName}() {\n    await this.${loc.variableName}.click();\n    await this.waitForNavigation();\n    return this;\n  }`,
        });
      }
    }

    if (type === 'table') {
      methods.push({
        name: 'getRowCount',
        code: `  async getRowCount(): Promise<number> {\n    return this.page.locator('table tbody tr').count();\n  }`,
      });
      methods.push({
        name: 'getCellText',
        code: `  async getCellText(row: number, col: number): Promise<string> {\n    return this.page.locator(\`table tbody tr:nth-child(\${row}) td:nth-child(\${col})\`).innerText();\n  }`,
      });
      methods.push({
        name: 'getRowByText',
        code: `  getRowByText(text: string) {\n    return this.page.locator('table tbody tr', { hasText: text });\n  }`,
      });
    }

    if (type === 'modal') {
      methods.push({
        name: 'isModalVisible',
        code: `  async isModalVisible(): Promise<boolean> {\n    return this.isVisible(this.page.locator('[role="dialog"], .modal, [class*="modal"]'));\n  }`,
      });
      methods.push({
        name: 'closeModal',
        code: `  async closeModal() {\n    const close = this.page.locator('[role="dialog"] button[aria-label="Close"], .modal .close, .modal-close').first();\n    if (await this.isVisible(close, 2000)) await close.click();\n    return this;\n  }`,
      });
    }

    return methods;
  }

  // ─── Barrel Index (Tier 2, Item 8) ──────────────────────────────────────────

  private generateBarrelIndex(results: POMResult[]): string {
    const lines: string[] = [
      '// Auto-generated barrel exports for Page Objects',
      `// Generated at ${new Date().toISOString()}`,
      '',
    ];
    for (const r of results) {
      lines.push(`export { ${r.className} } from './${r.className}';`);
    }
    lines.push('');
    lines.push(`export { BasePage } from './BasePage';`);
    lines.push('');

    // Page factory with URL routing
    lines.push('// Page factory — resolve the right POM by URL');
    lines.push(`import { Page } from '@playwright/test';`);
    for (const r of results) {
      lines.push(`import { ${r.className} } from './${r.className}';`);
    }
    lines.push('');
    lines.push('const PAGE_ROUTES: Array<{ pattern: RegExp; create: (page: Page) => any }> = [');
    for (const r of results) {
      const pathEscaped = r.pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      lines.push(`  { pattern: /${pathEscaped}/, create: (page) => new ${r.className}(page) },`);
    }
    lines.push('];');
    lines.push('');
    lines.push(`export function createPageObject(page: Page, url?: string) {`);
    lines.push(`  const currentUrl = url || page.url();`);
    lines.push(`  const match = PAGE_ROUTES.find(r => r.pattern.test(currentUrl));`);
    lines.push(`  return match ? match.create(page) : null;`);
    lines.push(`}`);
    return lines.join('\n');
  }

  // ─── Fixture Code (Tier 2, Item 6) ──────────────────────────────────────────

  private generateFixtureCode(className: string): string {
    const instanceName = className.charAt(0).toLowerCase() + className.slice(1);
    return `import { test as base } from '@playwright/test';
import { ${className} } from '../pages/${className}';

type PageFixtures = {
  ${instanceName}: ${className};
};

export const test = base.extend<PageFixtures>({
  ${instanceName}: async ({ page }, use) => {
    const ${instanceName} = new ${className}(page);
    await use(${instanceName});
  },
});

export { expect } from '@playwright/test';

// Usage in tests:
// import { test, expect } from './fixtures/${className}.fixture';
// test('example', async ({ ${instanceName} }) => {
//   await ${instanceName}.navigate();
// });
`;
  }

  // ─── Data Interface (Tier 2, Item 7) ────────────────────────────────────────

  private generateDataInterface(className: string, locators: POMLocator[]): string {
    const inputLocators = locators.filter(l => l.elementType === 'input');
    if (inputLocators.length === 0) return '';

    const interfaceName = `${className}Data`;
    const lines: string[] = [];
    lines.push(`export interface ${interfaceName} {`);
    for (const loc of inputLocators) {
      const fieldClean = loc.fieldName.replace(/[:\s]+$/, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
      const propName = fieldClean.split(/\s+/).map((p, i) =>
        i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)
      ).join('');
      lines.push(`  ${propName}: string;`);
    }
    lines.push(`}`);
    lines.push('');

    // Factory
    const factoryName = `create${className}Data`;
    lines.push(`export function ${factoryName}(overrides: Partial<${interfaceName}> = {}): ${interfaceName} {`);
    lines.push(`  return {`);
    for (const loc of inputLocators) {
      const fieldClean = loc.fieldName.replace(/[:\s]+$/, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
      const propName = fieldClean.split(/\s+/).map((p, i) =>
        i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)
      ).join('');
      const defaultVal = /email/i.test(loc.fieldName) ? 'test@example.com'
        : /pass/i.test(loc.fieldName) ? 'Password123!'
        : /phone/i.test(loc.fieldName) ? '+1234567890'
        : /name/i.test(loc.fieldName) ? 'Test User'
        : 'test-value';
      lines.push(`    ${propName}: overrides.${propName} ?? '${defaultVal}',`);
    }
    lines.push(`  };`);
    lines.push(`}`);
    return lines.join('\n');
  }

  // ─── Build POM Code (with BasePage, Fluent API, Components, Smart Waits) ──

  private buildPOMCode(
    className: string,
    url: string,
    pagePath: string,
    locators: POMLocator[],
    methods: Array<{ name: string; code: string }>,
    _consumedByCompound: Set<string>,
    hasAssertions: boolean,
    components: ComponentFragment[]
  ): string {
    const lines: string[] = [];

    // Imports — extend BasePage instead of standalone
    const imports = hasAssertions ? `import { expect } from '@playwright/test';\n` : '';
    lines.push(`${imports}import { BasePage } from './BasePage';`);
    lines.push(`import type { Page, Locator } from '@playwright/test';`);
    lines.push('');

    let defaultBase = '';
    try { defaultBase = new URL(url).origin; } catch { /* ignore */ }
    lines.push(`const BASE_URL = process.env.BASE_URL || '${esc(defaultBase)}';`);
    lines.push('');

    // Component fragment classes (Tier 1, Item 4)
    for (const comp of components) {
      lines.push(`/** ${comp.name} — reusable ${comp.type} fragment */`);
      lines.push(`export class ${comp.name} extends BasePage {`);
      for (const loc of comp.locators) {
        lines.push(`  readonly ${loc.variableName}: Locator;`);
      }
      lines.push('');
      lines.push(`  constructor(page: Page) {`);
      lines.push(`    super(page);`);
      for (const loc of comp.locators) {
        lines.push(`    this.${loc.variableName} = ${loc.locator};`);
      }
      lines.push(`  }`);
      for (const m of comp.methods) {
        lines.push('');
        lines.push(m.code);
      }
      lines.push(`}`);
      lines.push('');
    }

    // Main page class — extends BasePage (Tier 1, Item 2)
    lines.push(`/**`);
    lines.push(` * Page Object for ${className}`);
    lines.push(` * URL: ${url}`);
    lines.push(` * Path: ${pagePath}`);
    lines.push(` * Locator strategies: ${[...new Set(locators.map(l => l.locatorStrategy))].join(', ')}`);
    lines.push(` * Auto-generated at ${new Date().toISOString()}`);
    lines.push(` */`);
    lines.push(`export class ${className} extends BasePage {`);

    for (const loc of locators) {
      lines.push(`  readonly ${loc.variableName}: Locator;`);
    }

    // Component instances
    for (const comp of components) {
      const instanceName = comp.type;
      lines.push(`  readonly ${instanceName}: ${comp.name};`);
    }

    lines.push('');
    lines.push(`  constructor(page: Page) {`);
    lines.push(`    super(page);`);
    for (const loc of locators) {
      lines.push(`    this.${loc.variableName} = ${loc.locator};`);
    }
    for (const comp of components) {
      lines.push(`    this.${comp.type} = new ${comp.name}(page);`);
    }
    lines.push(`  }`);
    lines.push('');

    for (const m of methods) {
      lines.push(m.code);
      lines.push('');
    }

    lines.push(`}`);
    return lines.join('\n');
  }

  // ─── Method Generation (Tier 1, Items 3+5: Fluent API + Smart Waits) ───────

  private generateMethods(
    locators: POMLocator[],
    snapshot: { pagePath: string; className: string }
  ): { methods: Array<{ name: string; code: string }>; consumedByCompound: Set<string> } {
    const methods: Array<{ name: string; code: string }> = [];
    const consumedByCompound = new Set<string>();

    // navigate() — smart URL, returns this for chaining
    methods.push({
      name: 'navigate',
      code: [
        `  async navigate() {`,
        `    const targetPath = '${esc(snapshot.pagePath)}';`,
        `    let url: string;`,
        `    try {`,
        `      const base = new URL(BASE_URL);`,
        `      if (base.pathname === targetPath || base.pathname.replace(/\\/$/, '') === targetPath.replace(/\\/$/, '')) {`,
        `        url = BASE_URL;`,
        `      } else if (targetPath === '/' || targetPath === '') {`,
        `        url = base.origin;`,
        `      } else {`,
        `        url = base.origin + targetPath;`,
        `      }`,
        `    } catch {`,
        `      url = BASE_URL + targetPath;`,
        `    }`,
        `    await this.page.goto(url, { waitUntil: 'domcontentloaded' });`,
        `    await this.waitForPageLoad();`,
        `    return this;`,
        `  }`,
      ].join('\n'),
    });

    // Compound login()
    const usernameVar = locators.find(l => /user|email/i.test(l.fieldName) && l.elementType === 'input');
    const passwordVar = locators.find(l => /pass/i.test(l.fieldName) && l.elementType === 'input');
    const loginBtn = locators.find(l => /^(login|sign\s*in|submit|log\s*in)$/i.test(l.fieldName.trim()) && (l.elementType === 'button' || l.elementType === 'link'));

    if (usernameVar && passwordVar && loginBtn) {
      methods.push({
        name: 'login',
        code: [
          `  async login(username: string, password: string) {`,
          `    await this.waitForPageLoad();`,
          `    await this.safeFill(this.${usernameVar.variableName}, username);`,
          `    await this.safeFill(this.${passwordVar.variableName}, password);`,
          `    await this.retryClick(this.${loginBtn.variableName});`,
          `    await this.waitForNavigation();`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
      consumedByCompound.add(usernameVar.variableName);
      consumedByCompound.add(passwordVar.variableName);
      consumedByCompound.add(loginBtn.variableName);
    }

    // Fill methods — Fluent API + Smart Waits
    for (const loc of locators.filter(l => l.elementType === 'input' && !consumedByCompound.has(l.variableName))) {
      const methodName = 'fill' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Input$/, '');
      methods.push({
        name: methodName,
        code: [
          `  async ${methodName}(value: string) {`,
          `    await this.safeFill(this.${loc.variableName}, value);`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    // Click methods — Fluent API + Smart Waits + navigation detection
    for (const loc of locators.filter(l => (l.elementType === 'button' || l.elementType === 'link') && !consumedByCompound.has(l.variableName))) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/(Button|Link)$/, '');
      const clickName = 'click' + baseName;
      const isNavLink = loc.elementType === 'link';

      methods.push({
        name: clickName,
        code: [
          `  async ${clickName}() {`,
          `    await this.retryClick(this.${loc.variableName});`,
          ...(isNavLink ? [`    await this.waitForNavigation();`] : []),
          `    return this;`,
          `  }`,
        ].join('\n'),
      });

      // Hover method
      const hoverName = 'hover' + baseName;
      methods.push({
        name: hoverName,
        code: [
          `  async ${hoverName}() {`,
          `    await this.safeHover(this.${loc.variableName});`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    // Select dropdown
    for (const loc of locators.filter(l => l.elementType === 'select')) {
      const methodName = 'select' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Dropdown$/, '');
      methods.push({
        name: methodName,
        code: [
          `  async ${methodName}(option: string) {`,
          `    await this.safeSelect(this.${loc.variableName}, option);`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    // Combobox (custom dropdown)
    for (const loc of locators.filter(l => l.elementType === 'combobox')) {
      const methodName = 'select' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Dropdown$|Element$/, '');
      methods.push({
        name: methodName,
        code: [
          `  async ${methodName}(option: string) {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.click();`,
          `    await this.page.getByRole('option', { name: option }).first().click();`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    // Menu hover
    for (const loc of locators.filter(l => l.elementType === 'menu')) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Element$|Menu$/, '');
      methods.push({
        name: `hover${baseName}Menu`,
        code: [
          `  async hover${baseName}Menu() {`,
          `    await this.safeHover(this.${loc.variableName});`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    // Checkbox
    for (const loc of locators.filter(l => l.elementType === 'checkbox')) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Element$|Input$/, '');
      methods.push({
        name: `check${baseName}`,
        code: [
          `  async check${baseName}() {`,
          `    await this.${loc.variableName}.check();`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
      methods.push({
        name: `uncheck${baseName}`,
        code: [
          `  async uncheck${baseName}() {`,
          `    await this.${loc.variableName}.uncheck();`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    // Radio
    for (const loc of locators.filter(l => l.elementType === 'radio')) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Element$|Input$/, '');
      methods.push({
        name: `select${baseName}`,
        code: [
          `  async select${baseName}() {`,
          `    await this.${loc.variableName}.check();`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }

    return { methods, consumedByCompound };
  }

  // ─── Assertion methods ──────────────────────────────────────────────────────

  private extractAssertionMethods(
    steps: FeatureStep[],
    snapshot: { candidateTargets: Set<string> }
  ): Array<{ name: string; code: string }> {
    const methods: Array<{ name: string; code: string }> = [];
    const seen = new Set<string>();
    for (const step of steps) {
      if (step.action !== 'assert') continue;
      if (!snapshot.candidateTargets.has(step.target)) continue;
      const key = step.target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const cleanName = step.target.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
        .map((p, i) => i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))
        .join('');
      const methodName = `assert${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Visible`;
      methods.push({
        name: methodName,
        code: [
          `  async ${methodName}() {`,
          `    await expect(this.page.getByText('${esc(step.target)}', { exact: false })).toBeVisible({ timeout: 10000 });`,
          `    return this;`,
          `  }`,
        ].join('\n'),
      });
    }
    return methods;
  }

  // ─── Locator Building (Tier 1, Item 1: Priority Chain) ─────────────────────

  private buildLocator(el: ElementInfo, candidate: string): { locator: string; strategy: string; confidence: number } {
    const role = this.inferRole(el);

    for (const strat of LOCATOR_STRATEGIES) {
      const result = strat.build(el, candidate, role);
      if (result) {
        return { locator: result, strategy: strat.name, confidence: strat.weight };
      }
    }
    return { locator: `this.page.locator('${el.tag}')`, strategy: 'css-generic', confidence: 30 };
  }

  // ─── Match Candidate ───────────────────────────────────────────────────────

  private matchCandidate(
    candidate: string,
    elements: ElementInfo[]
  ): { locator: string; liveSelector: string; elementType: POMLocator['elementType']; element: ElementInfo; strategy: string; confidence: number } | null {
    const lower = candidate.toLowerCase();
    const candidateClean = lower.replace(/[:\s]+$/, '').trim();

    // Positional match for patterns like "user1", "item2"
    const posMatch = candidateClean.match(/^([a-z]+?)(\d+)$/);
    if (posMatch) {
      const n = parseInt(posMatch[2]) - 1;
      const groupSelectors = [
        { sel: '.figure', tag: 'div', className: 'figure' },
        { sel: '.card', tag: 'div', className: 'card' },
        { sel: '.tile', tag: 'div', className: 'tile' },
        { sel: '.item', tag: 'div', className: 'item' },
        { sel: '.product', tag: 'div', className: 'product' },
      ];
      for (const grp of groupSelectors) {
        const matching = elements.filter(el => el.tag === grp.tag && true);
        if (matching.length > n) {
          return {
            locator: `this.page.locator('${grp.sel}').nth(${n})`,
            liveSelector: grp.sel,
            elementType: 'other',
            element: { ...matching[0], text: candidate },
            strategy: 'positional',
            confidence: 75,
          };
        }
      }
      const imgs = elements.filter(el => el.tag === 'img');
      if (imgs.length > n) {
        return {
          locator: `this.page.locator('img').nth(${n})`,
          liveSelector: 'img',
          elementType: 'other',
          element: { ...imgs[n], text: candidate },
          strategy: 'positional',
          confidence: 70,
        };
      }
    }

    // Score-based matching
    const scored = elements.map(el => ({
      el,
      score: this.scoreMatch(candidateClean, el),
    })).filter(s => s.score > 0);
    scored.sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0].el;
      const built = this.buildLocator(best, candidate);
      return {
        locator: built.locator,
        liveSelector: this.buildLiveSelector(best, candidate),
        elementType: this.getElementType(best),
        element: best,
        strategy: built.strategy,
        confidence: built.confidence,
      };
    }

    return null;
  }

  // ─── Scoring ────────────────────────────────────────────────────────────────

  private scoreMatch(candidate: string, el: ElementInfo): number {
    let score = 0;
    const fields = [
      { val: el.testId.toLowerCase(), weight: 100 },
      { val: el.ariaLabel.toLowerCase(), weight: 95 },
      { val: el.placeholder.toLowerCase(), weight: 90 },
      { val: el.name.toLowerCase(), weight: 85 },
      { val: el.id.toLowerCase(), weight: 80 },
      { val: el.text.toLowerCase(), weight: 70 },
      { val: el.value.toLowerCase(), weight: 60 },
    ];
    for (const f of fields) {
      if (!f.val) continue;
      if (f.val === candidate) score += f.weight;
      else if (f.val.includes(candidate) || candidate.includes(f.val)) score += f.weight * 0.7;
      else if (this.fuzzyMatch(candidate, f.val)) score += f.weight * 0.4;
    }
    return score;
  }

  private fuzzyMatch(a: string, b: string): boolean {
    const wordsA = a.split(/\s+/).filter(w => w.length > 2);
    const wordsB = b.split(/\s+/).filter(w => w.length > 2);
    return wordsA.some(w => wordsB.includes(w));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private buildLiveSelector(el: ElementInfo, candidate: string): string {
    if (el.testId) return `[data-testid="${el.testId}"]`;
    if (el.id) return `#${el.id}`;
    if (el.name) return `${el.tag}[name="${el.name}"]`;
    if (el.placeholder) return `[placeholder="${el.placeholder}"]`;
    if (el.ariaLabel) return `[aria-label="${el.ariaLabel}"]`;
    const text = (el.text || candidate).replace(/"/g, '\\"');
    return `text="${text}"`;
  }

  private resolveLiveLocator(page: Page, selector: string, candidate: string): any {
    if (selector.startsWith('text=')) {
      const text = selector.substring(6, selector.length - 1);
      return page.getByText(text, { exact: false }).first();
    }
    const posMatch = candidate.toLowerCase().match(/^([a-z]+)(\d+)$/);
    if (posMatch) {
      const n = parseInt(posMatch[2]) - 1;
      return page.locator(selector).nth(n);
    }
    return page.locator(selector).or(page.getByRole('button', { name: candidate })).or(page.getByRole('link', { name: candidate })).first();
  }

  private inferRole(el: ElementInfo): string {
    if (el.role) return el.role;
    if (el.tag === 'a' && el.href) return 'link';
    if (el.tag === 'button') return 'button';
    if (el.tag === 'input') {
      if (el.type === 'submit' || el.type === 'button') return 'button';
      if (el.type === 'checkbox') return 'checkbox';
      if (el.type === 'radio') return 'radio';
      if (el.type === 'text' || el.type === 'email' || el.type === 'password' || !el.type) return 'textbox';
    }
    if (el.tag === 'textarea') return 'textbox';
    if (el.tag === 'select') return 'combobox';
    return '';
  }

  private getElementType(el: ElementInfo): POMLocator['elementType'] {
    if (el.tag === 'input' && el.type === 'checkbox') return 'checkbox';
    if (el.tag === 'input' && el.type === 'radio') return 'radio';
    if (el.tag === 'button' || (el.tag === 'input' && (el.type === 'submit' || el.type === 'button'))) return 'button';
    if (el.tag === 'input' || el.tag === 'textarea') return 'input';
    if (el.tag === 'a') return 'link';
    if (el.tag === 'select') return 'select';
    if (el.role === 'combobox' || el.role === 'listbox') return 'combobox';
    if (el.role === 'menu' || el.role === 'menuitem') return 'menu';
    return 'other';
  }

  private toVariableName(fieldName: string, type: POMLocator['elementType']): string {
    const clean = fieldName.replace(/[:\s]+$/, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
    const parts = clean.split(/\s+/);
    const camelCase = parts[0].toLowerCase() + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    const suffixMap: Record<string, string> = {
      input: 'Input', button: 'Button', link: 'Link', select: 'Dropdown',
      checkbox: 'Checkbox', radio: 'Radio', text: 'Text', other: 'Element',
      combobox: 'Dropdown', menu: 'Menu',
    };
    return camelCase + (suffixMap[type] || 'Element');
  }

  private generateClassName(url: string, featureName?: string): string {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/+|\/+$/g, '');
      if (path) {
        const segments = path.split('/').filter(s => s && !s.match(/^\d+$/));
        if (segments.length > 0) {
          const name = segments[segments.length - 1]
            .replace(/[^a-zA-Z0-9]/g, ' ')
            .split(/\s+/)
            .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
            .join('');
          return name + 'Page';
        }
      }
    } catch { /* ignore */ }
    if (featureName) {
      return featureName.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join('') + 'Page';
    }
    return 'AppPage';
  }

  // ─── DOM Extraction ─────────────────────────────────────────────────────────

  private async extractDOMElements(page: Page): Promise<ElementInfo[]> {
    const result = await page.evaluate(`(() => {
      const selector = [
        'input', 'button', 'a', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[role="textbox"]', '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="menu"]',
        'label',
        'img', '.figure', '.card', '.tile', '.item', '.product', '[class*="figure"]',
        '[class*="card"]', '[class*="tile"]', '[class*="hover"]', '[class*="menu-item"]',
        '[onclick]', '[onmouseover]', '[onmouseenter]'
      ].join(', ');
      const seen = new Set();
      const elements = Array.from(document.querySelectorAll(selector)).filter(el => {
        if (seen.has(el)) return false;
        seen.add(el);
        return true;
      });
      return elements.map(function(el) {
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const inLayout = rect.width > 0 && rect.height > 0;
        const notDisplayNone = cs.display !== 'none';
        const notVisibilityHidden = cs.visibility !== 'hidden';
        const visible = inLayout && notDisplayNone && notVisibilityHidden;
        const src = el.src || el.getAttribute('src') || '';
        const nearbyText = (el.innerText || el.textContent || '').trim().substring(0, 200);
        const allChildText = Array.from(el.querySelectorAll('*'))
          .map(c => (c.innerText || c.textContent || '').trim())
          .filter(t => t && t.length < 100)
          .join(' ');

        // Detect component regions
        function isInside(tagNames) {
          let p = el.parentElement;
          while (p) {
            const pTag = p.tagName.toLowerCase();
            const pRole = p.getAttribute('role') || '';
            const pClass = (p.className || '').toLowerCase();
            for (const t of tagNames) {
              if (pTag === t || pRole === t || pClass.includes(t)) return true;
            }
            p = p.parentElement;
          }
          return false;
        }

        return {
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('alt') || '',
          text: nearbyText || allChildText.substring(0, 100),
          testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '',
          value: el.value || src.split('/').pop() || '',
          href: el.href || '',
          role: el.getAttribute('role') || '',
          visible: visible,
          className: (el.className || '').toString().substring(0, 200),
          parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : '',
          isInsideHeader: isInside(['header', 'banner']),
          isInsideFooter: isInside(['footer', 'contentinfo']),
          isInsideNav: isInside(['nav', 'navigation', 'navbar', 'sidebar']),
          isInsideModal: isInside(['dialog', 'modal']),
          isInsideSidebar: isInside(['aside', 'sidebar']),
          isInsideTable: isInside(['table']),
          boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }).filter(function(e) {
        return e.visible || e.tag === 'img' || e.tag === 'div';
      });
    })()`);
    return result as ElementInfo[];
  }

  private async computeDomHash(page: Page): Promise<string> {
    const result = await page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('a:not([hidden]), button:not([hidden]), input:not([type="hidden"])'));
      const visible = els.filter(function(el) {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const sig = visible.map(function(el) {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 30);
        return el.tagName + '|' + text;
      }).join('::');
      let hash = 0;
      for (let i = 0; i < sig.length; i++) {
        hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
      }
      return hash.toString(16);
    })()`);
    return String(result);
  }

  // ─── Step Parsing ───────────────────────────────────────────────────────────

  private pickFlowFollowingScenario(parsed: any): any {
    const scenarios = (parsed.scenarios || []).filter((s: any) => !(s.tags || []).includes('@background'));
    if (scenarios.length === 0) return null;
    let pick = scenarios.find((s: any) => (s.tags || []).includes('@smoke') && (s.tags || []).includes('@positive'));
    if (pick) return pick;
    pick = scenarios.find((s: any) => (s.tags || []).includes('@positive'));
    if (pick) return pick;
    pick = scenarios.find((s: any) => (s.tags || []).includes('@smoke'));
    if (pick) return pick;
    pick = scenarios.find((s: any) => (s.tags || []).includes('@happy-path') || (s.tags || []).includes('@e2e'));
    if (pick) return pick;
    pick = scenarios.find((s: any) => !(s.tags || []).includes('@negative'));
    if (pick) return pick;
    return scenarios[0];
  }

  private parseScenarioIntoSteps(scenario: any): FeatureStep[] {
    const steps: FeatureStep[] = [];
    let idx = 0;
    const example = (scenario.examples && scenario.examples[0]) || null;
    for (const step of scenario.steps || []) {
      let text = (step.text || '').trim();
      if (example) {
        for (const [key, value] of Object.entries(example)) {
          text = text.replace(new RegExp(`<${key}>`, 'g'), String(value));
        }
      }
      const parsed = this.parseStepText(text, idx);
      if (parsed) { steps.push(parsed); idx++; }
    }
    return steps;
  }

  private parseFeatureIntoSteps(parsed: any): FeatureStep[] {
    const steps: FeatureStep[] = [];
    let idx = 0;
    for (const scenario of parsed.scenarios || []) {
      for (const step of scenario.steps || []) {
        const parsedStep = this.parseStepText((step.text || '').trim(), idx);
        if (parsedStep) { steps.push(parsedStep); idx++; }
      }
    }
    return steps;
  }

  private parseStepText(text: string, idx: number): FeatureStep | null {
    const lower = text.toLowerCase();
    const quotes = (text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
    if (quotes.length === 0) return null;

    const firstQuote = quotes[0];
    if (firstQuote.startsWith('http') || firstQuote === '/' || /^\/[a-z]/.test(firstQuote)) return null;
    if (/^\d+$/.test(firstQuote)) return null;

    if (lower.match(/\b(hover|mouseover|mouse over)\b/)) {
      return { idx, action: 'hover', target: firstQuote };
    }
    if (lower.match(/\bselect\b.*\bfrom\b/) && quotes.length >= 2) {
      return { idx, action: 'select', target: quotes[1], optionValue: quotes[0] };
    }
    if (lower.match(/\bselect\b.*\bin\b/) && quotes.length >= 2) {
      return { idx, action: 'select', target: quotes[1], optionValue: quotes[0] };
    }
    if (lower.match(/^(i )?select\s+"/) && quotes.length === 1) {
      return { idx, action: 'select', target: firstQuote, optionValue: firstQuote };
    }
    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter') || lower.includes('set')) {
      return { idx, action: 'fill', target: firstQuote, value: quotes[1] || '' };
    }
    if (lower.includes('click')) {
      return { idx, action: 'click', target: firstQuote };
    }
    if (lower.includes('uncheck')) {
      return { idx, action: 'check', target: firstQuote, value: 'uncheck' };
    }
    if (lower.includes('check')) {
      return { idx, action: 'check', target: firstQuote, value: 'check' };
    }
    if (lower.includes('should see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown')) {
      return { idx, action: 'assert', target: firstQuote };
    }
    return null;
  }

  // ─── Apply POM to Feature ───────────────────────────────────────────────────

  applyMultiplePOMsToFeature(
    featureContent: string,
    poms: POMResult[],
    baseUrl: string
  ): string {
    if (!poms || poms.length === 0) throw new Error('At least one POM is required');
    if (poms.length === 1) return this.applyPOMToFeature(featureContent, poms[0], baseUrl);

    const parsed = bddService.parseFeatureContent(featureContent);
    const pomInstances = poms.map(p => ({
      pom: p,
      instanceName: p.className.charAt(0).toLowerCase() + p.className.slice(1),
    }));

    const background = (parsed.scenarios || []).find((s: any) => (s.tags || []).includes('@background'));

    const lines: string[] = [];
    lines.push(`import { test, expect } from '@playwright/test';`);
    for (const p of poms) {
      lines.push(`import { ${p.className} } from '../pages/${p.className}';`);
    }
    lines.push('');
    lines.push(`const BASE_URL = process.env.BASE_URL || '${esc(baseUrl)}';`);
    lines.push('');
    lines.push(`test.describe('${esc(parsed.name || 'Feature')}', () => {`);

    if (background && background.steps.length > 0) {
      lines.push(`  test.beforeEach(async ({ page }) => {`);
      for (const pi of pomInstances) {
        lines.push(`    const ${pi.instanceName} = new ${pi.pom.className}(page);`);
      }
      lines.push('');
      const bgContext = { activePOM: pomInstances[0] };
      for (const step of background.steps) {
        lines.push(`    // ${step.keyword} ${step.text}`);
        const call = this.mapStepToMultiPOMCallWithContext(step.text, pomInstances, bgContext);
        lines.push(`    ${call}`);
      }
      lines.push(`  });`);
      lines.push('');
    }

    for (const scenario of parsed.scenarios || []) {
      if ((scenario.tags || []).includes('@background')) continue;
      const isOutline = scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0;
      const runs: any[] = isOutline ? scenario.examples! : [null];
      const tags = (scenario.tags || []).filter((t: string) => t && t !== '@background');

      for (const example of runs) {
        const nameSuffix = example ? ` (${Object.entries(example).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
        const testOptions = tags.length > 0
          ? `, { tag: [${tags.map((t: string) => `'${esc(t)}'`).join(', ')}] }`
          : '';
        lines.push(`  test('${esc(scenario.name + nameSuffix)}'${testOptions}, async ({ page }) => {`);
        for (const pi of pomInstances) {
          lines.push(`    const ${pi.instanceName} = new ${pi.pom.className}(page);`);
        }
        lines.push('');

        const stepTexts = scenario.steps.map((s: any) => {
          let t = s.text;
          if (example) {
            for (const [key, value] of Object.entries(example)) {
              t = t.replace(new RegExp(`<${key}>`, 'g'), String(value));
            }
          }
          return { keyword: s.keyword, text: t };
        });

        // Compound login detection
        const loginPOM = pomInstances.find(pi => pi.pom.methods.includes('login'));
        const consumed = new Set<number>();
        let loginCallEmitAt = -1;
        let loginCallCode = '';
        if (loginPOM) {
          const fillSteps: Array<{ field: string; value: string; idx: number }> = [];
          stepTexts.forEach((step: any, idx: number) => {
            const lower = step.text.toLowerCase();
            const quotes = (step.text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
            if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type')) && quotes.length >= 2) {
              fillSteps.push({ field: quotes[0], value: quotes[1], idx });
            }
          });
          const userFill = fillSteps.find(f => /user|email/i.test(f.field));
          const passFill = fillSteps.find(f => /pass/i.test(f.field));
          if (userFill && passFill) {
            const afterFills = Math.max(userFill.idx, passFill.idx);
            const clickLoginIdx = stepTexts.findIndex((s: any, i: number) => {
              if (i <= afterFills) return false;
              const lower = s.text.toLowerCase();
              const quotes = (s.text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
              return lower.includes('click') && quotes[0] && /^(login|submit|log\s*in)$/i.test(quotes[0].trim());
            });
            if (clickLoginIdx > -1) {
              consumed.add(userFill.idx);
              consumed.add(passFill.idx);
              consumed.add(clickLoginIdx);
              loginCallEmitAt = clickLoginIdx;
              loginCallCode = `    await ${loginPOM.instanceName}.login('${esc(userFill.value)}', '${esc(passFill.value)}');`;
            }
          }
        }

        const context = { activePOM: pomInstances[0] };
        stepTexts.forEach((step: any, idx: number) => {
          if (consumed.has(idx)) {
            lines.push(`    // ${step.keyword} ${step.text}`);
            if (idx === loginCallEmitAt) lines.push(loginCallCode);
            return;
          }
          lines.push(`    // ${step.keyword} ${step.text}`);
          const call = this.mapStepToMultiPOMCallWithContext(step.text, pomInstances, context);
          lines.push(`    ${call}`);
        });

        lines.push(`  });`);
        lines.push('');
      }
    }

    lines.push(`});`);
    return lines.join('\n');
  }

  private mapStepToMultiPOMCallWithContext(
    stepText: string,
    pomInstances: Array<{ pom: POMResult; instanceName: string }>,
    context: { activePOM: { pom: POMResult; instanceName: string } }
  ): string {
    const lower = stepText.toLowerCase();
    const quotes = (stepText.match(/"([^"]*)"/g) || []).map(m => m.replace(/"/g, ''));

    if (lower.includes('navigate') || lower.match(/^(i )?(go to|open|visit|am on)/)) {
      return `await ${pomInstances[0].instanceName}.navigate();`;
    }

    const parsedStep = this.parseStepText(stepText, 0);

    if (quotes.length >= 1) {
      const target = parsedStep?.target || quotes[0];
      const value = parsedStep?.value !== undefined ? parsedStep.value : quotes[1];
      const optionValue = parsedStep?.optionValue;

      const searchOrder = [context.activePOM, ...pomInstances.filter(pi => pi !== context.activePOM)];

      for (const pi of searchOrder) {
        const loc = this.findLocatorForField(target, pi.pom);
        if (!loc) continue;

        if (parsedStep?.action === 'hover' || lower.match(/\b(hover|mouseover|mouse over)\b/)) {
          return `await ${pi.instanceName}.safeHover(${pi.instanceName}.${loc.variableName});`;
        }
        if (parsedStep?.action === 'select' && optionValue !== undefined) {
          if (loc.elementType === 'select') return `await ${pi.instanceName}.safeSelect(${pi.instanceName}.${loc.variableName}, '${esc(optionValue)}');`;
          if (loc.elementType === 'combobox') return `await ${pi.instanceName}.${loc.variableName}.click();\n    await page.getByRole('option', { name: '${esc(optionValue)}' }).first().click();`;
          return `await ${pi.instanceName}.${loc.variableName}.selectOption('${esc(optionValue)}');`;
        }
        if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set')) && value !== undefined && value !== '') {
          return `await ${pi.instanceName}.safeFill(${pi.instanceName}.${loc.variableName}, '${esc(value)}');`;
        }
        if (lower.includes('click')) {
          if (pi !== context.activePOM) context.activePOM = pi;
          return `await ${pi.instanceName}.retryClick(${pi.instanceName}.${loc.variableName});`;
        }
        if (lower.includes('uncheck')) return `await ${pi.instanceName}.${loc.variableName}.uncheck();`;
        if (lower.includes('check')) return `await ${pi.instanceName}.${loc.variableName}.check();`;
      }

      if (parsedStep?.action === 'hover' || lower.match(/\b(hover|mouseover|mouse over)\b/)) {
        return `await page.getByText('${esc(target)}', { exact: false }).first().hover();`;
      }
      if (parsedStep?.action === 'select' && optionValue !== undefined) {
        return `await page.getByLabel('${esc(target)}').selectOption('${esc(optionValue)}');`;
      }

      if (lower.includes('should see') || lower.includes('is visible') || lower.includes('displayed')) {
        const cleanName = target.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
          .map((p, i) => i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))
          .join('');
        const methodName = `assert${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Visible`;
        for (const pi of searchOrder) {
          if (pi.pom.methods.includes(methodName)) return `await ${pi.instanceName}.${methodName}();`;
        }
        return `await expect(page.getByText('${esc(target)}', { exact: false })).toBeVisible({ timeout: 10000 });`;
      }
      if (lower.includes('should not see') || lower.includes('not visible')) {
        return `await expect(page.getByText('${esc(target)}')).toBeHidden();`;
      }

      if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type')) && value !== undefined) {
        return `await page.getByLabel('${esc(target.replace(/[:\s]+$/, '').trim())}').fill('${esc(value)}');`;
      }
      if (lower.includes('click')) {
        return `await page.getByRole('button', { name: '${esc(target)}' }).or(page.getByRole('link', { name: '${esc(target)}' })).first().click();`;
      }
    }

    return `// TODO: unmapped step — ${stepText}`;
  }

  applyPOMToFeature(featureContent: string, pom: POMResult, baseUrl: string): string {
    const parsed = bddService.parseFeatureContent(featureContent);
    const instanceName = pom.className.charAt(0).toLowerCase() + pom.className.slice(1);

    const lines: string[] = [];
    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push(`import { ${pom.className} } from '../pages/${pom.className}';`);
    lines.push('');
    lines.push(`const BASE_URL = process.env.BASE_URL || '${esc(baseUrl)}';`);
    lines.push('');
    lines.push(`test.describe('${esc(parsed.name || 'Feature')}', () => {`);

    for (const scenario of parsed.scenarios || []) {
      if ((scenario.tags || []).includes('@background')) continue;
      const isOutline = scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0;
      const runs: any[] = isOutline ? scenario.examples! : [null];

      for (const example of runs) {
        const nameSuffix = example ? ` (${Object.entries(example).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
        lines.push(`  test('${esc(scenario.name + nameSuffix)}', async ({ page }) => {`);
        lines.push(`    const ${instanceName} = new ${pom.className}(page);`);

        const stepTexts = scenario.steps.map((s: any) => {
          let t = s.text;
          if (example) {
            for (const [key, value] of Object.entries(example)) {
              t = t.replace(new RegExp(`<${key}>`, 'g'), String(value));
            }
          }
          return { keyword: s.keyword, text: t };
        });

        // Compound login detection
        const hasLoginMethod = pom.methods.includes('login');
        const consumed = new Set<number>();
        let loginCallEmitAt = -1;
        let loginCallCode = '';
        if (hasLoginMethod) {
          const fillSteps: Array<{ field: string; value: string; idx: number }> = [];
          stepTexts.forEach((step: any, idx: number) => {
            const lower = step.text.toLowerCase();
            const quotes = (step.text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
            if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type')) && quotes.length >= 2) {
              fillSteps.push({ field: quotes[0], value: quotes[1], idx });
            }
          });
          const userFill = fillSteps.find(f => /user|email/i.test(f.field));
          const passFill = fillSteps.find(f => /pass/i.test(f.field));
          if (userFill && passFill) {
            const afterFills = Math.max(userFill.idx, passFill.idx);
            const clickLoginIdx = stepTexts.findIndex((s: any, i: number) => {
              if (i <= afterFills) return false;
              const lower = s.text.toLowerCase();
              const quotes = (s.text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
              return lower.includes('click') && quotes[0] && /^(login|submit|log\s*in)$/i.test(quotes[0].trim());
            });
            if (clickLoginIdx > -1) {
              consumed.add(userFill.idx);
              consumed.add(passFill.idx);
              consumed.add(clickLoginIdx);
              loginCallEmitAt = clickLoginIdx;
              loginCallCode = `    await ${instanceName}.login('${esc(userFill.value)}', '${esc(passFill.value)}');`;
            }
          }
        }

        stepTexts.forEach((step: any, idx: number) => {
          if (consumed.has(idx)) {
            lines.push(`    // ${step.keyword} ${step.text}`);
            if (idx === loginCallEmitAt) lines.push(loginCallCode);
            return;
          }
          lines.push(`    // ${step.keyword} ${step.text}`);
          lines.push(`    ${this.mapStepToPOMCall(step.text, pom, instanceName)}`);
        });

        lines.push(`  });`);
        lines.push('');
      }
    }

    lines.push(`});`);
    return lines.join('\n');
  }

  private mapStepToPOMCall(stepText: string, pom: POMResult, instance: string): string {
    const lower = stepText.toLowerCase();
    const quotes = (stepText.match(/"([^"]*)"/g) || []).map(m => m.replace(/"/g, ''));

    if (lower.includes('navigate') || lower.match(/^(i )?(go to|open|visit|am on)/)) {
      return `await ${instance}.navigate();`;
    }
    if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set')) && quotes.length >= 2) {
      const locator = this.findLocatorForField(quotes[0], pom);
      if (locator) return `await ${instance}.safeFill(${instance}.${locator.variableName}, '${esc(quotes[1])}');`;
      return `await page.getByLabel('${esc(quotes[0].replace(/[:\s]+$/, '').trim())}').fill('${esc(quotes[1])}');`;
    }
    if (lower.includes('click') && quotes[0]) {
      const locator = this.findLocatorForField(quotes[0], pom);
      if (locator) return `await ${instance}.retryClick(${instance}.${locator.variableName});`;
      return `await page.getByRole('button', { name: '${esc(quotes[0])}' }).click();`;
    }
    if (lower.match(/\b(hover|mouseover)\b/) && quotes[0]) {
      const locator = this.findLocatorForField(quotes[0], pom);
      if (locator) return `await ${instance}.safeHover(${instance}.${locator.variableName});`;
      return `await page.getByText('${esc(quotes[0])}').first().hover();`;
    }
    if (lower.includes('should see') || lower.includes('is visible') || lower.includes('displayed')) {
      const target = quotes[0];
      if (!target) return `// TODO: ${stepText}`;
      return `await expect(page.getByText('${esc(target)}', { exact: false })).toBeVisible({ timeout: 10000 });`;
    }
    if (lower.includes('should not see') || lower.includes('not visible')) {
      const target = quotes[0];
      if (!target) return `// TODO: ${stepText}`;
      return `await expect(page.getByText('${esc(target)}')).toBeHidden();`;
    }
    return `// TODO: unmapped step — ${stepText}`;
  }

  private findLocatorForField(fieldName: string, pom: POMResult): POMLocator | undefined {
    const clean = fieldName.replace(/[:\s]+$/, '').trim().toLowerCase();
    let match = pom.locators.find(l => l.fieldName.toLowerCase() === clean);
    if (match) return match;
    match = pom.locators.find(l => l.fieldName.toLowerCase().includes(clean) || clean.includes(l.fieldName.toLowerCase()));
    return match;
  }
}

export const pomGeneratorService = new POMGeneratorService();
