// Static POM scan service — port of the standalone `pom-scanner` package
// (c:/chandra-1212-main/pom-scanner) into the backend.
//
// Unlike `pomGenerator.service.ts`, which replays feature-file steps, this
// service does a single static live-DOM scan of a URL and classifies visible
// components (tablist, list, menu, form) then emits Playwright page-object
// code that extends BasePage / NavMenu / TabPanel / DataList.

import { chromium, Browser } from 'playwright-core';
import { logger } from '../../utils/logger';
import { validatePublicUrl } from '../../utils/urlValidator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScannerConfig {
  url: string;
  waitFor?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  pageName?: string;
  /** Playwright storageState — object or path. Lets the scanner cross login. */
  storageState?: any;
}

export interface ScanResult {
  url: string;
  title: string;
  scannedAt: string;
  components: DetectedComponent[];
  interactives: {
    buttons: ElementSummary[];
    links: ElementSummary[];
    inputs: InputSummary[];
  };
  stats: { domNodes: number; componentsFound: number };
}

export type DetectedComponent =
  | TabPanelComponent
  | ListComponent
  | MenuComponent
  | FormComponent;

interface BaseComponent {
  id: string;
  containerSelector: string;
  bestLocator: LocatorPick;
  confidence: number;
}
interface TabPanelComponent extends BaseComponent {
  type: 'tablist';
  tabs: { name: string; controls?: string; selected?: boolean }[];
  hasNestedList: boolean[];
}
interface ListComponent extends BaseComponent {
  type: 'list';
  variant: 'list' | 'grid';
  itemRole: 'listitem' | 'row' | 'option';
  itemCount: number;
  sampleItems: string[];
  hoverActions: string[];
}
interface MenuComponent extends BaseComponent {
  type: 'menu';
  items: MenuItem[];
  isHoverDriven: boolean;
}
interface MenuItem { name: string; children: MenuItem[]; }
interface FormComponent extends BaseComponent {
  type: 'form';
  fields: { name: string; role: string; required: boolean }[];
  submitLabel: string | null;
}
interface ElementSummary { name: string; selector: string; role: string; }
interface InputSummary extends ElementSummary {
  inputType: string;
  required: boolean;
  placeholder: string | null;
}
interface LocatorPick {
  strategy: 'role' | 'testid' | 'label' | 'text' | 'placeholder' | 'css';
  code: string;
  rationale: string;
}

export interface EmittedFiles {
  pageClass: { filename: string; code: string };
  fixtures: { filename: string; code: string };
  feature: { filename: string; code: string };
  scanReport: { filename: string; code: string };
  basePage: { filename: string; code: string };
  navMenu: { filename: string; code: string };
  tabPanel: { filename: string; code: string };
  dataList: { filename: string; code: string };
}

export interface StaticScanResponse {
  scan: ScanResult;
  files: EmittedFiles;
}

// ─── Browser-side scan script (injected via page.evaluate) ────────────────────

