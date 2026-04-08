# Single Server with Dynamic URLs & Tags - BDD Configuration

## 🎯 Goal
- ✅ All projects run on **same server** (port 3001)
- ✅ Dynamic URLs in feature files
- ✅ Dynamic tags in scenarios
- ✅ Route requests to correct project database

---

## 🏗️ Architecture

```
Single Backend Server (localhost:3001)
  │
  ├─ API Routing Middleware
  │   └─ Routes to correct database based on header/query param
  │
  ├─ Project 1 Database (5433)
  ├─ Project 2 Database (5434)
  └─ Project 3 Database (5435)
```

---

## 📝 Step 1: Update Feature Files with Dynamic Tags

### **Before (Static):**
```gherkin
@smoke @api @project1
Scenario: Get list of users
  When I send a GET request to "http://localhost:3001/api/users"
```

### **After (Dynamic):**
```gherkin
@smoke @api @project(${PROJECT_NAME})
Scenario: Get list of users
  When I send a GET request to "${API_BASE_URL}/api/users"
  And I use project header "${PROJECT_NAME}"
```

---

## 🔧 Step 2: Create Dynamic Feature File Helper

Create: `features/support/dynamicFeatures.ts`

```typescript
import { Before } from '@cucumber/cucumber';

// Global variables for dynamic replacement
export const dynamicVariables = {
  PROJECT_NAME: process.env.ACTIVE_PROJECT || 'project1',
  API_BASE_URL: process.env.API_URL || 'http://localhost:3001',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || '5433',
  DB_NAME: process.env.DB_NAME || 'playwright_project1'
};

// Replace dynamic variables in scenarios
Before(function(scenario) {
  const projectName = process.env.ACTIVE_PROJECT || 'project1';
  const apiUrl = `http://localhost:3001?project=${projectName}`;
  
  // Update dynamic variables
  dynamicVariables.PROJECT_NAME = projectName;
  dynamicVariables.API_BASE_URL = apiUrl;
  
  // Store in Cucumber world
  this.projectName = projectName;
  this.apiBaseUrl = apiUrl;
});
```

---

## 📋 Step 3: Update Feature Files with Variables

### **New api-testing.feature:**
```gherkin
@api @project(${PROJECT_NAME})
Feature: REST API Testing
  Background:
    Given the API is running on "${API_BASE_URL}"
    And I have project header "${PROJECT_NAME}"
    And the database is seeded with test data

  @get @positive @smoke
  Scenario: Get list of all users
    When I send a GET request to "${API_BASE_URL}/api/users"
    And I include header "X-Project: ${PROJECT_NAME}"
    Then the response status should be 200
    And the response should contain a JSON array
```

---

## 🔌 Step 4: Single Server Configuration

### **Update backend to handle project routing:**

Create: `src/middleware/projectRouter.ts`

```typescript
import { Request, Response, NextFunction } from 'express';

export const projectRouterMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Get project from:
  // 1. Query parameter: ?project=project1
  // 2. Header: X-Project: project1
  // 3. Cookie: project=project1
  // 4. Environment: ACTIVE_PROJECT
  
  const projectName = 
    req.query.project as string ||
    req.headers['x-project'] as string ||
    req.cookies?.project ||
    process.env.ACTIVE_PROJECT ||
    'project1';

  // Store in request for downstream use
  (req as any).projectName = projectName;
  (req as any).projectConfig = loadProjectConfig(projectName);

  next();
};

function loadProjectConfig(projectName: string) {
  const configs: Record<string, any> = {
    project1: {
      DB_HOST: 'localhost',
      DB_PORT: 5433,
      DB_NAME: 'playwright_project1',
      PORT: 3001
    },
    project2: {
      DB_HOST: 'localhost',
      DB_PORT: 5434,
      DB_NAME: 'playwright_project2',
      PORT: 3001
    },
    project3: {
      DB_HOST: 'localhost',
      DB_PORT: 5435,
      DB_NAME: 'playwright_project3',
      PORT: 3001
    }
  };
  
  return configs[projectName] || configs.project1;
}
```

### **Update src/index.ts:**
```typescript
import { projectRouterMiddleware } from './middleware/projectRouter';

