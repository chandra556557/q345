# DOM Snapshots Demo

This example demonstrates the DOM snapshots and self-healing capabilities of playwright-crx.

## Features Demonstrated

1. **DOM Snapshot Capture** - Capture full DOM state including styles and structure
2. **Visual Regression Testing** - Compare DOM snapshots between test runs
3. **Self-Healing Tests** - Auto-recover when element selectors break

## Usage

### 1. Basic DOM Snapshot Capture

```typescript
import { crx } from 'playwright-crx';

const crxApp = await crx.start();
const page = await crxApp.newPage();
await page.goto('https://example.com');

// Capture full page DOM snapshot
const snapshot = await crxApp.captureDOMSnapshot();
console.log('Total elements:', snapshot.metadata.totalElements);
console.log('Visible elements:', snapshot.metadata.visibleElements);

// Capture specific element
const headerSnapshot = await crxApp.captureDOMSnapshot('header');
```

### 2. Save and Compare Snapshots

```typescript
// Save baseline snapshot
await crxApp.saveDOMSnapshot('homepage', 'body');

// Later, compare current state against baseline
const { matches, diffs } = await crxApp.compareDOMSnapshot('homepage', 'body');

if (!matches) {
  console.log('DOM changed!');
  diffs.forEach(diff => {
    console.log(`${diff.type}: ${diff.path}`);
    console.log(`  Changes: ${diff.changes?.join(', ')}`);
  });
}
```

### 3. Using in Test Code

```typescript
// In your recorded test
test('homepage visual regression', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('body')).toMatchDOMSnapshot('homepage');
});
```

### 4. Self-Healing

```typescript
// Enable self-healing for a page
await crxApp.enableSelfHealing();

// Try to find an element even if its selector changed
const result = await crxApp.healSelector('[data-testid="old-button"]');

if (result.success) {
  console.log(`Found element with new selector: ${result.healedSelector}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Strategy: ${result.strategy}`);
} else {
  console.log('Could not heal selector');
  console.log('Alternative matches:', result.matches);
}
```

## How It Works

### DOM Snapshot Structure

```typescript
interface DOMSnapshot {
  version: number;
  timestamp: number;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  root: DOMElementSnapshot;
  metadata: {
    totalElements: number;
    visibleElements: number;
    interactiveElements: number;
    depth: number;
  };
}

interface DOMElementSnapshot {
  tag: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  textContent?: string;
  children: DOMElementSnapshot[];
  boundingBox?: { x, y, width, height };
  isVisible: boolean;
  testId?: string;
  aria?: {
    role?: string;
    label?: string;
    // ... more ARIA properties
  };
}
```

### Self-Healing Matching Strategies

The self-healing engine uses multiple strategies with confidence scoring:

1. **ID Matching** (weight: 0.25) - Exact ID match
2. **Test ID Matching** (weight: 0.25) - data-testid attribute
3. **ARIA Attributes** (weight: 0.15) - role, label, etc.
4. **Tag Matching** (weight: 0.30) - Same element type
5. **Text Similarity** (weight: 0.10) - Similar text content
6. **Class Similarity** (weight: 0.05) - Shared CSS classes
7. **Structural Matching** (weight: 0.10) - Parent/child relationships

Minimum confidence threshold defaults to 0.7 (70%).

## Configuration Options

### DOM Snapshot Options

```typescript
const snapshot = await crxApp.captureDOMSnapshot('body', {
  includeStyles: true,        // Capture computed CSS
  includeHidden: false,       // Skip hidden elements
  includeBoundingBoxes: true, // Capture element positions
  maxDepth: 100,              // Maximum DOM traversal depth
  filter: (el) => !el.classList.contains('dynamic') // Custom filter
});
```

### Comparison Options

```typescript
const diffs = domSnapshotManager.compare(expected, actual, {
  ignoreAttributes: ['data-reactroot', 'data-reactid'],
  ignoreStyles: ['animation', 'transition'],
  ignoreTextContent: false,
  tolerance: 0.1  // Position tolerance
});
```

### Self-Healing Options

```typescript
const result = await crxApp.healSelector('[data-testid="btn"]', {
  minConfidence: 0.8,
  maxAttempts: 3,
  useVisualComparison: true,
  useTextSimilarity: true,
  useStructuralMatching: true,
  useAriaAttributes: true
});
```

## Benefits

1. **More Resilient Tests** - Tests can recover from minor UI changes
2. **Better Debugging** - Full DOM state captured on failure
3. **Visual Regression** - Detect unintended UI changes
4. **Smarter Assertions** - Compare full element state, not just text
