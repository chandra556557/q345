# 📊 Allure Reporting Integration with Playwright

A complete guide for integrating Allure reports with Playwright test execution in the playwright-crx project.

---

## ✅ What's Been Configured

### 1. Dependencies Installed

**File:** `tests/package.json`

```json
"devDependencies": {
  "allure-commandline": "^2.30.0",
  "allure-playwright": "^3.0.0",
  "rimraf": "^6.0.1"
}
```

### 2. Reporter Configuration

**File:** `tests/playwright.config.ts`

The Allure reporter is now configured alongside the existing HTML and DB reporters:

```typescript
reporter: [
  ['html'],
  ['./crx/db-reporter.js'],
  ['allure-playwright', {
    detail: true,
    outputFolder: 'allure-results',
    suiteTitle: true,
    environmentInfo: {
      os_platform: process.platform,
      os_release: require('os').release(),
      node_version: process.version,
      playwright_version: require('@playwright/test/package.json').version
    }
  }]
],
```

### 3. NPM Scripts Added

**File:** `tests/package.json`

| Script | Description |
|--------|-------------|
| `npm test` | Run tests with default reporters |
| `npm run test:allure` | Run tests with only Allure reporter |
| `npm run allure:generate` | Generate HTML report from results |
| `npm run allure:open` | Open generated HTML report |
| `npm run allure:serve` | Serve results directly (dev mode) |
| `npm run allure:clean` | Clean all results and reports |

---

## 🚀 Quick Start

### Run Tests and Generate Allure Report

```bash
# 1. Navigate to tests directory
cd tests

# 2. Run tests (Allure results will be generated automatically)
npm test

# 3. Generate the HTML report
npm run allure:generate

# 4. Open the report in browser
npm run allure:open
```

### One-liner (Run → Generate → Open)

```bash
cd tests && npm test && npm run allure:generate && npm run allure:open
```

---

## 📁 Directory Structure

```
tests/
├── allure-results/          # Raw test results (JSON files)
│   ├── 123-456-result.json
│   ├── 789-012-result.json
│   └── ...
├── allure-report/           # Generated HTML report
│   ├── index.html          # Main report page
│   ├── data/               # Report data files
│   ├── plugins/            # Allure plugins
│   └── styles/             # Report styles
└── playwright.config.ts    # Reporter configuration
```

---

## 🎨 Allure Annotations Guide

### Basic Annotations

```typescript
import { test } from '@playwright/test';
import { allure } from 'allure-playwright';

test('my test', async ({ page }) => {
  // Labels and metadata
  allure.epic('Authentication');
  allure.feature('Login');
  allure.story('User logs in with valid credentials');
  allure.owner('John Doe');
  allure.severity('critical');
  allure.tag('smoke');
  allure.tag('regression');
  
  // Links
  allure.issue('JIRA-123', 'https://jira.example.com/JIRA-123');
  allure.link('PR-456', 'https://github.com/pr/456', 'pr');
  allure.tms('TEST-789', 'https://testrail.example.com/TEST-789');
  
  // Description
  allure.description('This test verifies user login functionality');
  allure.descriptionHtml('<h3>Login Test</h3><p>Verifies <b>user login</b></p>');
});
```

### Steps

```typescript
await allure.step('Navigate to login page', async () => {
  await page.goto('/login');
});

await allure.step('Fill login form', async () => {
  await page.fill('#username', 'user@example.com');
  await page.fill('#password', 'password');
});

await allure.step('Submit form', async () => {
  await page.click('#submit');
});
```

### Attachments

```typescript
// Screenshot attachment
const screenshot = await page.screenshot();
allure.attachment('Page Screenshot', screenshot, 'image/png');

// Text attachment
allure.attachment('Response Data', JSON.stringify(data, null, 2), 'application/json');

// File attachment
allure.attachment('Log File', fs.readFileSync('app.log'), 'text/plain');
```

### Parameters

```typescript
allure.parameter('Environment', 'staging');
allure.parameter('Browser', 'chromium');
allure.parameter('Viewport', '1920x1080');
```

---

## 📊 Report Sections

### Overview
- Test execution summary
- Pass/Fail statistics
- Duration metrics
- Environment information

### Categories
- **Product defects** (failed tests)
- **Test defects** (broken tests)

### Suites
- Grouped by test files
- Hierarchical structure
- Expandable test cases

### Graphs
- Status chart (pie chart)
- Severity chart
- Duration trend
- Execution timeline

### Behaviors
- Epic → Feature → Story hierarchy
- Organized by BDD annotations

### Packages
- Package structure
- Class organization
- Method-level details

### Test Cases
- Step-by-step execution
- Screenshots & attachments
- Error messages & stack traces
- Timing information

---

## 🔧 Advanced Configuration

### Custom Environment Info

Update `playwright.config.ts`:

```typescript
['allure-playwright', {
  detail: true,
  outputFolder: 'allure-results',
  suiteTitle: true,
  environmentInfo: {
    os_platform: process.platform,
    os_release: require('os').release(),
    node_version: process.version,
    playwright_version: require('@playwright/test/package.json').version,
    app_version: '1.2.3',  // Custom info
    environment: process.env.TEST_ENV || 'development'
  }
}]
```

### Custom Categories

Create `tests/allure-categories.json`:

```json
[
  {
    "name": "Critical Issues",
    "matchedStatuses": ["failed"],
    "messageRegex": ".*critical.*"
  },
  {
    "name": "API Errors",
    "traceRegex": ".*APIException.*"
  }
]
```

### Custom Executor Info

Create `tests/allure-executor.json`:

```json
{
  "name": "GitHub Actions",
  "type": "github",
  "url": "https://github.com/org/repo/actions",
  "buildOrder": 42,
  "buildName": "Test Run #42",
  "buildUrl": "https://github.com/org/repo/actions/runs/123",
  "reportUrl": "https://org.github.io/repo/allure-report",
  "reportName": "Playwright Test Report"
}
```

---

## 🔄 CI/CD Integration

### GitHub Actions

```yaml
name: Playwright Tests with Allure

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: cd tests && npm ci
        
      - name: Install Playwright
        run: cd tests && npx playwright install --with-deps
        
      - name: Run tests
        run: cd tests && npm test
        
      - name: Generate Allure Report
        if: always()
        run: cd tests && npm run allure:generate
        
      - name: Upload Allure Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: allure-report
          path: tests/allure-report
```

### Jenkins

```groovy
pipeline {
    agent any
    
    stages {
        stage('Test') {
            steps {
                sh 'cd tests && npm test'
            }
        }
        
        stage('Generate Allure Report') {
            steps {
                sh 'cd tests && npm run allure:generate'
            }
        }
    }
    
    post {
        always {
            allure([
                includeProperties: false,
                jdk: '',
                properties: [],
                reportBuildPolicy: 'ALWAYS',
                results: [[path: 'tests/allure-results']]
            ])
        }
    }
}
```

---

## 🐛 Troubleshooting

### Issue: Allure command not found

**Solution:**
```bash
# Install allure-commandline globally
npm install -g allure-commandline

# Or use npx
npx allure --version
```

### Issue: Report shows empty

**Solution:**
1. Ensure tests actually ran: `ls tests/allure-results`
2. Check reporter configuration in `playwright.config.ts`
3. Verify output folder path is correct

### Issue: Screenshots not appearing

**Solution:**
```typescript
// Ensure trace is enabled in config
use: {
  trace: 'on-first-retry',  // or 'on', 'retain-on-failure'
  screenshot: 'on',         // or 'only-on-failure'
}

// Manually attach screenshot
allure.attachment('Screenshot', await page.screenshot(), 'image/png');
```

### Issue: Historical trends not showing

**Solution:**
Allure needs previous results for trends. In CI/CD, persist `allure-results` between runs or copy them to the report folder:

```bash
# Copy history from previous report
cp -r allure-report/history allure-results/
```

---

## 📚 Example Test File

See: `tests/crx/allure-example.spec.ts`

This file demonstrates:
- All annotations (epic, feature, story, etc.)
- Steps with nested structure
- Attachments (screenshots, text)
- Parameters
- Parameterized tests

Run it with:
```bash
cd tests
npx playwright test allure-example.spec.ts
npm run allure:generate
npm run allure:open
```

---

## 🎯 Best Practices

### 1. Organize with BDD Annotations
```typescript
allure.epic('User Management');
allure.feature('Registration');
allure.story('New user registration');
```

### 2. Use Meaningful Step Names
```typescript
// Good
await allure.step('Verify user sees success message', async () => {
  await expect(page.locator('.success')).toBeVisible();
});

// Bad
await allure.step('Step 1', async () => { ... });
```

### 3. Attach Relevant Information
```typescript
// On failure
if (testInfo.status !== 'passed') {
  allure.attachment('Page HTML', await page.content(), 'text/html');
  allure.attachment('Console logs', logs.join('\n'), 'text/plain');
}
```

### 4. Tag Tests Appropriately
```typescript
allure.tag('smoke');
allure.tag('api');
allure.tag('ui');
test('API smoke test @smoke @api', async () => { ... });
```

---

## 📖 Additional Resources

- [Allure Report Documentation](https://docs.qameta.io/allure/)
- [Allure Playwright Integration](https://github.com/allure-framework/allure-js/tree/main/packages/allure-playwright)
- [Playwright Test Configuration](https://playwright.dev/docs/test-reporters)

---

**Status:** ✅ Fully Integrated  
**Last Updated:** 2026-02-11  
**Version:** 1.0.0
