/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Page } from 'playwright-core/lib/server/page';
import type { Frame } from 'playwright-core/lib/server/frames';
import { serverSideCallMetadata } from 'playwright-core/lib/server';
import { createGuid } from 'playwright-core/lib/utils';

export interface DOMElementSnapshot {
  tag: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  textContent?: string;
  children: DOMElementSnapshot[];
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  testId?: string;
  aria?: {
    role?: string;
    label?: string;
    level?: number;
    checked?: boolean | 'mixed';
    pressed?: boolean | 'mixed';
    selected?: boolean;
    expanded?: boolean;
  };
}

export interface DOMSnapshot {
  version: number;
  timestamp: number;
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
  };
  root: DOMElementSnapshot;
  metadata: {
    totalElements: number;
    visibleElements: number;
    interactiveElements: number;
    depth: number;
  };
}

export interface DOMSnapshotOptions {
  includeStyles?: boolean;
  includeHidden?: boolean;
  includeBoundingBoxes?: boolean;
  maxDepth?: number;
  filter?: (element: Element) => boolean;
}

export interface DOMSnapshotDiff {
  type: 'added' | 'removed' | 'modified' | 'moved';
  path: string;
  expected?: DOMElementSnapshot;
  actual?: DOMElementSnapshot;
  changes?: string[];
}

export interface DOMSnapshotCompareOptions {
  ignoreAttributes?: string[];
  ignoreStyles?: string[];
  ignoreTextContent?: boolean;
  tolerance?: number;
}

const DEFAULT_OPTIONS: Required<DOMSnapshotOptions> = {
  includeStyles: true,
  includeHidden: false,
  includeBoundingBoxes: true,
  maxDepth: 100,
  filter: () => true,
};

const DEFAULT_COMPARE_OPTIONS: Required<DOMSnapshotCompareOptions> = {
  ignoreAttributes: ['data-reactroot', 'data-reactid', '_ngcontent'],
  ignoreStyles: ['animation', 'transition'],
  ignoreTextContent: false,
  tolerance: 0,
};

export class DOMSnapshotManager {
  
  async capture(page: Page, selector?: string, options?: DOMSnapshotOptions): Promise<DOMSnapshot> {
    const frame = page.mainFrame();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // Get page metadata
    const [url, title, viewport] = await Promise.all([
      frame.evaluate(() => window.location.href),
      frame.evaluate(() => document.title),
      page.viewportSize(),
    ]);

    // Capture DOM through evaluation
    const rootSnapshot = await this._captureElement(frame, selector || 'html', opts);
    
    const metadata = this._calculateMetadata(rootSnapshot);
    
    return {
      version: 1,
      timestamp: Date.now(),
      url,
      title,
      viewport: viewport ?? { width: 1280, height: 720 },
      root: rootSnapshot,
      metadata,
    };
  }

  async captureElement(page: Page, selector: string, options?: DOMSnapshotOptions): Promise<DOMElementSnapshot> {
    const frame = page.mainFrame();
    return this._captureElement(frame, selector, { ...DEFAULT_OPTIONS, ...options });
  }

