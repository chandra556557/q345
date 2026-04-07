# Complete Testing Guide - Frontend + Backend + BDD Tests

This guide shows how to run Cucumber BDD tests with the frontend and backend automatically started.

---

## 🚀 Quick Start (One Command)

### Run Everything Together - Project 1
```bash
cd playwright-crx-enhanced/backend
npm run test:full-stack:project1
```

**What happens:**
1. ✅ Backend starts on port 3001
2. ✅ Frontend starts on http://localhost:3000
3. ✅ Waits for backend to be ready
4. ✅ Runs all Cucumber tests (136 scenarios)

### Run Everything Together - Project 2
```bash
cd playwright-crx-enhanced/backend
npm run test:full-stack:project2
```

**What happens:**
1. ✅ Backend starts on port 3002
2. ✅ Frontend starts on http://localhost:3000
3. ✅ Waits for backend to be ready
4. ✅ Runs all Cucumber tests against Project 2

---

## 📋 Individual Test Commands

All commands below assume you're in: `cd playwright-crx-enhanced/backend`

### Run All Tests
```bash
npm run cucumber
```

### Run SauceDemo Tests (E-commerce with Real Browser)
```bash
npm run test:saucedemo
```
**What it tests:**
- Login to https://saucedemo.com
- Browse products
- Add items to cart
- Checkout flow
- Sorting & filtering
- Real Playwright browser automation

### Run Smoke Tests (Quick Validation)
```bash
npm run cucumber:smoke
```
**Duration:** ~30 seconds  
**Tests:** ~5-10 quick scenarios

### Run API Tests
```bash
npm run test:api
```
**Tests:** 24 API scenarios
- GET requests (list, pagination, filters)
- POST requests (create, validation)
- PUT requests (updates)
- DELETE requests
- Error handling
- Rate limiting

### Run Form Tests (Frontend)
```bash
npm run test:frontend
```
**Tests:** 29 form validation scenarios
- Text input validation
- Dropdown/select validation
- Checkboxes & radio buttons
- File upload
- Date/time fields
- Accessibility

### Run Database Tests
```bash
npm run cucumber:database
```
**Tests:** 23 database scenarios
- CREATE operations
- READ queries
- UPDATE operations
- DELETE operations
- Data integrity
- Transactions

### Run Authentication Tests
```bash
npm run cucumber:project1
```
**Tests:** 22 authentication scenarios
- User registration
- Login/logout
- Password reset
- Profile management
- Two-factor auth

---

## 🔄 Manual Multi-Terminal Setup (Advanced)

If you prefer separate terminal windows:

### Terminal 1: Start Backend
```bash
cd playwright-crx-enhanced/backend
npm run dev:project1
```
Wait for: `✅ Server running on port 3001`

### Terminal 2: Start Frontend
```bash
cd frontend
npm start
```
Wait for: `Compiled successfully`

### Terminal 3: Run Tests
```bash
cd playwright-crx-enhanced/backend
npm run cucumber
```

---

## 🎯 Running Specific Test Scenarios

### By Tag (Feature Category)
```bash
# Authentication tests
npm run cucumber:project1 -- --tags @login

# API tests
npm run cucumber:api

# Form validation
npm run test:frontend

# Database operations
npm run cucumber:database

# Smoke tests (fastest)
npm run cucumber:smoke
```

### By Specific Scenario Name
```bash
npm run cucumber -- --name "Successfully login with valid credentials"
npm run cucumber -- --name "Create new user"
npm run cucumber -- --name "Valid file upload succeeds"
```

### By Feature File
```bash
# Just authentication
npx cucumber-js features/user-authentication.feature

# Just API
npx cucumber-js features/api-testing.feature

# Just forms
npx cucumber-js features/form-validation.feature

# Just database
npx cucumber-js features/database-operations.feature

# Just SauceDemo (real browser)
npx cucumber-js features/saucedemo.feature
```

---

## 📊 Test Categories & Scenarios

### Feature Files Available
```
features/
├── user-authentication.feature       (22 scenarios) @login @registration @security
├── api-testing.feature                (24 scenarios) @api @rest-api @get @post @put @delete
├── database-operations.feature        (23 scenarios) @database @crud @transaction
├── form-validation.feature            (29 scenarios) @forms @validation @accessibility
├── saucedemo.feature                  (16 scenarios) @ecommerce @ui (real browser)
├── project-management.feature         (10 scenarios) @project-management
└── test-data-management.feature       (12 scenarios) @test-data

Total: 136 Real-World Testing Scenarios
```

### By Testing Type

**Smoke Tests (Quick - 30 seconds)**
```bash
npm run cucumber:smoke
```

**Positive/Happy Path Tests (Valid scenarios)**
```bash
npx cucumber-js features/*.feature --tags @positive
```

