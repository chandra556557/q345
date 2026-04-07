# BDD/Cucumber Integration with Dynamic Projects

Complete guide for running Cucumber BDD tests with dynamic project management.

## Overview

The BDD integration provides:
- **Project-aware Cucumber hooks** - Automatically load project configs for each scenario
- **Step definitions for project switching** - Use `Given I use project "project1"`
- **Test data management** - Separate fixtures and seeds per project
- **Feature files** - Pre-built scenarios demonstrating multi-project testing
- **Parallel execution** - Run tests for all projects concurrently

## Setup

### 1. Install Cucumber Dependencies

```bash
npm install --save-dev @cucumber/cucumber @cucumber/react
npm install --save-dev ts-node typescript
```

### 2. Update package.json

Already configured with these scripts:

```json
{
  "scripts": {
    "cucumber": "cucumber-js",
    "cucumber:project1": "ACTIVE_PROJECT=project1 cucumber-js",
    "cucumber:project2": "ACTIVE_PROJECT=project2 cucumber-js",
    "cucumber:all": "cucumber-js --parallel 2",
    "cucumber:report": "node scripts/generate-cucumber-report.js"
  }
}
```

### 3. Feature Files

Feature files are in `features/` directory:
- `project-management.feature` - Basic project testing
- `test-data-management.feature` - Test data fixtures and seeds

## Running Tests

### Run Tests for Specific Project

```bash
# Run for project1
npm run cucumber:project1

# Run for project2
npm run cucumber:project2

# Run for current project
npm run cucumber
```

### Run All Project Tests in Parallel

```bash
npm run cucumber:all
```

### Run with Tags

```bash
# Run smoke tests
npm run cucumber:project1 -- --tags "@smoke"

# Run API tests
npm run cucumber:project1 -- --tags "@api"

# Run tests excluding skipped
npm run cucumber:project1 -- --tags "not @skip"
```

### Run with Specific Feature File

```bash
# Run project management scenarios
ACTIVE_PROJECT=project1 npm run cucumber -- features/project-management.feature

# Run test data scenarios
ACTIVE_PROJECT=project1 npm run cucumber -- features/test-data-management.feature
```

## Feature Files

### project-management.feature

Tests for switching between projects and verifying configurations:

```gherkin
Scenario: Switch to project 1
  Given I use project "project1"
  Then I should be using project "project1"
  And the project should have database "playwright_project1"
  And the project should use port 3001
```

**Available Steps:**
- `Given I use project "{projectName}"`
- `When I call the health check endpoint`
- `When I call the database health check endpoint`
- `Then the API should return status {int}`
- `Then the health check status should be "{status}"`

### test-data-management.feature

Tests for managing project-specific test data:

```gherkin
Scenario: Load test fixture from project 1
  Given I use project "project1"
  When I load the test fixture "testUser"
  Then the fixture should have "email" property
  And the fixture property "email" should be "testuser@project1.com"
```

**Available Steps:**
- `Given I load the test fixture "{fixtureName}"`
- `Given I load seed data "{seedName}"`
- `When I use the test fixture`
- `Then the fixture should have "{property}" property`
- `Then seed data should have {int} records`

## Project Hooks

File: `features/hooks/projectHooks.ts`

### What Happens Automatically

**BeforeAll:**
- Logs which project will be tested
- Lists available projects

**Before (before each scenario):**
- Loads project environment variables
- Initializes project configuration
- Sets up API base URL
- Stores config in Cucumber World

**After (after each scenario):**
- Logs scenario result (PASSED/FAILED)
- Displays error messages if test failed

**AfterAll:**
- Cleans up after all scenarios

### Accessing Project Config in Steps

```typescript
When('I use the API', async function(this: World & any) {
  // Access project config
  const { projectConfig, apiBaseUrl } = this;
  
  const response = await fetch(`${apiBaseUrl}/api/health`);
  // ...
});
```

## Step Definitions

### Project Management Steps

**features/step-definitions/projectSteps.ts**

Control which project is used:

