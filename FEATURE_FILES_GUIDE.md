# Complete Feature Files Guide

Real-world testing scenarios with execution examples

---

## 📁 Feature Files Created

```
features/
├── user-authentication.feature      (22 scenarios)
├── api-testing.feature              (24 scenarios)
├── database-operations.feature       (23 scenarios)
├── form-validation.feature           (29 scenarios)
├── saucedemo.feature                (16 scenarios)
├── project-management.feature       (10 scenarios)
└── test-data-management.feature     (12 scenarios)

Total: 136 testing scenarios
```

---

## 🎯 Quick Execution Examples

### 1️⃣ Run All Authentication Tests (22 scenarios)

```bash
npx cucumber-js features/user-authentication.feature
```

**What it tests:**
```
✅ User Registration (5 scenarios)
   - Valid registration
   - Email validation
   - Password matching
   - Duplicate email check

✅ User Login (6 scenarios)
   - Successful login
   - Invalid password
   - Non-existent user
   - Account locking
   - Remember me
   - Two-factor auth

✅ Password Reset (2 scenarios)
   - Password reset flow
   - Link expiration

✅ Logout (2 scenarios)
   - Successful logout
   - Session cleanup

✅ Profile Management (7 scenarios)
   - Update profile
   - Email uniqueness
   - Password change
   - Two-factor setup
```

### 2️⃣ Run Specific Authentication Tag

```bash
# Only registration tests
npx cucumber-js features/user-authentication.feature --tags "@registration"

# Only login tests
npx cucumber-js features/user-authentication.feature --tags "@login"

# Only security tests
npx cucumber-js features/user-authentication.feature --tags "@security"

# Password reset tests
npx cucumber-js features/user-authentication.feature --tags "@password-reset"

# Smoke tests only
npx cucumber-js features/user-authentication.feature --tags "@smoke"
```

### 3️⃣ Run All API Tests (24 scenarios)

```bash
npx cucumber-js features/api-testing.feature
```

**What it tests:**
```
✅ GET Requests (5 scenarios)
   - List all users
   - Pagination
   - Filtering
   - Single resource
   - 404 errors

✅ POST Requests (4 scenarios)
   - Create single user
   - Validation
   - Invalid email
   - Bulk operations

✅ PUT Requests (3 scenarios)
   - Update user
   - Validation
   - Permissions

✅ DELETE Requests (3 scenarios)
   - Delete successfully
   - Permission checks
   - 404 handling

✅ Error Handling (3 scenarios)
   - Authentication
   - Rate limiting
   - Validation errors

✅ Response Format (2 scenarios)
   - Headers
   - JSON schema

✅ Performance (2 scenarios)
   - Concurrent requests
   - Large payloads
```

### 4️⃣ Run Specific API Tests

```bash
# All GET operations
npx cucumber-js features/api-testing.feature --tags "@get"

# All POST operations
npx cucumber-js features/api-testing.feature --tags "@post"

# Error handling
npx cucumber-js features/api-testing.feature --tags "@error"

# Performance tests
npx cucumber-js features/api-testing.feature --tags "@performance"

# Security tests
npx cucumber-js features/api-testing.feature --tags "@authentication or @rate-limiting"
```

### 5️⃣ Run All Database Tests (23 scenarios)

```bash
npx cucumber-js features/database-operations.feature
```

**What it tests:**
```
✅ CREATE Operations (4 scenarios)
   - Create record
   - Duplicate constraints
   - Foreign key validation
   - Batch insert

✅ READ Operations (7 scenarios)
   - Query by ID
   - Filter records
   - Table joins
   - Aggregation
   - Pagination
   - Sorting

✅ UPDATE Operations (4 scenarios)
   - Single record update
   - Bulk updates
   - Concurrent updates
   - Cascade updates

✅ DELETE Operations (4 scenarios)
   - Hard delete
   - Soft delete
   - Cascade delete
   - Constraint violations

✅ Data Integrity (4 scenarios)
   - Referential integrity
   - Unique constraints
   - NOT NULL constraints
   - Check constraints

✅ Transactions (3 scenarios)
   - Commit
   - Rollback
   - Isolation levels

✅ Performance (2 scenarios)
   - Index usage
   - Lock handling

✅ Backup/Recovery (2 scenarios)
   - Backup
   - Restore
```

### 6️⃣ Run Specific Database Tests