const BROWSER_SCAN_SCRIPT = `
(function(opts) {
  return new Promise(async (resolve) => {
    // Shadow-DOM-aware querying. Open shadow roots expose their contents via
    // el.shadowRoot — we walk into them transparently so web-component menus
    // (role="menu" inside a shadow tree) are classified like normal DOM.
    function qsaAll(selector, root) {
      root = root || document;
      const out = [];
      try {
        const direct = (root.querySelectorAll ? root.querySelectorAll(selector) : []);
        for (const n of direct) out.push(n);
      } catch (e) { /* ignore malformed selector from caller */ }
      const hosts = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const h of hosts) {
        if (h.shadowRoot && h.shadowRoot.mode === 'open') {
          const nested = qsaAll(selector, h.shadowRoot);
          for (const n of nested) out.push(n);
        }
      }
      return out;
    }
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      if (r.width < opts.minSize || r.height < opts.minSize) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    }
    function accessibleName(el) {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const ref = document.getElementById(labelledBy);
        if (ref) return (ref.textContent || '').trim();
      }
      const id = el.id;
      if (id) {
        const lbl = document.querySelector('label[for="' + id + '"]');
        if (lbl) return (lbl.textContent || '').trim();
      }
      const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      return txt.length > 80 ? txt.slice(0, 80) + '…' : txt;
    }
    function bestSelector(el) {
      const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
      if (testId) return '[data-testid="' + testId + '"]';
      if (el.id) return '#' + el.id;
      const role = el.getAttribute('role');
      const name = accessibleName(el);
      if (role && name) return role + '[name="' + name.slice(0, 40) + '"]';
      const path = [];
      let cur = el;
      for (let depth = 0; depth < 3 && cur && cur !== document.body; depth++) {
        const tag = cur.tagName.toLowerCase();
        const parentEl = cur.parentElement;
        if (!parentEl) break;
        const tagName = cur.tagName;
        const siblings = Array.from(parentEl.children).filter(c => c.tagName === tagName);
        const idx = siblings.indexOf(cur) + 1;
        path.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
        cur = parentEl;
      }
      return path.join(' > ');
    }
    function effectiveRole(el) {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const map = { button: 'button', a: 'link', nav: 'navigation', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', th: 'columnheader', td: 'cell', form: 'form', input: 'textbox', select: 'combobox' };
      return map[tag] || '';
    }
    function detectTabs() {
      const out = [];
      const tabLists = qsaAll('[role="tablist"]');
      document.querySelectorAll('nav ul, .tabs, .tab-nav').forEach(el => {
        const items = Array.from(el.querySelectorAll(':scope > li, :scope > a'));
        const selected = items.filter(i => i.getAttribute('aria-selected') === 'true' || i.classList.contains('active') || i.classList.contains('is-active'));
        if (items.length >= 2 && selected.length === 1 && !tabLists.includes(el)) tabLists.push(el);
      });
      tabLists.forEach((tl, i) => {
        if (!isVisible(tl)) return;
        const tabs = Array.from(tl.querySelectorAll('[role="tab"], a, li > button, li > a'))
          .filter(isVisible).filter(t => accessibleName(t).length > 0).slice(0, 20)
          .map(t => ({ name: accessibleName(t), controls: t.getAttribute('aria-controls') || undefined, selected: t.getAttribute('aria-selected') === 'true' || t.classList.contains('active') }));
        if (tabs.length < 2) return;
        const panels = tabs.map(t => t.controls ? document.getElementById(t.controls) : null);
        const hasNestedList = panels.map(p => !!(p && p.querySelector('ul, ol, [role="list"], [role="grid"], table')));
        out.push({ type: 'tablist', id: tl.id || 'tablist-' + i, containerSelector: bestSelector(tl), tabs, hasNestedList, confidence: tl.getAttribute('role') === 'tablist' ? 1.0 : 0.7 });
      });
      return out;
    }
    function detectLists() {
      const out = [];
      const containers = qsaAll('[role="list"], [role="grid"], [role="listbox"], ul, ol, table');
      let idCounter = 0;
      containers.forEach(c => {
        if (!isVisible(c)) return;
        if (c.closest('[role="menu"], [role="menubar"], [role="tablist"]')) return;
        const isTable = c.tagName === 'TABLE';
        const itemSelector = isTable ? 'tbody > tr' : ':scope > li, :scope > [role="listitem"], :scope > [role="row"], :scope > [role="option"]';
        const items = Array.from(c.querySelectorAll(itemSelector)).filter(isVisible);
        if (items.length < 2) return;
        const sampleItems = items.slice(0, 5).map(it => {
          const t = (it.textContent || '').trim().replace(/\\s+/g, ' ');
          return t.length > 60 ? t.slice(0, 60) + '…' : t;
        });
        const hoverActions = [];
        const firstItem = items[0];
        firstItem.querySelectorAll('button, a').forEach(btn => {
          const cs = getComputedStyle(btn);
          if (cs.opacity === '0' || cs.display === 'none' || cs.visibility === 'hidden') {
            const name = accessibleName(btn);
            if (name) hoverActions.push(name);
          }
        });
        out.push({ type: 'list', id: c.id || c.getAttribute('data-testid') || 'list-' + (idCounter++), containerSelector: bestSelector(c), variant: isTable ? 'grid' : 'list', itemRole: isTable ? 'row' : 'listitem', itemCount: items.length, sampleItems, hoverActions, confidence: c.getAttribute('role') ? 0.95 : 0.75 });
      });
      return out;
    }
    async function detectMenus() {
      const out = [];
      const explicit = qsaAll('[role="menubar"], [role="menu"], nav[aria-label]');
      let idCounter = 0;
      for (const m of explicit) {
        if (!isVisible(m)) continue;
        if (m.closest('[role="tablist"]')) continue;
        const topItems = Array.from(m.querySelectorAll(':scope > [role="menuitem"], :scope > li, :scope > a')).filter(isVisible);
        if (topItems.length < 1) continue;
        let isHoverDriven = false;
        const items = [];
        for (const ti of topItems) {
          const name = accessibleName(ti);
          if (!name) continue;
          const children = [];
          const submenu = ti.querySelector('ul, [role="menu"]');
          if (submenu) {
            if (opts.probeHoverMenus) {
              ti.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
              ti.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              await new Promise(r => setTimeout(r, opts.hoverProbeMs));
              if (isVisible(submenu)) isHoverDriven = true;
            }
            Array.from(submenu.querySelectorAll(':scope > li, :scope > [role="menuitem"]')).slice(0, 20).forEach(s => {
              const sn = accessibleName(s);
              if (sn) children.push({ name: sn, children: [] });
            });
            if (opts.probeHoverMenus) {
              ti.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
              ti.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }
          }
          items.push({ name, children });
        }
        out.push({ type: 'menu', id: m.id || 'menu-' + (idCounter++), containerSelector: bestSelector(m), items, isHoverDriven, confidence: m.getAttribute('role') ? 0.95 : 0.6 });
      }
      return out;
    }
    function detectForms() {
      return qsaAll('form').filter(isVisible).map((f, i) => {
        const fields = Array.from(f.querySelectorAll('input, select, textarea'))
          .filter(el => el.type !== 'hidden')
          .map(el => ({ name: accessibleName(el) || el.name || 'field', role: effectiveRole(el), required: !!el.required }));
        const submit = f.querySelector('button[type="submit"], input[type="submit"]');
        return { type: 'form', id: f.id || 'form-' + i, containerSelector: bestSelector(f), fields, submitLabel: submit ? accessibleName(submit) : null, confidence: 0.9 };
      });
    }
    function summarize(els) {
      return els.filter(isVisible).slice(0, 50).map(el => ({
        name: accessibleName(el) || (el.innerText || '').slice(0, 40),
        selector: bestSelector(el),
        role: effectiveRole(el),
      })).filter(x => x.name);
    }
    const components = [];
    components.push(...detectTabs());
    components.push(...detectLists());
    components.push(...(await detectMenus()));
    components.push(...detectForms());
    const interactives = {
      buttons: summarize(qsaAll('button, [role="button"]')),
      links: summarize(qsaAll('a[href]')),
      inputs: qsaAll('input, select, textarea')
        .filter(isVisible).filter(el => el.type !== 'hidden').slice(0, 30)
        .map(el => ({ name: accessibleName(el) || el.name || '', selector: bestSelector(el), role: effectiveRole(el), inputType: el.type || 'text', required: !!el.required, placeholder: el.placeholder || null }))
        .filter(x => x.name),
    };
    resolve({ url: location.href, title: document.title, domNodes: document.querySelectorAll('*').length, components, interactives });
  });
})
`;