```gherkin
Given I use project "project1"
Given the following projects are available:
  | project1 |
  | project2 |
When I call the health check endpoint
Then I should be using project "project1"
Then the project should have database "playwright_project1"
Then the project should use port 3001
```

### Test Data Steps

**features/step-definitions/testDataSteps.ts**

Manage test data fixtures and seeds:

```gherkin
Given I load the test fixture "testUser"
Given I have a test user with the following data:
  | email    | test@example.com |
  | username | testuser        |
Given the fixture "testUser" is modified with:
  | email | modified@example.com |
When I use the test fixture
Then the fixture should have "email" property
Then the fixture property "email" should be "testuser@project1.com"
Then seed data should have 3 records
Then the available fixtures should include "testUser"
Then the available seed data should include "users"
```

## Test Data Management

### Directory Structure

```
features/test-data/
├── project1/
│   ├── fixtures/
│   │   └── testUser.json
│   ├── seeds/
│   │   └── users.json
│   └── expected-results/
├── project2/
│   ├── fixtures/
│   │   └── testUser.json
│   ├── seeds/
│   │   └── users.json
│   └── expected-results/
└── default/
    ├── fixtures/
    └── seeds/
```

### Create New Fixtures

Add JSON files to `features/test-data/{projectName}/fixtures/`:

```json
{
  "email": "user@project.com",
  "name": "Test User",
  "role": "user",
  "status": "active"
}
```

### Create Seed Data

Add JSON arrays to `features/test-data/{projectName}/seeds/`:

```json
[
  { "id": 1, "email": "user1@project.com", "role": "admin" },
  { "id": 2, "email": "user2@project.com", "role": "user" },
  { "id": 3, "email": "user3@project.com", "role": "user" }
]
```

### Load in Steps

```typescript
// In your step definitions
When('I load test data', function(this: World & any) {
  const dataManager = getTestDataManager(this.projectName);
  
  // Load fixture
  const fixture = dataManager.loadFixture('testUser');
  
  // Load seed data
  const seeds = dataManager.loadSeedData('users');
  
  // Get summary
  const summary = dataManager.getSummary();
});
```

## Cucumber World

The Cucumber World object is enriched with project information:

```typescript
interface CucumberWorld {
  projectName: string;
  projectConfig: ProjectConfig;
  apiBaseUrl: string;
  database: DatabaseConfig;
  testFixture: any;
  testFixtures: Map<string, any>;
  seedData: any[];
  seedDataMap: Map<string, any[]>;
  lastResponse: AxiosResponse;
  healthResponse: any;
  dbHealthResponse: any;
}
```

Access in step definitions:

```typescript
Given('I use project {string}', async function(projectName: string) {
  // this.projectName
  // this.projectConfig
  // this.apiBaseUrl
  // this.database
  // etc.
});
```

## Configuration Files

### cucumber.js

Main Cucumber configuration with project profiles:

```javascript
// Default profile
default: {
  paths: ['features/**/*.feature'],
  support: ['features/**/*.ts'],
  timeout: 60000,
  parallel: 2
}

// Project-specific profiles
project1: { ... }
project2: { ... }
```

Run with specific profile:
```bash
ACTIVE_PROJECT=project1 npm run cucumber
```

## Tag-Based Execution

### Available Tags

```gherkin
@bdd              # All BDD tests
@project1         # Tests for project 1
@project2         # Tests for project 2
@smoke            # Smoke tests (quick)
@api              # API tests
@database         # Database tests
@fixtures         # Fixture tests
@seeds            # Seed data tests
@parallel         # Tests that can run in parallel
@skip             # Skip test
```

### Run by Tag

```bash
# Smoke tests only
npm run cucumber:project1 -- --tags "@smoke"

# API tests for project1
npm run cucumber:project1 -- --tags "@api and @project1"

# Everything except skipped
npm run cucumber:project1 -- --tags "not @skip"
```

## Reporting

### Generate HTML Report

Reports are automatically generated:
- `test-results/cucumber-report.html` - Main report
- `test-results/cucumber-report.json` - JSON format for CI/CD
- `test-results/cucumber-report.xml` - JUnit XML format

