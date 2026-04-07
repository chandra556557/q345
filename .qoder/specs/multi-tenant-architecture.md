# Multi-Tenant Enterprise Architecture for Playwright CRX Enhanced

## Overview
Transform the single-tenant Playwright CRX Enhanced application into an enterprise-grade multi-tenant platform supporting:
- **Organizations/Teams** with isolated data
- **Centralized Test Execution Hub** for multiple application types (Headless, GUI, API/Microservices)
- **Enterprise Scale** with Redis + BullMQ job queue (100+ concurrent tests)

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │ Org Selector    │  │ App Type Select │  │ Queue Dashboard │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Express)                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │ Auth + Tenant   │  │ Organization    │  │ Test Execution  │         │
│  │ Middleware      │  │ Management      │  │ API             │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│    PostgreSQL     │   │      Redis        │   │  Worker Pool      │
│   (Data Store)    │   │   (Job Queue)     │   │  (BullMQ Workers) │
└───────────────────┘   └───────────────────┘   └───────────────────┘
                                                         │
                        ┌────────────────────────────────┼────────────────────────────────┐
                        ▼                                ▼                                ▼
               ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
               │ Headless Worker │              │   GUI Worker    │              │   API Worker    │
               │ (Non-GUI Apps)  │              │ (GUI Apps)      │              │ (Microservices) │
               └─────────────────┘              └─────────────────┘              └─────────────────┘
```

---

## Database Schema Changes

### File: `backend/prisma/schema.prisma`

#### New Models

```prisma
model Organization {
  id                String              @id @default(cuid())
  name              String
  slug              String              @unique
  subscription      String              @default("free")
  maxConcurrentRuns Int                 @default(5)
  maxUsers          Int                 @default(10)
  settings          Json?
  status            String              @default("active")
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  
  userOrganizations UserOrganization[]
  projects          Project[]
  environments      Environment[]
  testRuns          TestRun[]
}

model UserOrganization {
  id             String       @id @default(cuid())
  userId         String
  organizationId String
  role           String       @default("member")  // owner, admin, developer, viewer
  joinedAt       DateTime     @default(now())
  status         String       @default("active")
  
  user           User         @relation(...)
  organization   Organization @relation(...)
  @@unique([userId, organizationId])
}

model Environment {
  id             String       @id @default(cuid())
  organizationId String
  name           String       // dev, staging, production
  displayName    String
  config         Json
  isDefault      Boolean      @default(false)
  ...
}

model ApplicationType {
  id          String   @id @default(cuid())
  name        String   @unique  // headless, gui, api
  displayName String
  config      Json
  scripts     Script[]
}

model WorkerNode {
  id              String    @id @default(cuid())
  hostname        String
  status          String    @default("idle")
  capabilities    Json
  maxConcurrency  Int       @default(5)
  currentLoad     Int       @default(0)
  lastHeartbeat   DateTime
  testRuns        TestRun[]
}

model JobQueue {
  id              String    @id @default(cuid())
  testRunId       String    @unique
  organizationId  String
  priority        Int       @default(0)
  status          String    @default("pending")
  attempts        Int       @default(0)
  ...
}
```

#### Modified Tables (Add organizationId)
- `Project` - add `organizationId`
- `Script` - add `applicationTypeId`
- `TestRun` - add `organizationId`, `environmentId`, `workerNodeId`, `executionMode`

---

## New Backend Services

### 1. Queue Service
**File:** `backend/src/services/queue/queue.service.ts`

```typescript
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

export class QueueService {
  private testQueue: Queue<TestJobData>;
  
  async addTestJob(data: TestJobData): Promise<string>
  async getQueueMetrics(): Promise<QueueMetrics>
  async removeJob(jobId: string): Promise<void>
}
```

### 2. Worker Pool Service
**File:** `backend/src/services/workers/workerPool.service.ts`

```typescript
import { Worker, Job } from 'bullmq';

export class WorkerPoolService {
  private workers: Worker[];
  
  async initialize()
  async processJob(job: Job<TestJobData>)
  async shutdown()
}
```

### 3. Tenant Service
**File:** `backend/src/services/tenant/tenant.service.ts`

```typescript
export class TenantService {
  async createOrganization(input)
  async getUserOrganizations(userId)
  async inviteUser(orgId, email, role)
  async checkConcurrencyLimit(orgId)
}
```

---

## Middleware Enhancements

### File: `backend/src/middleware/auth.middleware.ts`

```typescript
// Existing auth middleware - unchanged
export const authMiddleware = (req, res, next) => { ... }

// NEW: Tenant context middleware
export const tenantMiddleware = async (req, res, next) => {
  const orgSlug = req.headers['x-organization'];
  // Validate user membership, attach tenant to req
  req.tenant = { organizationId, role, permissions };
}

// NEW: Role-based access control
export const requireRole = (allowedRoles: string[]) => { ... }
```

---

## API Endpoints

### New Organization Routes
**File:** `backend/src/routes/organization.routes.ts`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/organizations` | Create organization |
| GET | `/api/organizations/my-organizations` | List user's orgs |
| GET | `/api/organizations/:slug` | Get org details |
| PATCH | `/api/organizations/:slug/settings` | Update settings |
| POST | `/api/organizations/:slug/invite` | Invite user |
| GET | `/api/organizations/:slug/environments` | List environments |

