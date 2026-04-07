# SauceDemo Execution Examples

Complete working examples with tags and URL configuration

---

## 🎯 Quick Execution Examples

### Example 1: View Feature File Structure
```bash
cat features/saucedemo.feature | head -50

# Output:
# @bdd @saucedemo @e2e
# Feature: SauceDemo E-commerce Application
#   As a QA Engineer
#   I want to test the Sauce Demo e-commerce website
#
#   Background:
#     Given the application URL is set to "https://saucedemo.com"
#     And the browser is opened
#
#   @smoke @login
#   Scenario: Successful login with valid credentials
#     When I navigate to the login page
#     And I enter username "standard_user"
#     ...
```

---

## 🏷️ Tag-Based Execution

### Execute Smoke Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@smoke"

# What runs:
# @smoke @login → Successful login with valid credentials
# @smoke @products → View products list
#
# Result: 2 scenarios tested in ~10 seconds
```

### Execute Login Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@login"

# What runs:
# ✓ Successful login with valid credentials
# ✓ Login with invalid credentials (error handling)
#
# Result: 2 scenarios, comprehensive login validation
```

### Execute Shopping Cart Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@shopping-cart"

# What runs:
# ✓ Add single product to cart
# ✓ Add multiple products to cart
# ✓ Remove product from cart
#
# Result: 3 scenarios covering cart lifecycle
```

### Execute Checkout Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@checkout"

# What runs:
# ✓ Complete checkout process
# ✓ Finalize order
#
# Result: 2 scenarios for purchase workflow
```

### Execute E2E Tests
```bash
npx cucumber-js features/saucedemo.feature --tags "@e2e"

# What runs:
# Full end-to-end workflows covering:
# - Login → Browse → Add to Cart → Checkout → Order
# 
# Result: ~5-7 comprehensive scenarios
```

---

## 🌐 URL Configuration Examples

### Example 1: Default URL (SauceDemo Production)
```bash
# Feature file has:
# Given the application URL is set to "https://saucedemo.com"

npx cucumber-js features/saucedemo.feature --tags "@smoke"

# Automatically tests against: https://saucedemo.com
```

### Example 2: Testing Staging Environment
Create `features/saucedemo-staging.feature`:
```gherkin
Background:
  Given the application URL is set to "https://staging-saucedemo.com"

# Then all scenarios run against staging URL
```

```bash
npx cucumber-js features/saucedemo-staging.feature --tags "@smoke"

# Tests: https://staging-saucedemo.com instead
```

### Example 3: Environment Variable Configuration
Create `features/support/urlManager.ts`:
```typescript
export function getApplicationUrl(): string {
  return process.env.SAUCE_DEMO_URL || 'https://saucedemo.com';
}
```

Update saucedemo step:
```typescript
Given('the application URL is set to {string}', function(url: string) {
  this.appUrl = process.env.SAUCE_DEMO_URL || url;
});
```

Then run with custom URL:
```bash
# Development
SAUCE_DEMO_URL=https://dev.saucedemo.com npx cucumber-js features/saucedemo.feature

# Staging
SAUCE_DEMO_URL=https://staging.saucedemo.com npx cucumber-js features/saucedemo.feature

# Production
SAUCE_DEMO_URL=https://saucedemo.com npx cucumber-js features/saucedemo.feature
```

### Example 4: Local Testing
```bash
# Test against local instance running on different port
SAUCE_DEMO_URL=http://localhost:3000 npx cucumber-js features/saucedemo.feature --tags "@smoke"
```

---

## 📊 Tag Combinations for Different Scenarios

### Scenario A: Pre-Release Validation
```bash
#!/bin/bash

echo "🧪 Pre-Release Validation"
echo "=========================="

# 1. Smoke tests (quick)
echo "1. Running smoke tests..."
npx cucumber-js features/saucedemo.feature --tags "@smoke" || exit 1

# 2. E2E tests (comprehensive)
echo "2. Running E2E tests..."
npx cucumber-js features/saucedemo.feature --tags "@e2e" || exit 1

# 3. Error handling tests
echo "3. Running error handling tests..."
npx cucumber-js features/saucedemo.feature --tags "@error-handling" || exit 1

# 4. Accessibility tests
echo "4. Running accessibility tests..."
npx cucumber-js features/saucedemo.feature --tags "@accessibility" || exit 1

echo "✅ All pre-release tests passed!"
```

### Scenario B: Performance Baseline
```bash
#!/bin/bash

echo "⚡ Performance Testing"
echo "===================="

# Test multiple URLs for performance comparison
for URL in \
  "https://saucedemo.com" \
  "https://staging.saucedemo.com" \
  "https://dev.saucedemo.com"
do
  echo "Testing: $URL"
  SAUCE_DEMO_URL=$URL npx cucumber-js \
    features/saucedemo.feature \
    --tags "@performance" \
    || continue
done

echo "✅ Performance tests completed!"
```

### Scenario C: Continuous Integration Matrix
```yaml
name: SauceDemo Tests

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - tag: '@smoke'
            env: 'production'
            url: 'https://saucedemo.com'
          
          - tag: '@e2e'
            env: 'staging'
            url: 'https://staging.saucedemo.com'
          
          - tag: '@shopping-cart'
            env: 'dev'
            url: 'https://dev.saucedemo.com'
          
          - tag: '@checkout'
            env: 'production'
            url: 'https://saucedemo.com'
    
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      
      - run: npm install && npm run build
      
      - name: Test ${{ matrix.tag }} on ${{ matrix.env }}
        env:
          SAUCE_DEMO_URL: ${{ matrix.url }}
        run: |
          npx cucumber-js features/saucedemo.feature --tags "${{ matrix.tag }}"
```

