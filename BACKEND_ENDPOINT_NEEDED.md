# Backend Endpoint Needed for Frontend Test Runner

## ✅ Frontend is Ready
The CucumberTestRunner component is now integrated in the Dashboard and configured to use existing backend endpoints.

## 📋 What's Being Used

### **Existing Endpoints:**
- ✅ `GET /api/bdd/runs` - Get test run history
- ✅ `GET /api/bdd/runs/:id` - Get specific run details
- ✅ `POST /api/bdd/features/:id/run` - Run a feature

### **New Endpoint Needed:**
To run tests with **tag filters** directly from frontend:

```
POST /api/bdd/run-cucumber
```

---

## 🎯 Endpoint Specification

### **POST /api/bdd/run-cucumber**

Executes Cucumber tests with optional tag filtering.

**Request:**
```json
{
  "filter": "all" | "smoke" | "api" | "forms" | "database" | "saucedemo",
  "tags": "@smoke"  // Optional: Gherkin tag filter
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "run-uuid",
    "status": "running",
    "totalScenarios": 10,
    "passedScenarios": 0,
    "failedScenarios": 0,
    "skippedScenarios": 0,
    "totalDuration": 0,
    "startedAt": "2026-04-07T10:30:00Z",
    "completedAt": null,
    "features": []
  }
}
```

---

## 🔧 Implementation Option 1: Simple Version

Add to `bdd.controller.ts`:

```typescript
/**
 * Run Cucumber tests with tag filter
 * POST /api/bdd/run-cucumber
 */
export const runCucumberTests = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { filter = 'all', tags = '' } = req.body;

  // Create run record
  const { rows: runRows } = await pool.query(
    `INSERT INTO "BDDRun" (
      id, "userId", "organizationId", status, "createdAt", "updatedAt"
    )
    VALUES (gen_random_uuid()::text, $1, $2, 'running', now(), now())
    RETURNING *`,
    [userId, organizationId]
  );

  const run = runRows[0];

  // Execute Cucumber in background
  setImmediate(async () => {
    try {
      // Execute: npm run cucumber with optional tags
      const command = tags 
        ? `npm run cucumber -- --tags "${tags}"`
        : `npm run cucumber`;

      const { exec } = require('child_process');
      exec(command, { cwd: __dirname + '/../..' }, (error: any, stdout: string, stderr: string) => {
        // Parse results and update run record
        const results = parseTestOutput(stdout);
        
        pool.query(
          `UPDATE "BDDRun" SET 
            status = $1,
            "passedScenarios" = $2,
            "failedScenarios" = $3,
            "totalScenarios" = $4,
            "completedAt" = now(),
            "updatedAt" = now()
          WHERE id = $5`,
          [
            results.failed > 0 ? 'failed' : 'passed',
            results.passed,
            results.failed,
            results.passed + results.failed,
            run.id
          ]
        );
      });
    } catch (err) {
      pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "updatedAt" = now() WHERE id = $1`,
        [run.id]
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: run.id,
      status: 'running',
      totalScenarios: 0,
      passedScenarios: 0,
      failedScenarios: 0,
      skippedScenarios: 0,
      totalDuration: 0,
      startedAt: run.createdAt,
      features: []
    }
  });
});
```

### **Add to Route:**
```typescript
// bdd.routes.ts
import { runCucumberTests } from '../controllers/bdd.controller';

router.post('/run-cucumber', authMiddleware, runCucumberTests);
```

---

## 🔧 Implementation Option 2: Full Integration (Recommended)

Create a service to handle Cucumber execution:

### **Create: `src/services/bdd/cucumber.service.ts`**

```typescript
import { spawn } from 'child_process';
import path from 'path';
import { logger } from '../../utils/logger';

