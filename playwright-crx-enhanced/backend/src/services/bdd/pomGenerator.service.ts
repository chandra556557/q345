import { chromium, Page } from 'playwright-core';
import { logger } from '../../utils/logger';
import { bddService } from './bdd.service';

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
}

interface POMLocator {
  fieldName: string;         // e.g. "Username" (from feature file)
  variableName: string;      // e.g. "usernameInput"
  locator: string;           // e.g. "page.getByLabel('Username')"
  elementType: 'input' | 'button' | 'link' | 'select' | 'combobox' | 'checkbox' | 'radio' | 'menu' | 'text' | 'other';
}

interface POMResult {
  className: string;
  url: string;
  pagePath: string;
  locators: POMLocator[];
  methods: string[];
  generatedCode: string;
}

interface FeatureStep {
  idx: number;
  action: 'navigate' | 'click' | 'fill' | 'select' | 'check' | 'hover' | 'assert' | 'other';
  target: string;
  value?: string;
  optionValue?: string;  // for dropdown select: option chosen
}

class POMGeneratorService {
  /**
   * Main entry: Given a feature file + URL, visit the page, extract locators, generate POM.
   * Supports multi-page flows: follows clicks that cause navigation and generates a POM per page.
   */
  async generateFromFeature(
    featureContent: string,
    targetUrl: string,
    options: { className?: string; waitForSelector?: string } = {}
  ): Promise<POMResult[]> {
    const parsed = bddService.parseFeatureContent(featureContent);
    logger.info(`POM Generator: parsing feature with ${(parsed.scenarios || []).length} scenarios`);

    // Fix Gap 10: Pick positive/happy-path scenarios for flow-following.
    // Priority: @smoke > @positive > @happy-path > first non-negative scenario
    const scenarioForFlow = this.pickFlowFollowingScenario(parsed);
    logger.info(`POM Generator: using scenario "${scenarioForFlow?.name || 'none'}" for flow-following`);

    // Collect ALL candidate targets from ALL scenarios (for locator generation)
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
      domHash: string;  // for detecting DOM changes at same URL
    }
    const snapshots: Snapshot[] = [];

