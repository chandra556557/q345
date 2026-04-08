# How to Implement Dynamic URLs in Step Definitions

## 📝 Example: Update API Testing Steps

### **Before (Static URLs):**

```typescript
// features/step-definitions/apiSteps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import axios from 'axios';

Given('the API is running on {string}', function(url: string) {
  this.apiUrl = 'http://localhost:3001'; // ❌ Static
});

When('I send a GET request to {string}', async function(endpoint: string) {
  const fullUrl = 'http://localhost:3001' + endpoint; // ❌ Static
  const response = await axios.get(fullUrl);
  this.lastResponse = response;
});
```

### **After (Dynamic URLs):**

```typescript
// features/step-definitions/apiSteps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import axios from 'axios';
import { resolveStepParameter } from '../support/dynamicFeatures';

Given('the API is running on {string}', function(url: string) {
  // ✅ Resolve: "http://localhost:3001?project=${PROJECT_NAME}"
  // becomes: "http://localhost:3001?project=project1"
  this.apiUrl = resolveStepParameter(url, this);
  console.log(`✓ API URL set to: ${this.apiUrl}`);
});

When('I send a GET request to {string}', async function(endpoint: string) {
  // ✅ Resolve: "${API_BASE_URL}/api/users"
  // becomes: "http://localhost:3001?project=project1/api/users"
  const resolvedEndpoint = resolveStepParameter(endpoint, this);
  const fullUrl = this.apiUrl.replace('?project=', '?project=') + resolvedEndpoint;
  
  const response = await axios.get(fullUrl, {
    headers: {
      'X-Project': this.projectName // ✅ Send project header
    }
  });
  
  this.lastResponse = response;
});

Then('the response should contain a JSON array', function() {
  if (!Array.isArray(this.lastResponse.data)) {
    throw new Error('Response is not a JSON array');
  }
});
```

---

## 🎯 Feature File Using Dynamic URLs

### **api-testing.feature (Updated):**

```gherkin
@bdd @api @rest-api
Feature: REST API Testing
  As an API consumer
  I want to test API endpoints dynamically
  So that tests work across all projects

  Background:
    # ✅ Now uses ${API_BASE_URL} which gets replaced
    Given the API is running on "${API_BASE_URL}"
    And I have a valid authentication token
    And I set project header to "${PROJECT_NAME}"

  @get @positive @smoke
  Scenario: Get list of all users
    When I send a GET request to "${API_BASE_URL}/api/users"
    Then the response status should be 200
    And the response should contain a JSON array

  @get @filter
  Scenario: Filter users by role
    When I send a GET request to "${API_BASE_URL}/api/users?role=admin"
    Then the response status should be 200
    And all returned users should have role "admin"

  @post @create
  Scenario: Create new user
    When I send a POST request to "${API_BASE_URL}/api/users" with body:
      | email    | test@${PROJECT_NAME}.com |
      | name     | Test User                |
      | password | SecurePass123!           |
    Then the response status should be 201
```

---

## 🔧 Implementation Steps

### **1. Update src/index.ts**

```typescript
import { projectRouterMiddleware } from './middleware/projectRouter';

// Add project router middleware BEFORE all routes
app.use(projectRouterMiddleware);

// Existing routes
app.use('/api', routes);
```

### **2. Update cucumber.js**

```javascript
module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    support: [
      'features/support/world.ts',
      'features/support/dynamicFeatures.ts', // ✅ ADD THIS
      'features/support/**/*.ts',
      'features/hooks/**/*.ts',
      'features/step-definitions/**/*.ts'
    ],
    format: [
      'progress-bar',
      'json:test-results/cucumber-report.json'
    ],
    timeout: 60000
  }
};
```

### **3. Update Step Definitions**

**Pattern to follow in all step definitions:**

```typescript
import { When, Given, Then } from '@cucumber/cucumber';
import { resolveStepParameter } from '../support/dynamicFeatures';

Given('something with {string}', function(parameter: string) {
  // Resolve variables in parameter
  const resolved = resolveStepParameter(parameter, this);
  
  // Use resolved parameter
  this.value = resolved;
});
```

### **4. Update Feature Files**

Replace hardcoded values with variables:

```gherkin
# Before
When I send request to "http://localhost:3001/api/users"

# After
When I send request to "${API_BASE_URL}/api/users"
```

---

## 📊 Available Dynamic Variables

| Variable | Value | Example |
|----------|-------|---------|
| `${PROJECT_NAME}` | Current project | `project1`, `project2` |
| `${API_BASE_URL}` | Base API URL | `http://localhost:3001?project=project1` |
| `${API_PORT}` | API port | `3001` |
| `${DB_HOST}` | Database host | `localhost` |
| `${DB_PORT}` | Database port | `5433` |
| `${DB_NAME}` | Database name | `playwright_project1` |
| `${DB_USER}` | Database user | `postgres` |
| `${TIMESTAMP}` | Current timestamp | `2026-04-07T13:43:00Z` |
| `${DATE}` | Current date | `2026-04-07` |

---

## 🚀 Running with Dynamic URLs

```bash
# Single server handles all projects on port 3001

# Run tests for project1
ACTIVE_PROJECT=project1 npm run cucumber:api

# Run tests for project2
ACTIVE_PROJECT=project2 npm run cucumber:api

# Run tests for project3
ACTIVE_PROJECT=project3 npm run cucumber:api

# Specify project via header (from frontend)
curl -H "X-Project: project2" http://localhost:3001/api/users

# Or via query parameter
curl http://localhost:3001/api/users?project=project2
```

---

## ✅ Example: Complete Updated Step

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import axios from 'axios';
import { resolveStepParameter } from '../support/dynamicFeatures';

// Feature: Given the API is running on "${API_BASE_URL}"
Given('the API is running on {string}', function(urlTemplate: string) {
  // Input: "${API_BASE_URL}"
  // Output: "http://localhost:3001?project=project1"
  this.apiBaseUrl = resolveStepParameter(urlTemplate, this);
  this.headers = {
    'X-Project': this.projectName,
    'Content-Type': 'application/json'
  };
});

// Feature: When I send a GET request to "${API_BASE_URL}/api/users"
When('I send a GET request to {string}', async function(endpoint: string) {
  // Input: "${API_BASE_URL}/api/users"
  // Output: "http://localhost:3001?project=project1/api/users"
  const resolvedEndpoint = resolveStepParameter(endpoint, this);
  
  try {
    const response = await axios.get(resolvedEndpoint, {
      headers: this.headers,
      validateStatus: () => true // Don't throw on any status
    });
    
    this.lastResponse = response;
    this.lastStatusCode = response.status;
  } catch (error: any) {
    throw new Error(`Failed to GET ${resolvedEndpoint}: ${error.message}`);
  }
});

// Feature: Then the response status should be 200
Then('the response status should be {int}', function(expectedStatus: number) {
  if (this.lastStatusCode !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${this.lastStatusCode}`
    );
  }
});

// Feature: And the response should contain a JSON array
Then('the response should contain a JSON array', function() {
  if (!Array.isArray(this.lastResponse.data)) {
    throw new Error('Response data is not an array');
  }
});
```

---

## 🎁 Benefits

✅ **Single Server** - All projects on port 3001
✅ **Dynamic URLs** - Variables replaced automatically
✅ **No Duplication** - Write features once, run for all projects
✅ **Easy Maintenance** - Change URLs in one place
✅ **Scalable** - Add new projects without changing tests
✅ **Clean Code** - Feature files are more readable

---

## 📋 Checklist

- [ ] Copy `projectRouter.ts` to `src/middleware/`
- [ ] Copy `dynamicFeatures.ts` to `features/support/`
- [ ] Update `src/index.ts` to use projectRouterMiddleware
- [ ] Update `cucumber.js` to include dynamicFeatures
- [ ] Update all feature files to use `${VARIABLE_NAME}` syntax
- [ ] Update step definitions to use `resolveStepParameter()`
- [ ] Copy `.env.single-server` to `.env`
- [ ] Test with different projects: `ACTIVE_PROJECT=project1 npm run cucumber`
- [ ] Verify URLs are resolved correctly
- [ ] Verify project header is sent

---

**Now your BDD tests are fully dynamic and scalable!** 🎉
