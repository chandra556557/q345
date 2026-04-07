# Cucumber BDD Quick Start - Multi-Project

Get started with BDD tests for multiple projects in 5 minutes.

## Installation

```bash
# Install Cucumber dependencies
npm install

# Build TypeScript
npm run build
```

## Run Your First Test

### 1️⃣ Run All Scenarios for Project 1

```bash
npm run cucumber:project1
```

Expected output:
```
12 scenarios (12 passed)
30 steps (30 passed)
```

### 2️⃣ Run All Scenarios for Project 2

```bash
npm run cucumber:project2
```

### 3️⃣ Run Parallel Tests (Both Projects)

```bash
npm run cucumber:all
```

## Feature Files

### What's Already Set Up

✅ **project-management.feature** - 10 scenarios
  - Switch between projects
  - Health checks for each project
  - Database connection verification
  - Endpoint testing

✅ **test-data-management.feature** - 12 scenarios
  - Load fixtures (testUser)
  - Load seed data (users)
  - Modify fixtures
  - View test data summary

## Run Specific Tests

### Smoke Tests Only
```bash
npm run cucumber:smoke
```

### API Tests Only
```bash
npm run cucumber:api
```

### With Project Tag
```bash
ACTIVE_PROJECT=project1 npm run cucumber -- --tags "@smoke"
ACTIVE_PROJECT=project2 npm run cucumber -- --tags "@api"
```

## Test Files Location

```
features/
├── project-management.feature           ← Project switching tests
├── test-data-management.feature         ← Test data tests
├── hooks/
│   └── projectHooks.ts                  ← Auto loads project config
├── step-definitions/
│   ├── projectSteps.ts                  ← 15 project steps
│   └── testDataSteps.ts                 ← 18 test data steps
├── support/
│   └── testDataManager.ts               ← Fixture/seed manager
└── test-data/
    ├── project1/
    │   ├── fixtures/testUser.json       ← Project 1 test user
    │   └── seeds/users.json             ← Project 1 users list
    └── project2/
        ├── fixtures/testUser.json       ← Project 2 test user
        └── seeds/users.json             ← Project 2 users list
```

## Available Gherkin Steps

### Project Management

```gherkin
# Switch projects
Given I use project "project1"
Given the following projects are available:
  | project1 |
  | project2 |

# Health checks
When I call the health check endpoint
When I call the database health check endpoint
When I make a request to "/api"

# Verifications
Then I should be using project "project1"
Then the project should have database "playwright_project1"
Then the project should use port 3001
Then the API should return status 200
Then the health check status should be "ok"
Then the environment should be "development"
```

### Test Data

```gherkin
# Load data
Given I load the test fixture "testUser"
Given I load seed data "users"
Given I have a test user with the following data:
  | email    | test@project.com |
  | username | testuser        |

# Modify data
Given the fixture "testUser" is modified with:
  | email | new@project.com |

# Verify data
Then the fixture should have "email" property
Then the fixture property "email" should be "testuser@project1.com"
Then seed data should have 3 records
Then the available fixtures should include "testUser"
Then the available seed data should include "users"
Then I should have test data for "project1"
Then I can view the test data summary
```

## Write Your Own Scenario

### Create a Feature File

Create `features/my-test.feature`:

```gherkin
@bdd @my-tests
Feature: My Project Tests
  Scenario: Test project 1
    Given I use project "project1"
    When I call the health check endpoint
    Then the API should return status 200
```

### Run It

```bash
npm run cucumber:project1 -- features/my-test.feature
```

## Add Custom Test Data

### 1. Create Fixture (JSON)

Create `features/test-data/project1/fixtures/myFixture.json`:

```json
{
  "id": "123",
  "name": "Test Data",
  "status": "active"
}
```

### 2. Create Seed Data (JSON Array)

Create `features/test-data/project1/seeds/mySeeds.json`:

```json
[
  { "id": 1, "name": "Item 1", "status": "active" },
  { "id": 2, "name": "Item 2", "status": "inactive" }
]
```

### 3. Use in Scenario

