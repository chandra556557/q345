# BDD Cucumber Framework - Architecture & Implementation Document

## Table of Contents
1. [Overview](#overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Technology Stack](#technology-stack)
4. [System Architecture](#system-architecture)
5. [Database Design](#database-design)
6. [Backend Architecture](#backend-architecture)
7. [Frontend Architecture](#frontend-architecture)
8. [Execution Pipeline](#execution-pipeline)
9. [Real-Time Streaming (SSE)](#real-time-streaming-sse)
10. [Serenity Report Engine](#serenity-report-engine)
11. [Screenplay Pattern](#screenplay-pattern)
12. [Multi-Tenancy](#multi-tenancy)
13. [API Reference](#api-reference)
14. [File Structure](#file-structure)
15. [Data Flow Diagrams](#data-flow-diagrams)

---

## 1. Overview

The BDD Cucumber Framework is a full-stack implementation integrated into the Playwright CRX Enhanced platform. It allows users to write Gherkin-based BDD test scenarios, execute them against real browsers using Playwright, and view rich Serenity-style HTML reports — all through a modern React UI with real-time execution feedback.

### Key Capabilities

| Capability | Description |
|---|---|
| Gherkin Editor | Write and parse Feature files with live preview |
| Auto Code Generation | Convert BDD steps to Playwright test scripts |
| Browser Execution | Run tests on Chromium, Firefox, or WebKit |
| Real-Time Streaming | Live execution updates via Server-Sent Events (SSE) |
| Serenity Reports | Beautiful HTML reports with screenshots and timelines |
| Step Library | Reusable step definitions shared across org |
| Screenplay Pattern | Composable Tasks → Actions → Questions model |
| Scheduled Runs | Cron-based automated execution |
| Multi-Tenancy | Organization-scoped isolation |
| Parallel Execution | Configurable worker-based parallelism |
| Concurrency Control | Max 3 concurrent runs with queuing |

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + TypeScript)                 │
│                                                                      │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Feature     │  │  Runs    │  │ Step Library │  │  Schedules   │ │
│  │  Editor Tab  │  │  Tab     │  │    Tab       │  │    Tab       │ │
│  │             │  │          │  │              │  │              │ │
│  │ ┌─────────┐ │  │ Run Cards│  │ Pattern CRUD │  │ Cron Config  │ │
│  │ │ Gherkin │ │  │ SSE Live │  │ Code Editor  │  │ Enable/Disable│ │
│  │ │ Editor  │ │  │ Progress │  │ Usage Stats  │  │ Manual Trigger│ │
│  │ ├─────────┤ │  │ Reports  │  │              │  │              │ │
│  │ │ Preview │ │  │ Cancel   │  │              │  │              │ │
│  │ │ Panel   │ │  │          │  │              │  │              │ │
│  │ └─────────┘ │  │          │  │              │  │              │ │
│  └──────┬──────┘  └────┬─────┘  └──────┬───────┘  └──────┬───────┘ │
│         │              │               │                  │         │
└─────────┼──────────────┼───────────────┼──────────────────┼─────────┘
          │    Axios HTTP│       SSE     │                  │
          ▼              ▼               ▼                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     API GATEWAY (Express.js)                         │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────────────────────────────┐ │
│  │  Auth Middleware  │  │  Tenant Middleware (Organization Scope)  │ │
│  └────────┬─────────┘  └────────────────┬────────────────────────┘ │
│           ▼                              ▼                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    /api/bdd/* Routes                          │   │
│  │                                                              │   │
│  │  /features  /runs  /step-library  /schedules  /parse  /status│   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    CONTROLLER LAYER                                   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  bdd.controller.ts                            │   │
│  │                                                              │   │
│  │  createFeature()    runFeature()     getStepLibrary()        │   │
│  │  getFeatures()      getRuns()        createStepEntry()       │   │
│  │  updateFeature()    cancelRun()      getSchedules()          │   │
│  │  deleteFeature()    deleteRun()      createSchedule()        │   │
│  │  parseFeature()     streamRun()      generateCode()          │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                                    │
│                                                                      │
│  ┌────────────────────┐ ┌──────────────────┐ ┌───────────────────┐  │
│  │   bdd.service.ts   │ │screenplay.service│ │serenityReport.svc │  │
│  │                    │ │       .ts        │ │       .ts         │  │
│  │ • Gherkin Parser   │ │                  │ │                   │  │
│  │ • Code Generator   │ │ • Task CRUD      │ │ • HTML Generation │  │
│  │ • Execution Engine │ │ • Action CRUD    │ │ • Donut Charts    │  │
│  │ • Concurrency Ctrl │ │ • Question CRUD  │ │ • Timeline Viz    │  │
│  │ • SSE Emitter      │ │ • Code Gen       │ │ • Screenshot Embed│  │
│  │ • Step Library     │ │ • Step Def Gen   │ │ • Syntax Highlight│  │
│  │ • Schedule Mgmt    │ │ • Preset Library │ │ • Print Support   │  │
│  │ • Screenshot Mgmt  │ │                  │ │                   │  │
│  └────────┬───────────┘ └────────┬─────────┘ └────────┬──────────┘  │
└───────────┼──────────────────────┼─────────────────────┼────────────┘
            │                      │                     │
            ▼                      ▼                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    DATA LAYER (Prisma ORM)                            │
│                                                                      │
│  ┌────────────┐ ┌────────────┐ ┌─────────┐ ┌──────────────────────┐│
│  │ BDDFeature │ │ BDDScenario│ │ BDDStep │ │      BDDRun          ││
│  │            │◄┤            │◄┤         │ │                      ││
│  │ name       │ │ name       │ │ keyword │ │ status    duration   ││
│  │ content    │ │ type       │ │ text    │ │ steps     errorMsg   ││
│  │ tags       │ │ tags       │ │ dataTable│ │ screenshots          ││
│  │ status     │ │ examples   │ │ docString│ │ reportUrl            ││
│  └────────────┘ └────────────┘ └─────────┘ └──────────────────────┘│
│  ┌──────────────┐ ┌────────────┐ ┌────────────────────────────────┐│
│  │BDDStepLibrary│ │BDDSchedule │ │ Screenplay (Task/Action/Q)    ││
│  │              │ │            │ │                                ││
│  │ pattern      │ │ cron       │ │ ScreenplayTask                ││
│  │ keyword      │ │ enabled    │ │ ScreenplayAction              ││
│  │ code         │ │ browser    │ │ ScreenplayQuestion             ││
│  │ usageCount   │ │ nextRunAt  │ │                                ││
│  └──────────────┘ └────────────┘ └────────────────────────────────┘│
│                                                                      │
│                      PostgreSQL Database                             │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    EXECUTION ENGINE                                   │
│                                                                      │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────────────┐  │
│  │ Child Process│───▶│  Playwright   │───▶│  Browser Instance    │  │
│  │ Manager      │    │  + Cucumber   │    │  (Chromium/FF/WebKit)│  │
│  │              │    │               │    │                      │  │
│  │ • Spawn      │    │ • Feature File│    │ • Navigate           │  │
│  │ • Kill       │    │ • Step Defs   │    │ • Click              │  │
│  │ • Monitor    │    │ • Config      │    │ • Fill               │  │
│  │              │    │               │    │ • Assert             │  │
│  └──────────────┘    └───────────────┘    └──────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               Output Artifacts                                │   │
│  │                                                              │   │
│  │  📁 playwright-crx-reports/                                   │   │
│  │  ├── bdd-{runId}/index.html      (Serenity Report)           │   │
│  │  └── bdd-artifacts/              (Screenshots)               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18 + TypeScript | UI Components |
| Frontend | Axios | HTTP Client |
| Frontend | EventSource API | SSE Streaming |
| Frontend | CSS3 (Custom) | Styling & Themes |
| Backend | Node.js + Express.js | REST API Server |
| Backend | TypeScript | Type Safety |
| Backend | Prisma ORM | Database Access |
| Database | PostgreSQL | Persistent Storage |
| Testing | Playwright | Browser Automation |
| Testing | Cucumber/Gherkin | BDD Syntax |
| Reporting | Custom HTML Generator | Serenity-style Reports |
| Auth | JWT | Authentication |
| Real-time | Server-Sent Events | Live Updates |

---

## 4. System Architecture

### 4.1 Layered Architecture

```
┌─────────────────────────────────────────┐
│           Presentation Layer             │
│     (React Components + CSS)            │
├─────────────────────────────────────────┤
│           API Layer                      │
│     (Express Routes + Middleware)        │
├─────────────────────────────────────────┤
│           Controller Layer               │
│     (Request Handling + Validation)      │
├─────────────────────────────────────────┤
│           Service Layer                  │
│  (Business Logic + Execution Engine)    │
├─────────────────────────────────────────┤
│           Data Access Layer              │
│     (Prisma ORM + Migrations)           │
├─────────────────────────────────────────┤
│           Database Layer                 │
│     (PostgreSQL)                        │
└─────────────────────────────────────────┘
```

### 4.2 Component Interaction

```
User ──▶ React UI ──▶ Axios ──▶ Express API ──▶ Controller ──▶ Service ──▶ Prisma ──▶ PostgreSQL
                        ▲                                         │
                        │                                         ▼
                   SSE Stream ◀──────────── EventEmitter ◀── Child Process (Playwright)
```

---

## 5. Database Design

### 5.1 Entity Relationship Diagram

```
┌──────────────┐       ┌───────────────┐       ┌──────────────┐
│    User      │       │ Organization  │       │   Project    │
│──────────────│       │───────────────│       │──────────────│
│ id (PK)      │       │ id (PK)       │       │ id (PK)      │
│ email        │       │ name          │       │ name         │
│ password     │       │ slug          │       │              │
└──────┬───────┘       └───────┬───────┘       └──────┬───────┘
       │                       │                      │
       │    ┌──────────────────┼──────────────────────┘
       │    │                  │
       ▼    ▼                  ▼
┌──────────────────────────────────────┐
│           BDDFeature                  │
│──────────────────────────────────────│
│ id            (UUID PK)              │
│ userId        (FK → User)            │
│ organizationId(FK → Organization)    │
│ projectId     (FK → Project)         │
│ name          (VARCHAR 255)          │
│ description   (TEXT)                 │
│ featureContent(TEXT - Gherkin)        │
│ tags          (JSONB)                │
│ status        (draft|active|archived)│
│ createdAt     (TIMESTAMP)            │
│ updatedAt     (TIMESTAMP)            │
└──────────┬───────────────────────────┘
           │ 1:N
           ▼
┌──────────────────────────────────────┐
│          BDDScenario                  │
│──────────────────────────────────────│
│ id            (UUID PK)              │
│ featureId     (FK → BDDFeature)      │
│ name          (VARCHAR 255)          │
│ scenarioType  (Scenario|Outline)     │
│ description   (TEXT)                 │
│ tags          (JSONB)                │
│ examplesData  (JSONB)                │
│ sortOrder     (INT)                  │
│ createdAt     (TIMESTAMP)            │
│ updatedAt     (TIMESTAMP)            │
└──────────┬───────────────────────────┘
           │ 1:N
           ▼
┌──────────────────────────────────────┐
│            BDDStep                    │
│──────────────────────────────────────│
│ id            (UUID PK)              │
│ scenarioId    (FK → BDDScenario)     │
│ keyword       (Given|When|Then|And)  │
│ text          (TEXT)                 │
│ dataTable     (JSONB)                │
│ docString     (TEXT)                 │
│ stepDefinition(TEXT - Playwright)     │
│ sortOrder     (INT)                  │
│ createdAt     (TIMESTAMP)            │
│ updatedAt     (TIMESTAMP)            │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│            BDDRun                     │
│──────────────────────────────────────│
│ id            (UUID PK)              │
│ featureId     (FK → BDDFeature)      │
│ scenarioId    (FK → BDDScenario)     │
│ userId        (FK → User)            │
│ organizationId(FK → Organization)    │
│ status        (pending|running|      │
│                passed|failed|cancel) │
│ duration      (INT ms)               │
│ totalSteps    (INT)                  │
│ passedSteps   (INT)                  │
│ failedSteps   (INT)                  │
│ skippedSteps  (INT)                  │
│ errorMsg      (TEXT)                 │
│ browser       (VARCHAR)              │
│ executionMode (VARCHAR)              │
│ reportUrl     (VARCHAR)              │
│ screenshotUrls(JSONB)                │
│ tags          (VARCHAR)              │
│ parallelWorkers(INT)                 │
│ startedAt     (TIMESTAMP)            │
│ completedAt   (TIMESTAMP)            │
│ createdAt     (TIMESTAMP)            │
│ updatedAt     (TIMESTAMP)            │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│         BDDStepLibrary                │
│──────────────────────────────────────│
│ id            (UUID PK)              │
│ userId        (FK → User)            │
│ organizationId(FK → Organization)    │
│ pattern       (VARCHAR 500 - regex)  │
│ code          (TEXT - Playwright)     │
│ keyword       (Given|When|Then)      │
│ description   (TEXT)                 │
│ tags          (JSONB)                │
│ usageCount    (INT default 0)        │
│ createdAt     (TIMESTAMP)            │
│ updatedAt     (TIMESTAMP)            │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│          BDDSchedule                  │
│──────────────────────────────────────│
│ id            (UUID PK)              │
│ featureId     (FK → BDDFeature)      │
│ userId        (FK → User)            │
│ organizationId(FK → Organization)    │
│ cronExpression(VARCHAR 100)          │
│ tags          (VARCHAR)              │
│ browser       (VARCHAR)              │
│ executionMode (VARCHAR)              │
│ enabled       (BOOLEAN default true) │
│ lastRunAt     (TIMESTAMP)            │
│ nextRunAt     (TIMESTAMP)            │
│ createdAt     (TIMESTAMP)            │
│ updatedAt     (TIMESTAMP)            │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐     ┌──────────────────────┐
│        ScreenplayTask                 │     │  ScreenplayAction    │
│──────────────────────────────────────│     │──────────────────────│
│ id            (UUID PK)              │ 1:N │ id        (UUID PK)  │
│ userId        (FK → User)            │────▶│ taskId    (FK)       │
│ organizationId(FK → Organization)    │     │ actionType(ENUM)     │
│ name          (VARCHAR 255)          │     │ target    (VARCHAR)  │
│ description   (TEXT)                 │     │ value     (VARCHAR)  │
│ code          (TEXT)                 │     │ code      (TEXT)     │
│ tags          (JSONB)                │     │ sortOrder (INT)      │
│ createdAt     (TIMESTAMP)            │     └──────────────────────┘
│ updatedAt     (TIMESTAMP)            │
│                                      │     ┌──────────────────────┐
│                                      │     │ ScreenplayQuestion   │
│                                      │ 1:N │──────────────────────│
│                                      │────▶│ id        (UUID PK)  │
│                                      │     │ taskId    (FK)       │
│                                      │     │ questionType(ENUM)   │
│                                      │     │ target    (VARCHAR)  │
│                                      │     │ expected  (VARCHAR)  │
│                                      │     │ code      (TEXT)     │
│                                      │     │ sortOrder (INT)      │
└──────────────────────────────────────┘     └──────────────────────┘
```

### 5.2 Migration Files

| Migration | File | Purpose |
|---|---|---|
| 012 | `012_create_bdd_tables.sql` | BDDFeature, BDDScenario, BDDStep, BDDRun tables |
| 013 | `013_bdd_enhancements.sql` | BDDStepLibrary, BDDSchedule, BDDRun extensions |
| 014 | `014_create_screenplay_tables.sql` | ScreenplayTask, ScreenplayAction, ScreenplayQuestion |

---

## 6. Backend Architecture

### 6.1 Service Layer Design

```
┌─────────────────────────────────────────────────────────────┐
│                    bdd.service.ts                             │
│─────────────────────────────────────────────────────────────│
│                                                             │
│  ┌─────────────────┐   ┌──────────────────┐                │
│  │  PARSER MODULE  │   │  GENERATOR MODULE│                │
│  │                 │   │                  │                │
│  │ parseFeature()  │──▶│ generateCode()   │                │
│  │                 │   │                  │                │
│  │ Extract:        │   │ Produce:         │                │
│  │ • Feature name  │   │ • Playwright     │                │
│  │ • Scenarios     │   │   test script    │                │
│  │ • Steps         │   │ • Page actions   │                │
│  │ • Tags          │   │ • Assertions     │                │
│  │ • Data tables   │   │                  │                │
│  └─────────────────┘   └──────────────────┘                │
│                                                             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              EXECUTION ENGINE                     │       │
│  │                                                   │       │
│  │  executeFeature()                                 │       │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │       │
│  │  │ Write   │  │ Inject   │  │ Spawn Child    │  │       │
│  │  │ Feature │─▶│ Step     │─▶│ Process        │  │       │
│  │  │ to Temp │  │ Defs     │  │ (Playwright)   │  │       │
│  │  └─────────┘  └──────────┘  └───────┬────────┘  │       │
│  │                                      │           │       │
│  │  ┌─────────┐  ┌──────────┐  ┌───────▼────────┐  │       │
│  │  │ Update  │  │ Generate │  │ Parse Output   │  │       │
│  │  │ Database│◀─│ Report   │◀─│ & Screenshots  │  │       │
│  │  └─────────┘  └──────────┘  └────────────────┘  │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  ┌─────────────────┐   ┌──────────────────┐                │
│  │  CONCURRENCY    │   │  SSE STREAMING   │                │
│  │                 │   │                  │                │
│  │ MAX_CONCURRENT=3│   │ EventEmitter     │                │
│  │ MAX_QUEUED=20   │   │ • run:started    │                │
│  │ activeRuns Map  │   │ • step:passed    │                │
│  │ processMap      │   │ • step:failed    │                │
│  └─────────────────┘   │ • run:completed  │                │
│                         └──────────────────┘                │
│  ┌─────────────────┐   ┌──────────────────┐                │
│  │  STEP LIBRARY   │   │  SCHEDULE MGR    │                │
│  │                 │   │                  │                │
│  │ CRUD operations │   │ CRUD operations  │                │
│  │ Org-scoped      │   │ Cron parsing     │                │
│  │ Usage tracking  │   │ Enable/Disable   │                │
│  └─────────────────┘   └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Gherkin Parser Flow

```
Raw Gherkin Input                    Parsed Output
─────────────────                    ─────────────

Feature: Login                  ──▶  { name: "Login",
  As a user                            description: "...",
  I want to login                      tags: ["@smoke"],
                                       scenarios: [
  @smoke                                 {
  Scenario: Valid Login                    name: "Valid Login",
    Given I am on login page               type: "Scenario",
    When I enter "admin"                   steps: [
    And I enter "pass123"                    { keyword: "Given", text: "I am on login page" },
    Then I see the dashboard                 { keyword: "When", text: "I enter \"admin\"" },
                                             { keyword: "And", text: "I enter \"pass123\"" },
  Scenario Outline: Roles                    { keyword: "Then", text: "I see the dashboard" }
    Given I login as "<role>"              ]
    Then I see "<page>"                  },
                                         {
    Examples:                              name: "Roles",
      | role  | page      |               type: "Scenario Outline",
      | admin | dashboard |               steps: [...],
      | user  | home      |               examples: [
                                             { role: "admin", page: "dashboard" },
                                             { role: "user", page: "home" }
                                           ]
                                         }
                                       ]
                                     }
```

### 6.3 Playwright Code Generation

```
BDD Step                              Generated Playwright Code
────────                              ─────────────────────────

Given I am on login page         ──▶  await page.goto('login-url');

When I enter "admin" in username ──▶  await page.getByLabel('username').fill('admin');

When I click the "Submit" button ──▶  await page.getByRole('button', { name: 'Submit' }).click();

Then I see the dashboard         ──▶  await expect(page).toHaveURL(/dashboard/);

Then I see text "Welcome"        ──▶  await expect(page.getByText('Welcome')).toBeVisible();
```

---

## 7. Frontend Architecture

### 7.1 Component Tree

```
<App>
  └── <BDDTesting>                          ← Main Container
      ├── Tab Navigation
      │   ├── [Features] [Runs] [Step Library] [Schedules]
      │
      ├── <FeaturesTab>                     ← Tab 1
      │   ├── <FeatureEditorSection>
      │   │   ├── <GherkinEditor>           ← Left Panel (textarea)
      │   │   │   └── Monospace, dark theme, syntax highlighting
      │   │   └── <ParsePreview>            ← Right Panel
      │   │       └── <ScenarioTree>
      │   │           ├── Feature Name
      │   │           ├── Scenario → Steps (Given/When/Then)
      │   │           └── Scenario Outline → Steps + Examples
      │   ├── <FeatureForm>
      │   │   ├── Name Input
      │   │   ├── Description Input
      │   │   ├── Tags Input
      │   │   ├── Project Selector
      │   │   └── Status Selector
      │   ├── <ActionButtons>
      │   │   ├── [Create] [Update] [Delete] [Run]
      │   │   └── <ExecutionOptions> (browser, mode, tags, workers)
      │   └── <FeatureList>
      │       └── <FeatureCard> × N
      │           ├── Name, Description, Tags
      │           ├── Scenario Count, Run Count
      │           └── Status Badge
      │
      ├── <RunsTab>                         ← Tab 2
      │   └── <RunCard> × N
      │       ├── Feature Name
      │       ├── Status Badge (pending|running|passed|failed)
      │       ├── <ProgressBar> (passed/failed/skipped)
      │       ├── Duration, Browser, Mode
      │       ├── Step Results List
      │       │   └── <StepResult> (icon + keyword + text + duration)
      │       ├── Error Message (if failed)
      │       ├── Screenshot Thumbnails
      │       └── [View Report] [Cancel] [Delete]
      │
      ├── <StepLibraryTab>                  ← Tab 3
      │   ├── <CreateStepForm>
      │   │   ├── Pattern Input (regex)
      │   │   ├── Keyword Dropdown (Given/When/Then)
      │   │   ├── Code Editor (monospace)
      │   │   ├── Description Input
      │   │   └── Tags Input
      │   └── <StepEntryList>
      │       └── <StepEntry> × N
      │           ├── Pattern, Keyword Badge, Usage Count
      │           └── [Edit] [Delete]
      │
      └── <SchedulesTab>                    ← Tab 4
          ├── <CreateScheduleForm>
          │   ├── Feature Dropdown
          │   ├── Cron Expression Input
          │   ├── Browser Selector
          │   ├── Mode Selector
          │   └── Tags Input
          └── <ScheduleList>
              └── <ScheduleEntry> × N
                  ├── Feature Name, Cron, Browser
                  ├── Next Run / Last Run
                  ├── Enabled Toggle
                  └── [Edit] [Delete] [Run Now]
```

### 7.2 State Management

```typescript
// Core State (React useState)
interface BDDTestingState {
  // Tab
  activeTab: 'features' | 'runs' | 'step-library' | 'schedules';

  // Features
  features: BDDFeature[];
  selectedFeature: BDDFeature | null;
  featureContent: string;          // Gherkin editor content
  parsedPreview: ParsedFeature;    // Live parse result

  // Runs
  runs: BDDRun[];
  activeStreams: Map<string, EventSource>;  // SSE connections

  // Step Library
  stepLibrary: StepLibEntry[];

  // Schedules
  schedules: BDDSchedule[];

  // UI State
  loading: boolean;
  error: string | null;
}
```

### 7.3 TypeScript Interfaces

```typescript
interface BDDFeature {
  id: string;
  name: string;
  description: string;
  featureContent: string;
  tags: string[];
  status: 'draft' | 'active' | 'archived';
  scenarios: BDDScenario[];
  runs: BDDRun[];
  createdAt: string;
  updatedAt: string;
}

interface BDDScenario {
  id: string;
  name: string;
  scenarioType: 'Scenario' | 'Scenario Outline';
  tags: string[];
  examplesData: Record<string, string>[];
  steps: BDDStep[];
  sortOrder: number;
}

interface BDDStep {
  id: string;
  keyword: 'Given' | 'When' | 'Then' | 'And' | 'But';
  text: string;
  dataTable?: any[][];
  docString?: string;
  stepDefinition?: string;
  sortOrder: number;
}

interface BDDRun {
  id: string;
  featureId: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
  duration: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  errorMsg?: string;
  browser: string;
  executionMode: string;
  reportUrl?: string;
  screenshotUrls: string[];
  parallelWorkers?: number;
  startedAt: string;
  completedAt?: string;
}

interface StepLibEntry {
  id: string;
  pattern: string;
  keyword: string;
  code: string;
  description: string;
  tags: string[];
  usageCount: number;
}

interface BDDSchedule {
  id: string;
  featureId: string;
  cronExpression: string;
  browser: string;
  executionMode: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}
```

---

## 8. Execution Pipeline

### 8.1 Full Execution Flow

```
┌─────────┐     ┌──────────┐     ┌──────────────┐     ┌───────────────┐
│  User    │     │ Frontend │     │   Backend    │     │  Playwright   │
│  clicks  │     │          │     │              │     │  + Cucumber   │
│  "Run"   │     │          │     │              │     │               │
└────┬─────┘     └────┬─────┘     └──────┬───────┘     └───────┬───────┘
     │                │                   │                     │
     │  1. Click Run  │                   │                     │
     │───────────────▶│                   │                     │
     │                │  2. POST /run     │                     │
     │                │──────────────────▶│                     │
     │                │                   │  3. Check           │
     │                │                   │  concurrency        │
     │                │                   │  (max 3)            │
     │                │                   │                     │
     │                │                   │  4. Create BDDRun   │
     │                │                   │  status=pending     │
     │                │                   │                     │
     │                │  5. Return runId  │                     │
     │                │◀──────────────────│                     │
     │                │                   │                     │
     │                │  6. Connect SSE   │                     │
     │                │──────────────────▶│                     │
     │                │                   │  7. Write feature   │
     │                │                   │  to temp dir        │
     │                │                   │                     │
     │                │                   │  8. Inject step     │
     │                │                   │  definitions        │
     │                │                   │                     │
     │                │                   │  9. Spawn process   │
     │                │                   │──────────────────▶  │
     │                │                   │                     │
     │                │                   │  10. Update status  │
     │                │                   │  status=running     │
     │                │                   │                     │
     │                │  11. SSE: started │                     │
     │                │◀──────────────────│                     │
     │  Live update   │                   │                     │
     │◀───────────────│                   │                     │
     │                │                   │     12. Execute     │
     │                │                   │     steps           │
     │                │                   │◀────────────────── │
     │                │  13. SSE: step    │     Step result     │
     │                │◀──────────────────│                     │
     │  Progress bar  │                   │                     │
     │◀───────────────│                   │     14. Screenshot  │
     │                │                   │     on failure      │
     │                │                   │◀────────────────── │
     │                │                   │                     │
     │                │                   │  15. Parse results  │
     │                │                   │◀─────────────────── │
     │                │                   │                     │
     │                │                   │  16. Generate       │
     │                │                   │  Serenity report    │
     │                │                   │                     │
     │                │                   │  17. Update BDDRun  │
     │                │                   │  status=passed/fail │
     │                │                   │  + step counts      │
     │                │                   │  + reportUrl        │
     │                │                   │                     │
     │                │  18. SSE: done    │                     │
     │                │◀──────────────────│                     │
     │  Final result  │                   │                     │
     │◀───────────────│                   │                     │
     │                │                   │                     │
     │  19. View      │  20. GET report   │                     │
     │  Report ───────│──────────────────▶│                     │
     │                │  21. HTML file    │                     │
     │◀───────────────│◀──────────────────│                     │
```

### 8.2 Concurrency Model

```
                    Incoming Run Requests
                           │
                           ▼
                  ┌─────────────────┐
                  │ Check Active    │
                  │ Runs Count      │
                  └────────┬────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         < 3 Active   = 3 Active   Queue Full
              │            │         (> 20)
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Execute  │ │ Add to   │ │ Reject   │
        │ Directly │ │ Queue    │ │ (429)    │
        └──────────┘ └──────────┘ └──────────┘
                           │
                     When slot opens
                           │
                           ▼
                    ┌──────────┐
                    │ Dequeue  │
                    │ & Execute│
                    └──────────┘

Active Runs Map:
┌─────────┬──────────┬────────────────┐
│ Run ID  │ Process  │ Status         │
├─────────┼──────────┼────────────────┤
│ run-001 │ PID 1234 │ running        │
│ run-002 │ PID 1235 │ running        │
│ run-003 │ PID 1236 │ running        │
└─────────┴──────────┴────────────────┘
```

---

## 9. Real-Time Streaming (SSE)

### 9.1 SSE Architecture

```
┌──────────┐          ┌──────────────┐          ┌──────────────┐
│ Browser  │          │   Express    │          │ Execution    │
│ (React)  │          │   Server     │          │ Engine       │
│          │          │              │          │              │
│ EventSrc │◀── SSE ──│ /runs/:id/   │◀── Emit─│ EventEmitter │
│          │  stream  │   stream     │         │              │
│          │          │              │          │              │
│ onmessage│          │ res.write()  │          │ emit('step', │
│ handler  │          │ 'data: ...'  │          │   { ... })   │
└──────────┘          └──────────────┘          └──────────────┘
```

### 9.2 SSE Event Types

| Event | Payload | When |
|---|---|---|
| `run:started` | `{ runId, featureName, timestamp }` | Execution begins |
| `step:passed` | `{ runId, step, keyword, text, duration }` | Step passes |
| `step:failed` | `{ runId, step, keyword, text, error, screenshot }` | Step fails |
| `step:skipped` | `{ runId, step, keyword, text }` | Step skipped |
| `run:completed` | `{ runId, status, duration, totalSteps, passed, failed }` | Execution ends |
| `run:error` | `{ runId, error }` | Unexpected error |

---

## 10. Serenity Report Engine

### 10.1 Report Structure

```
┌──────────────────────────────────────────────────────────────────┐
│  🎭 Feature: User Login                          ✅ PASSED       │
│  Run ID: abc-123  |  Duration: 12.5s  |  Browser: Chromium     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📖 Narrative                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  As a registered user                                      │  │
│  │  I want to login to the application                        │  │
│  │  So that I can access my dashboard                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  📊 Summary                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ 🟢 100%  │  │ Passed:3 │  │ Failed:0 │  │ Time:12s │       │
│  │  ╭───╮   │  │          │  │          │  │          │       │
│  │  │ ● │   │  │          │  │          │  │          │       │
│  │  ╰───╯   │  │          │  │          │  │          │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                  │
│  📋 Scenarios                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ▼ Scenario: Valid Login                          ✅ Passed  │  │
│  │   ✓ Given I am on the login page           (1.2s)         │  │
│  │   ✓ When I enter valid credentials          (2.1s)         │  │
│  │   ✓ Then I see the dashboard                (0.8s)         │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ ▼ Scenario: Invalid Login                        ✅ Passed  │  │
│  │   ✓ Given I am on the login page           (0.9s)         │  │
│  │   ✓ When I enter invalid credentials        (1.5s)         │  │
│  │   ✓ Then I see an error message             (0.5s)         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  📝 Feature File                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Feature: User Login                                       │  │
│  │    As a registered user ...                                │  │
│  │    @smoke                                                  │  │
│  │    Scenario: Valid Login                                   │  │
│  │      Given I am on the login page                          │  │
│  │      When I enter valid credentials                        │  │
│  │      Then I see the dashboard                              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 10.2 Report Generation Pipeline

```
BDDRun Data ──▶ Parse Narrative ──▶ Group Steps by Scenario ──▶ Calculate Stats
                                                                      │
                                                                      ▼
HTML Output ◀── Embed CSS ◀── Build HTML Sections ◀── Generate Charts/Timelines
     │
     ▼
playwright-crx-reports/bdd-{runId}/index.html
```

---

## 11. Screenplay Pattern

### 11.1 Screenplay Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   SCREENPLAY PATTERN                     │
│                                                         │
│  "Actor performs Tasks composed of Actions & Questions" │
│                                                         │
│  ┌─────────┐                                            │
│  │  ACTOR  │ (The user/system performing actions)       │
│  └────┬────┘                                            │
│       │ performs                                         │
│       ▼                                                 │
│  ┌─────────────────────────────────────────┐           │
│  │              TASK                        │           │
│  │  "Login as Admin"                        │           │
│  │                                          │           │
│  │  composed of:                            │           │
│  │  ┌──────────────────────────────────┐   │           │
│  │  │         ACTIONS                   │   │           │
│  │  │                                   │   │           │
│  │  │  1. Navigate to /login            │   │           │
│  │  │  2. Fill username = "admin"       │   │           │
│  │  │  3. Fill password = "secret"      │   │           │
│  │  │  4. Click "Login" button          │   │           │
│  │  └──────────────────────────────────┘   │           │
│  │  ┌──────────────────────────────────┐   │           │
│  │  │        QUESTIONS                  │   │           │
│  │  │                                   │   │           │
│  │  │  1. Dashboard is visible?         │   │           │
│  │  │  2. URL contains /dashboard?      │   │           │
│  │  │  3. Welcome text displayed?       │   │           │
│  │  └──────────────────────────────────┘   │           │
│  └─────────────────────────────────────────┘           │
│                                                         │
│  Generated Step Definition:                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Given('the actor logs in as Admin', async () =>│   │
│  │    await page.goto('/login');                    │   │
│  │    await page.getByLabel('username')             │   │
│  │             .fill('admin');                      │   │
│  │    await page.getByLabel('password')             │   │
│  │             .fill('secret');                     │   │
│  │    await page.getByRole('button',                │   │
│  │             { name: 'Login' }).click();          │   │
│  │    await expect(page.locator('.dashboard'))      │   │
│  │             .toBeVisible();                      │   │
│  │  });                                             │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 11.2 Preset Libraries

**Preset Actions:**

| Action | Type | Playwright Code |
|---|---|---|
| Navigate to URL | navigation | `await page.goto(url)` |
| Click by role | interaction | `await page.getByRole(role, { name }).click()` |
| Click by text | interaction | `await page.getByText(text).click()` |
| Fill by label | input | `await page.getByLabel(label).fill(value)` |
| Fill by placeholder | input | `await page.getByPlaceholder(ph).fill(value)` |
| Select dropdown | input | `await page.selectOption(selector, value)` |
| Press key | interaction | `await page.keyboard.press(key)` |
| Upload file | input | `await page.setInputFiles(selector, path)` |
| Hover element | interaction | `await page.hover(selector)` |
| Check checkbox | interaction | `await page.getByLabel(label).check()` |

**Preset Questions:**

| Question | Type | Playwright Assertion |
|---|---|---|
| Element visible | visibility | `await expect(locator).toBeVisible()` |
| Element hidden | visibility | `await expect(locator).toBeHidden()` |
| Page title | title | `await expect(page).toHaveTitle(title)` |
| URL contains | url | `await expect(page).toHaveURL(pattern)` |
| Page has text | text | `await expect(page.getByText(text)).toBeVisible()` |
| Element has text | text | `await expect(locator).toHaveText(text)` |
| Element count | count | `await expect(locator).toHaveCount(n)` |
| Has attribute | attribute | `await expect(locator).toHaveAttribute(attr, val)` |

---

## 12. Multi-Tenancy

### 12.1 Tenant Isolation Model

```
┌───────────────────────────────────────────────────┐
│                  Organization A                    │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Features │  │ Step Lib │  │ Runs           │  │
│  │ (Org A)  │  │ (Org A)  │  │ (Org A only)   │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
│  Concurrent Limit: 5                              │
└───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│                  Organization B                    │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Features │  │ Step Lib │  │ Runs           │  │
│  │ (Org B)  │  │ (Org B)  │  │ (Org B only)   │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
│  Concurrent Limit: 3                              │
└───────────────────────────────────────────────────┘

          ✖ No cross-organization access
```

### 12.2 Middleware Chain

```
Request ──▶ authMiddleware ──▶ optionalTenantMiddleware ──▶ Controller
               │                        │
               ▼                        ▼
          Verify JWT              Extract orgId
          Set req.user            Set req.organizationId
                                  Validate membership
```

---

## 13. API Reference

### 13.1 Feature Endpoints

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/bdd/features` | List all features | - | `BDDFeature[]` |
| GET | `/api/bdd/features/:id` | Get feature by ID | - | `BDDFeature` |
| POST | `/api/bdd/features` | Create feature | `{ name, description, featureContent, tags, status }` | `BDDFeature` |
| PUT | `/api/bdd/features/:id` | Update feature | `{ name, description, featureContent, tags, status }` | `BDDFeature` |
| DELETE | `/api/bdd/features/:id` | Delete feature | - | `{ success: true }` |

### 13.2 Parse & Generate Endpoints

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| POST | `/api/bdd/parse` | Parse Gherkin text | `{ content }` | `ParsedFeature` |
| POST | `/api/bdd/features/:id/generate` | Generate Playwright code | - | `{ code: string }` |

### 13.3 Execution Endpoints

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| POST | `/api/bdd/features/:id/run` | Execute feature | `{ scenarioId?, browser, executionMode, tags, parallelWorkers, stepDefinitions }` | `BDDRun` |
| GET | `/api/bdd/runs` | List all runs | - | `BDDRun[]` |
| GET | `/api/bdd/runs/:id` | Get run details | - | `BDDRun` |
| GET | `/api/bdd/runs/:id/stream` | SSE stream | - | `EventStream` |
| POST | `/api/bdd/runs/:id/cancel` | Cancel execution | - | `{ success: true }` |
| DELETE | `/api/bdd/runs/:id` | Delete run record | - | `{ success: true }` |
| GET | `/api/bdd/status` | Concurrency status | - | `{ active, queued, max }` |

### 13.4 Step Library Endpoints

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/bdd/step-library` | List step entries | - | `StepLibEntry[]` |
| POST | `/api/bdd/step-library` | Create entry | `{ pattern, keyword, code, description, tags }` | `StepLibEntry` |
| PUT | `/api/bdd/step-library/:id` | Update entry | `{ pattern, keyword, code, description, tags }` | `StepLibEntry` |
| DELETE | `/api/bdd/step-library/:id` | Delete entry | - | `{ success: true }` |

### 13.5 Schedule Endpoints

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/bdd/schedules` | List schedules | - | `BDDSchedule[]` |
| POST | `/api/bdd/schedules` | Create schedule | `{ featureId, cronExpression, browser, executionMode, tags }` | `BDDSchedule` |
| PUT | `/api/bdd/schedules/:id` | Update schedule | `{ cronExpression, browser, executionMode, enabled }` | `BDDSchedule` |
| DELETE | `/api/bdd/schedules/:id` | Delete schedule | - | `{ success: true }` |
| POST | `/api/bdd/schedules/:id/run` | Manual trigger | - | `BDDRun` |

---

## 14. File Structure

```
playwright-crx-enhanced/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma                    # BDD models (Feature, Scenario, Step, Run, etc.)
│   ├── migrations/
│   │   ├── 012_create_bdd_tables.sql        # Core BDD tables
│   │   ├── 013_bdd_enhancements.sql         # Step Library, Schedule, Run extensions
│   │   └── 014_create_screenplay_tables.sql # Screenplay pattern tables
│   └── src/
│       ├── controllers/
│       │   └── bdd.controller.ts            # REST API handlers
│       ├── routes/
│       │   └── bdd.routes.ts                # Route definitions
│       ├── services/
│       │   └── bdd/
│       │       ├── bdd.service.ts           # Core BDD engine (parser, generator, executor)
│       │       ├── screenplay.service.ts    # Screenplay pattern service
│       │       └── serenityReport.service.ts# Serenity HTML report generator
│       ├── middleware/
│       │   └── auth.middleware.ts           # JWT auth + tenant middleware
│       └── index.ts                         # Express app setup + route registration
├── frontend/
│   └── src/
│       ├── App.tsx                           # Router with BDD route
│       └── components/
│           ├── BDDTesting.tsx               # Main BDD component (74.5KB)
│           └── BDDTesting.css               # BDD styles
└── playwright-crx-reports/                  # Generated output
    ├── bdd-{runId}/
    │   └── index.html                       # Serenity HTML report
    └── bdd-artifacts/                       # Screenshots
```

---

## 15. Data Flow Diagrams

### 15.1 Feature Creation Flow

```
User writes Gherkin ──▶ Frontend sends POST /features
                              │
                              ▼
                     Controller receives request
                              │
                              ▼
                     Service parses Gherkin content
                              │
                     ┌────────┼────────┐
                     │        │        │
                     ▼        ▼        ▼
               Extract    Extract   Extract
               Feature    Scenarios Steps
               metadata   + types   + keywords
                     │        │        │
                     └────────┼────────┘
                              │
                              ▼
                     Prisma creates records:
                     BDDFeature ──▶ BDDScenario[] ──▶ BDDStep[]
                              │
                              ▼
                     Return created feature to frontend
```

### 15.2 Step Library Injection Flow

```
Feature Execution Request
         │
         ▼
┌─────────────────────────────────┐
│  Load Step Sources              │
│                                 │
│  1. User-provided step defs     │
│  2. Step Library (org-scoped)   │
│  3. Screenplay task step defs   │
│  4. Feature inline step defs    │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Merge & Deduplicate            │
│  (User > Library > Screenplay)  │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Write to temp/step_definitions │
│  directory as .js files         │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Cucumber discovers and loads   │
│  all step definition files      │
└─────────────────────────────────┘
```

### 15.3 Report Access Flow

```
Execution Completes
        │
        ▼
Generate Serenity HTML ──▶ Save to playwright-crx-reports/bdd-{runId}/index.html
        │
        ▼
Update BDDRun.reportUrl = "/playwright-crx-reports/bdd-{runId}/index.html"
        │
        ▼
Frontend "View Report" button ──▶ window.open(reportUrl) ──▶ Express static serve ──▶ HTML Report
```

---

## Summary

This BDD Cucumber Framework is a production-grade, full-stack implementation that provides:

- **Complete Gherkin support** with parsing, validation, and live preview
- **Automated Playwright code generation** from BDD steps
- **Real-time execution monitoring** via SSE streaming
- **Rich Serenity-style HTML reports** with charts, timelines, and screenshots
- **Reusable step libraries** with org-level sharing
- **Screenplay Pattern** for composable, maintainable test design
- **Scheduled execution** with cron-based automation
- **Multi-tenant isolation** with per-org resource limits
- **Concurrent execution** with queuing and cancellation support