// ─── Locator strategy (Node side) ─────────────────────────────────────────────

function pickLocator(input: { role?: string; name?: string; testId?: string; label?: string; placeholder?: string; text?: string; css: string; unique?: boolean }): LocatorPick {
  if (input.role && input.name) {
    const exact = input.unique === false ? '' : ', exact: true';
    return { strategy: 'role', code: `page.getByRole('${input.role}', { name: ${quote(input.name)}${exact} })`, rationale: `Role "${input.role}" with accessible name` };
  }
  if (input.testId) return { strategy: 'testid', code: `page.getByTestId(${quote(input.testId)})`, rationale: 'data-testid is the most stable selector' };
  if (input.label) return { strategy: 'label', code: `page.getByLabel(${quote(input.label)})`, rationale: 'Form field located by accessible label' };
  if (input.placeholder) return { strategy: 'placeholder', code: `page.getByPlaceholder(${quote(input.placeholder)})`, rationale: 'Placeholder used as next-best signal' };
  if (input.text && input.text.length < 40) return { strategy: 'text', code: `page.getByText(${quote(input.text)})`, rationale: 'Short text content used as locator' };
  return { strategy: 'css', code: `page.locator(${quote(input.css)})`, rationale: 'WARN: CSS fallback — no stable role/testid/label found' };
}

