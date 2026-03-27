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
import { domSnapshotManager, type DOMElementSnapshot, type DOMSnapshot } from './domSnapshot';

export interface ElementMatch {
  selector: string;
  confidence: number;
  reason: string;
  element: DOMElementSnapshot;
}

export interface SelfHealingResult {
  success: boolean;
  originalSelector: string;
  healedSelector?: string;
  confidence: number;
  matches: ElementMatch[];
  strategy: string;
  timestamp: number;
}

export interface SelfHealingOptions {
  minConfidence?: number;
  maxAttempts?: number;
  useVisualComparison?: boolean;
  useTextSimilarity?: boolean;
  useStructuralMatching?: boolean;
  useAriaAttributes?: boolean;
  fallbackStrategies?: string[];
}

const DEFAULT_SELF_HEALING_OPTIONS: Required<SelfHealingOptions> = {
  minConfidence: 0.7,
  maxAttempts: 3,
  useVisualComparison: true,
  useTextSimilarity: true,
  useStructuralMatching: true,
  useAriaAttributes: true,
  fallbackStrategies: ['id', 'testid', 'aria', 'text', 'class', 'structural'],
};

export class SelfHealingEngine {
  private _history: Map<string, DOMSnapshot> = new Map();
  private _healingStats = {
    totalAttempts: 0,
    successfulHealings: 0,
    failedHealings: 0,
    averageConfidence: 0,
  };

  async captureReference(page: Page, actionId: string, selector: string): Promise<void> {
    try {
      const snapshot = await domSnapshotManager.capture(page, selector, {
        includeStyles: true,
        includeBoundingBoxes: true,
        includeHidden: false,
      });
      this._history.set(`${actionId}:${selector}`, snapshot);
    } catch (e) {
      // If selector not found, we can't capture reference
      console.warn(`Failed to capture reference for ${selector}: ${e}`);
    }
  }

  async heal(
    page: Page,
    originalSelector: string,
    actionId: string,
    options?: SelfHealingOptions
  ): Promise<SelfHealingResult> {
    const opts = { ...DEFAULT_SELF_HEALING_OPTIONS, ...options };
    this._healingStats.totalAttempts++;

    const referenceKey = `${actionId}:${originalSelector}`;
    const referenceSnapshot = this._history.get(referenceKey);

    if (!referenceSnapshot) {
      return {
        success: false,
        originalSelector,
        confidence: 0,
        matches: [],
        strategy: 'none',
        timestamp: Date.now(),
      };
    }

    const currentSnapshot = await domSnapshotManager.capture(page, 'body');
    const matches = this._findMatches(
      referenceSnapshot.root,
      currentSnapshot.root,
      originalSelector,
      opts
    );

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    const bestMatch = matches[0];
    const success = bestMatch && bestMatch.confidence >= opts.minConfidence;

    if (success) {
      this._healingStats.successfulHealings++;
      this._updateAverageConfidence(bestMatch.confidence);
    } else {
      this._healingStats.failedHealings++;
    }

    return {
      success,
      originalSelector,
      healedSelector: bestMatch?.selector,
      confidence: bestMatch?.confidence ?? 0,
      matches: matches.slice(0, 5),
      strategy: bestMatch?.reason ?? 'none',
      timestamp: Date.now(),
    };
  }

  private _findMatches(
    reference: DOMElementSnapshot,
    current: DOMElementSnapshot,
    originalSelector: string,
    options: Required<SelfHealingOptions>
  ): ElementMatch[] {
    const matches: ElementMatch[] = [];
    const candidates = this._collectCandidates(current);

    for (const candidate of candidates) {
      const match = this._calculateMatch(reference, candidate, options);
      if (match.confidence > 0) {
        matches.push(match);
      }
    }

    return matches;
  }

  private _collectCandidates(root: DOMElementSnapshot): DOMElementSnapshot[] {
    const candidates: DOMElementSnapshot[] = [];
    
    const collect = (el: DOMElementSnapshot | null | undefined) => {
      if (!el) return;
      if (el.isVisible) {
        candidates.push(el);
      }
      if (Array.isArray(el.children)) {
        for (const child of el.children) {
          collect(child);
        }
      }
    };

    if (root) {
      collect(root);
    }
    return candidates;
  }