    // Fix Gap 6: snapshot deduplication — merge by URL + domHash
    const takeSnapshot = async (preferredClassName?: string): Promise<Snapshot> => {
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {});
      }
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const url = page.url();
      const urlObj = new URL(url);
      const pagePath = urlObj.pathname + urlObj.search;
      const elements = await this.extractDOMElements(page);
      // Fix Gap 2: DOM hash to detect same-URL state changes (e.g., login state)
      const domHash = await this.computeDomHash(page);

      // Check for existing snapshot with same URL and similar DOM
      const existing = snapshots.find(s => s.url === url && s.domHash === domHash);
      if (existing) {
        logger.info(`POM Generator: reusing existing snapshot for ${existing.className}`);
        return existing;
      }

      // Same URL but different DOM → create new snapshot with suffixed class name
      let className = preferredClassName || this.generateClassName(url, parsed.name);
      const sameUrlCount = snapshots.filter(s => s.url === url).length;
      if (sameUrlCount > 0) {
        className = `${className}State${sameUrlCount + 1}`;
      }
      // Fix Gap 16: class name collision across different URLs
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

      // Fix Gap 1: only follow ONE scenario (the positive one) — avoid multi-scenario state pollution
      const flowSteps: FeatureStep[] = scenarioForFlow
        ? this.parseScenarioIntoSteps(scenarioForFlow)
        : allSteps;

      for (const step of flowSteps) {
        // Associate this step's target with the current snapshot
        currentSnapshot.candidateTargets.add(step.target);

        if (step.action === 'click') {
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) {
            // Fix Gap 10: step target not found — log so user knows
            logger.warn(`POM Generator: no match for click "${step.target}" on ${currentSnapshot.className}`);
            continue;
          }
          const urlBefore = page.url();
          const domHashBefore = currentSnapshot.domHash;
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            // Fix Gap 8: longer timeout (10s instead of 3s)
            await locator.click({ timeout: 10000 });
            // Fix Gap B: wait for navigation (or at least network settle)
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(500);  // buffer for late JS rendering
            const urlAfter = page.url();
            const domHashAfter = await this.computeDomHash(page);

            // Fix Gap 2 + 7: detect both URL change AND significant DOM change
            if (urlAfter !== urlBefore || domHashAfter !== domHashBefore) {
              logger.info(`POM Generator: page transition after "${step.target}" (url:${urlBefore !== urlAfter}, dom:${domHashBefore !== domHashAfter})`);
              currentSnapshot = await takeSnapshot();
            }
          } catch (e: any) {
            logger.warn(`POM Generator: click on "${step.target}" failed — ${e.message.substring(0, 100)}`);
          }
        } else if (step.action === 'fill') {
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) {
            logger.warn(`POM Generator: no match for fill "${step.target}" on ${currentSnapshot.className}`);
            continue;
          }
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            await locator.fill(step.value || 'test', { timeout: 5000 }).catch(() => {});
          } catch { /* ignore */ }
        } else if (step.action === 'hover') {
          // Fix Gap H3: execute hover to reveal submenus, then re-snapshot
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) {
            logger.warn(`POM Generator: no match for hover "${step.target}" on ${currentSnapshot.className}`);
            continue;
          }
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            await locator.hover({ timeout: 5000 });
            await page.waitForTimeout(500);  // let submenu render
            // Take a new snapshot — DOM changed because submenu is now visible
            const newHash = await this.computeDomHash(page);
            if (newHash !== currentSnapshot.domHash) {
              logger.info(`POM Generator: hover on "${step.target}" revealed new elements`);
              currentSnapshot = await takeSnapshot();
            }
          } catch (e: any) {
            logger.warn(`POM Generator: hover on "${step.target}" failed — ${e.message.substring(0, 100)}`);
          }
        } else if (step.action === 'select') {
          // Fix Gap D2: execute dropdown select during flow-following
          // target = dropdown, optionValue = selected option
          const match = this.matchCandidate(step.target, currentSnapshot.elements);
          if (!match) continue;
          try {
            const locator = this.resolveLiveLocator(page, match.liveSelector, step.target);
            if (match.elementType === 'select') {
              await locator.selectOption(step.optionValue || '', { timeout: 3000 }).catch(() => {});
            } else {
              // Custom dropdown: click to open, then click option
              await locator.click({ timeout: 3000 });
              await page.waitForTimeout(300);
              if (step.optionValue) {
                const optLocator = page.getByRole('option', { name: step.optionValue }).first();
                await optLocator.click({ timeout: 3000 }).catch(() => {});
              }
            }
          } catch { /* ignore */ }
        }
      }

      // Also populate candidateTargets from ALL scenarios (so POMs cover all quoted targets)
      // Associate each target with the snapshot where it matches best
      const consumedTargets = new Set<string>();
      for (const snap of snapshots) {
        snap.candidateTargets.forEach(t => consumedTargets.add(t));
      }
      const unconsumedSteps = allSteps.filter(s => !consumedTargets.has(s.target));
      for (const step of unconsumedSteps) {
        // Find the snapshot where this target best matches
        let bestSnap: Snapshot | null = null;
        let bestScore = 0;
        for (const snap of snapshots) {
          const match = this.matchCandidate(step.target, snap.elements);
          if (match) {
            const score = this.scoreMatch(step.target.toLowerCase().replace(/[:\s]+$/, '').trim(), match.element);
            if (score > bestScore) {
              bestScore = score;
              bestSnap = snap;
            }
          }
        }
        if (bestSnap) {
          bestSnap.candidateTargets.add(step.target);
        }
      }

      // Generate one POM per unique snapshot
      const results: POMResult[] = [];
      for (const snapshot of snapshots) {
        const locators: POMLocator[] = [];
        const usedVarNames = new Set<string>();

        for (const candidate of snapshot.candidateTargets) {
          const match = this.matchCandidate(candidate, snapshot.elements);
          if (!match) continue;
          let varName = this.toVariableName(candidate, match.elementType);
          let counter = 2;
          const originalVar = varName;
          while (usedVarNames.has(varName)) {
            varName = `${originalVar}${counter++}`;
          }
          usedVarNames.add(varName);
          locators.push({
            fieldName: candidate,
            variableName: varName,
            locator: match.locator,
            elementType: match.elementType,
          });
        }

        if (locators.length === 0) {
          logger.info(`POM Generator: skipping ${snapshot.className} — no matched locators`);
          continue;
        }

        const { methods, consumedByCompound } = this.generateMethods(locators, snapshot);
        const assertions = this.extractAssertionMethods(allSteps, snapshot);
        const allMethods = [...methods, ...assertions];

        const generatedCode = this.buildPOMCode(
          snapshot.className,
          snapshot.url,
          snapshot.pagePath,
          locators,
          allMethods,
          consumedByCompound,
          assertions.length > 0
        );

        results.push({
          className: snapshot.className,
          url: snapshot.url,
          pagePath: snapshot.pagePath,
          locators,
          methods: allMethods.map(m => m.name),
          generatedCode,
        });
      }

      return results;
    } finally {
      await browser.close();
    }
  }

  /**
   * Fix Gap 10: Pick the best scenario for flow-following (prefers @positive/@smoke/@happy-path)
   */
  private pickFlowFollowingScenario(parsed: any): any {
    const scenarios = (parsed.scenarios || []).filter((s: any) => !(s.tags || []).includes('@background'));
    if (scenarios.length === 0) return null;

    // Priority 1: @smoke + @positive
    let pick = scenarios.find((s: any) => (s.tags || []).includes('@smoke') && (s.tags || []).includes('@positive'));
    if (pick) return pick;
    // Priority 2: @positive (any)
    pick = scenarios.find((s: any) => (s.tags || []).includes('@positive'));
    if (pick) return pick;
    // Priority 3: @smoke
    pick = scenarios.find((s: any) => (s.tags || []).includes('@smoke'));
    if (pick) return pick;
    // Priority 4: @happy-path or @e2e
    pick = scenarios.find((s: any) => (s.tags || []).includes('@happy-path') || (s.tags || []).includes('@e2e'));
    if (pick) return pick;
    // Priority 5: first non-negative scenario
    pick = scenarios.find((s: any) => !(s.tags || []).includes('@negative'));
    if (pick) return pick;
    // Fallback: first scenario
    return scenarios[0];
  }

  /**
   * Parse a single scenario into steps (for scenario-isolated flow-following)
   */
  private parseScenarioIntoSteps(scenario: any): FeatureStep[] {
    const steps: FeatureStep[] = [];
    let idx = 0;
    // If this is a Scenario Outline, use the FIRST example as values
    const example = (scenario.examples && scenario.examples[0]) || null;
    for (const step of scenario.steps || []) {
      let text = (step.text || '').trim();
      if (example) {
        for (const [key, value] of Object.entries(example)) {
          text = text.replace(new RegExp(`<${key}>`, 'g'), String(value));
        }
      }
      const parsed = this.parseStepText(text, idx);
      if (parsed) {
        steps.push(parsed);
        idx++;
      }
    }
    return steps;
  }

  /**
   * Fix Gap 2: compute a lightweight DOM hash to detect state changes at the same URL
   * (e.g., logged-out homepage vs logged-in homepage)
   */
  private async computeDomHash(page: Page): Promise<string> {
    const result = await page.evaluate(`(() => {
      // Hash based on visible clickable elements' aggregate text
      const els = Array.from(document.querySelectorAll('a:not([hidden]), button:not([hidden]), input:not([type="hidden"])'));
      const visible = els.filter(function(el) {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const sig = visible.map(function(el) {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 30);
        return el.tagName + '|' + text;
      }).join('::');
      // Simple hash function
      let hash = 0;
      for (let i = 0; i < sig.length; i++) {
        hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
      }
      return hash.toString(16);
    })()`);
    return String(result);
  }

  /**
   * Parse feature file into ordered, actionable steps
   */
  private parseFeatureIntoSteps(parsed: any): FeatureStep[] {
    const steps: FeatureStep[] = [];
    let idx = 0;
    for (const scenario of parsed.scenarios || []) {
      for (const step of scenario.steps || []) {
        const parsedStep = this.parseStepText((step.text || '').trim(), idx);
        if (parsedStep) {
          steps.push(parsedStep);
          idx++;
        }
      }
    }
    return steps;
  }

  /**
   * Parse a single step text into a FeatureStep
   * Handles: navigate, click, fill, hover, select (dropdown), check, assert
   */
  private parseStepText(text: string, idx: number): FeatureStep | null {
    const lower = text.toLowerCase();
    const quotes = (text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
    if (quotes.length === 0) return null;

    // Filter obvious non-element strings
    const firstQuote = quotes[0];
    if (firstQuote.startsWith('http') || firstQuote === '/' || /^\/[a-z]/.test(firstQuote)) return null;
    if (/^\d+$/.test(firstQuote)) return null;

    // Hover: "I hover over 'Menu'" or "I mouse over 'X'"
    if (lower.match(/\b(hover|mouseover|mouse over)\b/)) {
      return { idx, action: 'hover', target: firstQuote };
    }

    // Dropdown select: "I select 'USA' from 'Country'" or "I select 'USA' from the 'Country' dropdown"
    // Pattern: "select X from Y" — target is the DROPDOWN (Y), optionValue is the OPTION (X)
    if (lower.match(/\bselect\b.*\bfrom\b/) && quotes.length >= 2) {
      return { idx, action: 'select', target: quotes[1], optionValue: quotes[0] };
    }
    // Alt pattern: "I select 'USA' in 'Country'"
    if (lower.match(/\bselect\b.*\bin\b/) && quotes.length >= 2) {
      return { idx, action: 'select', target: quotes[1], optionValue: quotes[0] };
    }
    // Simple: "I select 'USA'" (dropdown inferred from context)
    if (lower.match(/^(i )?select\s+"/) && quotes.length === 1) {
      return { idx, action: 'select', target: firstQuote, optionValue: firstQuote };
    }

    // Fill: "fill X with Y" / "type X into Y" / "enter Y in X"
    if (lower.includes('fill') || lower.includes('type') || lower.includes('enter') || lower.includes('set')) {
      return { idx, action: 'fill', target: firstQuote, value: quotes[1] || '' };
    }

    // Click
    if (lower.includes('click')) {
      return { idx, action: 'click', target: firstQuote };
    }

    // Check/uncheck
    if (lower.includes('uncheck')) {
      return { idx, action: 'check', target: firstQuote, value: 'uncheck' };
    }
    if (lower.includes('check')) {
      return { idx, action: 'check', target: firstQuote, value: 'check' };
    }

    // Assertion
    if (lower.includes('should see') || lower.includes('visible') || lower.includes('displayed') || lower.includes('shown')) {
      return { idx, action: 'assert', target: firstQuote };
    }

    return null;
  }

  /**
   * Extract all interactive DOM elements with their metadata.
   * Includes standard interactive elements PLUS potentially-hoverable containers
   * (div.figure, img, elements with cursor:pointer) to support hover-reveal patterns.
   */
  private async extractDOMElements(page: Page): Promise<ElementInfo[]> {
    const result = await page.evaluate(`(() => {
      // Broader selector: includes standard interactive elements + hover containers
      const selector = [
        'input', 'button', 'a', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[role="textbox"]', '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="menu"]',
        'label',
        // Hover-target containers (common patterns)
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
        // "Visible" includes elements that are in the layout but may be hidden by CSS animation
        const inLayout = rect.width > 0 && rect.height > 0;
        const notDisplayNone = cs.display !== 'none';
        const notVisibilityHidden = cs.visibility !== 'hidden';
        const visible = inLayout && notDisplayNone && notVisibilityHidden;
        // For images, also capture the src filename as a potential identifier
        const src = el.src || el.getAttribute('src') || '';
        // Grab nearby text (including from children that might be hidden, for hover reveals)
        const nearbyText = (el.innerText || el.textContent || '').trim().substring(0, 200);
        // Pull text from children even if currently hidden (for hover reveal patterns)
        const allChildText = Array.from(el.querySelectorAll('*'))
          .map(c => (c.innerText || c.textContent || '').trim())
          .filter(t => t && t.length < 100)
          .join(' ');
        return {
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('alt') || '',
          text: nearbyText || allChildText.substring(0, 100),
          testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || '',
          value: el.value || src.split('/').pop() || '',
          href: el.href || '',
          role: el.getAttribute('role') || '',
          visible: visible
        };
      }).filter(function(e) {
        // Keep visible OR potentially-hoverable elements (img, .figure, etc.)
        return e.visible || e.tag === 'img' || e.tag === 'div';
      });
    })()`);
    return result as ElementInfo[];
  }

  /**
   * Match a candidate name against DOM elements and return the best locator
   */
  private matchCandidate(
    candidate: string,
    elements: ElementInfo[]
  ): { locator: string; liveSelector: string; elementType: POMLocator['elementType']; element: ElementInfo } | null {
    const lower = candidate.toLowerCase();
    const candidateClean = lower.replace(/[:\s]+$/, '').trim();

    const scored = elements.map(el => ({
      el,
      score: this.scoreMatch(candidateClean, el),
    })).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0].el;
      return {
        locator: this.buildLocator(best, candidate),
        liveSelector: this.buildLiveSelector(best, candidate),
        elementType: this.getElementType(best),
        element: best,
      };
    }

    // Fallback: positional match for patterns like "user1", "item2", "card3"
    // When nothing matches by text/attribute, try mapping to the Nth element of a group
    const posMatch = candidateClean.match(/^([a-z]+)(\d+)$/);
    if (posMatch) {
      const prefix = posMatch[1];
      const n = parseInt(posMatch[2]) - 1;
      // Look for elements that could be group items (figure, card, img, div)
      const groupCandidates = elements.filter(el =>
        el.tag === 'img' ||
        el.tag === 'div' ||
        el.tag === 'li' ||
        /figure|card|tile|item|user/i.test(el.id) ||
        /figure|card|tile|item|user/i.test(el.ariaLabel)
      );
      if (groupCandidates.length > n) {
        const target = groupCandidates[n];
        // Use :nth-of-type locator for positional access
        const positionalLocator = `this.page.locator('.figure, .card, .tile, img').nth(${n})`;
        return {
          locator: positionalLocator,
          liveSelector: `.figure, .card, .tile, img`,
          elementType: 'other',
          element: { ...target, text: prefix + (n + 1) },
        };
      }
    }

    return null;
  }

  /**
   * Build a runtime selector for executing clicks during flow-following
   */
  private buildLiveSelector(el: ElementInfo, candidate: string): string {
    if (el.id) return `#${el.id}`;
    if (el.testId) return `[data-testid="${el.testId}"]`;
    if (el.name) return `${el.tag}[name="${el.name}"]`;
    if (el.placeholder) return `[placeholder="${el.placeholder}"]`;
    if (el.ariaLabel) return `[aria-label="${el.ariaLabel}"]`;
    const text = (el.text || candidate).replace(/"/g, '\\"');
    return `text="${text}"`;
  }

  /**
   * Resolve a runtime locator for executing during flow-following
   */
  private resolveLiveLocator(page: Page, selector: string, candidate: string): any {
    if (selector.startsWith('text=')) {
      const text = selector.substring(6, selector.length - 1);
      return page.getByText(text, { exact: false }).first();
    }
    // Positional pattern: candidate is like "user1", "item2"
    const posMatch = candidate.toLowerCase().match(/^([a-z]+)(\d+)$/);
    if (posMatch) {
      const n = parseInt(posMatch[2]) - 1;
      // Use nth for positional access (matches the locator string we built)
      return page.locator(selector).nth(n);
    }
    return page.locator(selector).or(page.getByRole('button', { name: candidate })).or(page.getByRole('link', { name: candidate })).first();
  }

  /**
   * Score how well a DOM element matches a candidate name
   */
  private scoreMatch(candidate: string, el: ElementInfo): number {
    let score = 0;
    const fields = [
      { val: el.ariaLabel.toLowerCase(), weight: 100 },
      { val: el.placeholder.toLowerCase(), weight: 90 },
      { val: el.name.toLowerCase(), weight: 85 },
      { val: el.id.toLowerCase(), weight: 80 },
      { val: el.text.toLowerCase(), weight: 70 },
      { val: el.testId.toLowerCase(), weight: 95 },
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

  /**
   * Simple fuzzy match: check if words overlap
   */
  private fuzzyMatch(a: string, b: string): boolean {
    const wordsA = a.split(/\s+/).filter(w => w.length > 2);
    const wordsB = b.split(/\s+/).filter(w => w.length > 2);
    return wordsA.some(w => wordsB.includes(w));
  }

  /**
   * Build the best Playwright locator for an element using priority rules
   * (same as Playwright's codegen priority)
   */
  private buildLocator(el: ElementInfo, candidate: string): string {
    // Priority 1: getByRole with accessible name
    const role = this.inferRole(el);
    const accessibleName = el.ariaLabel || el.text || el.value;
    if (role && accessibleName) {
      return `this.page.getByRole('${role}', { name: ${JSON.stringify(accessibleName)} })`;
    }

    // Priority 2: getByTestId
    if (el.testId) {
      return `this.page.getByTestId('${this.escape(el.testId)}')`;
    }

    // Priority 3: getByLabel
    if (el.ariaLabel) {
      return `this.page.getByLabel(${JSON.stringify(el.ariaLabel)})`;
    }
    // Label might be on a separate element — try candidate
    if (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') {
      return `this.page.getByLabel(${JSON.stringify(candidate.replace(/[:\s]+$/, '').trim())})`;
    }

    // Priority 4: getByPlaceholder
    if (el.placeholder) {
      return `this.page.getByPlaceholder(${JSON.stringify(el.placeholder)})`;
    }

    // Priority 5: getByText
    if (el.text && el.text.length < 50) {
      return `this.page.getByText(${JSON.stringify(el.text)})`;
    }

    // Priority 6: CSS attributes
    if (el.id) return `this.page.locator('#${this.escape(el.id)}')`;
    if (el.name) return `this.page.locator('${el.tag}[name="${this.escape(el.name)}"]')`;

    // Fallback: generic CSS
    return `this.page.locator('${el.tag}')`;
  }

  /**
   * Infer ARIA role from element
   */
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
    // Custom dropdown — ARIA combobox
    if (el.role === 'combobox' || el.role === 'listbox') return 'combobox';
    if (el.role === 'menu' || el.role === 'menuitem') return 'menu';
    return 'other';
  }

  /**
   * Generate a variable name from the field label: "Username:" → "usernameInput"
   */
  private toVariableName(fieldName: string, type: POMLocator['elementType']): string {
    const clean = fieldName
      .replace(/[:\s]+$/, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim();
    const parts = clean.split(/\s+/);
    const camelCase = parts[0].toLowerCase() + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    const suffixMap: Record<string, string> = {
      input: 'Input',
      button: 'Button',
      link: 'Link',
      select: 'Dropdown',
      checkbox: 'Checkbox',
      radio: 'Radio',
      text: 'Text',
      other: 'Element',
    };
    return camelCase + (suffixMap[type] || 'Element');
  }

  /**
   * Generate class name from URL or feature name
   */
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

  /**
   * Generate method stubs based on locator patterns.
   * Returns both the method list and which locators were consumed by compound methods (like login),
   * so we can skip generating individual click/fill methods for them (fix for duplicate methods gap).
   */
  private generateMethods(
    locators: POMLocator[],
    snapshot: { pagePath: string; className: string }
  ): { methods: Array<{ name: string; code: string }>; consumedByCompound: Set<string> } {
    const methods: Array<{ name: string; code: string }> = [];
    const consumedByCompound = new Set<string>();

    // navigate() method — uses the actual page path (fix #1)
    methods.push({
      name: 'navigate',
      code: [
        `  /** Navigate directly to this page */`,
        `  async navigate() {`,
        `    await this.page.goto(BASE_URL + '${this.escape(snapshot.pagePath)}', { waitUntil: 'domcontentloaded' });`,
        `  }`,
      ].join('\n'),
    });

    // Compound login() method — consumes username + password + login button
    const usernameVar = locators.find(l => /user|email/i.test(l.fieldName) && l.elementType === 'input');
    const passwordVar = locators.find(l => /pass/i.test(l.fieldName) && l.elementType === 'input');
    const loginBtn = locators.find(l => /^(login|sign\s*in|submit|log\s*in)$/i.test(l.fieldName.trim()) && (l.elementType === 'button' || l.elementType === 'link'));

    if (usernameVar && passwordVar && loginBtn) {
      methods.push({
        name: 'login',
        code: [
          `  /** Log in with the given credentials */`,
          `  async login(username: string, password: string) {`,
          `    await this.page.waitForLoadState('domcontentloaded');`,
          `    await this.${usernameVar.variableName}.fill(username);`,
          `    await this.${passwordVar.variableName}.fill(password);`,
          `    await this.${loginBtn.variableName}.click();`,
          `  }`,
        ].join('\n'),
      });
      // Fix #2: mark these as consumed so we don't also generate fillUsername/fillPassword/clickLogin
      consumedByCompound.add(usernameVar.variableName);
      consumedByCompound.add(passwordVar.variableName);
      consumedByCompound.add(loginBtn.variableName);
    }

    // Input fills — skip if consumed
    for (const loc of locators.filter(l => l.elementType === 'input' && !consumedByCompound.has(l.variableName))) {
      const methodName = 'fill' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Input$/, '');
      methods.push({
        name: methodName,
        code: [
          `  /** Fill the ${loc.fieldName} field */`,
          `  async ${methodName}(value: string) {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.fill(value);`,
          `  }`,
        ].join('\n'),
      });
    }

    // Button/link clicks — skip if consumed
    for (const loc of locators.filter(l => (l.elementType === 'button' || l.elementType === 'link') && !consumedByCompound.has(l.variableName))) {
      const methodName = 'click' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/(Button|Link)$/, '');
      methods.push({
        name: methodName,
        code: [
          `  /** Click the ${loc.fieldName} ${loc.elementType} */`,
          `  async ${methodName}() {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.click();`,
          `  }`,
        ].join('\n'),
      });

      // Fix Gap H2: Hover method for any interactive element (button/link)
      const hoverName = 'hover' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/(Button|Link)$/, '');
      methods.push({
        name: hoverName,
        code: [
          `  /** Hover over the ${loc.fieldName} ${loc.elementType} (useful for revealing submenus) */`,
          `  async ${hoverName}() {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.hover();`,
          `  }`,
        ].join('\n'),
      });
    }

    // Native <select> dropdown
    for (const loc of locators.filter(l => l.elementType === 'select')) {
      const methodName = 'select' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Dropdown$/, '');
      methods.push({
        name: methodName,
        code: [
          `  /** Select an option from the ${loc.fieldName} dropdown */`,
          `  async ${methodName}(option: string) {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.selectOption(option);`,
          `  }`,
        ].join('\n'),
      });
    }

    // Fix Gap D1-D3: Custom dropdown (ARIA combobox) — click to open + click option
    for (const loc of locators.filter(l => l.elementType === 'combobox')) {
      const methodName = 'select' + loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Dropdown$|Element$/, '');
      methods.push({
        name: methodName,
        code: [
          `  /** Select an option from the ${loc.fieldName} custom dropdown (ARIA combobox) */`,
          `  async ${methodName}(option: string) {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.click();`,
          `    await this.page.getByRole('option', { name: option }).first().click();`,
          `  }`,
        ].join('\n'),
      });
    }

    // Fix Gap H2 + H3: Menu hover (reveals submenu)
    for (const loc of locators.filter(l => l.elementType === 'menu')) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Element$|Menu$/, '');
      methods.push({
        name: `hover${baseName}Menu`,
        code: [
          `  /** Hover over the ${loc.fieldName} menu to reveal submenu items */`,
          `  async hover${baseName}Menu() {`,
          `    await this.${loc.variableName}.waitFor({ state: 'visible' });`,
          `    await this.${loc.variableName}.hover();`,
          `  }`,
        ].join('\n'),
      });
    }

    // Checkbox — fix #7
    for (const loc of locators.filter(l => l.elementType === 'checkbox')) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Element$|Input$/, '');
      methods.push({
        name: `check${baseName}`,
        code: [
          `  /** Check the ${loc.fieldName} checkbox */`,
          `  async check${baseName}() {`,
          `    await this.${loc.variableName}.check();`,
          `  }`,
        ].join('\n'),
      });
      methods.push({
        name: `uncheck${baseName}`,
        code: [
          `  /** Uncheck the ${loc.fieldName} checkbox */`,
          `  async uncheck${baseName}() {`,
          `    await this.${loc.variableName}.uncheck();`,
          `  }`,
        ].join('\n'),
      });
    }

    // Radio — fix #7
    for (const loc of locators.filter(l => l.elementType === 'radio')) {
      const baseName = loc.variableName.charAt(0).toUpperCase() + loc.variableName.slice(1).replace(/Element$|Input$/, '');
      methods.push({
        name: `select${baseName}`,
        code: [
          `  /** Select the ${loc.fieldName} radio option */`,
          `  async select${baseName}() {`,
          `    await this.${loc.variableName}.check();`,
          `  }`,
        ].join('\n'),
      });
    }

    return { methods, consumedByCompound };
  }

  /**
   * Extract assertion methods from feature steps (Then I should see "X") — fix #4
   */
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
          `  /** Assert "${step.target}" is visible on the page */`,
          `  async ${methodName}() {`,
          `    await expect(this.page.getByText('${this.escape(step.target)}', { exact: false })).toBeVisible({ timeout: 10000 });`,
          `  }`,
        ].join('\n'),
      });
    }
    return methods;
  }

  /**
   * Build the complete POM TypeScript file
   */
  private buildPOMCode(
    className: string,
    url: string,
    pagePath: string,
    locators: POMLocator[],
    methods: Array<{ name: string; code: string }>,
    _consumedByCompound: Set<string>,
    hasAssertions: boolean
  ): string {
    const lines: string[] = [];
    // Fix #3: only import `expect` if we actually have assertion methods
    const imports = ['Page', 'Locator'];
    if (hasAssertions) imports.push('expect');
    lines.push(`import { ${imports.join(', ')} } from '@playwright/test';`);
    lines.push('');
    // Fix #6: base URL from environment
    let defaultBase = '';
    try { defaultBase = new URL(url).origin; } catch { /* ignore */ }
    lines.push(`const BASE_URL = process.env.BASE_URL || '${this.escape(defaultBase)}';`);
    lines.push('');
    lines.push(`/**`);
    lines.push(` * Page Object for ${className}`);
    lines.push(` * URL: ${url}`);
    lines.push(` * Path: ${pagePath}`);
    lines.push(` * Auto-generated at ${new Date().toISOString()}`);
    lines.push(` */`);
    lines.push(`export class ${className} {`);
    lines.push(`  readonly page: Page;`);
    for (const loc of locators) {
      lines.push(`  readonly ${loc.variableName}: Locator;`);
    }
    lines.push('');
    lines.push(`  constructor(page: Page) {`);
    lines.push(`    this.page = page;`);
    // Explicit Locator type for clarity (fix #10)
    for (const loc of locators) {
      lines.push(`    this.${loc.variableName} = ${loc.locator};`);
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

  private escape(s: string): string {
    return s.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
  }

  /**
   * Apply multiple POMs to a feature — regenerate Playwright test code selecting the right POM per step
   * Includes: Background → beforeEach, navigation waits, active POM tracking, Scenario Outline, tags.
   */
  applyMultiplePOMsToFeature(
    featureContent: string,
    poms: POMResult[],
    baseUrl: string
  ): string {
    if (!poms || poms.length === 0) {
      throw new Error('At least one POM is required');
    }
    if (poms.length === 1) {
      return this.applyPOMToFeature(featureContent, poms[0], baseUrl);
    }

    const parsed = bddService.parseFeatureContent(featureContent);
    const pomInstances = poms.map(p => ({
      pom: p,
      instanceName: p.className.charAt(0).toLowerCase() + p.className.slice(1),
    }));

    // Fix Gap A: Detect Background scenario for beforeEach
    const background = (parsed.scenarios || []).find((s: any) => (s.tags || []).includes('@background'));

    const lines: string[] = [];
    lines.push(`import { test, expect } from '@playwright/test';`);
    for (const p of poms) {
      lines.push(`import { ${p.className} } from '../pages/${p.className}';`);
    }
    lines.push('');
    lines.push(`const BASE_URL = process.env.BASE_URL || '${this.escape(baseUrl)}';`);
    lines.push('');
    lines.push(`test.describe('${this.escape(parsed.name || 'Feature')}', () => {`);

    // Fix Gap A: Background → test.beforeEach
    if (background && background.steps.length > 0) {
      lines.push(`  // Background — runs before every scenario`);
      lines.push(`  test.beforeEach(async ({ page }) => {`);
      for (const pi of pomInstances) {
        lines.push(`    const ${pi.instanceName} = new ${pi.pom.className}(page);`);
      }
      lines.push('');
      // Track active POM through background
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

      // Fix Gap E: Tags → Playwright tags
      const tags = (scenario.tags || []).filter((t: string) => t && t !== '@background');

      for (const example of runs) {
        const nameSuffix = example
          ? ` (${Object.entries(example).map(([k, v]) => `${k}=${v}`).join(', ')})`
          : '';
        const testOptions = tags.length > 0
          ? `, { tag: [${tags.map((t: string) => `'${this.escape(t)}'`).join(', ')}] }`
          : '';
        lines.push(`  test('${this.escape(scenario.name + nameSuffix)}'${testOptions}, async ({ page }) => {`);
        // Instantiate all POMs
        for (const pi of pomInstances) {
          lines.push(`    const ${pi.instanceName} = new ${pi.pom.className}(page);`);
        }
        lines.push('');

        // Fix Gap C: Scenario Outline substitution BEFORE mapping
        const stepTexts = scenario.steps.map((s: any) => {
          let t = s.text;
          if (example) {
            for (const [key, value] of Object.entries(example)) {
              t = t.replace(new RegExp(`<${key}>`, 'g'), String(value));
            }
          }
          return { keyword: s.keyword, text: t };
        });

        // Detect compound patterns (login, search, etc.)
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
              loginCallCode = `    await ${loginPOM.instanceName}.login('${this.escape(userFill.value)}', '${this.escape(passFill.value)}');`;
            }
          }
        }

        // Fix Gap 4: Track active POM based on last click navigation
        const context = { activePOM: pomInstances[0] };

        // Generate steps — select the right POM per step, with navigation waits
        stepTexts.forEach((step: any, idx: number) => {
          if (consumed.has(idx)) {
            lines.push(`    // ${step.keyword} ${step.text}`);
            if (idx === loginCallEmitAt) {
              lines.push(loginCallCode);
              // After login, switch active POM to any page with user info (if available)
            }
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

  /**
   * Fix Gap 4 + Gap B: Map step with active-POM tracking and navigation waits.
   * Prefers the currently active POM when resolving ambiguous elements.
   */
  private mapStepToMultiPOMCallWithContext(
    stepText: string,
    pomInstances: Array<{ pom: POMResult; instanceName: string }>,
    context: { activePOM: { pom: POMResult; instanceName: string } }
  ): string {
    const lower = stepText.toLowerCase();
    const quotes = (stepText.match(/"([^"]*)"/g) || []).map(m => m.replace(/"/g, ''));

    // Navigation — use active POM's navigate()
    if (lower.includes('navigate') || lower.match(/^(i )?(go to|open|visit|am on)/)) {
      return `await ${pomInstances[0].instanceName}.navigate();`;
    }

    // Fix Gap H4 + D5: parse the step to get the correct target + option (uses unified parser)
    const parsedStep = this.parseStepText(stepText, 0);

    if (quotes.length >= 1) {
      const target = parsedStep?.target || quotes[0];
      const value = parsedStep?.value !== undefined ? parsedStep.value : quotes[1];
      const optionValue = parsedStep?.optionValue;

      // Fix Gap 4: try active POM first, then others
      const searchOrder = [
        context.activePOM,
        ...pomInstances.filter(pi => pi !== context.activePOM),
      ];

      for (const pi of searchOrder) {
        const loc = this.findLocatorForField(target, pi.pom);
        if (!loc) continue;

        // Fix Gap H4: Hover
        if (parsedStep?.action === 'hover' || lower.match(/\b(hover|mouseover|mouse over)\b/)) {
          return `await ${pi.instanceName}.${loc.variableName}.hover();`;
        }

        // Fix Gap D3: Custom dropdown (combobox) vs native select
        if (parsedStep?.action === 'select' && optionValue !== undefined) {
          if (loc.elementType === 'select') {
            return `await ${pi.instanceName}.${loc.variableName}.selectOption('${this.escape(optionValue)}');`;
          }
          if (loc.elementType === 'combobox') {
            // Click combobox to open, then click option
            return `await ${pi.instanceName}.${loc.variableName}.click();\n    await page.getByRole('option', { name: '${this.escape(optionValue)}' }).first().click();`;
          }
          // Fallback: try selectOption, Playwright will auto-detect
          return `await ${pi.instanceName}.${loc.variableName}.selectOption('${this.escape(optionValue)}');`;
        }

        if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set')) && value !== undefined && value !== '') {
          return `await ${pi.instanceName}.${loc.variableName}.fill('${this.escape(value)}');`;
        }
        if (lower.includes('click')) {
          const clickCode = `await ${pi.instanceName}.${loc.variableName}.click();`;
          if (pi !== context.activePOM) {
            context.activePOM = pi;
          }
          return clickCode;
        }
        if (lower.includes('uncheck')) {
          return `await ${pi.instanceName}.${loc.variableName}.uncheck();`;
        }
        if (lower.includes('check')) {
          return `await ${pi.instanceName}.${loc.variableName}.check();`;
        }
      }

      // Fix Gap H4: Hover fallback — use getByText when no POM match
      if (parsedStep?.action === 'hover' || lower.match(/\b(hover|mouseover|mouse over)\b/)) {
        return `await page.getByText('${this.escape(target)}', { exact: false }).first().hover();`;
      }

      // Dropdown fallback
      if (parsedStep?.action === 'select' && optionValue !== undefined) {
        return `await page.getByLabel('${this.escape(target)}').selectOption('${this.escape(optionValue)}');`;
      }

      // Fix Gap G: Assertion — try POM assertion methods with fuzzy match
      if (lower.includes('should see') || lower.includes('is visible') || lower.includes('displayed')) {
        const cleanName = target.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
          .map((p, i) => i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))
          .join('');
        const methodName = `assert${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Visible`;

        // Try active POM first, then others
        for (const pi of searchOrder) {
          if (pi.pom.methods.includes(methodName)) {
            return `await ${pi.instanceName}.${methodName}();`;
          }
        }
        // Fallback to inline assertion
        return `await expect(page.getByText('${this.escape(target)}', { exact: false })).toBeVisible({ timeout: 10000 });`;
      }

      if (lower.includes('should not see') || lower.includes('not visible')) {
        return `await expect(page.getByText('${this.escape(target)}')).toBeHidden();`;
      }

      // Fallback: generic inline locator
      if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type')) && value !== undefined) {
        return `await page.getByLabel('${this.escape(target.replace(/[:\s]+$/, '').trim())}').fill('${this.escape(value)}');`;
      }
      if (lower.includes('click')) {
        return `await page.getByRole('button', { name: '${this.escape(target)}' }).or(page.getByRole('link', { name: '${this.escape(target)}' })).first().click();`;
      }
    }

    return `// TODO: unmapped step — ${stepText}`;
  }

  /**
   * Apply a POM to a feature — regenerate Playwright test code using POM method calls
   */
  applyPOMToFeature(
    featureContent: string,
    pom: POMResult,
    baseUrl: string
  ): string {
    const parsed = bddService.parseFeatureContent(featureContent);
    const instanceName = pom.className.charAt(0).toLowerCase() + pom.className.slice(1);

    const lines: string[] = [];
    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push(`import { ${pom.className} } from '../pages/${pom.className}';`);
    lines.push('');
    lines.push(`const BASE_URL = process.env.BASE_URL || '${this.escape(baseUrl)}';`);
    lines.push('');
    lines.push(`test.describe('${this.escape(parsed.name || 'Feature')}', () => {`);

    for (const scenario of parsed.scenarios || []) {
      if ((scenario.tags || []).includes('@background')) continue;

      const isOutline = scenario.type === 'Scenario Outline' && scenario.examples && scenario.examples.length > 0;
      const runs: any[] = isOutline ? scenario.examples! : [null];

      for (const example of runs) {
        const nameSuffix = example
          ? ` (${Object.entries(example).map(([k, v]) => `${k}=${v}`).join(', ')})`
          : '';
        lines.push(`  test('${this.escape(scenario.name + nameSuffix)}', async ({ page }) => {`);
        lines.push(`    const ${instanceName} = new ${pom.className}(page);`);

        // Track consecutive fills to detect login pattern
        const stepTexts = scenario.steps.map((s: any) => {
          let t = s.text;
          if (example) {
            for (const [key, value] of Object.entries(example)) {
              t = t.replace(new RegExp(`<${key}>`, 'g'), String(value));
            }
          }
          return { keyword: s.keyword, text: t };
        });

        // Check if sequence matches a compound method like login(user, pass)
        const hasLoginMethod = pom.methods.includes('login');
        const consumed = new Set<number>();
        let loginCallEmitAt = -1;
        let loginCallCode = '';

        if (hasLoginMethod) {
          // Find fill Username, fill Password, click Login in CONSECUTIVE order
          // (scanning the step list for the pattern)
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
            // Look for the click login/submit step that comes AFTER both fills
            const afterFills = Math.max(userFill.idx, passFill.idx);
            const clickLoginIdx = stepTexts.findIndex((s: any, i: number) => {
              if (i <= afterFills) return false;
              const lower = s.text.toLowerCase();
              const quotes = (s.text.match(/"([^"]*)"/g) || []).map((m: string) => m.replace(/"/g, ''));
              // Only match "Login" or "Sign In" as the button, not external "Sign In" link on homepage
              return lower.includes('click') && quotes[0] && /^(login|submit|log\s*in)$/i.test(quotes[0].trim());
            });
            if (clickLoginIdx > -1) {
              consumed.add(userFill.idx);
              consumed.add(passFill.idx);
              consumed.add(clickLoginIdx);
              // Emit the login() call at the position of the LAST consumed step (click Login)
              loginCallEmitAt = clickLoginIdx;
              loginCallCode = `    await ${instanceName}.login('${this.escape(userFill.value)}', '${this.escape(passFill.value)}');`;
            }
          }
        }

        // Generate steps in order — preserving Gherkin flow
        stepTexts.forEach((step: any, idx: number) => {
          if (consumed.has(idx)) {
            // Emit comment for the consumed step
            lines.push(`    // ${step.keyword} ${step.text}`);
            // When we reach the last consumed step, emit the compound login() call
            if (idx === loginCallEmitAt) {
              lines.push(loginCallCode);
            }
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

  /**
   * Map a Gherkin step to a POM method call or locator usage
   */
  private mapStepToPOMCall(stepText: string, pom: POMResult, instance: string): string {
    const lower = stepText.toLowerCase();
    const quotes = (stepText.match(/"([^"]*)"/g) || []).map(m => m.replace(/"/g, ''));

    // Navigation
    if (lower.includes('navigate') || lower.match(/^(i )?(go to|open|visit|am on)/)) {
      return `await ${instance}.navigate();`;
    }

    // Fill: map to locator.fill()
    if ((lower.includes('fill') || lower.includes('enter') || lower.includes('type') || lower.includes('set')) && quotes.length >= 2) {
      const locator = this.findLocatorForField(quotes[0], pom);
      if (locator) {
        return `await ${instance}.${locator.variableName}.fill('${this.escape(quotes[1])}');`;
      }
      return `await page.getByLabel('${this.escape(quotes[0].replace(/[:\s]+$/, '').trim())}').fill('${this.escape(quotes[1])}');`;
    }

    // Click: map to locator.click()
    if (lower.includes('click') && quotes[0]) {
      const locator = this.findLocatorForField(quotes[0], pom);
      if (locator) {
        return `await ${instance}.${locator.variableName}.click();`;
      }
      return `await page.getByRole('button', { name: '${this.escape(quotes[0])}' }).click();`;
    }

    // Should see (assertion)
    if (lower.includes('should see') || lower.includes('is visible') || lower.includes('displayed')) {
      const target = quotes[0];
      if (!target) return `// TODO: ${stepText}`;
      return `await expect(page.getByText('${this.escape(target)}', { exact: false })).toBeVisible({ timeout: 10000 });`;
    }

    // Should not see
    if (lower.includes('should not see') || lower.includes('not visible')) {
      const target = quotes[0];
      if (!target) return `// TODO: ${stepText}`;
      return `await expect(page.getByText('${this.escape(target)}')).toBeHidden();`;
    }

    return `// TODO: unmapped step — ${stepText}`;
  }

  private findLocatorForField(fieldName: string, pom: POMResult): POMLocator | undefined {
    const clean = fieldName.replace(/[:\s]+$/, '').trim().toLowerCase();
    // Exact match first
    let match = pom.locators.find(l => l.fieldName.toLowerCase() === clean);
    if (match) return match;
    // Partial match
    match = pom.locators.find(l => l.fieldName.toLowerCase().includes(clean) || clean.includes(l.fieldName.toLowerCase()));
    return match;
  }
}

export const pomGeneratorService = new POMGeneratorService();
