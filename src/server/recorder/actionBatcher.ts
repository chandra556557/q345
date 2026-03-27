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

import type { ActionInContext, Action, FrameDescription } from '@recorder/actions';
import type { PerformAction } from './crxPlayer';

export type ActionBatch = {
  actions: PerformAction[];
  type: 'parallel' | 'sequential';
  estimatedDuration: number;
};

export interface ActionBatcherOptions {
  maxBatchSize?: number;
  maxParallelDuration?: number;
  enableParallelAssertions?: boolean;
  enableParallelIndependentActions?: boolean;
  respectDataDependencies?: boolean;
}

const DEFAULT_OPTIONS: Required<ActionBatcherOptions> = {
  maxBatchSize: 5,
  maxParallelDuration: 5000, // 5 seconds max for parallel batch
  enableParallelAssertions: true,
  enableParallelIndependentActions: true,
  respectDataDependencies: true,
};

/**
 * Analyzes action dependencies to determine which can run in parallel
 */
export class ActionDependencyAnalyzer {
  private _actionGraph: Map<number, Set<number>> = new Map();
  private _actions: PerformAction[] = [];

  constructor(actions: PerformAction[]) {
    this._actions = actions;
    this._buildDependencyGraph();
  }

  /**
   * Builds a dependency graph where edges represent "must run after" relationships
   */
  private _buildDependencyGraph(): void {
    for (let i = 0; i < this._actions.length; i++) {
      this._actionGraph.set(i, new Set());
    }

    for (let i = 0; i < this._actions.length; i++) {
      for (let j = i + 1; j < this._actions.length; j++) {
        if (this._hasDependency(this._actions[i], this._actions[j], i, j)) {
          this._actionGraph.get(j)!.add(i);
        }
      }
    }
  }

  /**
   * Determines if action2 depends on action1
   */
  private _hasDependency(action1: PerformAction, action2: PerformAction, index1: number, index2: number): boolean {
    const { action: a1, frame: f1 } = action1;
    const { action: a2, frame: f2 } = action2;

    // Same frame/page dependency - actions on same element are dependent
    if (this._sameFrame(f1, f2)) {
      // Actions targeting the same selector are dependent
      if (this._getSelector(a1) && this._getSelector(a1) === this._getSelector(a2)) {
        return true;
      }

      // Navigation actions create dependencies
      if (a1.name === 'navigate' || a1.name === 'openPage') {
        return true;
      }

      // Click might trigger navigation or popup
      if (a1.name === 'click' && a1.signals.length > 0) {
        return true;
      }

      // Fill followed by action on same form
      if (a1.name === 'fill' && this._isFormAction(a2)) {
        // Check if they're in the same form
        return true; // Conservative approach
      }
    }

    // Actions with signals create dependencies for subsequent actions
    if (a1.signals.length > 0) {
      return true;
    }

    // Page operations are dependent
    if (a1.name === 'openPage' || a1.name === 'closePage') {
      return true;
    }

    // Sequential actions on same page are dependent
    if (f1.pageAlias === f2.pageAlias && index2 === index1 + 1) {
      // Conservative: adjacent actions on same page are dependent
      // unless both are assertions
      if (!(this._isAssertion(a1) && this._isAssertion(a2))) {
        return true;
      }
    }

    return false;
  }

  private _sameFrame(f1: FrameDescription, f2: FrameDescription): boolean {
    return f1.pageAlias === f2.pageAlias && 
           f1.framePath.length === f2.framePath.length &&
           f1.framePath.every((p, i) => p === f2.framePath[i]);
  }

  private _getSelector(action: Action): string | undefined {
    return (action as any).selector;
  }

  private _isFormAction(action: Action): boolean {
    return ['click', 'press', 'select', 'check', 'uncheck'].includes(action.name);
  }

  private _isAssertion(action: Action): boolean {
    return ['assertText', 'assertValue', 'assertChecked', 'assertVisible', 'assertSnapshot'].includes(action.name);
  }

  /**
   * Returns actions that can run in parallel (have no unresolved dependencies)
   */
  getParallelizableActions(completedIndices: Set<number>): number[] {
    const parallelizable: number[] = [];

    for (let i = 0; i < this._actions.length; i++) {
      if (completedIndices.has(i)) continue;

      const dependencies = this._actionGraph.get(i)!;
      const unresolvedDeps = [...dependencies].filter(dep => !completedIndices.has(dep));

      if (unresolvedDeps.length === 0) {
        parallelizable.push(i);
      }
    }

    return parallelizable;
  }

  /**
   * Get estimated duration for an action
   */
  getActionDuration(action: PerformAction): number {
    const baseDurations: Record<string, number> = {
      'click': 300,
      'fill': 200,
      'press': 150,
      'check': 200,
      'uncheck': 200,
      'select': 250,
      'navigate': 2000,
      'openPage': 1500,
      'closePage': 500,
      'assertText': 100,
      'assertValue': 100,
      'assertChecked': 100,
      'assertVisible': 100,
      'assertSnapshot': 500,
      'setInputFiles': 500,
    };

    return baseDurations[action.action.name] ?? 300;
  }
}

/**
 * Batches actions for optimal parallel execution
 */
export class ActionBatcher {
  private _options: Required<ActionBatcherOptions>;