**Security Tests**
```bash
npx cucumber-js features/*.feature --tags @security
```

**Performance Tests**
```bash
npx cucumber-js features/*.feature --tags @performance
```

**Validation Tests**
```bash
npx cucumber-js features/*.feature --tags @validation
```

**Accessibility Tests**
```bash
npx cucumber-js features/form-validation.feature --tags @accessibility
```

---

## 🌐 SauceDemo Testing (Real Browser Automation)

The SauceDemo feature uses **real Playwright browser automation** against https://saucedemo.com:

```bash
npm run test:saucedemo
```

**What it does:**
1. Opens Chrome browser
2. Navigates to saucedemo.com
3. Logs in with test credentials
4. Adds items to cart
5. Completes checkout
6. Tests filtering & sorting
7. Takes screenshots/videos

**Test Scenarios:**
- @smoke - Successful login
- @login - Various login scenarios
- @products - Product catalog tests
- @shopping-cart - Cart operations
- @checkout - Checkout flow
- @sorting - Product sorting
- @filter - Product filtering
- @logout - Session logout

---

## 🔧 Configuration

### Change Backend Port
Edit `playwright-crx-enhanced/backend/.env.project1`:
```bash
PORT=3001  # Change this
DB_HOST=localhost
DB_PORT=5433
```

### Change Database
Edit `playwright-crx-enhanced/backend/.env.project1`:
```bash
DB_HOST=localhost
DB_PORT=5433
DB_NAME=playwright_project1
DB_USER=postgres
DB_PASSWORD=postgres
```

### Switch Projects
```bash
# Project 1 (port 3001)
npm run test:full-stack:project1

# Project 2 (port 3002)
npm run test:full-stack:project2
```

---

## 📈 Viewing Test Results

### HTML Report
```bash
npm run cucumber:report
# Opens: playwright-crx-enhanced/backend/cucumber-report.html
```

### Console Output
Tests output results directly to terminal:
```
✅ Passing scenarios (green)
❌ Failing scenarios (red)
⏭️ Skipped scenarios (yellow)
```

### Full Test Run Summary
```bash
npm run cucumber

# Shows:
# ✅ 120 scenarios passed
# ❌ 5 scenarios failed
# ⏭️ 11 scenarios pending
# Duration: 2m 34s
```

---

## 🐛 Troubleshooting

### "Port already in use"
```bash
# Kill existing processes
# Linux/Mac:
lsof -ti:3001 | xargs kill -9

# Windows:
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

### "Server did not start"
Check if backend dependencies are installed:
```bash
cd playwright-crx-enhanced/backend
npm install
```

### "Frontend not running"
Ensure frontend is built:
```bash
cd frontend
npm install
npm run build
```

### "Tests timeout"
Increase timeout in `cucumber.js`:
```javascript
const common = {
  timeout: 60000  // 60 seconds instead of 5
}
```

---

## 📚 Test Execution Examples

### Example 1: Pre-Release Testing
```bash
# Run smoke tests
npm run cucumber:smoke

# Run security tests
npx cucumber-js features/*.feature --tags @security

# Run all critical tests
npm run test:full-stack:project1
```

### Example 2: Frontend Feature Testing
```bash
# Start everything
npm run test:full-stack:project1

# Or just frontend tests
npm run test:frontend
```

### Example 3: API Development Testing
```bash
# Test your API endpoints
npm run test:api
```

### Example 4: E-commerce Testing
```bash
# Test real e-commerce flow
npm run test:saucedemo
```

---

## ✅ Checklist for Testing

- [ ] Backend running on correct port
- [ ] Frontend running on localhost:3000
- [ ] Database connected
- [ ] Tests starting successfully
- [ ] SauceDemo tests opening real browser
- [ ] Test reports generated

---

## 🎓 What's Being Tested

**Frontend (Form Validation):**
- Text input validation
- Email format validation
- Required field validation
- File upload
- Date/time fields
- Accessibility (keyboard navigation, screen readers)

**Backend (API):**
- GET/POST/PUT/DELETE endpoints
- Authentication & authorization
- Rate limiting
- Error handling
- Response validation

**Database:**
- CRUD operations
- Foreign key constraints
- Data integrity
- Transactions
- Performance (indexes)

**E-Commerce (SauceDemo):**
- User login/logout
- Product browsing
- Shopping cart
- Checkout process
- Sorting & filtering

---

## 🚀 Next Steps

1. **Run everything together:**
   ```bash
   cd playwright-crx-enhanced/backend
   npm run test:full-stack:project1
   ```

2. **Watch tests execute** - All windows show real-time progress

3. **Check results** - Terminal shows pass/fail statistics

4. **View reports** - Open HTML report for detailed analysis

5. **Iterate** - Modify step definitions or feature files as needed

**Enjoy your testing! 🎉**