  private _calculateMatch(
    reference: DOMElementSnapshot | null | undefined,
    candidate: DOMElementSnapshot | null | undefined,
    options: Required<SelfHealingOptions>
  ): ElementMatch {
    // Handle null/undefined cases
    if (!reference || !candidate) {
      return {
        selector: candidate ? this._buildSelector(candidate) : 'unknown',
        confidence: 0,
        reason: 'missing element data',
        element: candidate || { tag: 'unknown', attributes: {}, styles: {}, children: [], isVisible: false },
      };
    }

    let totalScore = 0;
    let totalWeight = 0;
    const reasons: string[] = [];

    // Tag matching (high weight)
    if (reference.tag && reference.tag === candidate.tag) {
      totalScore += 0.3 * 1;
      reasons.push('same tag');
    }
    totalWeight += 0.3;

    // ID matching (very high weight)
    const refId = reference.attributes?.id;
    const candId = candidate.attributes?.id;
    if (refId && refId === candId) {
      totalScore += 0.25 * 1;
      reasons.push('same id');
    }
    totalWeight += 0.25;

    // Test ID matching (very high weight)
    if (reference.testId && reference.testId === candidate.testId) {
      totalScore += 0.25 * 1;
      reasons.push('same testid');
    }
    totalWeight += 0.25;

    // ARIA attributes matching
    if (options.useAriaAttributes && reference.aria && candidate.aria) {
      let ariaScore = 0;
      let ariaCount = 0;
      
      if (reference.aria.role && candidate.aria.role) {
        ariaScore += reference.aria.role === candidate.aria.role ? 1 : 0;
        ariaCount++;
      }
      if (reference.aria.label && candidate.aria.label) {
        ariaScore += this._textSimilarity(reference.aria.label, candidate.aria.label);
        ariaCount++;
      }
      
      if (ariaCount > 0) {
        totalScore += 0.15 * (ariaScore / ariaCount);
        if (ariaScore > 0) reasons.push('aria match');
      }
    }
    totalWeight += 0.15;

    // Text similarity
    if (options.useTextSimilarity && reference.textContent && candidate.textContent) {
      try {
        const similarity = this._textSimilarity(reference.textContent, candidate.textContent);
        totalScore += 0.1 * similarity;
        if (similarity > 0.8) reasons.push('text similarity');
      } catch (e) {
        // Text similarity failed, skip
      }
    }
    totalWeight += 0.1;

    // Class matching
    const refClass = reference.attributes?.class;
    const candClass = candidate.attributes?.class;
    if (refClass && candClass && typeof refClass === 'string' && typeof candClass === 'string') {
      const refClasses = new Set(refClass.split(' '));
      const candClasses = new Set(candClass.split(' '));
      const intersection = new Set([...refClasses].filter(x => candClasses.has(x)));
      const union = new Set([...refClasses, ...candClasses]);
      const classSimilarity = union.size > 0 ? intersection.size / union.size : 0;
      
      totalScore += 0.05 * classSimilarity;
      if (classSimilarity > 0.5) reasons.push('class similarity');
    }
    totalWeight += 0.05;

    // Structural matching (parent/child relationships)
    if (options.useStructuralMatching) {
      const structuralScore = this._structuralSimilarity(reference, candidate);
      totalScore += 0.1 * structuralScore;
      if (structuralScore > 0.5) reasons.push('structural similarity');
    }
    totalWeight += 0.1;

    const confidence = totalWeight > 0 ? totalScore / totalWeight : 0;

    return {
      selector: this._buildSelector(candidate),
      confidence: Math.min(confidence, 1),
      reason: reasons.join(', '),
      element: candidate,
    };
  }

  private _textSimilarity(text1: string | null | undefined, text2: string | null | undefined): number {
    // Handle null/undefined inputs
    if (!text1 && !text2) return 1; // Both empty/null are considered identical
    if (!text1 || !text2) return 0; // One is null, other is not

    const normalized1 = text1.toLowerCase().trim();
    const normalized2 = text2.toLowerCase().trim();
    
    if (normalized1 === normalized2) return 1;
    if (normalized1 === '' || normalized2 === '') return 0;
    
    // Simple Jaccard similarity for words
    const words1 = new Set(normalized1.split(/\s+/).filter(w => w.length > 0));
    const words2 = new Set(normalized2.split(/\s+/).filter(w => w.length > 0));
    
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private _structuralSimilarity(reference: DOMElementSnapshot, candidate: DOMElementSnapshot): number {
    // Compare child counts
    const refChildCount = reference.children.length;
    const candChildCount = candidate.children.length;
    
    if (refChildCount === 0 && candChildCount === 0) return 1;
    if (refChildCount === 0 || candChildCount === 0) return 0;
    
    // Compare child tag distributions
    const refTags = this._getTagDistribution(reference);
    const candTags = this._getTagDistribution(candidate);
    
    let matchingTags = 0;
    const allTags = new Set([...refTags.keys(), ...candTags.keys()]);
    
    for (const tag of allTags) {
      const refCount = refTags.get(tag) ?? 0;
      const candCount = candTags.get(tag) ?? 0;
      matchingTags += Math.min(refCount, candCount);
    }
    
    return matchingTags / Math.max(refChildCount, candChildCount);
  }

  private _getTagDistribution(element: DOMElementSnapshot): Map<string, number> {
    const distribution = new Map<string, number>();
    
    for (const child of element.children) {
      const count = distribution.get(child.tag) ?? 0;
      distribution.set(child.tag, count + 1);
    }
    
    return distribution;
  }

  private _buildSelector(element: DOMElementSnapshot | null | undefined): string {
    if (!element) {
      return 'unknown';
    }

    const parts: string[] = [element.tag || 'unknown'];
    
    if (element.attributes?.id) {
      parts.push(`#${element.attributes.id}`);
      return parts.join('');
    }
    
    if (element.testId) {
      parts.push(`[data-testid="${element.testId}"]`);
      return parts.join('');
    }
    
    if (element.attributes?.class && typeof element.attributes.class === 'string') {
      const classes = element.attributes.class.split(' ').slice(0, 2);
      if (classes.length > 0 && classes[0]) {
        parts.push(`.${classes.join('.')}`);
      }
    }
    
    return parts.join('');
  }

  private _updateAverageConfidence(newConfidence: number): void {
    const { successfulHealings, averageConfidence } = this._healingStats;
    this._healingStats.averageConfidence = 
      ((averageConfidence * (successfulHealings - 1)) + newConfidence) / successfulHealings;
  }

  getStats() {
    return { ...this._healingStats };
  }

  clearHistory(): void {
    this._history.clear();
  }

  exportHistory(): Record<string, DOMSnapshot> {
    return Object.fromEntries(this._history);
  }
}

// Singleton instance
export const selfHealingEngine = new SelfHealingEngine();