```gherkin
Scenario: Use my fixture
  Given I use project "project1"
  When I load the test fixture "myFixture"
  Then the fixture should have "name" property
```

## Common Commands

```bash
# Run all tests
npm run cucumber:all

# Run project1 only
npm run cucumber:project1

# Run project2 only  
npm run cucumber:project2

# Run smoke tests
npm run cucumber:smoke

# Run API tests
npm run cucumber:api

# View test report
open test-results/cucumber-report.html

# List available projects
npm run project:list

# Create new project
npm run project:create myproject

# Show project config
npm run project:show project1
```

## Project Config (Automatic)

Each project loads its own `.env.{projectName}` file:

```
.env.project1  ← Loaded for project1 tests
  PORT=3001
  DB_NAME=playwright_project1
  NODE_ENV=development

.env.project2  ← Loaded for project2 tests  
  PORT=3002
  DB_NAME=playwright_project2
  NODE_ENV=staging
```

No manual setup needed - hooks handle it automatically!

## Verify Setup

```bash
# Check projects exist
npm run project:list

# Show project1 config
npm run project:show project1

# Build TypeScript
npm run build

# Run quick smoke test
npm run cucumber:smoke
```

## Test Reports

After running tests, view reports:

```bash
# HTML report
open test-results/cucumber-report.html

# JSON report (for CI/CD)
cat test-results/cucumber-report.json

# JUnit XML report
cat test-results/cucumber-report.xml
```

## Tags Reference

```gherkin
@bdd                # All BDD tests
@smoke              # Quick smoke tests
@api                # API tests
@database           # Database tests
@fixtures           # Fixture tests
@seeds              # Seed data tests
@project1           # Project 1 specific
@project2           # Project 2 specific
@parallel           # Can run in parallel
@skip               # Skip this test
```

Filter by tag:
```bash
npm run cucumber -- --tags "@smoke"
npm run cucumber -- --tags "@api and @project1"
npm run cucumber -- --tags "not @skip"
```

## Troubleshooting

### Tests Not Running
```bash
# Check cucumber is installed
npm list @cucumber/cucumber

# Rebuild and try again
npm run build && npm run cucumber:project1
```

### Project Not Found
```bash
# Check projects exist
npm run project:list

# Create missing project
npm run project:create project1
```

### Wrong Environment
```bash
# Verify .env files exist
ls -la .env*

# Check active project
echo $ACTIVE_PROJECT

# Run with explicit project
ACTIVE_PROJECT=project1 npm run cucumber
```

### Test Data Not Found
```bash
# Check test data exists
ls -la features/test-data/project1/fixtures/
ls -la features/test-data/project1/seeds/

# Create test data
mkdir -p features/test-data/project1/{fixtures,seeds}
```

## Next Steps

1. **Run tests**: `npm run cucumber:project1`
2. **View report**: Open `test-results/cucumber-report.html`
3. **Add scenarios**: Create `.feature` files in `features/`
4. **Add test data**: Create JSON files in `features/test-data/`
5. **Write steps**: Add to `features/step-definitions/`

## Learn More

- Full guide: [BDD_PROJECT_INTEGRATION.md](BDD_PROJECT_INTEGRATION.md)
- Project setup: [PROJECT_CONFIGURATION.md](PROJECT_CONFIGURATION.md)
- Step definitions: `features/step-definitions/`
- Example scenarios: `features/*.feature`

## File Checklist

```
✅ features/project-management.feature
✅ features/test-data-management.feature
✅ features/hooks/projectHooks.ts
✅ features/step-definitions/projectSteps.ts
✅ features/step-definitions/testDataSteps.ts
✅ features/support/testDataManager.ts
✅ features/test-data/project1/fixtures/testUser.json
✅ features/test-data/project1/seeds/users.json
✅ features/test-data/project2/fixtures/testUser.json
✅ features/test-data/project2/seeds/users.json
✅ cucumber.js (config)
✅ .env.project1
✅ .env.project2
✅ package.json (scripts added)
```

All ready to go! 🚀