// ─── Runtime component classes (emitted verbatim) ─────────────────────────────
// These match the contract the page-class emitter assumes: extends BasePage,
// constructs NavMenu / TabPanel / DataList with a CSS-ish container selector.
// Users drop these into pages/ + pages/components/ in their test project.

const BASE_PAGE_CODE = `// StaticBasePage.ts — Auto-generated runtime base for static-scan page classes.
// Named "StaticBasePage" to avoid colliding with the scenario-replay generator's
// own BasePage when both are emitted into the same project.
import { Page, Locator, expect } from '@playwright/test';

export abstract class StaticBasePage {
  readonly page: Page;
  abstract readonly path: string;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(baseUrl?: string): Promise<void> {
    const target = baseUrl ? baseUrl.replace(/\\/$/, '') + this.path : this.path;
    await this.page.goto(target, { waitUntil: 'networkidle' });
  }

  /** Hover that tolerates re-rendered targets by re-resolving if the first hover misses. */
  async stableHover(locator: Locator): Promise<void> {
    try {
      await locator.hover({ timeout: 2000 });
    } catch {
      await locator.first().hover({ timeout: 3000 });
    }
  }

  /** Hover a parent and click a child that is only revealed on hover. */
  async hoverAndClick(parent: Locator, child: Locator): Promise<void> {
    await this.stableHover(parent);
    await child.click({ timeout: 5000 });
  }

  /** Resolve nth row. 1-based to match Gherkin ("the 2nd row"). */
  resolveIndex(items: Locator, oneBasedIndex: number): Locator {
    return items.nth(Math.max(0, oneBasedIndex - 1));
  }

  async expectTitle(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(pattern);
  }
}
`;

const NAV_MENU_CODE = `// NavMenu.ts — Multi-level, hover-capable navigation menu wrapper.
import { Page, Locator } from '@playwright/test';

export class NavMenu {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page, containerSelector: string) {
    this.page = page;
    this.root = page.locator(containerSelector);
  }

  item(name: string): Locator {
    return this.root.getByRole('menuitem', { name }).first()
      .or(this.root.getByRole('link', { name }).first())
      .or(this.root.getByText(name, { exact: true }).first());
  }

  async click(name: string): Promise<void> {
    await this.item(name).click();
  }

  /** For hover-driven menus: hover the top-level item, then click a child by name. */
  async select(topItem: string, childName: string): Promise<void> {
    const top = this.item(topItem);
    await top.hover();
    // Submenus may render outside the menu root, so search the whole page.
    const child = this.page.getByRole('menuitem', { name: childName }).first()
      .or(this.page.getByRole('link', { name: childName }).first())
      .or(this.page.getByText(childName, { exact: true }).first());
    await child.click();
  }
}
`;

const TAB_PANEL_CODE = `// TabPanel.ts — ARIA tablist wrapper with a scoped "active panel" locator.
import { Page, Locator, expect } from '@playwright/test';

export class TabPanel {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page, containerSelector: string) {
    this.page = page;
    this.root = page.locator(containerSelector);
  }

  tab(name: string): Locator {
    return this.root.getByRole('tab', { name }).first()
      .or(this.root.getByText(name, { exact: true }).first());
  }

  /** The visible panel linked to the currently-selected tab (if aria-controls is present). */
  activePanel(): Locator {
    return this.page.locator('[role="tabpanel"]:not([hidden])').first();
  }

  async open(name: string): Promise<void> {
    const t = this.tab(name);
    await t.click();
    await expect(t).toHaveAttribute('aria-selected', 'true').catch(() => { /* non-ARIA tabs */ });
  }

  /** Convenience: open a tab and click an item by visible text inside that panel. */
  async clickItemInTab(tabName: string, itemText: string): Promise<void> {
    await this.open(tabName);
    await this.activePanel().getByText(itemText, { exact: false }).first().click();
  }
}
`;

