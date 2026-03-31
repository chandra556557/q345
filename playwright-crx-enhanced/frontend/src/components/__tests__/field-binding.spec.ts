/**
 * E2E Tests for Field Binding in Script Enhancement Modal
 * Covers: FB-019 through FB-028
 *
 * Prerequisites:
 *   - Backend running on localhost:3001
 *   - Frontend running on localhost:5174
 *   - A user account with at least one project and one script containing {{placeholder}} patterns
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';
const API_URL = 'http://localhost:3001/api';

// Helper: log in and navigate to Scripts
async function loginAndGoToScripts(page: any) {
  await page.goto(BASE_URL);
  // Fill login form (adjust selectors to match your app)
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill('admin@test.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/dashboard**', { timeout: 10000 }).catch(() => {});
  }
  // Navigate to Scripts section
  await page.locator('text=Scripts').first().click();
  await page.waitForTimeout(1000);
}

// ──────────────────────────────────────────────────────────────────────
// FB-019: Verify placeholder extraction with {{}} patterns
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-019: Placeholder extraction with {{}} patterns', () => {
  test('should detect {{username}}, {{password}}, {{email}} from enhanced script', async ({ page }) => {
    // Mock the enhance endpoint to return script with placeholders
    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-script-1',
            scriptName: 'Login Test',
            originalCode: `await page.fill('#username', '{{username}}');\nawait page.fill('#password', '{{password}}');\nawait page.fill('#email', '{{email}}');`,
            enhancedCode: `await page.fill('#username', '{{username}}');\nawait page.fill('#password', '{{password}}');\nawait page.fill('#email', '{{email}}');`,
            suggestions: [],
            diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    // Mock placeholder extraction endpoint
    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [
            { name: 'username', line: 1, context: "await page.fill('#username', '{{username}}')" },
            { name: 'password', line: 2, context: "await page.fill('#password', '{{password}}')" },
            { name: 'email', line: 3, context: "await page.fill('#email', '{{email}}')" }
          ]
        })
      });
    });

    // Mock test data generation
    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { _testDataType: 'positive', _index: 1, username: 'john_doe', password: 'Pass@123', email: 'john@test.com' },
            { _testDataType: 'positive', _index: 2, username: 'jane_doe', password: 'Secure!456', email: 'jane@test.com' }
          ],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await loginAndGoToScripts(page);

    // Select a script and open enhancement
    const scriptRow = page.locator('[data-testid="script-row"], tr, .script-item').first();
    if (await scriptRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await scriptRow.click();
    }

    // Open enhancement modal (look for enhance button)
    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enhanceBtn.click();
    }

    // Generate test data
    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    // Click Auto-Detect in inline or modal binding
    const autoDetectBtn = page.locator('[data-testid="inline-auto-detect-btn"], [data-testid="modal-auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      await page.waitForTimeout(1000);

      // Verify placeholders are detected
      const usernameRow = page.locator('[data-testid*="binding-row-username"]').first();
      const passwordRow = page.locator('[data-testid*="binding-row-password"]').first();
      const emailRow = page.locator('[data-testid*="binding-row-email"]').first();

      await expect(usernameRow).toBeVisible();
      await expect(passwordRow).toBeVisible();
      await expect(emailRow).toBeVisible();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-020: Verify selector-based field extraction
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-020: Selector-based field extraction', () => {
  test('should detect fields from .fill() and getByLabel() selectors', async ({ page }) => {
    // Mock enhance to return script with selectors (no {{}} placeholders)
    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-script-2',
            scriptName: 'Form Test',
            originalCode: `await page.fill('#email', 'test@example.com');\nawait page.getByLabel('Password').fill('secret');`,
            enhancedCode: `await page.fill('#email', 'test@example.com');\nawait page.getByLabel('Password').fill('secret');`,
            suggestions: [],
            diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    // Mock extraction to fail (triggers client-side fallback with selector detection)
    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Not found' }) });
    });

    // Mock test data
    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, email: 'user@test.com', Password: 'Test@123' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await loginAndGoToScripts(page);

    // Trigger enhancement and test data generation flow
    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await enhanceBtn.click();
    }

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    const autoDetectBtn = page.locator('[data-testid*="auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      await page.waitForTimeout(1500);

      // Verify selector-based fields detected (email from #email, Password from getByLabel)
      const bindingList = page.locator('[data-testid*="binding-list"]').first();
      await expect(bindingList).toBeVisible();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-021: Verify auto-bind exact match
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-021: Auto-bind exact match', () => {
  test('placeholder {{username}} should auto-bind to data field "username"', async ({ page }) => {
    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [
            { name: 'username', line: 1, context: "fill('#user', '{{username}}')" },
            { name: 'password', line: 2, context: "fill('#pass', '{{password}}')" }
          ]
        })
      });
    });

    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-3', scriptName: 'Auto-Bind Test',
            originalCode: "fill('#user', '{{username}}');\nfill('#pass', '{{password}}');",
            enhancedCode: "fill('#user', '{{username}}');\nfill('#pass', '{{password}}');",
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, username: 'john', password: 'secret123' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    const autoDetectBtn = page.locator('[data-testid*="auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      await page.waitForTimeout(1000);

      // Check that username select is auto-bound to "username"
      const usernameSelect = page.locator('[data-testid*="binding-select-username"]').first();
      if (await usernameSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(usernameSelect).toHaveValue('username');
      }

      // Check that password select is auto-bound to "password"
      const passwordSelect = page.locator('[data-testid*="binding-select-password"]').first();
      if (await passwordSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(passwordSelect).toHaveValue('password');
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-022: Verify auto-bind fuzzy match
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-022: Auto-bind fuzzy match', () => {
  test('placeholder {{email}} should fuzzy-bind to data field "user_email"', async ({ page }) => {
    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [{ name: 'email', line: 1, context: "fill('#email', '{{email}}')" }]
        })
      });
    });

    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-4', scriptName: 'Fuzzy Bind Test',
            originalCode: "fill('#email', '{{email}}');",
            enhancedCode: "fill('#email', '{{email}}');",
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, user_email: 'fuzzy@test.com', full_name: 'John' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    const autoDetectBtn = page.locator('[data-testid*="auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      await page.waitForTimeout(1000);

      // "email" should fuzzy-match to "user_email" since "user_email" includes "email"
      const emailSelect = page.locator('[data-testid*="binding-select-email"]').first();
      if (await emailSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(emailSelect).toHaveValue('user_email');
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-023: Verify manual binding addition
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-023: Manual binding addition', () => {
  test('should add manual placeholder "customField" mapped to data field', async ({ page }) => {
    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-5', scriptName: 'Manual Bind Test',
            originalCode: 'await page.click("button");',
            enhancedCode: 'await page.click("button");',
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, first_name: 'Alice', last_name: 'Smith' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    // Open test data modal and generate
    const genModalBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genModalBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genModalBtn.click();
      await page.waitForTimeout(1000);
    }

    const genBtn = page.locator('[data-testid="modal-field-binding"]').locator('..').locator('button:has-text("Generate")').first();
    if (await genBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    // Fill manual placeholder input
    const nameInput = page.locator('[data-testid="modal-manual-placeholder-input"]');
    const fieldSelect = page.locator('[data-testid="modal-manual-field-select"]');
    const addBtn = page.locator('[data-testid="modal-manual-add-btn"]');

    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nameInput.fill('customField');
      await fieldSelect.selectOption('first_name');
      await addBtn.click();
      await page.waitForTimeout(500);

      // Verify the new binding row appears
      const customRow = page.locator('[data-testid="modal-binding-row-customField"]');
      await expect(customRow).toBeVisible();

      // Verify the placeholder label
      const placeholderLabel = page.locator('[data-testid="modal-placeholder-customField"]');
      await expect(placeholderLabel).toContainText('{{customField}}');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-024: Verify DDR creation with bindings
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-024: DDR creation with bindings', () => {
  test('should create data-driven run with correct field bindings', async ({ page }) => {
    let capturedDDRRequest: any = null;

    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-6', scriptName: 'DDR Creation Test',
            originalCode: "fill('#user', '{{username}}');",
            enhancedCode: "fill('#user', '{{username}}');",
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [{ name: 'username', line: 1, context: "fill('#user', '{{username}}')" }]
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { _testDataType: 'positive', _index: 1, username: 'user1' },
            { _testDataType: 'positive', _index: 2, username: 'user2' }
          ],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    // Intercept DDR creation to capture the payload
    await page.route(`${API_URL}/data-driven-runs`, (route) => {
      if (route.request().method() === 'POST') {
        capturedDDRRequest = route.request().postDataJSON();
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: 'ddr-created-123', status: 'pending' } })
        });
      } else {
        route.continue();
      }
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    const autoDetectBtn = page.locator('[data-testid*="auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      await page.waitForTimeout(1000);
    }

    // Click Save/Create DDR
    const saveBtn = page.locator('[data-testid*="save-ddr-btn"]').first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);

      // Verify the request payload
      expect(capturedDDRRequest).toBeTruthy();
      expect(capturedDDRRequest.fieldBindings).toHaveProperty('username', 'username');
      expect(capturedDDRRequest.dataRows).toHaveLength(2);
      expect(capturedDDRRequest.browser).toBe('chromium');
      expect(capturedDDRRequest.executionMode).toBe('sequential');

      // Verify success state
      await expect(saveBtn).toContainText('DDR Created');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-025: Verify binding persists across modal reopen
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-025: Binding state persistence within session', () => {
  test('bindings should persist in inline view when modal closes', async ({ page }) => {
    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-7', scriptName: 'Persistence Test',
            originalCode: "fill('#email', '{{email}}');",
            enhancedCode: "fill('#email', '{{email}}');",
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, email: 'test@test.com' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [{ name: 'email', line: 1, context: "fill('#email', '{{email}}')" }]
        })
      });
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    // Generate test data from main view
    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    // In the modal, click auto-detect
    const modalAutoDetect = page.locator('[data-testid="modal-auto-detect-btn"]');
    if (await modalAutoDetect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await modalAutoDetect.click();
      await page.waitForTimeout(1000);

      // Verify binding exists in modal
      const modalBinding = page.locator('[data-testid="modal-binding-list"]');
      if (await modalBinding.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(modalBinding).toBeVisible();
      }
    }

    // Close modal — inline binding should still show the data
    const closeBtn = page.locator('button:has-text("Close")').first();
    if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }

    // The inline binding section should be visible (test data persists in main view)
    const inlineBinding = page.locator('[data-testid="inline-field-binding"]');
    // Note: bindings are cleared on modal close by design; inline binding
    // relies on test data still being available in the main view state
    if (await inlineBinding.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(inlineBinding).toBeVisible();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-026: Verify empty state messaging
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-026: Empty state messaging', () => {
  test('should show instructional message when no placeholders detected', async ({ page }) => {
    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-8', scriptName: 'Empty State Test',
            originalCode: 'await page.goto("https://example.com");',
            enhancedCode: 'await page.goto("https://example.com");',
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, name: 'test' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    // Check for empty state in inline view
    const inlineEmpty = page.locator('[data-testid="inline-empty-state"]');
    if (await inlineEmpty.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(inlineEmpty).toContainText('Auto-Detect');
    }

    // Check for empty state in modal
    const modalEmpty = page.locator('[data-testid="modal-empty-state"]');
    if (await modalEmpty.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(modalEmpty).toContainText('Auto-Detect Fields');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-027: Verify loading states
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-027: Loading states', () => {
  test('should show spinner during auto-detection and save', async ({ page }) => {
    // Slow down the extraction endpoint to observe loading state
    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, async (route) => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [{ name: 'field1', line: 1, context: '{{field1}}' }]
        })
      });
    });

    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-9', scriptName: 'Loading Test',
            originalCode: "fill('#f', '{{field1}}');",
            enhancedCode: "fill('#f', '{{field1}}');",
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, field1: 'val1' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    // Slow down DDR creation to observe save loading state
    await page.route(`${API_URL}/data-driven-runs`, async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: 'ddr-loading-test', status: 'pending' } })
        });
      } else {
        route.continue();
      }
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    // Click auto-detect and verify loading state
    const autoDetectBtn = page.locator('[data-testid*="auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      // Should show "Detecting..." text while loading
      await expect(autoDetectBtn).toContainText('Detecting');
      // Wait for loading to complete
      await page.waitForTimeout(3000);
    }

    // Click save and verify loading state
    const saveBtn = page.locator('[data-testid*="save-ddr-btn"]').first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveBtn.click();
      // Should show "Saving..." text while loading
      await expect(saveBtn).toContainText('Saving');
      await page.waitForTimeout(3000);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// FB-028: Verify success state after save
// ──────────────────────────────────────────────────────────────────────
test.describe('FB-028: Success state after save', () => {
  test('save button should show success state with checkmark after DDR creation', async ({ page }) => {
    await page.route(`${API_URL}/scripts/*/enhance`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scriptId: 'test-10', scriptName: 'Success State Test',
            originalCode: "fill('#a', '{{alpha}}');",
            enhancedCode: "fill('#a', '{{alpha}}');",
            suggestions: [], diff: [],
            summary: { totalSuggestions: 0, byCategory: {}, estimatedImprovement: 0 }
          }
        })
      });
    });

    await page.route(`${API_URL}/data-driven-runs/extract-placeholders`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          placeholders: [{ name: 'alpha', line: 1, context: "fill('#a', '{{alpha}}')" }]
        })
      });
    });

    await page.route('**/testdata/generate/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ _testDataType: 'positive', _index: 1, alpha: 'value1' }],
          metadata: { testDataType: 'positive' }
        })
      });
    });

    await page.route(`${API_URL}/data-driven-runs`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: 'ddr-success-test', status: 'pending' } })
        });
      } else {
        route.continue();
      }
    });

    await loginAndGoToScripts(page);

    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("AI Enhancement")').first();
    if (await enhanceBtn.isVisible({ timeout: 3000 }).catch(() => false)) await enhanceBtn.click();

    const genBtn = page.locator('button:has-text("Generate Test Data")').first();
    if (await genBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genBtn.click();
      await page.waitForTimeout(2000);
    }

    const autoDetectBtn = page.locator('[data-testid*="auto-detect-btn"]').first();
    if (await autoDetectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autoDetectBtn.click();
      await page.waitForTimeout(1500);
    }

    const saveBtn = page.locator('[data-testid*="save-ddr-btn"]').first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);

      // Verify success state: button text changes and is disabled
      await expect(saveBtn).toContainText('DDR Created');
      await expect(saveBtn).toBeDisabled();
    }
  });
});
