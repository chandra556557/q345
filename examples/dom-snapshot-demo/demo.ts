/**
 * DOM Snaphots Demo Script
 * 
 * Run this after building the extension:
 * 1. npm run build
 * 2. Load extension in Chrome
 * 3. Run this demo in the service worker console
 */

import { crx } from 'playwright-crx';

async function runDemo() {
  console.log('🚀 Starting DOM Snapshots Demo');
  
  const crxApp = await crx.start();
  const page = await crxApp.newPage();
  
  // Navigate to a test page
  await page.goto('https://demo.playwright.dev/todomvc');
  await page.waitForLoadState('networkidle');
  
  console.log('\n📸 Step 1: Capture DOM Snapshot');
  const snapshot = await crxApp.captureDOMSnapshot('body');
  console.log('  URL:', snapshot.url);
  console.log('  Title:', snapshot.title);
  console.log('  Total Elements:', snapshot.metadata.totalElements);
  console.log('  Visible Elements:', snapshot.metadata.visibleElements);
  console.log('  Interactive Elements:', snapshot.metadata.interactiveElements);
  
  console.log('\n💾 Step 2: Save Baseline Snapshot');
  await crxApp.saveDOMSnapshot('todo-app-baseline', '.todoapp');
  console.log('  Baseline saved!');
  
  console.log('\n🔄 Step 3: Simulate User Actions');
  // Add a todo
  await page.getByPlaceholder('What needs to be done?').fill('Test DOM Snapshots');
  await page.getByPlaceholder('What needs to be done?').press('Enter');
  
  console.log('\n🔍 Step 4: Compare Snapshots');
  const { matches, diffs } = await crxApp.compareDOMSnapshot('todo-app-baseline', '.todoapp');
  
  if (matches) {
    console.log('  ✅ No changes detected');
  } else {
    console.log(`  ⚠️  ${diffs.length} differences found:`);
    diffs.slice(0, 5).forEach((diff, i) => {
      console.log(`    ${i + 1}. ${diff.type}: ${diff.path}`);
    });
  }
  
  console.log('\n🩹 Step 5: Test Self-Healing');
  await crxApp.enableSelfHealing();
  
  // Try to heal a selector (simulate a changed element)
  const healResult = await crxApp.healSelector('[data-testid="todo-item"]');
  console.log('  Healing Success:', healResult.success);
  console.log('  Confidence:', healResult.confidence);
  console.log('  Strategy:', healResult.strategy);
  
  if (!healResult.success && healResult.matches.length > 0) {
    console.log('  Alternative matches:');
    healResult.matches.slice(0, 3).forEach((match, i) => {
      console.log(`    ${i + 1}. ${match.selector} (${Math.round(match.confidence * 100)}%)`);
    });
  }
  
  console.log('\n📊 Step 6: Self-Healing Stats');
  const stats = crxApp.getSelfHealingStats();
  console.log('  Total Attempts:', stats.totalAttempts);
  console.log('  Successful:', stats.successfulHealings);
  console.log('  Failed:', stats.failedHealings);
  console.log('  Avg Confidence:', Math.round(stats.averageConfidence * 100) + '%');
  
  console.log('\n✅ Demo Complete!');
  
  await crxApp.close();
}

// Run if this is the main module
if (typeof window !== 'undefined') {
  (window as any).runDOMSnapshotDemo = runDemo;
  console.log('Demo loaded! Run runDOMSnapshotDemo() to start.');
}

export { runDemo };