### View Reports

```bash
# Open in browser
open test-results/cucumber-report.html

# Or use the provided script
npm run cucumber:report
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: BDD Tests - Multi Project

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        project: [project1, project2]
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - run: ACTIVE_PROJECT=${{ matrix.project }} npm run cucumber
      - uses: actions/upload-artifact@v2
        if: always()
        with:
          name: cucumber-reports-${{ matrix.project }}
          path: test-results/
```

## Advanced Usage

### Custom World Helpers

Extend Cucumber World with custom helpers:

```typescript
import { World } from '@cucumber/cucumber';

interface CustomWorld extends World {
  // Your custom properties
  userId?: string;
  authToken?: string;
}

export default CustomWorld;
```

### Before Hook with Conditions

```typescript
Before({ tags: '@database' }, async function() {
  // Only runs for scenarios tagged @database
  const dataManager = getTestDataManager(this.projectName);
  await dataManager.seedDatabase();
});
```

### Data Table Transformations

```typescript
Given('users exist:', async function(dataTable) {
  const users = dataTable.hashes();
  // users = [
  //   { email: 'user1@test.com', name: 'User 1' },
  //   { email: 'user2@test.com', name: 'User 2' }
  // ]
});
```

## Troubleshooting

### Tests Not Finding Features

Check `cucumber.js` configuration:
```javascript
paths: ['features/**/*.feature']
```

### Hooks Not Running

Ensure hooks are in `features/hooks/`:
```javascript
support: ['features/hooks/**/*.ts']
```

### Project Config Not Loading

Set `ACTIVE_PROJECT`:
```bash
ACTIVE_PROJECT=project1 npm run cucumber
```

### TypeScript Errors

Install dev dependencies:
```bash
npm install --save-dev ts-node @types/node
```

## Examples

### Test Project Switching

```gherkin
Scenario: Verify project configurations
  Given the following projects are available:
    | project1 |
    | project2 |
  
  When I use project "project1"
  And I call the health check endpoint
  Then the health check status should be "ok"
  And the environment should be "development"
  
  When I use project "project2"
  And I call the health check endpoint
  Then the health check status should be "ok"
  And the environment should be "staging"
```

### Test with Fixtures

```gherkin
Scenario: Use test fixtures
  Given I use project "project1"
  And I load the test fixture "testUser"
  When I use the test fixture
  Then the fixture should have "email" property
  And the fixture property "role" should be "user"
```

### Test with Seed Data

```gherkin
Scenario: Verify seed data
  Given I use project "project1"
  And I load seed data "users"
  Then seed data should have 3 records
  And the available seed data should include "users"
```

## Files Structure

```
features/
├── project-management.feature          # Project switching tests
├── test-data-management.feature        # Test data tests
├── hooks/
│   └── projectHooks.ts                 # Project configuration hooks
├── step-definitions/
│   ├── projectSteps.ts                 # Project management steps
│   └── testDataSteps.ts                # Test data steps
├── support/
│   ├── testDataManager.ts              # Test data utilities
│   └── world.ts                        # Cucumber World (optional)
└── test-data/
    ├── project1/
    │   ├── fixtures/
    │   │   └── testUser.json
    │   └── seeds/
    │       └── users.json
    ├── project2/
    │   ├── fixtures/
    │   │   └── testUser.json
    │   └── seeds/
    │       └── users.json
    └── default/
        ├── fixtures/
        └── seeds/

cucumber.js                             # Cucumber configuration
test-results/                           # Test reports (generated)
```

## Next Steps

1. **Run your first test**: `npm run cucumber:project1`
2. **Create custom steps**: Add to `features/step-definitions/`
3. **Add test data**: Create fixtures in `features/test-data/`
4. **Write scenarios**: Add `.feature` files
5. **Configure CI/CD**: Add to your pipeline

## Support

- Review example feature files for inspiration
- Check step definitions for available steps
- Consult hooks for how data is loaded
- See `PROJECT_CONFIGURATION.md` for environment setup