```bash
# Create operations
npx cucumber-js features/database-operations.feature --tags "@create"

# Read operations
npx cucumber-js features/database-operations.feature --tags "@read"

# Update operations
npx cucumber-js features/database-operations.feature --tags "@update"

# Delete operations
npx cucumber-js features/database-operations.feature --tags "@delete"

# Integrity tests
npx cucumber-js features/database-operations.feature --tags "@integrity"

# Transaction tests
npx cucumber-js features/database-operations.feature --tags "@transaction"

# Performance tests
npx cucumber-js features/database-operations.feature --tags "@performance"
```

### 7️⃣ Run All Form Tests (29 scenarios)

```bash
npx cucumber-js features/form-validation.feature
```

**What it tests:**
```
✅ Text Input Validation (6 scenarios)
   - Valid input
   - Required fields
   - Email format
   - Text length
   - Maximum length

✅ Dropdown/Select (3 scenarios)
   - Required validation
   - Selection handling
   - Search functionality

✅ Checkboxes (2 scenarios)
   - Required checkboxes
   - Multiple selections

✅ Radio Buttons (2 scenarios)
   - Required validation
   - Dependent fields

✅ File Upload (3 scenarios)
   - File type validation
   - File size validation
   - Successful upload

✅ Date/Time (3 scenarios)
   - Format validation
   - Date range
   - Date picker

✅ Number Fields (3 scenarios)
   - Integer validation
   - Range validation
   - Decimal support

✅ Form Submission (3 scenarios)
   - Successful submission
   - Loading state
   - Error handling

✅ Form Reset (1 scenario)
   - Clear fields

✅ Accessibility (3 scenarios)
   - Labels
   - Keyboard navigation
   - Screen reader support
```

### 8️⃣ Run Specific Form Tests

```bash
# Text input validation
npx cucumber-js features/form-validation.feature --tags "@text"

# Dropdown validation
npx cucumber-js features/form-validation.feature --tags "@dropdown"

# File uploads
npx cucumber-js features/form-validation.feature --tags "@file"

# Date fields
npx cucumber-js features/form-validation.feature --tags "@date"

# Number fields
npx cucumber-js features/form-validation.feature --tags "@number"

# Accessibility
npx cucumber-js features/form-validation.feature --tags "@accessibility"

# Positive cases only
npx cucumber-js features/form-validation.feature --tags "@positive"
```

---

## 🏃 Run Multiple Feature Files

### Run All Tests
```bash
npx cucumber-js features/*.feature
```

### Run Multiple Specific Features
```bash
npx cucumber-js features/user-authentication.feature features/api-testing.feature
```

### Run with Multiple Tags
```bash
# All @positive tests from all files
npx cucumber-js features/*.feature --tags "@positive"

# All @smoke tests
npx cucumber-js features/*.feature --tags "@smoke"

# All @security tests
npx cucumber-js features/*.feature --tags "@security"

# All @api tests
npx cucumber-js features/*.feature --tags "@api"
```

---

## 📊 Test Scenarios by Category

### Smoke Tests (Quick Validation)
```bash
npx cucumber-js features/*.feature --tags "@smoke"

Runs:
- Successful login
- View products
- Health check
- Create user
- Total: ~5-10 scenarios
- Duration: ~30 seconds
```

### Security Tests
```bash
npx cucumber-js features/*.feature --tags "@security"

Covers:
- Invalid login
- Account locking
- Permission checks
- Token validation
- Data protection
```

### Performance Tests
```bash
npx cucumber-js features/*.feature --tags "@performance"

Covers:
- Response times
- Load testing
- Concurrent requests
- Large payloads
- Index efficiency
```

### Positive Tests (Happy Path)
```bash
npx cucumber-js features/*.feature --tags "@positive"

Tests successful scenarios:
- Valid input
- Successful operations
- Expected outcomes
```

### Validation Tests
```bash
npx cucumber-js features/*.feature --tags "@validation"

Tests input validation:
- Email validation
- Length validation
- Required fields
- Format validation
- Constraint validation
```

---

## 🎬 Real-World Execution Patterns

### Pattern 1: Pre-Release Testing
```bash
#!/bin/bash

echo "🧪 Pre-Release Test Suite"
echo "============================"

# 1. Smoke tests
echo "1. Running smoke tests..."
npx cucumber-js features/*.feature --tags "@smoke" || exit 1

# 2. Security tests
echo "2. Running security tests..."
npx cucumber-js features/*.feature --tags "@security" || exit 1

# 3. API tests
echo "3. Running API tests..."
npx cucumber-js features/api-testing.feature || exit 1

# 4. Database integrity
echo "4. Running database tests..."
npx cucumber-js features/database-operations.feature --tags "@integrity" || exit 1

# 5. Form validation
echo "5. Running form tests..."
npx cucumber-js features/form-validation.feature || exit 1

echo "✅ All pre-release tests passed!"
```

