import { chromium, Page, Browser } from 'playwright-core';
import { logger } from '../../utils/logger';
import { bddService } from './bdd.service';
import { validatePublicUrl } from '../../utils/urlValidator';
import { safeResolveLocator } from '../../utils/locatorStrategy';

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

  /**
   * Chain multiple hovers (for two-level hover menus).
   * Each entry is hovered in order, settled with a short wait so the next
   * level has time to render, then the final entry is hovered last.
   */
  async hoverChain(locators: Locator[], settleMs = 200) {
    for (const loc of locators) {
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.hover();
      await this.page.waitForTimeout(settleMs);
    }
    return this;
  }

  /** Select option from native dropdown with wait */
  async safeSelect(locator: Locator, option: string, timeout = 5000) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.selectOption(option);
    return this;
  }

  /**
   * Dropdown-taxonomy-aware select. Detects the widget at runtime:
   *  - native <select>  -> selectOption(...)
   *  - ARIA combobox / listbox / custom -> click to open, wait, pick by role/text
   *
   * Waits for the option to actually appear (async-rendered dropdowns take
   * 200–1000ms). Tries four locator fallbacks for the option itself.
   */
  async smartSelect(locator: Locator, option: string, opts: { timeout?: number } = {}) {
    const timeout = opts.timeout ?? 10000;
    await locator.waitFor({ state: 'visible', timeout });
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});

    // Wrap the tag probe so a stale/detached locator doesn't abort the whole
    // select — we fall through to the custom-dropdown branch when unknown.
    let tag = '';
    let inputType = '';
    try {
      const probe = await locator.evaluate((el: HTMLElement) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type || '',
      }), { timeout: 2000 } as any);
      tag = probe.tag;
      inputType = probe.type;
    } catch { tag = ''; }
    if (tag === 'select') {
      await locator.selectOption(option);
      return this;
    }

    // Typeahead / searchable comboboxes: the trigger is a text input with
    // role="combobox" (or autocomplete/list attributes). Open by focusing,
    // type the option, wait for a filtered option, then pick it.
    const looksLikeTypeahead =
      tag === 'input' && (inputType === 'text' || inputType === 'search' || inputType === '');
    if (looksLikeTypeahead) {
      await locator.click({ timeout });
      await locator.fill('');
      await locator.type(option, { delay: 20 });
      const optionLoc = this.page.getByRole('option', { name: option, exact: false }).first()
        .or(this.page.locator('[role="listbox"] [role="option"]', { hasText: option }).first())
        .or(this.page.locator('li[role="option"]', { hasText: option }).first())
        .first();
      await optionLoc.waitFor({ state: 'visible', timeout });
      await optionLoc.click();
      return this;
    }

    await locator.click({ timeout });

    // Each branch ends in .first() — without that, two options sharing the
    // query text ("Open" and "Open account") trip strict-mode throws.
    const optionLoc = this.page.getByRole('option', { name: option, exact: false }).first()
      .or(this.page.locator('[role="listbox"] [role="option"]', { hasText: option }).first())
      .or(this.page.locator('[role="menuitem"]', { hasText: option }).first())
      .or(this.page.locator('li', { hasText: option }).first())
      .first();
    await optionLoc.waitFor({ state: 'visible', timeout });
    await optionLoc.click();
    return this;
  }

  /**
   * Multi-select dropdown — applies multiple options in one open. Works for:
   *  - native <select multiple> (uses selectOption with an array)
   *  - custom checkbox-in-dropdown (click trigger, then click each option)
   * The dropdown is only opened once; if it auto-closes between picks, pass
   * reopenBetween: true to click the trigger before each option.
   */
  async smartMultiSelect(
    locator: Locator,
    options: string[],
    opts: { timeout?: number; reopenBetween?: boolean } = {},
  ) {
    const timeout = opts.timeout ?? 10000;
    if (!Array.isArray(options) || options.length === 0) return this;
    await locator.waitFor({ state: 'visible', timeout });

    let tag = '';
    try { tag = await locator.evaluate((el: HTMLElement) => el.tagName.toLowerCase(), { timeout: 2000 } as any); } catch { /* fall through */ }
    if (tag === 'select') {
      await locator.selectOption(options);
      return this;
    }

    await locator.click({ timeout });
    for (const option of options) {
      if (opts.reopenBetween) {
        await locator.click({ timeout });
      }
      const optionLoc = this.page.getByRole('option', { name: option, exact: false }).first()
        .or(this.page.locator('[role="listbox"] [role="option"]', { hasText: option }).first())
        .or(this.page.locator('[role="menuitemcheckbox"]', { hasText: option }).first())
        .or(this.page.locator('li', { hasText: option }).first())
        .first();
      await optionLoc.waitFor({ state: 'visible', timeout });
      await optionLoc.click();
    }
    // Click outside to close for patterns that stay open.
    await this.page.keyboard.press('Escape').catch(() => {});
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
    options: {
      className?: string;
      waitForSelector?: string;
      /** Playwright storageState JSON (cookies + localStorage). Lets the
       *  generator scan post-login pages without replaying the login flow. */
      storageState?: any;
      /** When true, also run static-scan on the landing page and merge its
       *  classified components (tabs/lists/menus/forms) into the POM. */
      enrichWithScan?: boolean;
    } = {}
  ): Promise<POMResult[]> {
    const parsed = bddService.parseFeatureContent(featureContent);
    logger.info(`POM Generator: parsing feature with ${(parsed.scenarios || []).length} scenarios`);

    const scenarioForFlow = this.pickFlowFollowingScenario(parsed);
    logger.info(`POM Generator: using scenario "${scenarioForFlow?.name || 'none'}" for flow-following`);

    const allSteps: FeatureStep[] = this.parseFeatureIntoSteps(parsed);

    // Defence-in-depth: reject non-public URLs before launching a browser.
    // The controller also validates, but future internal callers might not.
    const allowPrivate = process.env.ALLOW_PRIVATE_SCAN_URLS === 'true';
    validatePublicUrl(targetUrl, { allowPrivate });

    let browser: Browser | null = null;
    let context: any = null;
    let page: any = null;
    try {
      browser = await chromium.launch({ headless: true });
      const contextOpts: any = {
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      };
      // storageState accepts either a path (legacy Playwright) or an object
      // ({ cookies, origins }). We persist it as-is so callers can pass either.
      if (options.storageState) contextOpts.storageState = options.storageState;
      context = await browser.newContext(contextOpts);
      page = await context.newPage();
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      throw e;
    }

    interface Snapshot {
      url: string;
      pagePath: string;
      className: string;
      elements: ElementInfo[];
      candidateTargets: Set<string>;
      domHash: string;
      /** Static-scan classification (tabs/lists/menus/forms) captured against
       *  the same open page. Populated only when enrichWithScan is true. */
      scanComponents?: any[];
    }
    const snapshots: Snapshot[] = [];

    // Lazy-loaded so the import only runs when enrichment is requested.
    let staticScanSvc: any = null;
    const getStaticScan = async () => {
      if (staticScanSvc) return staticScanSvc;
      try {
        staticScanSvc = (await import('./staticScan.service')).staticScanService;
      } catch (e: any) {
        logger.warn(`POM Generator: could not load staticScanService: ${e?.message}`);
        staticScanSvc = { scanOpenPage: async () => null };
      }
      return staticScanSvc;
    };

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

      // Enrichment runs at snapshot time (reuses the open Playwright Page, no
      // second browser launch) and is stored on the snapshot so the later
      // code-gen step can fold the components into the emitted TS class.
      let scanComponents: any[] | undefined;
      if (options.enrichWithScan) {
        try {
          const svc = await getStaticScan();
          const scan = await svc.scanOpenPage(page);
          if (scan?.components) scanComponents = scan.components;
        } catch (scanErr: any) {
          logger.warn(`POM Generator: scanOpenPage failed for ${url}: ${scanErr?.message}`);
        }
      }

      const snapshot: Snapshot = { url, pagePath, className: finalClassName, elements, candidateTargets: new Set(), domHash, scanComponents };
      snapshots.push(snapshot);
      logger.info(`POM Generator: snapshot for ${finalClassName} at ${url} — ${elements.length} elements${scanComponents ? ` + ${scanComponents.length} scan components` : ''}`);
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
            // Replaced eval() with an allowlist-based parser. If the locator
            // string doesn't match one of the supported Playwright getters,
            // safeResolveLocator returns null and we treat it as broken
            // rather than execute arbitrary code in the backend process.
            const pwLocator = safeResolveLocator(page, rawLocator);
            if (pwLocator) {
              matchCount = await pwLocator.count().catch(() => 0);
            } else {
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

        // Enrichment: fold static-scan components into `locators` BEFORE the
        // page-class TypeScript is emitted, so the merged locators become
        // first-class `readonly xxxTabs/Menu/List: Locator` declarations with
        // real constructor initializers. Otherwise the merged locators would
        // be referenced by apply-POM but missing from the emitted class.
        if (snapshot.scanComponents && snapshot.scanComponents.length > 0) {
          this.appendScanComponentsToLocators(snapshot.scanComponents, locators, usedVarNames);
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

      // Enrichment now runs per-snapshot inside `takeSnapshot()` and is
      // folded into `locators` before `buildPOMCode` — the emitted TS class
      // includes the merged tab/menu/list/form locators as real readonly
      // declarations with constructor initializers (not just in-memory
      // metadata). No post-hoc merge needed here.

      // Generate combined barrel index (Tier 2, Item 8)
      if (results.length > 0) {
        const combinedBarrel = this.generateBarrelIndex(results);
        results[0].barrelExport = combinedBarrel;
      }

      return results;
    } finally {
      if (browser) {
        await browser.close().catch(err => {
          logger.warn(`POM Generator: browser.close() failed: ${err?.message}`);
        });
      }
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
      // Surface low-confidence locators as @unstable JSDoc so reviewers notice
      // them at code-review time and the UI can highlight them before run.
      if ((loc.confidence ?? 100) < 60) {
        lines.push(`  /** @unstable confidence=${loc.confidence ?? 0} strategy=${loc.locatorStrategy} — review before merging */`);
      }
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
    // Top-document + open shadow-root traversal in one evaluate, plus same-
    // origin iframes enumerated via Playwright's frame API below.
    const extractForRoot = `function extractFromRoot(root) {
      const selectorList = [
        'input', 'button', 'a', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[role="textbox"]', '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="menu"]',
        'label',
        'img', '.figure', '.card', '.tile', '.item', '.product', '[class*="figure"]',
        '[class*="card"]', '[class*="tile"]', '[class*="hover"]', '[class*="menu-item"]',
        '[onclick]', '[onmouseover]', '[onmouseenter]'
      ].join(', ');
      const out = [];
      const seen = new Set();

      // Walk the DOM including open shadow roots. Closed shadow roots are
      // invisible to JS — we can't cross them without the app's cooperation.
      function walk(node) {
        if (!node || seen.has(node)) return;
        seen.add(node);
        // Only call matches/querySelectorAll on Elements & shadow-root hosts.
        if (node.querySelectorAll) {
          node.querySelectorAll(selectorList).forEach(el => { if (!out.includes(el)) out.push(el); });
        }
        // Recurse into open shadow roots.
        const allChildren = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const c of allChildren) {
          if (c.shadowRoot && c.shadowRoot.mode === 'open') walk(c.shadowRoot);
        }
      }
      walk(root);
      return out.map(function(el) {
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

        function isInside(tagNames) {
          let p = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
          while (p) {
            const pTag = p.tagName ? p.tagName.toLowerCase() : '';
            const pRole = p.getAttribute ? (p.getAttribute('role') || '') : '';
            const pClass = (p.className || '').toString().toLowerCase();
            for (const t of tagNames) {
              if (pTag === t || pRole === t || pClass.includes(t)) return true;
            }
            p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null;
          }
          return false;
        }

        return {
          tag: el.tagName ? el.tagName.toLowerCase() : '',
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
    }`;

    // Extract from main document (includes open shadow roots).
    const mainResult = await page.evaluate(`(() => {
      ${extractForRoot}
      return extractFromRoot(document);
    })()`);

    // Extract from same-origin iframes via Playwright's frame API so we don't
    // trip the same-origin policy in `page.evaluate`. Cross-origin frames are
    // skipped (browser blocks access). Failures per-frame are swallowed.
    const frameResults: ElementInfo[] = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const elements = await frame.evaluate(`(() => {
          ${extractForRoot}
          return extractFromRoot(document);
        })()`);
        if (Array.isArray(elements)) frameResults.push(...(elements as ElementInfo[]));
      } catch { /* cross-origin frame — skip */ }
    }

    return [...(mainResult as ElementInfo[]), ...frameResults];
  }

  private async computeDomHash(page: Page): Promise<string> {
    const result = await page.evaluate(`(() => {
      // Include role=option/listitem/menuitem/row so that opening a dropdown,
      // expanding a tree, or revealing a menu triggers a new snapshot — those
      // interactions don't alter the set of buttons/inputs but do change the
      // interactive surface the user can target.
      const els = Array.from(document.querySelectorAll(
        'a:not([hidden]), button:not([hidden]), input:not([type="hidden"]),' +
        ' [role="option"]:not([hidden]), [role="menuitem"]:not([hidden]),' +
        ' [role="listitem"]:not([hidden]), [role="row"]:not([hidden]),' +
        ' [role="tab"]:not([hidden])'
      ));
      const visible = els.filter(function(el) {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const sig = visible.map(function(el) {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 30);
        const role = el.getAttribute('role') || '';
        return el.tagName + (role ? ':' + role : '') + '|' + text;
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
          // Surface confidence across ALL POMs — take the highest match.
          let bestWarning: string | null = null;
          let bestConfidence = -1;
          const stepQuotes = (step.text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
          for (const pi of pomInstances) {
            const w = this.confidenceWarningForStep(step.text, pi.pom);
            if (w && bestConfidence === -1) bestWarning = w;
            // If any POM has a confident match, suppress the warning.
            const loc = this.findLocatorForField(stepQuotes[0] || '', pi.pom);
            if (loc && (loc.confidence ?? 100) >= bestConfidence) bestConfidence = loc.confidence ?? 100;
          }
          if (bestWarning && bestConfidence < 60) lines.push(`    ${bestWarning}`);
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

      // Derive the caller's intent once so each POM gets scored with the
      // correct role preference (click -> button/link, fill -> input, etc.).
      const intent: 'click' | 'fill' | 'select' | 'hover' | 'check' | 'assert' | undefined =
        parsedStep?.action === 'hover' || lower.match(/\b(hover|mouseover|mouse over)\b/) ? 'hover' :
        parsedStep?.action === 'select' ? 'select' :
        lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set') ? 'fill' :
        lower.includes('uncheck') || lower.includes('check') ? 'check' :
        lower.includes('click') ? 'click' :
        lower.includes('should see') || lower.includes('is visible') || lower.includes('displayed') ? 'assert' :
        undefined;

      for (const pi of searchOrder) {
        const loc = this.findLocatorForField(target, pi.pom, intent);
        if (!loc) continue;

        if (intent === 'hover') {
          return `await ${pi.instanceName}.safeHover(${pi.instanceName}.${loc.variableName});`;
        }
        if (intent === 'select' && optionValue !== undefined) {
          return `await ${pi.instanceName}.smartSelect(${pi.instanceName}.${loc.variableName}, '${esc(optionValue)}');`;
        }
        if (intent === 'fill' && value !== undefined && value !== '') {
          return `await ${pi.instanceName}.safeFill(${pi.instanceName}.${loc.variableName}, '${esc(value)}');`;
        }
        if (intent === 'click') {
          if (pi !== context.activePOM) context.activePOM = pi;
          return `await ${pi.instanceName}.retryClick(${pi.instanceName}.${loc.variableName});`;
        }
        if (intent === 'check' && lower.includes('uncheck')) return `await ${pi.instanceName}.${loc.variableName}.uncheck();`;
        if (intent === 'check') return `await ${pi.instanceName}.${loc.variableName}.check();`;
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

    // Fix Gap #14: Background → test.beforeEach
    const background = (parsed.scenarios || []).find((s: any) => (s.tags || []).includes('@background'));
    if (background && background.steps.length > 0) {
      lines.push(`  test.beforeEach(async ({ page }) => {`);
      lines.push(`    const ${instanceName} = new ${pom.className}(page);`);
      lines.push('');
      for (const step of background.steps) {
        lines.push(`    // ${step.keyword} ${step.text}`);
        lines.push(`    ${this.mapStepToPOMCall(step.text, pom, instanceName)}`);
      }
      lines.push(`  });`);
      lines.push('');
    }

    for (const scenario of parsed.scenarios || []) {
      if ((scenario.tags || []).includes('@background')) continue;
      const isOutline = scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0;
      const runs: any[] = isOutline ? scenario.examples! : [null];

      // Fix Gap #13: Tags → Playwright test annotations
      const tags = (scenario.tags || []).filter((t: string) => t && t !== '@background');

      for (const example of runs) {
        const nameSuffix = example ? ` (${Object.entries(example).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
        const testOptions = tags.length > 0
          ? `, { tag: [${tags.map((t: string) => `'${esc(t)}'`).join(', ')}] }`
          : '';
        lines.push(`  test('${esc(scenario.name + nameSuffix)}'${testOptions}, async ({ page }) => {`);
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
          // Annotate the resolved locator's confidence so low-quality matches
          // surface as comments in the emitted test file (and `@unstable` JSDoc
          // on class properties). Users see warnings in the dry-run preview.
          const warning = this.confidenceWarningForStep(step.text, pom);
          if (warning) lines.push(`    ${warning}`);
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
    const parsedStep = this.parseStepText(stepText, 0);

    // Navigation — emit absolute URLs verbatim, prepend BASE_URL for relative paths.
    if (lower.includes('navigate') || lower.match(/\b(go to|open|visit|am on|i am on)\b/)) {
      const url = quotes[0];
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return `await page.goto('${esc(url)}', { waitUntil: 'domcontentloaded' });`;
      }
      if (url && url.startsWith('/')) {
        return `await page.goto(BASE_URL + '${esc(url)}', { waitUntil: 'domcontentloaded' });`;
      }
      return `await ${instance}.navigate();`;
    }

    // Hover — chained ("hover Settings then Profile" / "A > B > C") or single.
    if (parsedStep?.action === 'hover' || lower.match(/\b(hover|mouseover|mouse over)\b/)) {
      const chain = this.detectHoverChain(stepText, quotes);
      if (chain && chain.length >= 2) {
        // Resolve each step of the chain via scored matching; fall back to a
        // best-effort multi-strategy locator for any step the POM doesn't know.
        const resolved = chain.map((name: string) => {
          const loc = this.findLocatorForField(name, pom, 'hover');
          if (loc) return `${instance}.${loc.variableName}`;
          return `page.getByRole('menuitem', { name: '${esc(name)}' }).or(page.getByRole('button', { name: '${esc(name)}' })).or(page.getByRole('link', { name: '${esc(name)}' })).or(page.getByText('${esc(name)}', { exact: false })).first()`;
        });
        return `await ${instance}.hoverChain([${resolved.join(', ')}]);`;
      }
      const target = parsedStep?.target || quotes[0];
      if (target) {
        const loc = this.findLocatorForField(target, pom, 'hover');
        if (loc) return `await ${instance}.safeHover(${instance}.${loc.variableName});`;
        // Multi-strategy fallback: icon-only menus don't respond to getByText.
        return `await page.getByRole('button', { name: '${esc(target)}' }).or(page.getByRole('link', { name: '${esc(target)}' })).or(page.getByLabel('${esc(target)}')).or(page.getByText('${esc(target)}', { exact: false })).first().hover();`;
      }
    }

    // Select/dropdown — unified taxonomy: native + ARIA combobox/listbox +
    // typeahead + multi-select + custom.
    if (parsedStep?.action === 'select' && parsedStep.optionValue !== undefined) {
      const loc = this.findLocatorForField(parsedStep.target, pom, 'select');
      // Multi-value syntax: "A, B, C" or "A | B | C" in the option value.
      const multiValues: string[] = this.splitMultiSelectValues(parsedStep.optionValue);
      if (multiValues.length > 1) {
        const literal = multiValues.map((v: string) => `'${esc(v)}'`).join(', ');
        if (loc) return `await ${instance}.smartMultiSelect(${instance}.${loc.variableName}, [${literal}]);`;
        return `await page.getByLabel('${esc(parsedStep.target)}').or(page.getByRole('combobox', { name: '${esc(parsedStep.target)}' })).first().click();\n    for (const opt of [${literal}]) {\n      await page.getByRole('option', { name: opt, exact: false }).first().click();\n    }`;
      }
      if (loc) return `await ${instance}.smartSelect(${instance}.${loc.variableName}, '${esc(parsedStep.optionValue)}');`;
      return `await page.getByLabel('${esc(parsedStep.target)}').or(page.getByRole('combobox', { name: '${esc(parsedStep.target)}' })).first().click();\n    await page.getByRole('option', { name: '${esc(parsedStep.optionValue)}', exact: false }).first().click();`;
    }

    // Fill
    if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set')) && quotes.length >= 2) {
      const loc = this.findLocatorForField(quotes[0], pom, 'fill');
      if (loc) return `await ${instance}.safeFill(${instance}.${loc.variableName}, '${esc(quotes[1])}');`;
      return `await page.getByLabel('${esc(quotes[0].replace(/[:\s]+$/, '').trim())}').or(page.getByPlaceholder('${esc(quotes[0])}')).first().fill('${esc(quotes[1])}');`;
    }

    // Click
    if (lower.includes('click') && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom, 'click');
      if (loc) return `await ${instance}.retryClick(${instance}.${loc.variableName});`;
      // Multi-strategy fallback: button > link > menuitem > label > text.
      return `await page.getByRole('button', { name: '${esc(quotes[0])}' }).or(page.getByRole('link', { name: '${esc(quotes[0])}' })).or(page.getByRole('menuitem', { name: '${esc(quotes[0])}' })).or(page.getByLabel('${esc(quotes[0])}')).or(page.getByText('${esc(quotes[0])}', { exact: false })).first().click();`;
    }

    // Uncheck (before check)
    if (lower.includes('uncheck') && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom, 'check');
      if (loc) return `await ${instance}.${loc.variableName}.uncheck();`;
      return `await page.getByRole('checkbox', { name: '${esc(quotes[0])}' }).uncheck();`;
    }

    // Check
    if (lower.includes('check') && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom, 'check');
      if (loc) return `await ${instance}.${loc.variableName}.check();`;
      return `await page.getByRole('checkbox', { name: '${esc(quotes[0])}' }).check();`;
    }

    // Wait
    if (lower.match(/\bwait\b|\bpause\b|\bdelay\b/)) {
      const seconds = quotes[0] ? parseInt(quotes[0]) : (lower.match(/(\d+)\s*second/)?.[1] ? parseInt(lower.match(/(\d+)\s*second/)![1]) : 1);
      return `await page.waitForTimeout(${seconds * 1000});`;
    }

    // Press key
    if (lower.match(/\bpress\b/) && quotes[0]) {
      return `await page.keyboard.press('${esc(quotes[0])}');`;
    }

    // Upload file — guard against "upload"/"attach" appearing inside quoted text
    // (e.g. `"Upload" should be visible` would otherwise hijack this branch).
    // Only fire when the verb appears in the un-quoted part of the step.
    {
      const unquoted = stepText.replace(/"[^"]*"/g, '').toLowerCase();
      const isUploadAction = /\b(upload|attach)\b/.test(unquoted);
      if (isUploadAction && quotes[0]) {
        const target = quotes.length >= 2 ? quotes[1] : '';
        // Prefer a POM locator that is actually a file input. The matcher
        // happily returns the page heading "File Uploader" for the field
        // name "File"; calling setInputFiles on a heading throws at runtime.
        const loc = target ? this.findLocatorForField(target, pom) : null;
        const isFileInput = (l: any) => l && (
          /type\s*=\s*["']file["']/i.test(l.locatorCode || '') ||
          /\bfileinput|fileupload|chooseFile|attachment/i.test(l.variableName || '')
        );
        if (loc && isFileInput(loc)) {
          return `await ${instance}.${loc.variableName}.setInputFiles('${esc(quotes[0])}');`;
        }
        return `await page.locator('input[type="file"]').first().setInputFiles('${esc(quotes[0])}');`;
      }
    }

    // Scroll
    if (lower.match(/\bscroll\b/) && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom);
      if (loc) return `await ${instance}.${loc.variableName}.scrollIntoViewIfNeeded();`;
      return `await page.getByText('${esc(quotes[0])}', { exact: false }).first().scrollIntoViewIfNeeded();`;
    }

    // Dialog
    if (lower.match(/\b(accept|dismiss|confirm|cancel)\b.*\b(dialog|alert|popup)\b/)) {
      const isAccept = lower.includes('accept') || lower.includes('confirm');
      return `page.once('dialog', async d => await d.${isAccept ? 'accept' : 'dismiss'}());`;
    }

    // Screenshot
    if (lower.match(/\bscreenshot\b|\bcapture\b/)) {
      return `await page.screenshot({ path: '${esc(quotes[0] || 'screenshot')}.png', fullPage: true });`;
    }

    // Assertions — visibility. Match: "should see", "is visible", "displayed",
    // "is shown", "should be visible", and the natural "I see the … button/link".
    // Prefers role-based locators when the step mentions "button"/"link".
    if (
      lower.includes('should see') ||
      lower.includes('is visible') ||
      lower.includes('displayed') ||
      lower.includes('is shown') ||
      lower.includes('should be visible') ||
      /\bsee the\b/.test(lower)
    ) {
      const target = quotes[0];
      if (!target) {
        const plainMatch = lower.match(/should see\s+(.+)/);
        if (plainMatch) return `await expect(page.getByText('${esc(plainMatch[1].trim())}', { exact: false })).toBeVisible({ timeout: 10000 });`;
        return `// TODO: ${stepText}`;
      }
      // 1) POM locator
      const loc = this.findLocatorForField(target, pom, 'assert');
      if (loc) return `await expect(${instance}.${loc.variableName}).toBeVisible({ timeout: 10000 });`;
      // 2) Role-specific when step text hints at button / link
      if (/\bbutton\b/.test(lower)) {
        return `await expect(page.getByRole('button', { name: '${esc(target)}' })).toBeVisible({ timeout: 10000 });`;
      }
      if (/\blink\b/.test(lower)) {
        return `await expect(page.getByRole('link', { name: '${esc(target)}' })).toBeVisible({ timeout: 10000 });`;
      }
      // 3) Reusable POM assertion method (e.g. assertLoginSuccessVisible)
      const cleanName = target.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
        .map((p, i) => i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)).join('');
      const methodName = `assert${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Visible`;
      if (pom.methods.includes(methodName)) return `await ${instance}.${methodName}();`;
      // 4) Text fallback
      return `await expect(page.getByText('${esc(target)}', { exact: false })).toBeVisible({ timeout: 10000 });`;
    }

    // Negative visibility. Match: "should not see", "not visible", "is hidden",
    // "should not be visible", and "I should not see the … button/link".
    if (
      lower.includes('should not see') ||
      lower.includes('not visible') ||
      lower.includes('is hidden') ||
      lower.includes('should not be visible') ||
      lower.includes('should be hidden')
    ) {
      const target = quotes[0];
      if (!target) return `// TODO: ${stepText}`;
      const loc = this.findLocatorForField(target, pom, 'assert');
      if (loc) return `await expect(${instance}.${loc.variableName}).toBeHidden();`;
      if (/\bbutton\b/.test(lower)) {
        return `await expect(page.getByRole('button', { name: '${esc(target)}' })).toBeHidden();`;
      }
      if (/\blink\b/.test(lower)) {
        return `await expect(page.getByRole('link', { name: '${esc(target)}' })).toBeHidden();`;
      }
      return `await expect(page.getByText('${esc(target)}')).toBeHidden();`;
    }

    // URL assertion
    if (lower.match(/should be on|should be at|url should/) && quotes[0]) {
      return `await expect(page).toHaveURL(new RegExp('${esc(quotes[0])}'));`;
    }

    // Title assertion
    if (lower.match(/title should|page title/) && quotes[0]) {
      return `await expect(page).toHaveTitle(new RegExp('${esc(quotes[0])}'));`;
    }

    // Disabled/enabled assertion
    if (lower.includes('should be disabled') && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom);
      if (loc) return `await expect(${instance}.${loc.variableName}).toBeDisabled();`;
      return `await expect(page.getByRole('button', { name: '${esc(quotes[0])}' })).toBeDisabled();`;
    }
    if (lower.includes('should be enabled') && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom);
      if (loc) return `await expect(${instance}.${loc.variableName}).toBeEnabled();`;
      return `await expect(page.getByRole('button', { name: '${esc(quotes[0])}' })).toBeEnabled();`;
    }

    // Checked/unchecked assertion
    if (lower.includes('should be checked') && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom);
      if (loc) return `await expect(${instance}.${loc.variableName}).toBeChecked();`;
      return `await expect(page.getByRole('checkbox', { name: '${esc(quotes[0])}' })).toBeChecked();`;
    }
    if (lower.match(/should (be unchecked|not be checked)/) && quotes[0]) {
      const loc = this.findLocatorForField(quotes[0], pom);
      if (loc) return `await expect(${instance}.${loc.variableName}).not.toBeChecked();`;
      return `await expect(page.getByRole('checkbox', { name: '${esc(quotes[0])}' })).not.toBeChecked();`;
    }

    // Value assertion
    if (lower.match(/should have value|value should be/) && quotes.length >= 2) {
      const loc = this.findLocatorForField(quotes[0], pom);
      if (loc) return `await expect(${instance}.${loc.variableName}).toHaveValue('${esc(quotes[1])}');`;
      return `await expect(page.getByLabel('${esc(quotes[0])}')).toHaveValue('${esc(quotes[1])}');`;
    }

    // Steps without quotes — common patterns
    if (quotes.length === 0) {
      if (lower.match(/\b(loaded|ready|initialized|opened)\b/)) return `await ${instance}.waitForPageLoad();`;
      if (lower.match(/\b(log\s*out|sign\s*out|logout|signout)\b/)) return `await page.getByRole('button', { name: /log\\s*out|sign\\s*out/i }).or(page.getByRole('link', { name: /log\\s*out|sign\\s*out/i })).first().click();`;
      if (lower.match(/\bsubmit\b/)) return `await page.getByRole('button', { name: /submit/i }).click();`;
      if (lower.match(/\b(go back|navigate back)\b/)) return `await page.goBack();`;
      if (lower.match(/\breload\b|\brefresh\b/)) return `await page.reload();`;
      if (lower.match(/\b(am on|on the)\b.*\b(page|form|screen)\b/)) return `await ${instance}.navigate();`;
    }

    return `// TODO: unmapped step — ${stepText}`;
  }

  /**
   * Score-based locator lookup. Replaces the old exact-or-substring match,
   * which was too weak for post-login pages where step text ("Click Home")
   * rarely matches the POM field name ("Go to Homepage") literally.
   *
   * Scoring dimensions:
   *  - fieldName exact / word-overlap / contains
   *  - variableName overlap (camelCase split)
   *  - element-type preference hint from the step text
   *    (click -> button/link, fill -> input, select -> select/combobox)
   *  - confidence bonus from the original POM (higher = more resilient)
   */
  private findLocatorForField(
    fieldName: string,
    pom: POMResult,
    intent?: 'click' | 'fill' | 'select' | 'hover' | 'check' | 'assert',
  ): POMLocator | undefined {
    const clean = fieldName.replace(/[:\s]+$/, '').trim().toLowerCase();
    if (!clean) return undefined;
    // Expand the probe with synonyms: users write "Sign In" but the POM has
    // a field called "Login", and vice versa. One variant matching is enough
    // to surface the locator — the highest-scoring hit across all variants wins.
    const variants = this.expandWithSynonyms(clean);
    const allCleanWords = Array.from(new Set(variants.flatMap(v => v.split(/\s+/).filter(w => w.length > 1))));

    const scoreLocAgainst = (loc: POMLocator, probe: string, probeWords: string[]): number => {
      const fn = (loc.fieldName || '').toLowerCase();
      const vn = this.splitCamelCase((loc.variableName || '')).toLowerCase();
      let s = 0;

      if (fn === probe) s += 200;
      else if (fn === probe.replace(/\s+/g, '')) s += 180;
      else if (fn.includes(probe)) s += 110;
      else if (probe.includes(fn) && fn.length >= 3) s += 90;
      else {
        const fnWords = fn.split(/\s+/).filter(w => w.length > 1);
        const overlap = probeWords.filter(w => fnWords.includes(w)).length;
        if (overlap > 0) s += 60 * (overlap / Math.max(probeWords.length, fnWords.length || 1));
      }

      const vnWords = vn.split(/\s+/).filter(w => w.length > 1);
      const vnOverlap = probeWords.filter(w => vnWords.includes(w)).length;
      if (vnOverlap > 0) s += 30 * (vnOverlap / Math.max(probeWords.length, vnWords.length || 1));

      const et = loc.elementType;
      if (intent === 'click' && (et === 'button' || et === 'link' || et === 'menu')) s += 25;
      else if (intent === 'fill' && et === 'input') s += 30;
      else if (intent === 'select' && (et === 'select' || et === 'combobox')) s += 40;
      else if (intent === 'check' && (et === 'checkbox' || et === 'radio')) s += 30;
      if (intent === 'click' && (et === 'input' || et === 'checkbox' || et === 'radio' || et === 'select')) s -= 15;
      if (intent === 'fill' && (et === 'button' || et === 'link')) s -= 20;

      s += Math.max(0, Math.min(15, Math.round((loc.confidence ?? 0) * 0.15)));
      return s;
    };

    const scored = pom.locators.map(l => {
      let best = 0;
      for (const variant of variants) {
        const vw = variant.split(/\s+/).filter(w => w.length > 1);
        const s = scoreLocAgainst(l, variant, vw.length > 0 ? vw : allCleanWords);
        if (s > best) best = s;
      }
      return { l, s: best };
    }).filter(x => x.s > 0);
    scored.sort((a, b) => b.s - a.s);
    if (scored.length === 0) return undefined;
    return scored[0].s >= 25 ? scored[0].l : undefined;
  }

  /**
   * Generate a small set of synonym/lexical variants for a step target so the
   * scored matcher can resolve common UI copy mismatches: users write what
   * they see on the screen, but the POM field name was built from a label,
   * testid, or placeholder that used different wording.
   *
   * Each variant is space-separated, lowercased. The original probe is always
   * included — synonyms only add alternatives, never replace.
   */
  private expandWithSynonyms(clean: string): string[] {
    // Bidirectional groups — any member matches any other.
    const groups: string[][] = [
      ['login', 'log in', 'sign in', 'signin'],
      ['logout', 'log out', 'sign out', 'signout'],
      ['submit', 'send'],
      ['cancel', 'close', 'dismiss'],
      ['delete', 'remove', 'trash'],
      ['edit', 'modify', 'update'],
      ['save', 'apply', 'confirm'],
      ['search', 'find', 'lookup'],
      ['ok', 'okay', 'accept'],
      ['email', 'e-mail', 'mail'],
      ['username', 'user name', 'user id', 'userid', 'user'],
      ['password', 'pwd', 'pass'],
      ['home', 'homepage', 'dashboard'],
      ['settings', 'preferences', 'options', 'config'],
      ['profile', 'account', 'my account'],
      ['next', 'continue', 'proceed'],
      ['prev', 'previous', 'back'],
      ['new', 'create', 'add'],
    ];
    const out = new Set<string>([clean]);
    for (const group of groups) {
      for (const term of group) {
        if (clean === term || clean.includes(term)) {
          for (const alt of group) {
            if (alt === term) continue;
            out.add(clean.split(term).join(alt));
          }
        }
      }
    }
    return Array.from(out);
  }

  private splitCamelCase(s: string): string {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  }

  /**
   * Produce a `// @unstable` comment for a step whose resolved locator has
   * low confidence. The dry-run preview UI parses these to highlight fragile
   * steps before the test is saved.
   */
  private confidenceWarningForStep(stepText: string, pom: POMResult): string | null {
    const lower = stepText.toLowerCase();
    const quotes = (stepText.match(/"([^"]*)"/g) || []).map(m => m.replace(/"/g, ''));
    const target = quotes[0];
    if (!target) return null;
    const intent: 'click' | 'fill' | 'select' | 'hover' | 'check' | 'assert' | undefined =
      lower.match(/\b(hover|mouseover|mouse over)\b/) ? 'hover' :
      lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set') ? 'fill' :
      lower.includes('select') ? 'select' :
      lower.includes('uncheck') || lower.includes('check') ? 'check' :
      lower.includes('click') ? 'click' :
      lower.includes('should see') || lower.includes('is visible') || lower.includes('displayed') ? 'assert' :
      undefined;
    const loc = this.findLocatorForField(target, pom, intent);
    if (!loc) return `// @unstable no POM match for "${target}" — falling back to generic locator chain`;
    const c = loc.confidence ?? 100;
    if (c < 60) return `// @unstable confidence=${c} strategy=${loc.locatorStrategy} — consider adding a data-testid`;
    return null;
  }

  /**
   * Detect a chained-hover intent in step text. Recognizes:
   *   - "I hover over Settings then Profile"
   *   - "Hover Settings, then Profile"
   *   - "Hover \"Settings\" > \"Profile\" > \"Edit\""
   *   - Multi-quote hovers: quotes[] has 2+ entries and step has "hover"
   * Returns the ordered list of hover targets, or null if no chain detected.
   */
  /**
   * Split a "select X, Y, Z" or "X | Y | Z" option value into discrete choices
   * so the step mapper can emit a multi-select call. Single-value strings
   * return a one-element array; whitespace-only segments are dropped.
   * Avoids splitting on commas that are inside quoted pairs (e.g. "1,000").
   */
  private splitMultiSelectValues(value: string): string[] {
    if (!value) return [];
    // Pipe takes precedence — it's unambiguous.
    if (value.includes('|')) {
      return value.split('|').map(s => s.trim()).filter(Boolean);
    }
    // Comma split only when there are 2+ commas OR the segments look like
    // discrete options (short, title-case-ish). Otherwise a value like
    // "Main St, Apt 4" would be wrongly split.
    if (value.includes(',')) {
      const parts = value.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.every(p => p.length <= 40 && !/\d{2,}/.test(p))) {
        return parts;
      }
    }
    return [value];
  }

  private detectHoverChain(stepText: string, quotes: string[]): string[] | null {
    const lower = stepText.toLowerCase();
    if (!/\b(hover|mouseover|mouse over)\b/.test(lower)) return null;

    // Two or more distinct quoted targets strongly imply a chain.
    if (quotes.length >= 2) {
      const uniq = Array.from(new Set(quotes.map(q => q.trim()).filter(q => q.length > 0)));
      if (uniq.length >= 2) return uniq;
    }

    // Split by " > " (arrow chain) or " then " / ", then ".
    const arrowSplit = stepText.split(/\s*>\s*|\s+then\s+|,\s*then\s+/i);
    if (arrowSplit.length >= 2) {
      // Strip a leading "hover"/"I hover"/"hover over" from the first segment.
      const cleaned = arrowSplit
        .map((s, i) => i === 0 ? s.replace(/^\s*(?:i\s+)?hover(?:\s+over)?\s*/i, '') : s)
        .map(s => s.replace(/^["'\s]+|["'\s]+$/g, ''))
        .filter(s => s.length > 0);
      if (cleaned.length >= 2) return cleaned;
    }
    return null;
  }

  /**
   * Append static-scan components as POMLocator entries into an existing
   * locators[] list BEFORE the page-class TS is built. `usedVarNames` is the
   * same set the caller tracks for collision detection, so the emitted class
   * has no duplicate variables.
   */
  private appendScanComponentsToLocators(
    scanComponents: any[],
    locators: POMLocator[],
    usedVarNames: Set<string>,
  ): void {
    const toPascal = (s: string) =>
      s.replace(/(?:^|[^a-zA-Z0-9])([a-zA-Z])/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
    const uniqueName = (base: string): string => {
      const safe = base || 'component';
      let n = safe;
      let i = 2;
      while (usedVarNames.has(n)) n = `${safe}${i++}`;
      usedVarNames.add(n);
      return n;
    };

    let added = 0;
    for (const c of scanComponents) {
      const code: string | undefined = c.bestLocator?.code;
      if (!code) continue;
      const locatorCode = code.replace(/^page\./, 'this.page.');
      const rawName = c.id || c.type || 'component';
      const suffix =
        c.type === 'tablist' ? 'Tabs' :
        c.type === 'list' ? 'List' :
        c.type === 'menu' ? 'Menu' :
        c.type === 'form' ? 'Form' : '';
      const basePascal = toPascal(rawName) + suffix;
      const variableName = uniqueName(basePascal.charAt(0).toLowerCase() + basePascal.slice(1));

      const elementType: POMLocator['elementType'] =
        c.type === 'menu' ? 'menu' : 'other';

      const fieldName =
        c.type === 'tablist' ? `${c.tabs?.[0]?.name || 'Tab'} tabs` :
        c.type === 'menu'    ? `${c.items?.[0]?.name || 'Menu'} menu` :
        c.type === 'list'    ? `${c.sampleItems?.[0]?.split(/\s+/).slice(0, 3).join(' ') || 'List'} list` :
        c.type === 'form'    ? `${c.submitLabel || 'Submit'} form` :
        rawName;

      locators.push({
        fieldName,
        variableName,
        locator: locatorCode,
        elementType,
        locatorStrategy: c.bestLocator?.strategy || 'css',
        confidence: Math.round((c.confidence ?? 0.5) * 100),
      });
      added++;
    }
    if (added > 0) {
      logger.info(`POM Generator: merged ${added} static-scan component(s) into locators`);
    }
  }
}

export const pomGeneratorService = new POMGeneratorService();
