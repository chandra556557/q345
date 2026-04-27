// Shared Playwright locator-picking strategy used by both the scenario-replay
// POM generator and the static-scan emitter. Priority matches Playwright docs:
// getByRole > getByTestId > getByLabel > getByPlaceholder > getByText > css.

export interface LocatorInput {
  role?: string;
  name?: string;
  testId?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  css: string;
  unique?: boolean;
}

export interface LocatorPick {
  strategy: 'role' | 'testid' | 'label' | 'text' | 'placeholder' | 'css';
  code: string;
  rationale: string;
}

function quote(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export function pickLocator(input: LocatorInput): LocatorPick {
  if (input.role && input.name) {
    const exact = input.unique === false ? '' : ', exact: true';
    return {
      strategy: 'role',
      code: `page.getByRole('${input.role}', { name: ${quote(input.name)}${exact} })`,
      rationale: `Role "${input.role}" with accessible name — most resilient`,
    };
  }
  if (input.testId) {
    return {
      strategy: 'testid',
      code: `page.getByTestId(${quote(input.testId)})`,
      rationale: 'data-testid is the most stable selector when present',
    };
  }
  if (input.label) {
    return {
      strategy: 'label',
      code: `page.getByLabel(${quote(input.label)})`,
      rationale: 'Form field located by accessible label',
    };
  }
  if (input.placeholder) {
    return {
      strategy: 'placeholder',
      code: `page.getByPlaceholder(${quote(input.placeholder)})`,
      rationale: 'Placeholder used as next-best signal',
    };
  }
  if (input.text && input.text.length < 40) {
    return {
      strategy: 'text',
      code: `page.getByText(${quote(input.text)})`,
      rationale: 'Short text content used as locator',
    };
  }
  return {
    strategy: 'css',
    code: `page.locator(${quote(input.css)})`,
    rationale: 'WARN: CSS fallback — no stable role/testid/label found',
  };
}

/**
 * Evaluate a locator string against a Playwright Page in a bounded way
 * (no eval). Supports only the six Playwright locator getters above.
 * Returns a Locator-like object or null if the input can't be parsed.
 */
export function safeResolveLocator(page: any, locatorCode: string): any | null {
  // Strip leading `this.` so scanner-generated code also works.
  const src = locatorCode.replace(/^this\./, '').trim();
  // Allowlist the exact patterns. Arguments are parsed as JSON where possible;
  // object literals like `{ name: 'X', exact: true }` are JSON-compatible after
  // quoting the keys, which our emitters already produce.
  const patterns: Array<{ re: RegExp; call: (...args: any[]) => any }> = [
    { re: /^page\.getByTestId\(\s*'([^']*)'\s*\)$/, call: (v: string) => page.getByTestId(v) },
    { re: /^page\.getByLabel\(\s*'([^']*)'\s*\)$/, call: (v: string) => page.getByLabel(v) },
    { re: /^page\.getByPlaceholder\(\s*'([^']*)'\s*\)$/, call: (v: string) => page.getByPlaceholder(v) },
    { re: /^page\.getByText\(\s*'([^']*)'\s*\)$/, call: (v: string) => page.getByText(v) },
    { re: /^page\.locator\(\s*'([^']*)'\s*\)$/, call: (v: string) => page.locator(v) },
    {
      re: /^page\.getByRole\(\s*'([^']+)'\s*,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:,\s*exact:\s*(true|false)\s*)?\}\s*\)$/,
      call: (role: string, nameLit: string, exact?: string) => {
        // Unquote the name argument — JSON parse handles both single- and
        // double-quoted forms after normalization.
        const unquoted = nameLit.startsWith("'")
          ? nameLit.slice(1, -1).replace(/\\'/g, "'")
          : JSON.parse(nameLit);
        const opts: any = { name: unquoted };
        if (exact === 'true') opts.exact = true;
        return page.getByRole(role, opts);
      },
    },
  ];
  for (const p of patterns) {
    const m = src.match(p.re);
    if (m) {
      try {
        return p.call(...m.slice(1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