const DATA_LIST_CODE = `// DataList.ts — List/grid wrapper with filter-by-text and hover-row actions.
import { Page, Locator } from '@playwright/test';

export class DataList {
  readonly page: Page;
  readonly root: Locator;

  /** @param idOrSelector — either a raw CSS selector, a testid value, or a DOM id. */
  constructor(page: Page, idOrSelector: string) {
    this.page = page;
    if (idOrSelector.startsWith('#') || idOrSelector.startsWith('[') || idOrSelector.includes(' ')) {
      this.root = page.locator(idOrSelector);
    } else if (/^[a-zA-Z][\\w-]*$/.test(idOrSelector)) {
      // Bare id-like token — try testid first, fall back to #id.
      this.root = page.getByTestId(idOrSelector)
        .or(page.locator('#' + idOrSelector));
    } else {
      this.root = page.locator(idOrSelector);
    }
  }

  items(): Locator {
    return this.root.locator(':scope > li, :scope > [role="listitem"], :scope > tr, :scope tbody > tr, :scope > [role="row"], :scope > [role="option"]');
  }

  itemByText(text: string): Locator {
    return this.items().filter({ hasText: text }).first();
  }

  async clickItemByText(text: string): Promise<void> {
    await this.itemByText(text).click();
  }

  /** 1-based — matches Gherkin "the 2nd row". */
  nth(oneBasedIndex: number): Locator {
    return this.items().nth(Math.max(0, oneBasedIndex - 1));
  }

  async hoverRowAndClick(oneBasedIndex: number, actionName: string): Promise<void> {
    const row = this.nth(oneBasedIndex);
    await row.hover();
    await row.getByRole('button', { name: actionName }).first()
      .or(row.getByRole('link', { name: actionName }).first())
      .click();
  }

  async count(): Promise<number> {
    return this.items().count();
  }
}
`;

// ─── Emitter (mirrors pom-scanner/src/emitter/page-object.ts) ─────────────────

function emit(scan: ScanResult, pageName: string): EmittedFiles {
  const className = toPascalCase(pageName) + 'Page';
  const path = '/' + toKebabCase(pageName);
  return {
    pageClass: { filename: `pages/${className}.ts`, code: emitPageClass(className, path, scan) },
    fixtures: { filename: 'fixtures/pomFixtures.ts', code: emitFixtures(scan, className) },
    feature: { filename: `features/${toKebabCase(pageName)}.feature`, code: emitFeature(pageName, scan) },
    scanReport: { filename: 'scan-report.json', code: JSON.stringify(scan, null, 2) },
    basePage: { filename: 'pages/StaticBasePage.ts', code: BASE_PAGE_CODE },
    navMenu: { filename: 'pages/components/NavMenu.ts', code: NAV_MENU_CODE },
    tabPanel: { filename: 'pages/components/TabPanel.ts', code: TAB_PANEL_CODE },
    dataList: { filename: 'pages/components/DataList.ts', code: DATA_LIST_CODE },
  };
}

