// Locator-healing service — given a broken locator string and a current DOM
// snapshot from the live page, propose a replacement locator by scoring
// every visible interactive element against the original locator's intent.
//
// Called from generated step-defs when an action throws a "locator timeout"
// and the @auto-heal tag is set. The service is deterministic (no AI) — it
// uses role/name/testid heuristics shared with the POM generator so suggestions
// are explainable and fast.

import { logger } from '../../utils/logger';

export interface HealRequest {
  failingLocator: string;  // e.g. `page.getByRole('button', { name: 'Login' })`
  stepText?: string;       // Gherkin step that invoked it, if known
  elements: HealElement[]; // Snapshot captured by the step-def before healing
}

export interface HealElement {
  tag: string;
  role?: string;
  name?: string;          // aria-label / accessible name
  text?: string;
  testId?: string;
  placeholder?: string;
  label?: string;
  id?: string;
  visible?: boolean;
  disabled?: boolean;
}

export interface HealResponse {
  healed: boolean;
  suggestedLocator?: string;
  strategy?: 'role' | 'testid' | 'label' | 'placeholder' | 'text' | 'css';
  confidence: number;
  rationale: string;
}

interface ParsedLocator {
  strategy: 'role' | 'testid' | 'label' | 'placeholder' | 'text' | 'css' | 'unknown';
  role?: string;
  name?: string;
  testId?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  raw: string;
}

function parseLocator(raw: string): ParsedLocator {
  const r = raw.trim();
  // page.getByRole('button', { name: 'Login', exact: true })
  const role = r.match(/getByRole\(\s*'([^']+)'\s*(?:,\s*\{\s*name:\s*'([^']*)'[^}]*\})?\s*\)/);
  if (role) return { strategy: 'role', role: role[1], name: role[2], raw: r };
  const testId = r.match(/getByTestId\(\s*'([^']+)'\s*\)/);
  if (testId) return { strategy: 'testid', testId: testId[1], raw: r };
  const label = r.match(/getByLabel\(\s*'([^']+)'\s*\)/);
  if (label) return { strategy: 'label', label: label[1], raw: r };
  const placeholder = r.match(/getByPlaceholder\(\s*'([^']+)'\s*\)/);
  if (placeholder) return { strategy: 'placeholder', placeholder: placeholder[1], raw: r };
  const text = r.match(/getByText\(\s*'([^']+)'\s*\)/);
  if (text) return { strategy: 'text', text: text[1], raw: r };
  const css = r.match(/locator\(\s*'([^']+)'\s*\)/);
  if (css) return { strategy: 'css', raw: r };
  return { strategy: 'unknown', raw: r };
}

function quote(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function scoreCandidate(el: HealElement, target: ParsedLocator): number {
  if (el.visible === false) return 0;
  if (el.disabled) return 0;
  const targetName = (target.name || target.text || target.label || target.placeholder || target.testId || '').toLowerCase().trim();
  if (!targetName) return 0;

  const fields = [
    { val: (el.testId || '').toLowerCase(), weight: 100 },
    { val: (el.name || '').toLowerCase(), weight: 95 },
    { val: (el.label || '').toLowerCase(), weight: 90 },
    { val: (el.placeholder || '').toLowerCase(), weight: 80 },
    { val: (el.text || '').toLowerCase(), weight: 70 },
    { val: (el.id || '').toLowerCase(), weight: 60 },
  ];
  let score = 0;
  for (const f of fields) {
    if (!f.val) continue;
    if (f.val === targetName) score += f.weight;
    else if (f.val.includes(targetName) || targetName.includes(f.val)) score += f.weight * 0.7;
    else {
      const wordsA = targetName.split(/\s+/).filter(w => w.length > 2);
      const wordsB = f.val.split(/\s+/).filter(w => w.length > 2);
      const overlap = wordsA.filter(w => wordsB.includes(w)).length;
      if (overlap > 0) score += f.weight * 0.4 * (overlap / Math.max(wordsA.length, wordsB.length));
    }
  }
  // Role alignment boost — "button" locator that got a button wins over one that got a div.
  if (target.role && el.role === target.role) score += 20;
  if (target.role === 'button' && (el.tag === 'button' || el.tag === 'a')) score += 10;
  if (target.role === 'link' && el.tag === 'a') score += 10;
  if (target.role === 'textbox' && (el.tag === 'input' || el.tag === 'textarea')) score += 10;
  return score;
}

function buildLocatorFor(el: HealElement): { code: string; strategy: HealResponse['strategy']; confidence: number } {
  if (el.testId) {
    return { code: `page.getByTestId(${quote(el.testId)})`, strategy: 'testid', confidence: 95 };
  }
  if (el.role && el.name) {
    return { code: `page.getByRole('${el.role}', { name: ${quote(el.name)} })`, strategy: 'role', confidence: 90 };
  }
  if (el.label) {
    return { code: `page.getByLabel(${quote(el.label)})`, strategy: 'label', confidence: 80 };
  }
  if (el.placeholder) {
    return { code: `page.getByPlaceholder(${quote(el.placeholder)})`, strategy: 'placeholder', confidence: 70 };
  }
  if (el.text && el.text.length < 50) {
    return { code: `page.getByText(${quote(el.text)})`, strategy: 'text', confidence: 60 };
  }
  if (el.id) {
    return { code: `page.locator(${quote('#' + el.id)})`, strategy: 'css', confidence: 50 };
  }
  return { code: `page.locator(${quote(el.tag)})`, strategy: 'css', confidence: 20 };
}

class LocatorHealService {
  heal(req: HealRequest): HealResponse {
    const parsed = parseLocator(req.failingLocator);
    if (parsed.strategy === 'unknown') {
      return { healed: false, confidence: 0, rationale: `Could not parse failing locator: ${req.failingLocator.slice(0, 200)}` };
    }
    if (!Array.isArray(req.elements) || req.elements.length === 0) {
      return { healed: false, confidence: 0, rationale: 'No DOM elements provided — healer cannot suggest a replacement.' };
    }

    const scored = req.elements
      .map(el => ({ el, s: scoreCandidate(el, parsed) }))
      .filter(x => x.s >= 30)
      .sort((a, b) => b.s - a.s);

    if (scored.length === 0) {
      return {
        healed: false,
        confidence: 0,
        rationale: `No visible element matched the original locator's intent (${parsed.strategy}:${parsed.name || parsed.text || parsed.testId || 'n/a'})`,
      };
    }

    const best = scored[0];
    const built = buildLocatorFor(best.el);
    // Combine the scoring-derived confidence with the locator-strategy
    // confidence so a high-scoring fuzzy match via weak attributes (CSS) still
    // reports mid-confidence and a perfect testid match reports very high.
    const combined = Math.round(Math.min(100, (best.s / 100) * built.confidence + Math.min(30, best.s * 0.3)));
    logger.info(
      `Locator heal: "${parsed.raw.slice(0, 80)}" → ${built.strategy} (score=${best.s}, confidence=${combined})`,
    );
    return {
      healed: true,
      suggestedLocator: built.code,
      strategy: built.strategy,
      confidence: combined,
      rationale: `Closest match: tag=${best.el.tag} testid=${best.el.testId || '-'} name=${best.el.name || '-'} text="${(best.el.text || '').slice(0, 40)}" (score ${best.s})`,
    };
  }
}

export const locatorHealService = new LocatorHealService();