  private async _captureElement(frame: Frame, selector: string, options: Required<DOMSnapshotOptions>, depth = 0): Promise<DOMElementSnapshot> {
    if (depth > options.maxDepth) {
      return {
        tag: 'max-depth-reached',
        attributes: {},
        styles: {},
        children: [],
        isVisible: false,
      };
    }

    return await frame.evaluate(({ selector, options, depth }) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      function captureElement(el: Element, currentDepth: number): any {
        const tag = el.tagName.toLowerCase();
        
        // Check visibility
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && 
                         style.visibility !== 'hidden' && 
                         style.opacity !== '0';
        
        if (!options.includeHidden && !isVisible && currentDepth > 0) {
          return null;
        }

        // Check filter
        if (!options.filter(el)) {
          return null;
        }

        // Capture attributes
        const attributes: Record<string, string> = {};
        for (const attr of el.attributes) {
          attributes[attr.name] = attr.value;
        }

        // Capture styles
        const styles: Record<string, string> = {};
        if (options.includeStyles) {
          const computedStyle = window.getComputedStyle(el);
          const relevantStyles = [
            'color', 'background-color', 'font-size', 'font-weight',
            'width', 'height', 'display', 'position', 'margin', 'padding',
            'border', 'border-radius', 'box-shadow', 'opacity',
          ];
          for (const prop of relevantStyles) {
            styles[prop] = computedStyle.getPropertyValue(prop);
          }
        }

        // Get bounding box
        let boundingBox;
        if (options.includeBoundingBoxes) {
          const rect = el.getBoundingClientRect();
          boundingBox = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        }

        // Get ARIA info
        const aria: any = {};
        const ariaRole = el.getAttribute('role') || (el as HTMLElement)?.role;
        if (ariaRole) aria.role = ariaRole;
        
        // Safely get text content for aria-label
        let ariaLabel: string | null = null;
        try {
          ariaLabel = el.getAttribute('aria-label') || 
                     el.getAttribute('aria-labelledby') ||
                     ((el as HTMLElement)?.innerText?.slice(0, 100)) ||
                     el.textContent?.slice(0, 100) ||
                     null;
        } catch (e) {
          // Fallback if innerText access fails
          ariaLabel = el.textContent?.slice(0, 100) || null;
        }
        if (ariaLabel) aria.label = ariaLabel;

        const ariaLevel = el.getAttribute('aria-level');
        if (ariaLevel) {
          const parsed = parseInt(ariaLevel, 10);
          if (!isNaN(parsed)) aria.level = parsed;
        }

        // Capture children
        const children: any[] = [];
        if (currentDepth < options.maxDepth) {
          for (const child of el.children) {
            const childSnapshot = captureElement(child, currentDepth + 1);
            if (childSnapshot) {
              children.push(childSnapshot);
            }
          }
        }

        // Get testId
        const testId = el.getAttribute('data-testid') || 
                      el.getAttribute('data-test-id') ||
                      el.id || undefined;

        return {
          tag,
          attributes,
          styles,
          textContent: el.textContent?.slice(0, 500),
          children,
          boundingBox,
          isVisible,
          testId,
          aria: Object.keys(aria).length > 0 ? aria : undefined,
        };
      }

      return captureElement(element, depth);
    }, { selector, options, depth });
  }

  compare(expected: DOMSnapshot, actual: DOMSnapshot, options?: DOMSnapshotCompareOptions): DOMSnapshotDiff[] {
    const opts = { ...DEFAULT_COMPARE_OPTIONS, ...options };
    const diffs: DOMSnapshotDiff[] = [];
    
    this._compareElements(
      expected.root,
      actual.root,
      '',
      opts,
      diffs
    );
    
    return diffs;
  }

  private _compareElements(
    expected: DOMElementSnapshot,
    actual: DOMElementSnapshot,
    path: string,
    options: Required<DOMSnapshotCompareOptions>,
    diffs: DOMSnapshotDiff[]
  ): void {
    const currentPath = path ? `${path} > ${expected.tag}` : expected.tag;

    // Compare tag
    if (expected.tag !== actual.tag) {
      diffs.push({
        type: 'modified',
        path: currentPath,
        expected,
        actual,
        changes: [`Tag changed from "${expected.tag}" to "${actual.tag}"`],
      });
      return;
    }

    const changes: string[] = [];

    // Compare attributes
    for (const [key, value] of Object.entries(expected.attributes)) {
      if (options.ignoreAttributes.some(attr => key.includes(attr))) {
        continue;
      }
      if (actual.attributes[key] !== value) {
        changes.push(`Attribute "${key}" changed from "${value}" to "${actual.attributes[key]}"`);
      }
    }

    // Compare styles
    for (const [key, value] of Object.entries(expected.styles)) {
      if (options.ignoreStyles.some(style => key.includes(style))) {
        continue;
      }
      if (actual.styles[key] !== value) {
        changes.push(`Style "${key}" changed from "${value}" to "${actual.styles[key]}"`);
      }
    }

    // Compare text content
    if (!options.ignoreTextContent && expected.textContent !== actual.textContent) {
      changes.push(`Text content changed`);
    }

    // Compare visibility
    if (expected.isVisible !== actual.isVisible) {
      changes.push(`Visibility changed from ${expected.isVisible} to ${actual.isVisible}`);
    }

    if (changes.length > 0) {
      diffs.push({
        type: 'modified',
        path: currentPath,
        expected,
        actual,
        changes,
      });
    }

    // Compare children
    const maxChildren = Math.max(expected.children.length, actual.children.length);
    for (let i = 0; i < maxChildren; i++) {
      const expectedChild = expected.children[i];
      const actualChild = actual.children[i];

      if (!expectedChild && actualChild) {
        diffs.push({
          type: 'added',
          path: `${currentPath} > ${actualChild.tag}[${i}]`,
          actual: actualChild,
        });
      } else if (expectedChild && !actualChild) {
        diffs.push({
          type: 'removed',
          path: `${currentPath} > ${expectedChild.tag}[${i}]`,
          expected: expectedChild,
        });
      } else if (expectedChild && actualChild) {
        this._compareElements(expectedChild, actualChild, currentPath, options, diffs);
      }
    }
  }

  private _calculateMetadata(root: DOMElementSnapshot): DOMSnapshot['metadata'] {
    let totalElements = 0;
    let visibleElements = 0;
    let interactiveElements = 0;
    let maxDepth = 0;

    const countElements = (el: DOMElementSnapshot, depth: number) => {
      totalElements++;
      if (el.isVisible) visibleElements++;
      
      const interactiveTags = ['button', 'a', 'input', 'select', 'textarea', 'form'];
      if (interactiveTags.includes(el.tag) || el.attributes.onclick) {
        interactiveElements++;
      }

      maxDepth = Math.max(maxDepth, depth);

      for (const child of el.children) {
        countElements(child, depth + 1);
      }
    };

    countElements(root, 1);

    return {
      totalElements,
      visibleElements,
      interactiveElements,
      depth: maxDepth,
    };
  }

  serialize(snapshot: DOMSnapshot): string {
    return JSON.stringify(snapshot, null, 2);
  }

  deserialize(json: string): DOMSnapshot {
    return JSON.parse(json);
  }

  async saveToFile(snapshot: DOMSnapshot, path: string): Promise<void> {
    const fs = await import('../../shims/fs');
    await fs.writeFileSync(path, this.serialize(snapshot));
  }

  async loadFromFile(path: string): Promise<DOMSnapshot> {
    const fs = await import('../../shims/fs');
    const content = fs.readFileSync(path, 'utf-8');
    return this.deserialize(content);
  }
}

// Singleton instance
export const domSnapshotManager = new DOMSnapshotManager();