  constructor(options?: ActionBatcherOptions) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Creates optimized batches from a list of actions
   */
  createBatches(actions: PerformAction[]): ActionBatch[] {
    if (!this._options.enableParallelIndependentActions) {
      // Fall back to sequential execution
      return [{
        actions,
        type: 'sequential',
        estimatedDuration: actions.reduce((sum, a) => sum + this._estimateDuration(a), 0),
      }];
    }

    const analyzer = new ActionDependencyAnalyzer(actions);
    const batches: ActionBatch[] = [];
    const completedIndices = new Set<number>();
    const totalActions = actions.length;

    while (completedIndices.size < totalActions) {
      const parallelizable = analyzer.getParallelizableActions(completedIndices);

      if (parallelizable.length === 0) {
        // This shouldn't happen unless there's a cycle
        break;
      }

      if (parallelizable.length === 1) {
        // Single action - sequential batch
        const idx = parallelizable[0];
        batches.push({
          actions: [actions[idx]],
          type: 'sequential',
          estimatedDuration: analyzer.getActionDuration(actions[idx]),
        });
        completedIndices.add(idx);
      } else {
        // Multiple parallelizable actions - create parallel batch
        const batchIndices = this._optimizeParallelBatch(
          parallelizable,
          actions,
          analyzer
        );

        const batchActions = batchIndices.map(i => actions[i]);
        const maxDuration = Math.max(...batchActions.map(a => analyzer.getActionDuration(a)));

        batches.push({
          actions: batchActions,
          type: 'parallel',
          estimatedDuration: maxDuration,
        });

        batchIndices.forEach(i => completedIndices.add(i));
      }
    }

    return batches;
  }

  /**
   * Selects the optimal subset of parallelizable actions
   */
  private _optimizeParallelBatch(
    parallelizable: number[],
    actions: PerformAction[],
    analyzer: ActionDependencyAnalyzer
  ): number[] {
    // Group by type for better batching
    const assertions = parallelizable.filter(i => this._isAssertion(actions[i]));
    const others = parallelizable.filter(i => !this._isAssertion(actions[i]));

    const selected: number[] = [];
    let estimatedDuration = 0;

    // Prioritize assertions for parallel execution (they're read-only)
    if (this._options.enableParallelAssertions) {
      for (const idx of assertions) {
        if (selected.length >= this._options.maxBatchSize) break;
        
        const duration = analyzer.getActionDuration(actions[idx]);
        if (estimatedDuration + duration <= this._options.maxParallelDuration) {
          selected.push(idx);
          estimatedDuration = Math.max(estimatedDuration, duration);
        }
      }
    }

    // Add independent actions
    for (const idx of others) {
      if (selected.length >= this._options.maxBatchSize) break;

      const duration = analyzer.getActionDuration(actions[idx]);
      if (estimatedDuration + duration <= this._options.maxParallelDuration) {
        selected.push(idx);
        estimatedDuration = Math.max(estimatedDuration, duration);
      }
    }

    return selected;
  }

  private _isAssertion(action: PerformAction): boolean {
    return ['assertText', 'assertValue', 'assertChecked', 'assertVisible', 'assertSnapshot', 'assertDOMSnapshot'].includes(action.action.name);
  }

  private _estimateDuration(action: PerformAction): number {
    const baseDurations: Record<string, number> = {
      'click': 300,
      'fill': 200,
      'press': 150,
      'check': 200,
      'uncheck': 200,
      'select': 250,
      'navigate': 2000,
      'openPage': 1500,
      'closePage': 500,
      'assertText': 100,
      'assertValue': 100,
      'assertChecked': 100,
      'assertVisible': 100,
      'assertSnapshot': 500,
      'assertDOMSnapshot': 800,
      'setInputFiles': 500,
    };

    return baseDurations[action.action.name] ?? 300;
  }

  /**
   * Calculate performance metrics for batched execution
   */
  calculateMetrics(batches: ActionBatch[], totalActions: number): ExecutionMetrics {
    const sequentialDuration = batches
      .filter(b => b.type === 'sequential')
      .reduce((sum, b) => sum + b.estimatedDuration, 0);

    const parallelDuration = batches
      .filter(b => b.type === 'parallel')
      .reduce((sum, b) => sum + b.estimatedDuration, 0);

    const totalEstimatedDuration = sequentialDuration + parallelDuration;
    
    // Estimate sequential duration (actions run one by one)
    const estimatedSequentialDuration = batches.reduce(
      (sum, batch) => sum + batch.actions.reduce((a, action) => a + this._estimateDuration(action), 0),
      0
    );

    return {
      totalBatches: batches.length,
      parallelBatches: batches.filter(b => b.type === 'parallel').length,
      sequentialBatches: batches.filter(b => b.type === 'sequential').length,
      totalActions,
      parallelizedActions: batches.filter(b => b.type === 'parallel').reduce((sum, b) => sum + b.actions.length, 0),
      estimatedDuration: totalEstimatedDuration,
      estimatedSequentialDuration,
      estimatedTimeSaved: estimatedSequentialDuration - totalEstimatedDuration,
      speedupFactor: estimatedSequentialDuration / totalEstimatedDuration,
    };
  }
}

export interface ExecutionMetrics {
  totalBatches: number;
  parallelBatches: number;
  sequentialBatches: number;
  totalActions: number;
  parallelizedActions: number;
  estimatedDuration: number;
  estimatedSequentialDuration: number;
  estimatedTimeSaved: number;
  speedupFactor: number;
}

// Singleton instance
export const actionBatcher = new ActionBatcher();