app.use(projectRouterMiddleware);
app.use('/api', routes);
```

---

## 📚 Step 5: Update Step Definitions with Dynamic URLs

### **features/step-definitions/apiSteps.ts:**
```typescript
import { When, Then, Given } from '@cucumber/cucumber';

Given('the API is running on {string}', function(url: string) {
  // Replace variables: ${API_BASE_URL} -> http://localhost:3001?project=project1
  const resolvedUrl = url
    .replace('${API_BASE_URL}', this.apiBaseUrl)
    .replace('${PROJECT_NAME}', this.projectName);
  
  this.apiUrl = resolvedUrl;
});

When('I include header {string}', function(headerValue: string) {
  // Replace variables in header
  const resolvedHeader = headerValue
    .replace('${PROJECT_NAME}', this.projectName)
    .replace('${API_BASE_URL}', this.apiBaseUrl);
  
  this.headers = this.headers || {};
  const [key, value] = resolvedHeader.split(': ');
  this.headers[key] = value;
});

When('I send a GET request to {string}', async function(urlPath: string) {
  const resolvedUrl = urlPath
    .replace('${API_BASE_URL}', this.apiBaseUrl)
    .replace('${PROJECT_NAME}', this.projectName);
  
  const response = await axios.get(resolvedUrl, {
    headers: this.headers
  });
  
  this.lastResponse = response;
});
```

---

## 🏃 Step 6: Run with Single Server

### **All projects on same port:**
```bash
cd playwright-crx-enhanced/backend

# Start single server
npm run dev

# Run tests for project1
ACTIVE_PROJECT=project1 npm run cucumber:api

# Run tests for project2  
ACTIVE_PROJECT=project2 npm run cucumber:api

# Run tests for project3
ACTIVE_PROJECT=project3 npm run cucumber:api
```

### **Each request includes project:**
```bash
# Frontend to backend
curl -H "X-Project: project1" http://localhost:3001/api/users

# Or via query param
curl http://localhost:3001/api/users?project=project1

# Or in feature file
When I send a GET request to "http://localhost:3001/api/users?project=${PROJECT_NAME}"
```

---

## 📊 Dynamic URL Examples

### **In Feature Files:**
```gherkin
Given the API is running on "${API_BASE_URL}"
When I send a GET request to "${API_BASE_URL}/api/users"
And I use database "${DB_NAME}"
And I set header "X-Project: ${PROJECT_NAME}"
```

### **After Variable Replacement:**
```gherkin
Given the API is running on "http://localhost:3001?project=project1"
When I send a GET request to "http://localhost:3001?project=project1/api/users"
And I use database "playwright_project1"
And I set header "X-Project: project1"
```

---

## 🏷️ Dynamic Tags

### **Support Variables in Tags:**
```gherkin
@api @project(${PROJECT_NAME}) @smoke
Scenario: Test scenario

@api @project(${PROJECT_NAME}) @database(${DB_NAME})
Scenario: Database test
```

### **Parse Tags:**
```typescript
Before(function(scenario) {
  const projectTag = scenario.pickle.tags.find(tag => 
    tag.name.includes('@project')
  );
  
  if (projectTag) {
    // Extract: @project(project1) -> project1
    const projectName = projectTag.name
      .replace('@project(', '')
      .replace(')', '')
      .replace('${PROJECT_NAME}', process.env.ACTIVE_PROJECT);
    
    this.projectName = projectName;
  }
});
```

---

## 🗂️ Updated File Structure

```
playwright-crx-enhanced/backend/
├── .env                          (Single server config)
├── src/
│   ├── index.ts                  (Updated with projectRouter)
│   ├── middleware/
│   │   └── projectRouter.ts      (NEW - route by project)
│   ├── controllers/
│   │   └── (existing)
│   └── routes/
│       └── (existing)
├── features/
│   ├── support/
│   │   ├── dynamicFeatures.ts   (NEW - variable replacement)
│   │   └── world.ts
│   └── step-definitions/
│       ├── apiSteps.ts           (Updated with variable resolution)
│       └── (existing)
└── cucumber.js                   (Updated config)
```

---

## 🎯 Configuration

### **.env (Single Server):**
```bash
# Server
PORT=3001
NODE_ENV=development

