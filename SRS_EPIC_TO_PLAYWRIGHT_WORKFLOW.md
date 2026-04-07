# Software Requirements Specification (SRS)
# Epic-to-Playwright Workflow Pipeline

**Version:** 1.0
**Date:** 2026-03-30
**Status:** Implemented

---

## 1. Introduction

### 1.1 Purpose
This document defines the Software Requirements Specification for the **Epic-to-Playwright Workflow Pipeline** — an end-to-end automated testing workflow that starts from Jira epic/story selection and produces executable Playwright test suites through a 5-step pipeline.

### 1.2 Scope
The system covers:
1. **Jira Integration** — Connecting to Jira Cloud/Server to fetch epics, stories, and acceptance criteria
2. **Test Case Generation** — AI-powered and rule-based generation of comprehensive test cases across 5 categories
3. **Gherkin Conversion** — Converting generated test cases into BDD Gherkin feature files
4. **Playwright Code Generation** — Transforming Gherkin features into executable Playwright test scripts
5. **Test Execution** — Running generated tests with real-time progress streaming and reporting

### 1.3 Definitions & Acronyms

| Term | Definition |
|------|-----------|
| **Epic** | A large body of work in Jira that can be broken down into stories |
| **Story** | A user story describing a feature from the end-user's perspective |
| **AC** | Acceptance Criteria — conditions a story must meet |
| **BDD** | Behavior-Driven Development — test methodology using Given/When/Then |
| **Gherkin** | A business-readable domain-specific language for BDD |
| **SRS** | Software Requirements Specification |
| **OWASP** | Open Web Application Security Project |
| **SSE** | Server-Sent Events (for real-time streaming) |

---

## 2. System Overview

