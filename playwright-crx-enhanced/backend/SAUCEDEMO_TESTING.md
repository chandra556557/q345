# SauceDemo Testing Guide

Complete guide to testing https://saucedemo.com with Cucumber BDD

---

## 📋 Feature File Overview

**File:** `features/saucedemo.feature`

**16 Scenarios covering:**
- Authentication (login/logout)
- Product browsing & filtering
- Shopping cart management
- Checkout process
- Sorting & filtering
- Error handling
- Performance
- Accessibility

---

## 🚀 Quick Start

### Build & Run
```bash
# Build TypeScript
npm run build

# Run all saucedemo tests
npx cucumber-js features/saucedemo.feature
```

### Run Specific Scenarios by Tag

#### 1. Smoke Tests (Fast validation)
```bash
npx cucumber-js features/saucedemo.feature --tags "@smoke"

# Runs:
# ✓ Successful login with valid credentials
# ✓ View products list
```

#### 2. Shopping Cart Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@shopping-cart"

# Runs all cart-related scenarios:
# ✓ Add single product to cart
# ✓ Add multiple products to cart
# ✓ Remove product from cart
```

#### 3. Checkout Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@checkout"

# Runs:
# ✓ Complete checkout process
# ✓ Finalize order
```

#### 4. Login Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@login"

# Runs:
# ✓ Successful login with valid credentials
# ✓ Login with invalid credentials
```

#### 5. Product Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@products"

# Runs:
# ✓ View products list
```

#### 6. Error Handling
```bash
npx cucumber-js features/saucedemo.feature --tags "@error-handling"

# Runs:
# ✓ Login with invalid credentials
```

#### 7. Performance Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@performance"

# Runs:
# ✓ Verify page load performance
```

#### 8. Accessibility Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@accessibility"

# Runs:
# ✓ Verify page accessibility
```

---

## 🏷️ Available Tags

### Main Tags
```
@saucedemo           - All SauceDemo tests
@e2e                 - End-to-end tests
@bdd                 - BDD framework tag
```

### Functional Tags
```
@login               - Login/authentication tests
@products            - Product browsing tests
@shopping-cart       - Cart management tests
@checkout            - Checkout process tests
@logout              - Logout tests
@filter              - Product filtering tests
@sorting             - Product sorting tests
```

### Test Type Tags
```
@smoke               - Quick smoke tests (2 scenarios)
@complete-purchase   - Full purchase flow
@finalize            - Order finalization
@add-to-cart         - Adding items to cart
@remove              - Removing items from cart
@multi-add           - Adding multiple items
@single-item         - Single item filtering
@price-low-high      - Sorting low to high
@price-high-low      - Sorting high to low
@page-load           - Performance testing
@invalid-login       - Error handling
```

---

## 🎯 Tag Combinations

### Example 1: Smoke Tests Only
```bash
npx cucumber-js features/saucedemo.feature --tags "@smoke"
# Result: 2 scenarios (12 seconds)
```

### Example 2: E2E Purchase Flow
```bash
npx cucumber-js features/saucedemo.feature --tags "@e2e and @checkout"
# Result: 3 scenarios (complete purchase workflow)
```

### Example 3: Everything Except Performance
```bash
npx cucumber-js features/saucedemo.feature --tags "@saucedemo and not @performance"
# Result: 15 scenarios
```

### Example 4: Shopping Cart Tests Only
```bash
npx cucumber-js features/saucedemo.feature --tags "@shopping-cart"
# Result: 3 scenarios (add, remove, multi-add)
```

### Example 5: Login & Error Handling
```bash
npx cucumber-js features/saucedemo.feature --tags "@login or @invalid-login"
# Result: 2 scenarios
```

### Example 6: Non-API Tests (No External Calls)
```bash
npx cucumber-js features/saucedemo.feature --tags "not @page-load"
# Result: 15 scenarios
```

---

## 🌐 Setting Custom URLs

### Method 1: Feature File (Hardcoded)
Already set in `saucedemo.feature`:
```gherkin
Background:
  Given the application URL is set to "https://saucedemo.com"
```

### Method 2: Environment Variable
```bash
# Set via environment
SAUCE_DEMO_URL="https://staging-saucedemo.com" npx cucumber-js features/saucedemo.feature
```

### Method 3: Create Environment-Specific Feature Files

**features/saucedemo-staging.feature:**
```gherkin
Background:
  Given the application URL is set to "https://staging-saucedemo.com"
```

**features/saucedemo-prod.feature:**
```gherkin
Background:
  Given the application URL is set to "https://saucedemo.com"
```

Run specific environment:
```bash
# Production
npx cucumber-js features/saucedemo.feature

# Staging
npx cucumber-js features/saucedemo-staging.feature
```

### Method 4: World Configuration
Update `features/support/world.ts`:
```typescript
export default class CustomWorld extends World {
  appUrl: string = process.env.SAUCE_DEMO_URL || 'https://saucedemo.com';
  // ...
}
```

Then run:
```bash
SAUCE_DEMO_URL="https://custom-url.com" npx cucumber-js features/saucedemo.feature
```

---

## 📊 Test Execution Scenarios

### Scenario 1: Daily Smoke Test
```bash
# Run quick validation
npx cucumber-js features/saucedemo.feature --tags "@smoke"

# Expected: 2 scenarios, ~20 seconds
# Validates: Login + Product Display
```

### Scenario 2: Pre-Deployment Testing
```bash
# Full e2e before deployment
npx cucumber-js features/saucedemo.feature --tags "@e2e and not @performance"

# Expected: ~13 scenarios, ~2 minutes
# Validates: All functionality except performance
```

### Scenario 3: Performance Baseline
```bash
# Check page load times
npx cucumber-js features/saucedemo.feature --tags "@performance"

# Expected: 1 scenario, ~10 seconds
# Validates: Load time under 5 seconds
```