export class CucumberService {
  async runTests(runId: string, filter?: string, tags?: string) {
    const projectRoot = path.resolve(__dirname, '../../../..');
    
    // Build command
    let command = 'npm';
    let args = ['run', 'cucumber'];

    if (tags) {
      args.push('--', '--tags', tags);
    }

    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        cwd: projectRoot,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
        logger.info(`[${runId}] ${data}`);
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
        logger.error(`[${runId}] ${data}`);
      });

      process.on('close', (code) => {
        const results = this.parseResults(stdout);
        resolve({
          success: code === 0,
          results,
          output: stdout,
          errors: stderr
        });
      });

      process.on('error', (err) => {
        reject(err);
      });
    });
  }

  private parseResults(output: string) {
    // Parse Cucumber output to extract:
    // - passed scenarios count
    // - failed scenarios count
    // - skipped scenarios count
    // - total duration

    const passedMatch = output.match(/(\d+) scenarios?\s+passed/);
    const failedMatch = output.match(/(\d+) scenarios?\s+failed/);
    const skippedMatch = output.match(/(\d+) scenarios?\s+skipped/);
    const durationMatch = output.match(/(\d+)m (\d+)s/);

    return {
      passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
      failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
      duration: durationMatch 
        ? (parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10)) * 1000
        : 0
    };
  }
}

export const cucumberService = new CucumberService();
```

### **Update Controller:**

```typescript
import { cucumberService } from '../services/bdd/cucumber.service';

export const runCucumberTests = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { filter = 'all', tags = '' } = req.body;

  // Create run record
  const { rows: runRows } = await pool.query(
    `INSERT INTO "BDDRun" (
      id, "userId", "organizationId", status, "createdAt", "updatedAt"
    )
    VALUES (gen_random_uuid()::text, $1, $2, 'running', now(), now())
    RETURNING *`,
    [userId, organizationId]
  );

  const run = runRows[0];

  // Execute Cucumber in background
  setImmediate(async () => {
    try {
      const testResults = await cucumberService.runTests(run.id, filter, tags);
      
      await pool.query(
        `UPDATE "BDDRun" SET 
          status = $1,
          "totalSteps" = $2,
          "passedSteps" = $3,
          "failedSteps" = $4,
          "completedAt" = now(),
          "updatedAt" = now()
        WHERE id = $5`,
        [
          testResults.success ? 'passed' : 'failed',
          testResults.results.passed + testResults.results.failed,
          testResults.results.passed,
          testResults.results.failed,
          run.id
        ]
      );
    } catch (err) {
      logger.error(`Error running Cucumber tests: ${err}`);
      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "updatedAt" = now() WHERE id = $1`,
        [run.id]
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: run.id,
      status: 'running',
      totalScenarios: 0,
      passedScenarios: 0,
      failedScenarios: 0,
      skippedScenarios: 0,
      totalDuration: 0,
      startedAt: run.createdAt,
      features: []
    }
  });
});
```

---

## 📊 Frontend Usage

Once endpoint is added, users can:

1. **Open Dashboard** → BDD Features
2. **Click "Run All Tests"** or specific filter button
3. **Watch real-time progress** - frontend polls every 2 seconds
4. **See detailed results** - features/scenarios breakdown

---

## 🔍 Tag Filters Available

```
@smoke          - Quick validation tests (~30 sec)
@api            - API endpoint tests (24 scenarios)
@forms          - Form validation tests (29 scenarios)
@database       - Database operation tests (23 scenarios)
@saucedemo      - E-commerce tests with real browser (16 scenarios)
@positive       - Happy path scenarios
@security       - Security-related tests
@performance    - Performance tests
```

---

## 🎯 Current Frontend State

✅ Test runner UI ready
✅ Run buttons configured  
✅ Results display ready
✅ Polling logic active
✅ API integration configured

⏳ **Needs:** `/api/bdd/run-cucumber` endpoint in backend

---

## 🚀 To Complete the Integration

1. Choose implementation (Simple or Full)
2. Add endpoint to backend
3. Update swagger.ts with new endpoint
4. Restart backend
5. Test from frontend UI

Then users can run 136 BDD tests with one click! 🎉