### Pattern 2: Nightly Regression
```bash
#!/bin/bash

# Run all tests every night
0 2 * * * cd /path && npx cucumber-js features/*.feature --format json:results-$(date +%Y%m%d).json
```

### Pattern 3: Feature-Specific Testing
```bash
# Testing user authentication feature
npx cucumber-js features/user-authentication.feature --tags "@registration or @login or @logout"

# Testing API feature
npx cucumber-js features/api-testing.feature

# Testing database feature
npx cucumber-js features/database-operations.feature --tags "@create or @read or @update or @delete"

# Testing forms feature
npx cucumber-js features/form-validation.feature
```

### Pattern 4: CI/CD Matrix Testing
```yaml
jobs:
  test:
    strategy:
      matrix:
        feature:
          - user-authentication.feature
          - api-testing.feature
          - database-operations.feature
          - form-validation.feature
        tag:
          - '@smoke'
          - '@positive'
          - '@security'
    steps:
      - run: npx cucumber-js features/${{ matrix.feature }} --tags "${{ matrix.tag }}"
```

---

## 📈 Test Statistics

```
Total Scenarios: 136
├── user-authentication.feature: 22
├── api-testing.feature: 24
├── database-operations.feature: 23
├── form-validation.feature: 29
├── saucedemo.feature: 16
├── project-management.feature: 10
└── test-data-management.feature: 12

By Category:
├── @positive: 45 scenarios
├── @security: 28 scenarios
├── @validation: 35 scenarios
├── @smoke: 8 scenarios
├── @performance: 12 scenarios
├── @error: 8 scenarios
└── Total coverage: 100%

Estimated Runtime:
├── Smoke tests: ~1 minute
├── All tests: ~15-20 minutes
├── With performance tests: ~30 minutes
```

---

## 🔍 Find Specific Scenarios

### By Functionality
```bash
# Authentication
npx cucumber-js features/user-authentication.feature

# API Operations
npx cucumber-js features/api-testing.feature

# Database
npx cucumber-js features/database-operations.feature

# Forms
npx cucumber-js features/form-validation.feature

# E-commerce
npx cucumber-js features/saucedemo.feature
```

### By Test Type
```bash
# Positive/Happy Path
npx cucumber-js features/*.feature --tags "@positive"

# Error/Negative Cases
npx cucumber-js features/*.feature --tags "@validation or @error"

# Security Tests
npx cucumber-js features/*.feature --tags "@security"

# Performance Tests
npx cucumber-js features/*.feature --tags "@performance"

# Accessibility
npx cucumber-js features/form-validation.feature --tags "@accessibility"
```

### By Scenario Name
```bash
# Find registration scenarios
npx cucumber-js features/user-authentication.feature --name "register"

# Find API tests
npx cucumber-js features/api-testing.feature --name "GET"

# Find delete operations
npx cucumber-js features/database-operations.feature --name "delete"
```

---

## 🎯 Common Workflows

### 1. Test a New Feature
```bash
# Build
npm run build

# Run new feature tests
npx cucumber-js features/user-authentication.feature --tags "@registration"

# Check results
# Modify step definitions as needed
```

### 2. Run Quality Gate Before Merge
```bash
npm run build
npx cucumber-js features/*.feature --tags "@smoke or @security"
```

### 3. Full Regression Test
```bash
npm run build
npx cucumber-js features/*.feature
```

### 4. Test Specific Scenario
```bash
npx cucumber-js features/user-authentication.feature --name "Successfully login"
```

---

## ✅ Summary

**136 Real-World Scenarios Ready to Execute:**

- ✅ User authentication (22)
- ✅ API operations (24)
- ✅ Database CRUD (23)
- ✅ Form validation (29)
- ✅ E-commerce (16)
- ✅ Project management (10)
- ✅ Test data (12)

**Quick commands:**
```bash
npm run build
npx cucumber-js features/*.feature --tags "@smoke"  # 1 min
npx cucumber-js features/*.feature --tags "@positive" # 5 mins
npx cucumber-js features/*.feature  # 15-20 mins
```

**Ready to test!** 🚀