### New Queue Routes
**File:** `backend/src/routes/queue.routes.ts`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/queue/metrics` | Get queue stats |
| GET | `/api/queue/jobs` | List jobs |
| DELETE | `/api/queue/jobs/:id` | Cancel job |

### Modified Test Run Routes
| Method | Endpoint | Change |
|--------|----------|--------|
| POST | `/api/test-runs` | Add queue-based execution, org context |
| GET | `/api/test-runs` | Filter by organizationId |

---

## Frontend Components

### 1. Organization Selector
**File:** `frontend/src/components/OrganizationSelector.tsx`
- Dropdown to switch between organizations
- Stores selection in localStorage + axios headers

### 2. Application Type Selector
**File:** `frontend/src/components/ApplicationTypeSelector.tsx`
- Cards: Headless, GUI, API/Microservice
- Used when creating/running scripts

### 3. Queue Dashboard
**File:** `frontend/src/components/QueueDashboard.tsx`
- Real-time metrics: Waiting, Active, Completed, Failed
- Auto-refresh every 5 seconds

### 4. Worker Status Panel
**File:** `frontend/src/components/WorkerStatusPanel.tsx`
- Shows all worker nodes and their status
- Load distribution visualization

---

## Configuration

### Environment Variables (.env)

```bash
# Redis (Job Queue)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Worker Pool
WORKER_POOL_SIZE=3
WORKER_CONCURRENCY=5
ENABLE_WORKER_POOL=true

# Multi-Tenancy
ENABLE_MULTI_TENANCY=true
DEFAULT_ORG_MAX_CONCURRENT_RUNS=5

# Application Types
SUPPORTED_APP_TYPES=headless,gui,api
DEFAULT_EXECUTION_MODE=headless
```

### New Dependencies (package.json)

```json
{
  "dependencies": {
    "bullmq": "^5.1.0",
    "ioredis": "^5.3.2"
  }
}
```

---

## Implementation Files

### New Files to Create

| File | Purpose |
|------|---------|
| `backend/src/services/queue/queue.service.ts` | Redis + BullMQ queue |
| `backend/src/services/queue/redis.config.ts` | Redis connection |
| `backend/src/services/workers/workerPool.service.ts` | Worker pool manager |
| `backend/src/services/tenant/tenant.service.ts` | Organization management |
| `backend/src/routes/organization.routes.ts` | Org API routes |
| `backend/src/routes/queue.routes.ts` | Queue API routes |
| `backend/src/controllers/organization.controller.ts` | Org handlers |
| `frontend/src/components/OrganizationSelector.tsx` | Org switcher |
| `frontend/src/components/ApplicationTypeSelector.tsx` | App type UI |
| `frontend/src/components/QueueDashboard.tsx` | Queue metrics |
| `frontend/src/components/WorkerStatusPanel.tsx` | Worker status |

### Files to Modify

| File | Changes |
|------|---------|
| `backend/prisma/schema.prisma` | Add 6 new models, modify 4 existing |
| `backend/src/middleware/auth.middleware.ts` | Add tenantMiddleware, requireRole |
| `backend/src/controllers/testRun.controller.ts` | Queue-based execution |
| `backend/src/index.ts` | Add org routes, initialize workers |
| `backend/.env.example` | Add Redis, worker, tenant config |
| `backend/package.json` | Add bullmq, ioredis |
| `frontend/src/components/Dashboard.tsx` | Add OrgSelector, update API calls |

---

## Verification Plan

### 1. Database Migration
```bash
cd playwright-crx-enhanced/backend
npx prisma migrate dev --name add-multi-tenancy
npx prisma generate
```

### 2. Redis Setup
```bash
# Start Redis (Docker)
docker run -d -p 6379:6379 redis:alpine

# Verify connection
redis-cli ping
```

### 3. Backend Testing
```bash
# Start backend with workers
npm run dev

# Test organization creation
curl -X POST http://localhost:3001/api/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "QA Team", "slug": "qa-team"}'

# Test queue metrics
curl http://localhost:3001/api/queue/metrics \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization: qa-team"
```

### 4. Test Execution Flow
```bash
# Submit test to queue
curl -X POST http://localhost:3001/api/test-runs \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization: qa-team" \
  -d '{"scriptId": "xxx", "executionMode": "headless"}'

# Watch queue processing
redis-cli monitor
```

### 5. Frontend Verification
- Login and verify organization selector appears
- Switch organizations and verify data isolation
- Run tests and observe queue dashboard updates
- Check worker status panel for load distribution

---

## Summary

This implementation transforms Playwright CRX Enhanced into a centralized test execution platform that:

1. **Supports multiple teams** with isolated data (Organization model)
2. **Handles 100+ concurrent tests** via Redis + BullMQ workers
3. **Supports all application types**: Headless, GUI, API/Microservices
4. **Provides real-time visibility** into queue status and worker loads
5. **Enforces tenant-level limits** on concurrent executions