### 2.1 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ Jira Config  │ │ Generation   │ │ Results &    │             │
│  │ Panel        │ │ Options      │ │ Gherkin View │             │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘             │
│         └────────────────┼────────────────┘                      │
│                          │ REST + SSE                             │
└──────────────────────────┼───────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────┐
│                      BACKEND (Node.js/Express)                   │
│                          │                                        │
│  ┌───────────────────────▼────────────────────────────────┐      │
│  │           Workflow Orchestrator Service                  │      │
│  │  ┌─────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ ┌────────┐│      │
│  │  │FETCH│→│ANALYZE  │→│GENERATE │→│GHERKIN│→│EXECUTE ││      │
│  │  │Jira │ │Stories  │ │TestCases│ │Convert│ │Playwright│      │
│  │  └──┬──┘ └─────────┘ └────┬────┘ └───────┘ └────────┘│      │
│  └─────┼──────────────────────┼───────────────────────────┘      │
│        │                      │                                   │
│  ┌─────▼─────┐  ┌─────────────▼────────────────┐                │
│  │Jira       │  │Test Case Generator Service    │                │
│  │Service    │  │ ┌──────────┐ ┌──────────────┐ │                │
│  │           │  │ │Rule-Based│ │AI-Powered    │ │                │
│  │• REST API │  │ │Engine    │ │(OpenAI/Claude│ │                │
│  │• ADF Parse│  │ └──────────┘ └──────────────┘ │                │
│  │• AC Extract│ │                                │                │
│  └───────────┘  │ Categories:                    │                │
│                 │  Positive | Negative | Edge    │                │
│                 │  Boundary | Security           │                │
│                 └────────────────────────────────┘                │
│                                                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │BDD Service      │  │Serenity Reports │  │Allure Reports    │ │
│  │(Parse + Execute)│  │                 │  │                  │ │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                   PostgreSQL Database                        │ │
│  │  JiraConfig | WorkflowRun | BDDFeature | BDDScenario | ...  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 Pipeline Flow

```
Step 1: PICK           Step 2: ANALYZE        Step 3: GENERATE
┌──────────────┐      ┌──────────────┐      ┌────────────────────┐
│ Jira Epic    │      │ Extract AC   │      │ Positive Cases     │
│ → Stories    │─────→│ Enrich Data  │─────→│ Negative Cases     │
│ → AC         │      │ Context Scan │      │ Edge Cases         │
└──────────────┘      └──────────────┘      │ Boundary Cases     │
                                             │ Security Cases     │
                                             └────────┬───────────┘
                                                      │
Step 5: EXECUTE        Step 4: CONVERT                │
┌──────────────┐      ┌──────────────┐                │
│ Playwright   │      │ Gherkin      │                │
│ Browser Tests│◄─────│ Feature Files│◄───────────────┘
│ + Reports    │      │ + Playwright │
└──────────────┘      └──────────────┘
```

---

## 3. Functional Requirements

### 3.1 FR-01: Jira Integration

#### 3.1.1 Jira Connection Configuration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01-01 | System shall support Jira Cloud (REST API v3) and Jira Server (REST API v2) | P0 |
| FR-01-02 | Users shall configure Jira with: Base URL, Email, API Token, API Version | P0 |
| FR-01-03 | System shall provide "Test Connection" to validate credentials | P0 |
| FR-01-04 | Configuration shall be persisted per user and organization | P0 |
| FR-01-05 | API tokens shall not be returned to the frontend after saving | P0 |
| FR-01-06 | API tokens shall not be stored in workflow run results | P0 |

#### 3.1.2 Epic & Story Fetching
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01-10 | System shall list all accessible Jira projects | P0 |
| FR-01-11 | System shall fetch all epics for a selected project | P0 |
| FR-01-12 | System shall fetch an epic with all linked stories | P0 |
| FR-01-13 | System shall support fetching stories by: Epic Key, Story Keys, Sprint ID, Custom JQL | P0 |
| FR-01-14 | System shall extract story summary, description, status, priority, labels | P0 |
| FR-01-15 | System shall extract acceptance criteria from: custom fields, description sections, ADF format | P0 |
| FR-01-16 | System shall extract subtasks, comments (last 5), and attachment filenames | P1 |
| FR-01-17 | System shall parse Atlassian Document Format (ADF) to plain text | P0 |
| FR-01-18 | System shall handle common AC patterns: Given/When/Then, numbered lists, bullet points | P0 |
| FR-01-19 | If no explicit AC found, system shall derive AC from description sentences and subtasks | P1 |

### 3.2 FR-02: Test Case Generation

#### 3.2.1 Generation Engine
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-01 | System shall support two generation modes: AI-powered and Rule-based | P0 |
| FR-02-02 | AI mode shall support OpenAI (GPT-4o) and Anthropic (Claude) providers | P1 |
| FR-02-03 | Rule-based mode shall work without any external API dependency | P0 |
| FR-02-04 | System shall automatically fall back to rule-based if AI call fails | P0 |
| FR-02-05 | Users shall configure: max cases per category, security depth, application context | P0 |
| FR-02-06 | System shall analyze story context to detect: login, form, search, upload, payment, CRUD, API, permissions, datetime, numeric patterns | P0 |

#### 3.2.2 Test Case Categories

##### Positive Test Cases (Happy Path)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-10 | Each acceptance criterion shall produce at least one positive test case | P0 |
| FR-02-11 | Positive cases shall verify the system works correctly with valid inputs | P0 |
| FR-02-12 | Smoke test tags shall be assigned to the first 2 positive cases | P1 |
| FR-02-13 | Data-driven variations shall be generated for form-based stories | P1 |

##### Negative Test Cases (Error Paths)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-20 | Required field validation cases: one per detected input field | P0 |
| FR-02-21 | Invalid format cases: email, phone, URL, date patterns | P0 |
| FR-02-22 | Unauthorized access cases when permissions context detected | P0 |
| FR-02-23 | Wrong credentials cases when login context detected | P0 |
| FR-02-24 | Each negative case shall specify the expected error message/behavior | P0 |

##### Edge Cases
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-30 | Empty state test when data display context detected | P0 |
| FR-02-31 | Special characters input (Unicode, HTML entities, emoji) | P0 |
| FR-02-32 | Maximum length input per text field | P0 |
| FR-02-33 | Double-click/double-submit prevention | P1 |
| FR-02-34 | Network timeout handling | P1 |
| FR-02-35 | Browser back button after form submission | P1 |

##### Boundary Value Analysis
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-40 | Numeric boundaries: 0, -1, 0.01, max int (2147483647) | P0 |
| FR-02-41 | Date boundaries: epoch, Y2K, far future, today | P0 |
| FR-02-42 | String length boundaries: 1, 255, 256 characters | P0 |
| FR-02-43 | Pagination boundary: exact page size, page +1 | P1 |

##### Security Test Cases
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-50 | XSS attack via text input fields | P0 |
| FR-02-51 | SQL injection via search/form fields | P0 |
| FR-02-52 | Authentication bypass (direct URL access) | P0 |
| FR-02-53 | CSRF protection validation | P1 |
| FR-02-54 | Malicious file upload (wrong MIME type, oversized) | P1 |
| FR-02-55 | Horizontal privilege escalation (IDOR) | P0 |
| FR-02-56 | Session fixation and token exposure (thorough mode) | P2 |
| FR-02-57 | Stored XSS via attribute injection (thorough mode) | P2 |
| FR-02-58 | Each security case shall reference OWASP Top 10 category | P1 |

#### 3.2.3 Test Case Structure
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02-60 | Each test case shall have: id, category, title, description, preconditions, steps, expectedResult, priority, tags | P0 |
| FR-02-61 | Each step shall have: stepNumber, action, expectedResult (optional), testData (optional) | P0 |
| FR-02-62 | Priority levels: critical, high, medium, low | P0 |
| FR-02-63 | Tags shall include: category, feature-specific, and OWASP references | P1 |

### 3.3 FR-03: Gherkin Conversion

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-03-01 | All generated test cases shall be converted to a single Gherkin feature file per story | P0 |
| FR-03-02 | Feature header shall include: story key, summary, As a/I want/So that narrative | P0 |
| FR-03-03 | Common preconditions shall be extracted into Background section | P1 |
| FR-03-04 | Test cases with data variations shall use Scenario Outline + Examples table | P1 |
| FR-03-05 | Scenarios shall be organized by category with section comments | P0 |
| FR-03-06 | Each scenario shall have category tag, priority tag, and feature tags | P0 |
| FR-03-07 | Gherkin shall follow proper Given/When/Then step structure | P0 |
| FR-03-08 | Generated features shall be auto-saved as BDDFeature records in the database | P0 |

### 3.4 FR-04: Playwright Code Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04-01 | System shall generate Playwright test code from parsed Gherkin features | P0 |
| FR-04-02 | Generated code shall use Playwright Test API (@playwright/test) | P0 |
| FR-04-03 | Step library entries shall be injected for matching step patterns | P1 |
| FR-04-04 | Generated code shall include proper page navigation, form filling, and assertion patterns | P0 |
| FR-04-05 | Code shall support chromium, firefox, and webkit browsers | P0 |

### 3.5 FR-05: Workflow Pipeline Execution

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-05-01 | System shall execute the 5-step pipeline asynchronously | P0 |
| FR-05-02 | Each step shall update progress (0-100%) and current step description | P0 |
| FR-05-03 | Real-time progress shall be streamed via Server-Sent Events (SSE) | P0 |
| FR-05-04 | Pipeline status transitions: pending → fetching_jira → analyzing → generating_testcases → converting_gherkin → generating_playwright → executing → completed/failed | P0 |
| FR-05-05 | Pipeline configuration shall be sanitized (no secrets) before database storage | P0 |
| FR-05-06 | Failed pipelines shall record error message and mark as failed | P0 |
| FR-05-07 | Users shall be able to list their pipeline run history | P0 |
| FR-05-08 | Optional auto-execute: run generated Playwright tests immediately | P1 |

### 3.6 FR-06: Manual Input (No-Jira Mode)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-06-01 | System shall support test case generation without Jira | P0 |
| FR-06-02 | Users shall provide: summary, description, acceptance criteria (text) | P0 |
| FR-06-03 | Manual input shall produce the same test case categories as Jira-sourced stories | P0 |

---

## 4. Non-Functional Requirements

### 4.1 Performance
| ID | Requirement |
|----|-------------|
| NFR-01 | Rule-based generation shall complete within 2 seconds per story |
| NFR-02 | AI-powered generation shall complete within 30 seconds per story |
| NFR-03 | Full pipeline for 10 stories shall complete within 5 minutes |
| NFR-04 | SSE streaming shall have <500ms latency for progress updates |

### 4.2 Security
| ID | Requirement |
|----|-------------|
| NFR-05 | Jira API tokens shall never be returned to the frontend |
| NFR-06 | Jira API tokens shall not be stored in workflow run result records |
| NFR-07 | AI provider API keys shall not be persisted to disk |
| NFR-08 | All endpoints (except SSE streams) shall require JWT authentication |
| NFR-09 | Multi-tenant isolation: users can only access their own data |

### 4.3 Reliability
| ID | Requirement |
|----|-------------|
| NFR-10 | AI generation failures shall gracefully fall back to rule-based |
| NFR-11 | Jira API errors shall provide meaningful error messages |
| NFR-12 | Pipeline failures shall not lose partial results already generated |

### 4.4 Scalability
| ID | Requirement |
|----|-------------|
| NFR-13 | System shall handle epics with up to 200 stories |
| NFR-14 | System shall handle up to 5 concurrent pipeline executions |

---

## 5. API Specification

### 5.1 Jira Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/epic-pipeline/jira/test-connection` | Test Jira credentials |
| POST | `/api/epic-pipeline/jira/save-config` | Save Jira configuration |
| GET | `/api/epic-pipeline/jira/config` | Get saved config (no token) |
| GET | `/api/epic-pipeline/jira/projects` | List Jira projects |
| GET | `/api/epic-pipeline/jira/epics/:projectKey` | List epics for project |
| GET | `/api/epic-pipeline/jira/epic/:epicKey` | Get epic with all stories |
| POST | `/api/epic-pipeline/jira/search` | Search issues by JQL |

### 5.2 Test Case Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/epic-pipeline/generate` | Generate from manual input |
| POST | `/api/epic-pipeline/generate-from-jira` | Generate from Jira story key |

### 5.3 Pipeline Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/epic-pipeline/run` | Start full pipeline |
| GET | `/api/epic-pipeline/runs` | List pipeline runs |
| GET | `/api/epic-pipeline/runs/:id` | Get pipeline run details |
| GET | `/api/epic-pipeline/runs/:id/stream` | SSE progress stream |

### 5.4 Request/Response Examples

#### Start Pipeline
```json
POST /api/epic-pipeline/run
{
  "epicKey": "PROJ-100",
  "categories": ["positive", "negative", "edge", "boundary", "security"],
  "maxCasesPerCategory": 5,
  "securityDepth": "thorough",
  "aiProvider": "none",
  "applicationContext": "web application",
  "autoCreateFeatures": true,
  "autoExecute": false
}

Response 201:
{
  "success": true,
  "data": { "id": "cm...", "status": "pending" }
}
```

#### Generate from Manual Input
```json
POST /api/epic-pipeline/generate
{
  "summary": "User login with email and password",
  "description": "Users should be able to login using their registered email and password",
  "acceptanceCriteria": [
    "Given user is on login page, When user enters valid credentials, Then user is redirected to dashboard",
    "Given user enters wrong password, Then error message is shown",
    "Given user account is locked, Then login is rejected"
  ],
  "options": {
    "categories": ["positive", "negative", "edge", "boundary", "security"],
    "maxCasesPerCategory": 5,
    "securityDepth": "thorough"
  }
}
```

---

## 6. Database Schema

### 6.1 New Models

```prisma
model JiraConfig {
  id             String   @id @default(cuid())
  userId         String
  organizationId String?
  config         Json     // { baseUrl, email, apiToken, apiVersion }
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([userId, organizationId])
}

model WorkflowRun {
  id              String    @id @default(cuid())
  userId          String
  organizationId  String?
  status          String    @default("pending")
  config          Json      // Sanitized WorkflowConfig
  totalStories    Int       @default(0)
  totalTestCases  Int       @default(0)
  categoryCounts  Json      @default("{}")
  progress        Int       @default(0)
  currentStep     String    @default("Initializing...")
  results         Json?     // Aggregated results
  startedAt       DateTime?
  completedAt     DateTime?
  error           String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

### 6.2 Existing Models Used
- `BDDFeature` — Auto-generated Gherkin features are saved here
- `BDDScenario` — Individual scenarios within features
- `BDDStep` — Steps within scenarios
- `BDDRun` — Test execution results

---

## 7. Test Case Generation Examples

### 7.1 Input Story
```
Key: AUTH-42
Summary: User login with email and password
Description: As a registered user, I want to login with my email and password so that I can access my dashboard.
Acceptance Criteria:
  1. Given user is on login page, When user enters valid credentials, Then user is redirected to dashboard
  2. Password field should be masked
  3. "Remember me" checkbox should persist session for 30 days
```

### 7.2 Generated Output (25 test cases across 5 categories)

#### Positive Cases (5)
| # | Title | Priority |
|---|-------|----------|
| 1 | Verify: user enters valid credentials and is redirected to dashboard | Critical |
| 2 | Verify: password field is masked | High |
| 3 | Verify: Remember me checkbox persists session for 30 days | High |
| 4 | Verify form submission with all valid fields | High |
| 5 | Verify login with valid email variations (user+tag@domain.com) | Medium |

#### Negative Cases (5)
| # | Title | Priority |
|---|-------|----------|
| 1 | Submit with empty email field | High |
| 2 | Submit with empty password field | High |
| 3 | Submit with invalid email format | High |
| 4 | Login with wrong password | Critical |
| 5 | Submit with incomplete email address | High |

#### Edge Cases (5)
| # | Title | Priority |
|---|-------|----------|
| 1 | Input with special characters in password | Medium |
| 2 | Password field with maximum length input (500+ chars) | Medium |
| 3 | Double-click on login button | High |
| 4 | Handle slow network / timeout during login | Medium |
| 5 | Browser back button after successful login | Medium |

#### Boundary Cases (5)
| # | Title | Priority |
|---|-------|----------|
| 1 | Password with single character (1 char) | High |
| 2 | Email at max varchar length (255 chars) | Medium |
| 3 | Email at one beyond limit (256 chars) | Medium |
| 4 | Login at session expiry boundary (30 day mark) | Medium |
| 5 | Password at minimum length policy boundary | High |

#### Security Cases (5)
| # | Title | Priority |
|---|-------|----------|
| 1 | XSS attack via email input | Critical |
| 2 | SQL injection via login form | Critical |
| 3 | Access dashboard without authentication | Critical |
| 4 | CSRF protection on login submission | High |
| 5 | Session fixation and token exposure | High |

### 7.3 Generated Gherkin (excerpt)
```gherkin
@AUTH_42 @auto-generated
Feature: User login with email and password
  As a user
  I want to user login with email and password
  So that the acceptance criteria are met

  # Story: AUTH-42
  # Priority: High

  Background:
    Given the user is logged in
    Given the user is on the application page

  # ============================================================
  # POSITIVE TEST CASES
  # ============================================================

  @positive @happy-path @smoke @critical
  Scenario: Verify: user enters valid credentials and is redirected to dashboard
    When Navigate to login page
    When Enter valid email and password
    Then user is redirected to dashboard

  # ============================================================
  # SECURITY TEST CASES
  # ============================================================

  @security @xss @owasp-a7 @critical
  Scenario: XSS attack via text input
    When Navigate to the form
    And Enter XSS payload in text field
    And Submit the form
    And View the saved/displayed data
    Then Script is NOT executed. Input is either rejected, escaped, or sanitized.
```

---

## 8. Implementation Files

### 8.1 Backend Services (New)

| File | Purpose |
|------|---------|
| `backend/src/services/bdd/jira.service.ts` | Jira REST API integration, ADF parsing, AC extraction |
| `backend/src/services/bdd/testCaseGenerator.service.ts` | AI + rule-based test case generation engine |
| `backend/src/services/bdd/workflowOrchestrator.service.ts` | Pipeline orchestration, progress tracking, SSE events |

### 8.2 API Layer (New)

| File | Purpose |
|------|---------|
| `backend/src/controllers/epicPipeline.controller.ts` | Request handling for all pipeline endpoints |
| `backend/src/routes/epicPipeline.routes.ts` | Route registration under `/api/epic-pipeline` |

### 8.3 Database (Updated)

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Added `JiraConfig` and `WorkflowRun` models |

### 8.4 Frontend (New)

| File | Purpose |
|------|---------|
| `frontend/src/components/EpicPipeline.tsx` | Full workflow UI component |
| `frontend/src/components/EpicPipeline.css` | Styling for the pipeline UI |

### 8.5 Existing Services (Reused)

| File | Reused For |
|------|-----------|
| `backend/src/services/bdd/bdd.service.ts` | Gherkin parsing, Playwright code generation, test execution |
| `backend/src/services/bdd/testCaseConverter.service.ts` | Text-to-Gherkin conversion (CSV/structured/plain) |
| `backend/src/services/bdd/serenityReport.service.ts` | HTML report generation |

---

## 9. User Interface

### 9.1 Pipeline Step Indicator
Visual 5-step progress bar showing: Pick Epic → Analyze Stories → Generate Cases → Gherkin → Playwright

### 9.2 Tabs
1. **Configure** — Jira setup OR manual input, generation options
2. **Generate** — Same as Configure (combined view)
3. **Results** — Generated test cases by category, Gherkin preview
4. **History** — Past pipeline runs with status

### 9.3 Configuration Panel
- **Jira Mode**: Base URL, Email, API Token, Project/Epic selection
- **Manual Mode**: Summary, Description, Acceptance Criteria (textarea)
- **Options**: Category toggles, max cases, security depth, AI provider, app context

### 9.4 Results View
- Stats cards: total cases, per-category counts
- Category filter badges (positive/negative/edge/boundary/security)
- Test case table: title, priority, steps, expected result
- Gherkin feature preview with syntax highlighting

---

## 10. Future Enhancements

| Enhancement | Description | Priority |
|-------------|-------------|----------|
| **Jira Defect Creation** | Auto-create Jira bugs from failed test results | P2 |
| **Jira Test Sync** | Sync test cases back to Jira (Xray/Zephyr plugin) | P2 |
| **Allure-Jira Linking** | Link Allure reports to Jira issues | P2 |
| **Test Case Versioning** | Track changes to generated test cases across runs | P3 |
| **Coverage Matrix** | Map test cases to acceptance criteria (traceability) | P2 |
| **Bulk Sprint Processing** | Process all stories in a sprint in one click | P2 |
| **Custom Security Payloads** | User-defined security test payloads library | P3 |
| **Performance Test Cases** | Generate load/stress test scenarios | P3 |
| **Accessibility Test Cases** | WCAG compliance test generation | P3 |
| **Test Case Review Workflow** | Approval flow before execution | P3 |

---

## 11. Appendix: Test Case Category Taxonomy

```
Test Cases
├── Positive (Happy Path)
│   ├── AC Verification (1 per acceptance criterion)
│   ├── Valid Data Submission
│   └── Data-Driven Variations (Scenario Outline)
│
├── Negative (Error Paths)
│   ├── Required Field Empty
│   ├── Invalid Format (email, phone, URL, date)
│   ├── Wrong Credentials
│   └── Unauthorized Access
│
├── Edge Cases
│   ├── Empty State (no data)
│   ├── Special Characters (Unicode, HTML, emoji)
│   ├── Maximum Length Input
│   ├── Double Submit
│   ├── Network Timeout
│   └── Browser Back Navigation
│
├── Boundary Value Analysis
│   ├── Numeric: 0, -1, 0.01, MAX_INT
│   ├── Dates: epoch, Y2K, future, today
│   ├── Strings: 1 char, 255 chars, 256 chars
│   └── Pagination: exact page size
│
└── Security (OWASP)
    ├── A3: SQL Injection
    ├── A2: Authentication Bypass
    ├── A1: IDOR (Privilege Escalation)
    ├── A5: CSRF
    ├── A7: XSS (Reflected + Stored)
    ├── A8: File Upload Exploits
    └── Session Fixation
```