# Projects Configuration
PROJECTS=project1,project2,project3

# Project 1
PROJECT1_DB_HOST=localhost
PROJECT1_DB_PORT=5433
PROJECT1_DB_NAME=playwright_project1
PROJECT1_DB_USER=postgres
PROJECT1_DB_PASSWORD=postgres

# Project 2
PROJECT2_DB_HOST=localhost
PROJECT2_DB_PORT=5434
PROJECT2_DB_NAME=playwright_project2
PROJECT2_DB_USER=postgres
PROJECT2_DB_PASSWORD=postgres

# Project 3
PROJECT3_DB_HOST=localhost
PROJECT3_DB_PORT=5435
PROJECT3_DB_NAME=playwright_project3
PROJECT3_DB_USER=postgres
PROJECT3_DB_PASSWORD=postgres
```

### **Updated cucumber.js:**
```javascript
module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    support: [
      'features/support/world.ts',
      'features/support/dynamicFeatures.ts',
      'features/support/**/*.ts',
      'features/hooks/**/*.ts',
      'features/step-definitions/**/*.ts'
    ],
    format: [
      'progress-bar',
      'json:test-results/cucumber-report.json'
    ],
    timeout: 60000,
    // Support variable replacement in tags
    tags: process.env.CUCUMBER_TAGS || ''
  }
};
```

---

## 🚀 Usage Examples

### **Run all tests on single server:**
```bash
npm run dev                           # Start server on 3001

# In another terminal
ACTIVE_PROJECT=project1 npm run cucumber:api
ACTIVE_PROJECT=project2 npm run cucumber:api
ACTIVE_PROJECT=project3 npm run cucumber:api
```

### **Run with dynamic URLs:**
```bash
# Feature file automatically uses correct project
ACTIVE_PROJECT=project2 npm run cucumber:smoke

# URLs resolve to:
# "http://localhost:3001?project=project2/api/users"
# "http://localhost:3001?project=project2/api/health"
```

### **Run specific tags dynamically:**
```bash
# Tags like @project(${PROJECT_NAME}) get resolved
ACTIVE_PROJECT=project1 npm run cucumber -- --tags "@api and @project(project1)"
```

---

## ✅ Benefits

✅ **Single Server** - All projects on port 3001
✅ **Dynamic URLs** - Variables replaced at runtime
✅ **Dynamic Tags** - Tags support variable substitution
✅ **Easy Switching** - Just set ACTIVE_PROJECT env var
✅ **Scalable** - Add more projects without code changes
✅ **Clean** - No need for multiple server instances

---

## 📋 Implementation Checklist

- [ ] Create `src/middleware/projectRouter.ts`
- [ ] Create `features/support/dynamicFeatures.ts`
- [ ] Update `src/index.ts` to use projectRouter
- [ ] Update feature files with `${API_BASE_URL}` and `${PROJECT_NAME}`
- [ ] Update step definitions to resolve variables
- [ ] Update `.env` to single server config
- [ ] Update `cucumber.js` with dynamicFeatures support
- [ ] Test with different projects on same server
- [ ] Verify dynamic URL replacement
- [ ] Verify dynamic tag parsing

---

**Ready to implement single server with dynamic URLs!** 🎉