function emitPageClass(className: string, path: string, scan: ScanResult): string {
  const tabs = scan.components.filter(c => c.type === 'tablist') as TabPanelComponent[];
  const lists = scan.components.filter(c => c.type === 'list') as ListComponent[];
  const menus = scan.components.filter(c => c.type === 'menu') as MenuComponent[];
  const forms = scan.components.filter(c => c.type === 'form') as FormComponent[];

  const lines: string[] = [];
  lines.push(`// ${className}.ts`);
  lines.push(`// Auto-generated by static-scan from ${scan.url}`);
  lines.push(`// Scanned at ${scan.scannedAt}. Review @unstable markers before merging.`);
  lines.push('');
  lines.push(`import { Page, Locator, expect } from '@playwright/test';`);
  lines.push(`import { StaticBasePage } from './StaticBasePage';`);
  lines.push(`import { NavMenu } from './components/NavMenu';`);
  lines.push(`import { TabPanel } from './components/TabPanel';`);
  lines.push(`import { DataList } from './components/DataList';`);
  lines.push('');
  lines.push(`export class ${className} extends StaticBasePage {`);
  lines.push(`  readonly path = '${path}';`);
  lines.push('');

  if (menus.length > 0) {
    menus.forEach((m, i) => {
      const propName = menus.length === 1 ? 'navMenu' : `navMenu${i + 1}`;
      const conf = m.confidence < 0.5 ? '@unstable ' : '';
      lines.push(`  /** ${conf}Menu detected: ${m.items.length} top-level items` + (m.isHoverDriven ? ', hover-driven' : '') + ` */`);
      lines.push(`  readonly ${propName}: NavMenu;`);
    });
    lines.push('');
  }
  if (tabs.length > 0) {
    tabs.forEach((t, i) => {
      const propName = tabs.length === 1 ? 'tabs' : `tabs${i + 1}`;
      const conf = t.confidence < 0.5 ? '@unstable ' : '';
      lines.push(`  /** ${conf}Tab panel: [${t.tabs.map(x => `"${x.name}"`).join(', ')}] */`);
      lines.push(`  readonly ${propName}: TabPanel;`);
    });
    lines.push('');
  }
  if (lists.length > 0) {
    lists.forEach((l, i) => {
      const propName = pickListName(l, i);
      const conf = l.confidence < 0.5 ? '@unstable ' : '';
      lines.push(`  /** ${conf}List: ${l.itemCount} items, samples: ${l.sampleItems.slice(0, 2).map(s => `"${s}"`).join(', ')} */`);
      lines.push(`  readonly ${propName}: DataList;`);
    });
    lines.push('');
  }

  lines.push(`  constructor(page: Page) {`);
  lines.push(`    super(page);`);
  menus.forEach((m, i) => {
    const propName = menus.length === 1 ? 'navMenu' : `navMenu${i + 1}`;
    lines.push(`    this.${propName} = new NavMenu(page, ${quote(m.containerSelector)});`);
  });
  tabs.forEach((t, i) => {
    const propName = tabs.length === 1 ? 'tabs' : `tabs${i + 1}`;
    lines.push(`    this.${propName} = new TabPanel(page, ${quote(t.containerSelector)});`);
  });
  lists.forEach((l, i) => {
    const propName = pickListName(l, i);
    const rawId: string | undefined = (l as any).id;
    // Synthetic ids (e.g. "list-0", "tablist-1") are invented by the scanner when the
    // element has no real id/testid — they won't resolve via testid or #id lookup.
    const isSynthetic = !!rawId && /^(list|tablist|menu|form)-\d+$/.test(rawId);
    const idArg = rawId && !isSynthetic ? quote(rawId) : quote(l.containerSelector);
    lines.push(`    this.${propName} = new DataList(page, ${idArg});`);
  });
  lines.push(`  }`);
  lines.push('');

  forms.forEach((f, i) => {
    const methodName = forms.length === 1 ? 'submitForm' : `submitForm${i + 1}`;
    lines.push(`  /** Auto-generated form helper. ${f.fields.length} fields. */`);
    lines.push(`  async ${methodName}(data: { ${f.fields.map(fld => `${toCamelCase(fld.name)}${fld.required ? '' : '?'}: string`).join('; ')} }) {`);
    f.fields.forEach(fld => {
      const camelName = toCamelCase(fld.name);
      const guard = fld.required ? '' : `if (data.${camelName} !== undefined) `;
      lines.push(`    ${guard}await this.page.getByLabel(${quote(fld.name)}).fill(data.${camelName}${fld.required ? '' : '!'});`);
    });
    if (f.submitLabel) lines.push(`    await this.page.getByRole('button', { name: ${quote(f.submitLabel)} }).click();`);
    lines.push(`  }`);
    lines.push('');
  });

  if (tabs.length > 0 && lists.length > 0) {
    lines.push(`  /** Shortcut: open a tab and click an item by visible text. */`);
    lines.push(`  async openTabAndClickItem(tabName: string, itemText: string): Promise<void> {`);
    lines.push(`    await this.tabs.clickItemInTab(tabName, itemText);`);
    lines.push(`  }`);
    lines.push('');
  }

  lines.push(`}`);
  return lines.join('\n');
}

function pickListName(l: ListComponent, i: number): string {
  const raw = ((l as any).id || '').replace(/^list-/, '') || `list${i + 1}`;
  if (raw === `list${i + 1}` || /^\d+$/.test(raw)) return `list${i + 1}`;
  return toCamelCase(raw) + 'List';
}

function emitFixtures(_scan: ScanResult, className: string): string {
  const camel = toCamelCase(className);
  return [
    `// fixtures/pomFixtures.ts`,
    `// Auto-generated. Merge with your existing fixture file.`,
    ``,
    `import { test as base } from 'playwright-bdd';`,
    `import { ${className} } from '../pages/${className}';`,
    ``,
    `type POMFixtures = { ${camel}: ${className}; };`,
    ``,
    `export const test = base.extend<POMFixtures>({`,
    `  ${camel}: async ({ page }, use) => {`,
    `    await use(new ${className}(page));`,
    `  },`,
    `});`,
  ].join('\n');
}

