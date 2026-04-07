/**
 * Performance Optimization Demo Script
 * 
 * Run this after building the extension:
 * 1. npm run build
 * 2. Load extension in Chrome
 * 3. Run this demo in the service worker console
 */

import { crx } from 'playwright-crx';

async function runPerformanceDemo() {
  console.log('🚀 Performance Optimization Demo');
  console.log('================================\n');

  const crxApp = await crx.start();
  const page = await crxApp.newPage();

  // Enable parallel execution (default)
  crxApp.setParallelExecution(true);

  // Test code with mix of actions and assertions
  const testCode = `
    test('performance test', async ({ page }) => {
      await page.goto('https://demo.playwright.dev/todomvc');
      
      // These assertions can run in PARALLEL
      await expect(page.locator('.header h1')).toBeVisible();
      await expect(page.locator('.new-todo')).toBeVisible();
      await expect(page.locator('.todoapp')).toBeVisible();
      
      // These actions must run SEQUENTIALLY (data dependency)
      await page.locator('.new-todo').fill('Test parallel execution');
      await page.locator('.new-todo').press('Enter');
      
      // These assertions can run in PARALLEL
      await expect(page.locator('.todo-list li')).toHaveCount(1);
      await expect(page.locator('.todo-list li')).toHaveText('Test parallel execution');
      await expect(page.locator('.todo-count')).toContainText('1');
      
      // More sequential actions
      await page.locator('.new-todo').fill('Another todo');
      await page.locator('.new-todo').press('Enter');
      
      // Final parallel assertions
      await expect(page.locator('.todo-list li')).toHaveCount(2);
      await expect(page.locator('.todo-count')).toContainText('2');
    });
  `;

  console.log('📊 Test Code Analysis:');
  console.log('  - Total actions: 12');
  console.log('  - Assertions: 7 (parallelizable)');
  console.log('  - Form actions: 4 (sequential)');
  console.log('  - Navigation: 1 (sequential)');
  console.log('');

  console.log('⏱️  Running with SEQUENTIAL execution...');
  crxApp.setParallelExecution(false);
  const startSequential = performance.now();
  await crxApp.run(testCode, page);
  const sequentialDuration = performance.now() - startSequential;
  console.log(`  Sequential duration: ${Math.round(sequentialDuration)}ms`);
  console.log('');

  // Reset page state
  await page.goto('about:blank');
  await page.goto('https://demo.playwright.dev/todomvc');
  await page.waitForLoadState('networkidle');

  console.log('⚡ Running with PARALLEL execution...');
  crxApp.setParallelExecution(true);
  const startParallel = performance.now();
  await crxApp.run(testCode, page);
  const parallelDuration = performance.now() - startParallel;
  console.log(`  Parallel duration: ${Math.round(parallelDuration)}ms`);
  console.log('');

  // Get detailed metrics
  const metrics = crxApp.getExecutionMetrics();
  
  if (metrics) {
    console.log('📈 Detailed Metrics:');
    console.log('  Execution Batches:');
    console.log(`    Total: ${metrics.totalBatches}`);
    console.log(`    Parallel: ${metrics.parallelBatches} ⚡`);
    console.log(`    Sequential: ${metrics.sequentialBatches}`);
    console.log('');
    console.log('  Actions:');
    console.log(`    Total: ${metrics.totalActions}`);
    console.log(`    Parallelized: ${metrics.parallelizedActions}`);
    console.log(`    Efficiency: ${Math.round((metrics.parallelizedActions / metrics.totalActions) * 100)}%`);
    console.log('');
    console.log('  Performance:');
    console.log(`    Estimated time: ${Math.round(metrics.estimatedDuration)}ms`);
    console.log(`    Sequential time: ${Math.round(metrics.estimatedSequentialDuration)}ms`);
    console.log(`    Time saved: ${Math.round(metrics.estimatedTimeSaved)}ms`);
    console.log(`    Speedup: ${metrics.speedupFactor.toFixed(2)}x`);
    console.log('');
  }

  console.log('🎯 Real-World Performance:');
  console.log(`  Sequential: ${Math.round(sequentialDuration)}ms`);
  console.log(`  Parallel: ${Math.round(parallelDuration)}ms`);
  const actualSpeedup = sequentialDuration / parallelDuration;
  console.log(`  Actual Speedup: ${actualSpeedup.toFixed(2)}x`);
  console.log(`  Time Saved: ${Math.round(sequentialDuration - parallelDuration)}ms`);
  console.log('');

  console.log('✅ Demo Complete!');
  console.log('');
  console.log('💡 Tips for Maximum Performance:');
  console.log('  1. Group assertions together');
  console.log('  2. Use data-testid for stable selectors');
  console.log('  3. Avoid actions with side effects between assertions');
  console.log('  4. Structure tests with clear action/assertion phases');

  await crxApp.close();
}

// Run if this is the main module
if (typeof window !== 'undefined') {
  (window as any).runPerformanceDemo = runPerformanceDemo;
  console.log('Performance demo loaded! Run runPerformanceDemo() to start.');
}

export { runPerformanceDemo };