---

## 📈 Real-World Execution Patterns

### Pattern 1: Daily Regression Testing
```bash
# Run at 9 AM daily
0 9 * * * SAUCE_DEMO_URL=https://saucedemo.com npx cucumber-js features/saucedemo.feature --tags "@e2e" --format json:results-$(date +%Y%m%d).json
```

### Pattern 2: Pull Request Validation
```bash
#!/bin/bash
# Run on every pull request

npm run build || exit 1

# Quick smoke test
npx cucumber-js features/saucedemo.feature --tags "@smoke" || exit 1

# Full E2E
SAUCE_DEMO_URL=https://staging.saucedemo.com npx cucumber-js features/saucedemo.feature --tags "@e2e" || exit 1

echo "✅ All PR checks passed!"
```

### Pattern 3: Performance Regression Detection
```bash
#!/bin/bash

echo "⏱️ Performance Regression Testing"

# Get baseline
BASELINE=$(npx cucumber-js features/saucedemo.feature --tags "@performance" | grep "load within" | awk '{print $3}')

# Test after changes
NEW=$(npx cucumber-js features/saucedemo.feature --tags "@performance" | grep "load within" | awk '{print $3}')

# Compare
if (( $(echo "$NEW > $BASELINE * 1.1" | bc -l) )); then
  echo "❌ Performance regression detected!"
  echo "   Baseline: ${BASELINE}s"
  echo "   Current:  ${NEW}s"
  exit 1
fi

echo "✅ No performance regression"
```

---

## 🎨 Scenario Examples with Step-by-Step Output

### Example: Login & Browse Flow
```bash
$ npx cucumber-js features/saucedemo.feature --name "Successful login"

Feature: SauceDemo E-commerce Application

Scenario: Successful login with valid credentials
  ✓ Given the application URL is set to "https://saucedemo.com"
    ├─ ✓ Application URL set to: https://saucedemo.com
  
  ✓ And the browser is opened
    ├─ ✓ Browser opened at https://saucedemo.com
  
  ✓ When I navigate to the login page
    ├─ ✓ Navigated to login page: https://saucedemo.com/
  
  ✓ And I enter username "standard_user"
    ├─ ✓ Entered username: standard_user
  
  ✓ And I enter password "secret_sauce"
    ├─ ✓ Entered password: ****sauce
  
  ✓ And I click the login button
    ├─ ✓ Login successful for user: standard_user
  
  ✓ Then I should see the products page
    ├─ ✓ Products page displayed
  
  ✓ And the page title should contain "Swag Labs"
    ├─ ✓ Page title contains: "Swag Labs"

✅ 1 scenario (1 passed)
✅ 8 steps (8 passed)
```

### Example: Multi-Product Purchase
```bash
$ npx cucumber-js features/saucedemo.feature \
  --name "Complete checkout" \
  --tags "@checkout"

Feature: SauceDemo E-commerce Application

Scenario: Complete checkout process
  ✓ Given I am logged in as "standard_user"
    ├─ ✓ Logged in as: standard_user
  
  ✓ And I have added products to cart:
    │ | Sauce Labs Backpack      |
    │ | Sauce Labs Bike Light    |
    ├─ ✓ Added 2 products to cart
  
  ✓ When I navigate to the cart page
    ├─ ✓ Navigated to cart page
  
  ✓ And I click the checkout button
    ├─ ✓ Clicked checkout button
  
  ✓ And I fill in checkout information:
    │ | firstName | John        |
    │ | lastName  | Doe         |
    │ | zipCode   | 12345       |
    ├─ ✓ Filled in checkout information
    ├─ First Name: John
    ├─ Last Name: Doe
    ├─ Zip Code: 12345
  
  ✓ And I click continue
    ├─ ✓ Clicked continue button
  
  ✓ Then I should see the order summary
    ├─ ✓ Order summary displayed
  
  ✓ And I should see the total price
    ├─ ✓ Total price displayed: $39.98

✅ 1 scenario (1 passed)
✅ 10 steps (10 passed)
```

---

## 📋 Complete Command Reference

```bash
# Basic execution
npx cucumber-js features/saucedemo.feature

# By tag
npx cucumber-js features/saucedemo.feature --tags "@smoke"
npx cucumber-js features/saucedemo.feature --tags "@login or @logout"
npx cucumber-js features/saucedemo.feature --tags "@e2e and not @performance"

# By scenario name
npx cucumber-js features/saucedemo.feature --name "Successful login"

# With custom URL
SAUCE_DEMO_URL=https://staging.saucedemo.com npx cucumber-js features/saucedemo.feature

# Output formats
npx cucumber-js features/saucedemo.feature --format progress
npx cucumber-js features/saucedemo.feature --format json:results.json
npx cucumber-js features/saucedemo.feature --format html:report.html

# Dry run (check syntax)
npx cucumber-js features/saucedemo.feature --dry-run

# With specific profile (if using multiple env configs)
npx cucumber-js features/saucedemo.feature --profile staging
```

---

## ✅ Validation Checklist

- [x] Feature file created (`features/saucedemo.feature`)
- [x] Step definitions created (`features/step-definitions/saucedemoSteps.ts`)
- [x] 16 scenarios covering e-commerce workflow
- [x] Multiple tags for filtering (@smoke, @login, @checkout, etc.)
- [x] URL configuration documented
- [x] Real-world examples provided
- [x] CI/CD integration examples shown
- [x] All tests ready to execute

---

**Ready to test SauceDemo! 🚀**

```bash
npm run build && npx cucumber-js features/saucedemo.feature --tags "@smoke"
```