function emitFeature(pageName: string, scan: ScanResult): string {
  const lines: string[] = [];
  lines.push(`# Auto-suggested scenarios for ${pageName}`);
  lines.push(`# Generated from scan of ${scan.url}`);
  lines.push('');
  lines.push(`Feature: ${toTitleCase(pageName)}`);
  lines.push('');

  const tabs = scan.components.find(c => c.type === 'tablist') as TabPanelComponent | undefined;
  const list = scan.components.find(c => c.type === 'list') as ListComponent | undefined;
  const menu = scan.components.find(c => c.type === 'menu') as MenuComponent | undefined;
  const lowered = toTitleCase(pageName).toLowerCase();
  const startLen = lines.length;

  if (tabs && list) {
    lines.push(`  Scenario: Click an item in a non-default tab`);
    lines.push(`    Given I am on the ${lowered} page`);
    lines.push(`    When I open the "${tabs.tabs[1]?.name || tabs.tabs[0].name}" tab`);
    lines.push(`    And I click "${list.sampleItems[0]?.split(' ')[0] || 'Item'}" in the list`);
    lines.push(`    Then I see the item details`);
    lines.push('');
  }
  if (list && list.hoverActions.length > 0) {
    lines.push(`  Scenario: Hover a row and trigger a row action`);
    lines.push(`    Given I am on the ${lowered} page`);
    lines.push(`    When I hover the 2nd row and click "${list.hoverActions[0]}"`);
    lines.push(`    Then the row action is performed`);
    lines.push('');
  }
  if (menu && menu.isHoverDriven && menu.items.length > 0) {
    const firstWithChildren = menu.items.find(i => i.children.length > 0);
    if (firstWithChildren) {
      lines.push(`  Scenario: Navigate via hover menu`);
      lines.push(`    Given I am on the ${lowered} page`);
      lines.push(`    When I select "${firstWithChildren.children[0].name}" from the "${firstWithChildren.name}" menu`);
      lines.push(`    Then I navigate to the "${firstWithChildren.children[0].name}" page`);
      lines.push('');
    }
  }
  if (lines.length === startLen) {
    lines.push(`  Scenario: Page loads`);
    lines.push(`    Given I am on the ${lowered} page`);
    lines.push(`    Then I see the page title`);
  }
  return lines.join('\n');
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function toPascalCase(s: string): string {
  return s.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^(.)/, c => c.toUpperCase());
}
function toCamelCase(s: string): string {
  const p = toPascalCase(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
function toKebabCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');
}
function toTitleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function quote(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function roleForComponent(type: string): string | undefined {
  const map: Record<string, string> = { tablist: 'tablist', list: 'list', menu: 'navigation', form: 'form' };
  return map[type];
}
function nameForComponent(c: any): string | undefined {
  if (c.type === 'tablist' && c.tabs?.length) return c.tabs[0].name;
  if (c.type === 'menu' && c.items?.length) return c.items[0].name;
  return undefined;
}
function extractTestId(selector: string): string | undefined {
  const m = selector.match(/data-testid="([^"]+)"/);
  return m?.[1];
}

// ─── Public API ───────────────────────────────────────────────────────────────

class StaticScanService {
  async scan(cfg: ScannerConfig): Promise<ScanResult> {
    if (!cfg.url) throw new Error('url is required');
    // Shared validator: blocks non-http(s), loopback, RFC1918, link-local,
    // link-local IPv6, ::1, and localhost hostnames. Matches the controller-
    // level check so internal callers can't bypass SSRF protections.
    const allowPrivate = process.env.ALLOW_PRIVATE_SCAN_URLS === 'true';
    validatePublicUrl(cfg.url, { allowPrivate });

    logger.info(`Static scan: launching chromium for ${cfg.url}`);
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: cfg.headless ?? true });
      const contextOpts: any = { viewport: cfg.viewport || { width: 1280, height: 800 } };
      if (cfg.storageState) contextOpts.storageState = cfg.storageState;
      const context = await browser.newContext(contextOpts);
      const page = await context.newPage();
      await page.goto(cfg.url, { waitUntil: 'networkidle', timeout: 30_000 });
      if (cfg.waitFor) {
        await page.waitForSelector(cfg.waitFor, { timeout: 15_000 }).catch(() => {});
      }
      await page.waitForTimeout(500);

      const opts = { probeHoverMenus: true, hoverProbeMs: 200, minSize: 4 };
      const raw = await page.evaluate(
        new Function('opts', `return (${BROWSER_SCAN_SCRIPT})(opts);`) as any,
        opts as any,
      ) as {
        url: string;
        title: string;
        domNodes: number;
        components: any[];
        interactives: { buttons: any[]; links: any[]; inputs: any[] };
      };

      const components: DetectedComponent[] = raw.components.map((c: any) => ({
        ...c,
        bestLocator: pickLocator({
          role: roleForComponent(c.type),
          name: nameForComponent(c),
          testId: extractTestId(c.containerSelector),
          css: c.containerSelector,
        }),
      }));

      return {
        url: raw.url,
        title: raw.title,
        scannedAt: new Date().toISOString(),
        components,
        interactives: raw.interactives,
        stats: { domNodes: raw.domNodes, componentsFound: components.length },
      };
    } finally {
      if (browser) {
        await browser.close().catch(err => {
          logger.warn(`Static scan: browser.close() failed: ${err?.message}`);
        });
      }
    }
  }

  /**
   * Run the classifier on an already-navigated Playwright Page, without
   * launching a new browser. Used by the POM generator to enrich its POMs
   * during flow-replay, reusing the open context (cuts enrichment time ~50%
   * and keeps the authenticated session intact).
   */
  async scanOpenPage(page: any): Promise<ScanResult> {
    const opts = { probeHoverMenus: true, hoverProbeMs: 200, minSize: 4 };
    const scanOne = async (frameOrPage: any): Promise<any> => {
      try {
        return await frameOrPage.evaluate(
          new Function('opts', `return (${BROWSER_SCAN_SCRIPT})(opts);`) as any,
          opts as any,
        );
      } catch {
        return null;
      }
    };

    const raw = await scanOne(page) as {
      url: string;
      title: string;
      domNodes: number;
      components: any[];
      interactives: { buttons: any[]; links: any[]; inputs: any[] };
    };

    // Run the same classifier inside each same-origin iframe. Cross-origin
    // frames return null (evaluate throws) and are silently skipped. Frame
    // components are concatenated with a `frameUrl` tag so downstream code
    // can emit `page.frameLocator(...)` when needed.
    const frameComponents: any[] = [];
    const frameButtons: any[] = [];
    const frameLinks: any[] = [];
    const frameInputs: any[] = [];
    if (page.frames) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const fRes = await scanOne(frame);
        if (!fRes) continue;
        for (const c of fRes.components || []) frameComponents.push({ ...c, frameUrl: fRes.url });
        for (const b of fRes.interactives?.buttons || []) frameButtons.push({ ...b, frameUrl: fRes.url });
        for (const l of fRes.interactives?.links || []) frameLinks.push({ ...l, frameUrl: fRes.url });
        for (const i of fRes.interactives?.inputs || []) frameInputs.push({ ...i, frameUrl: fRes.url });
      }
    }

    const allComponents = [...(raw?.components || []), ...frameComponents];
    const components: DetectedComponent[] = allComponents.map((c: any) => ({
      ...c,
      bestLocator: pickLocator({
        role: roleForComponent(c.type),
        name: nameForComponent(c),
        testId: extractTestId(c.containerSelector),
        css: c.containerSelector,
      }),
    }));

    return {
      url: raw?.url || '',
      title: raw?.title || '',
      scannedAt: new Date().toISOString(),
      components,
      interactives: {
        buttons: [...(raw?.interactives?.buttons || []), ...frameButtons],
        links: [...(raw?.interactives?.links || []), ...frameLinks],
        inputs: [...(raw?.interactives?.inputs || []), ...frameInputs],
      },
      stats: { domNodes: raw?.domNodes || 0, componentsFound: components.length },
    };
  }

  async scanAndEmit(cfg: ScannerConfig): Promise<StaticScanResponse> {
    const result = await this.scan(cfg);
    const name = cfg.pageName || deriveNameFromUrl(cfg.url);
    const files = emit(result, name);
    logger.info(`Static scan: ${result.stats.componentsFound} components emitted as ${toPascalCase(name)}Page`);
    return { scan: result, files };
  }
}

function deriveNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg || u.hostname.split('.')[0] || 'home';
  } catch {
    return 'home';
  }
}

export const staticScanService = new StaticScanService();