### Scenario 4: Accessibility Audit
```bash
# Check accessibility compliance
npx cucumber-js features/saucedemo.feature --tags "@accessibility"

# Expected: 1 scenario, ~10 seconds
# Validates: Labels, accessible text, heading hierarchy
```

### Scenario 5: Shopping Feature Testing
```bash
# Complete shopping workflow
npx cucumber-js features/saucedemo.feature --tags "@shopping-cart or @checkout"

# Expected: 5 scenarios, ~1 minute
# Validates: Cart, checkout, order completion
```

### Scenario 6: Error Handling
```bash
# Test error scenarios
npx cucumber-js features/saucedemo.feature --tags "@error-handling"

# Expected: 1 scenario, ~10 seconds
# Validates: Error message display
```

---

## 🎬 Real-World Examples

### Example 1: Test Before Release
```bash
#!/bin/bash

echo "🧪 Pre-Release Testing"
echo "========================"

# Smoke tests
echo "Running smoke tests..."
npx cucumber-js features/saucedemo.feature --tags "@smoke" || exit 1

# E2E tests
echo "Running e2e tests..."
npx cucumber-js features/saucedemo.feature --tags "@e2e" || exit 1

# Accessibility
echo "Running accessibility checks..."
npx cucumber-js features/saucedemo.feature --tags "@accessibility" || exit 1

echo "✅ All pre-release tests passed!"
```

### Example 2: Continuous Integration
```yaml
# .github/workflows/saucedemo-tests.yml
name: SauceDemo Tests

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        tag: ['@smoke', '@shopping-cart', '@checkout', '@performance']
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - run: npx cucumber-js features/saucedemo.feature --tags "${{ matrix.tag }}"
```

### Example 3: Parallel Test Execution
```bash
# Run different test suites in parallel
parallel ::: \
  "npx cucumber-js features/saucedemo.feature --tags '@smoke'" \
  "npx cucumber-js features/saucedemo.feature --tags '@shopping-cart'" \
  "npx cucumber-js features/saucedemo.feature --tags '@checkout'" \
  "npx cucumber-js features/saucedemo.feature --tags '@accessibility'"
```

### Example 4: Test by URL
```bash
# Test against different environments
for URL in "https://saucedemo.com" "https://staging.saucedemo.com" "https://dev.saucedemo.com"; do
  echo "Testing: $URL"
  SAUCE_DEMO_URL=$URL npx cucumber-js features/saucedemo.feature --tags "@smoke"
done
```

---

## 📈 Test Coverage

### Login & Authentication
- ✅ Successful login
- ✅ Invalid login handling
- ✅ Logout functionality

### Products & Browsing
- ✅ View products list
- ✅ View product details
- ✅ Sort by price (ascending)
- ✅ Sort by price (descending)
- ✅ Filter single product

### Shopping Cart
- ✅ Add single item
- ✅ Add multiple items
- ✅ Remove items
- ✅ Cart counter accuracy

### Checkout
- ✅ Enter checkout information
- ✅ View order summary
- ✅ Finalize order
- ✅ Order confirmation

### Quality Checks
- ✅ Page performance
- ✅ Accessibility compliance
- ✅ Error message handling

---

## 🔍 Debugging Tests

### View Detailed Output
```bash
npx cucumber-js features/saucedemo.feature --format progress
npx cucumber-js features/saucedemo.feature --format json:results.json
npx cucumber-js features/saucedemo.feature --format html:report.html
```

### Run Single Scenario
```bash
# Run only "Successful login" scenario
npx cucumber-js features/saucedemo.feature --name "Successful login"
```

### Dry Run (Check Syntax)
```bash
npx cucumber-js features/saucedemo.feature --dry-run
```

### Verbose Output
```bash
npx cucumber-js features/saucedemo.feature --publish
```

---

## 📝 Adding New Tests

### Step 1: Add Scenario to Feature File
```gherkin
@saucedemo @custom-tag
Scenario: Your new scenario
  Given I am logged in as "standard_user"
  When I do something
  Then I should see something
```

### Step 2: Implement Step Definitions
```typescript
When('I do something', async function(this: World & any) {
  // Implementation
  console.log(`✓ Did something`);
});
```

### Step 3: Run with Tag
```bash
npx cucumber-js features/saucedemo.feature --tags "@custom-tag"
```

---

## ✅ Best Practices

1. **Use Meaningful Tags**
   - One tag per feature (@login, @checkout)
   - One tag per test type (@smoke, @e2e)

2. **Keep Scenarios Independent**
   - Each scenario should work standalone
   - Use Given steps for setup

3. **Test User Workflows**
   - Follow real user journeys
   - Test error scenarios

4. **Maintain Step Definitions**
   - Keep them simple and focused
   - Reuse steps across scenarios

5. **Document Tests**
   - Use clear scenario names
   - Add comments for complex logic

---

## 🎯 Summary

| Task | Command |
|------|---------|
| Run all tests | `npx cucumber-js features/saucedemo.feature` |
| Smoke tests | `npx cucumber-js features/saucedemo.feature --tags "@smoke"` |
| Shopping tests | `npx cucumber-js features/saucedemo.feature --tags "@shopping-cart"` |
| Checkout tests | `npx cucumber-js features/saucedemo.feature --tags "@checkout"` |
| E2E tests | `npx cucumber-js features/saucedemo.feature --tags "@e2e"` |
| Custom URL | `SAUCE_DEMO_URL=https://custom.com npx cucumber-js features/saucedemo.feature` |
| Dry run | `npx cucumber-js features/saucedemo.feature --dry-run` |

---

**Ready to test SauceDemo! 🚀**
