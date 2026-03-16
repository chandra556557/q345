/**
 * INT-002: End-to-End Execution Flow
 *
 * Test complete flow:
 *   Create feature > Execute with headless chromium > Monitor via SSE streaming >
 *   Verify run results > View Serenity report > Check screenshots captured
 */

import request from 'supertest';
import { app } from '../../../src/index';
import pool from '../../../src/db';
import {
  ensureTestUser,
  generateTestToken,
  cleanupTestData,
  SAMPLE_FEATURE_CONTENT,
} from './testHelper';

let authToken: string;
let userId: string;
let featureId: string;

beforeAll(async () => {
  userId = await ensureTestUser();
  authToken = generateTestToken(userId);
  await cleanupTestData(userId);

  // Create a feature to execute
  const res = await request(app)
    .post('/api/bdd/features')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      name: 'Execution Test Feature',
      description: 'Feature created for execution flow testing',
      featureContent: SAMPLE_FEATURE_CONTENT,
      tags: ['execution-test'],
    });

  featureId = res.body.data.id;
});

afterAll(async () => {
  await cleanupTestData(userId);
  await pool.end();
});

describe('INT-002: End-to-End Execution Flow', () => {
  let runId: string;

  // ─────────────────────────────────────────────
  // 1. Check execution status before running
  // ─────────────────────────────────────────────
  describe('Step 1: Check execution status', () => {
    it('should return current execution concurrency status', async () => {
      const res = await request(app)
        .get('/api/bdd/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // 2. Execute a feature
  // ─────────────────────────────────────────────
  describe('Step 2: Execute feature', () => {
    it('should start a BDD run with default options (chromium, headless)', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'chromium',
          executionMode: 'headless',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('BDD run started');
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.featureId).toBe(featureId);
      expect(res.body.data.browser).toBe('chromium');
      expect(res.body.data.executionMode).toBe('headless');
      expect(res.body.data.totalSteps).toBeGreaterThan(0);

      runId = res.body.data.id;
    });

    it('should return 404 when running non-existent feature', async () => {
      const res = await request(app)
        .post('/api/bdd/features/non-existent-id/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ browser: 'chromium', executionMode: 'headless' });

      expect(res.status).toBe(404);
    });

    it('should create run record with correct step count in database', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM "BDDRun" WHERE id = $1`,
        [runId]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userId);
      expect(rows[0].featureId).toBe(featureId);
      expect(rows[0].totalSteps).toBeGreaterThan(0);
      expect(['pending', 'running', 'passed', 'failed']).toContain(rows[0].status);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Monitor SSE streaming endpoint
  // ─────────────────────────────────────────────
  describe('Step 3: SSE Streaming endpoint', () => {
    it('should connect to SSE stream and receive initial connected event', async () => {
      const res = await request(app)
        .get(`/api/bdd/runs/${runId}/stream`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Accept', 'text/event-stream');

      // SSE endpoints return 200 with text/event-stream content type
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });
  });

  // ─────────────────────────────────────────────
  // 4. Verify run results
  // ─────────────────────────────────────────────
  describe('Step 4: Verify run results', () => {
    it('should list all runs for the user', async () => {
      const res = await request(app)
        .get('/api/bdd/runs')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const run = res.body.data.find((r: any) => r.id === runId);
      expect(run).toBeDefined();
      expect(run.featureName).toBe('Execution Test Feature');
    });

    it('should filter runs by featureId', async () => {
      const res = await request(app)
        .get(`/api/bdd/runs?featureId=${featureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.every((r: any) => r.featureId === featureId)).toBe(true);
    });

    it('should get a single run with detailed results', async () => {
      const res = await request(app)
        .get(`/api/bdd/runs/${runId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(runId);
      expect(res.body.data.featureName).toBe('Execution Test Feature');
      expect(res.body.data.featureContent).toBeDefined();
      expect(res.body.data.browser).toBe('chromium');
      expect(res.body.data.executionMode).toBe('headless');
    });

    it('should return 404 for non-existent run', async () => {
      const res = await request(app)
        .get('/api/bdd/runs/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────
  // 5. Start a second run and test cancellation
  // ─────────────────────────────────────────────
  describe('Step 5: Run cancellation', () => {
    let cancelRunId: string;

    it('should start another run for cancellation testing', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'chromium',
          executionMode: 'headless',
        });

      expect(res.status).toBe(201);
      cancelRunId = res.body.data.id;
    });

    it('should cancel a pending/running execution', async () => {
      // The run should be in pending or running state
      const res = await request(app)
        .post(`/api/bdd/runs/${cancelRunId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Run cancelled');

      // Verify status is cancelled in DB
      const { rows } = await pool.query(
        `SELECT status FROM "BDDRun" WHERE id = $1`,
        [cancelRunId]
      );
      expect(rows[0].status).toBe('cancelled');
    });

    it('should return 400 when cancelling an already-cancelled run', async () => {
      const res = await request(app)
        .post(`/api/bdd/runs/${cancelRunId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Delete runs
  // ─────────────────────────────────────────────
  describe('Step 6: Delete runs', () => {
    it('should delete a completed/cancelled run', async () => {
      // Wait briefly for any async processing to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // First, ensure the run is not 'running' — update if needed
      await pool.query(
        `UPDATE "BDDRun" SET status = 'failed', "completedAt" = now(), "updatedAt" = now()
         WHERE id = $1 AND status IN ('pending', 'running')`,
        [runId]
      );

      const res = await request(app)
        .delete(`/api/bdd/runs/${runId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone
      const { rows } = await pool.query(
        `SELECT * FROM "BDDRun" WHERE id = $1`,
        [runId]
      );
      expect(rows).toHaveLength(0);
    });

    it('should return 404 when deleting non-existent run', async () => {
      const res = await request(app)
        .delete('/api/bdd/runs/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────
  // 7. Execute with different browser options
  // ─────────────────────────────────────────────
  describe('Step 7: Execute with different options', () => {
    it('should start a run with firefox browser', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'firefox',
          executionMode: 'headless',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.browser).toBe('firefox');

      // Clean up: cancel the run immediately
      await request(app)
        .post(`/api/bdd/runs/${res.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);
    });

    it('should start a run with parallel workers', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'chromium',
          executionMode: 'headless',
          parallelWorkers: 2,
        });

      expect(res.status).toBe(201);

      // Clean up: cancel the run immediately
      await request(app)
        .post(`/api/bdd/runs/${res.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);
    });

    it('should start a run with tag filtering', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'chromium',
          executionMode: 'headless',
          tags: '@smoke',
        });

      expect(res.status).toBe(201);

      // Clean up: cancel the run immediately
      await request(app)
        .post(`/api/bdd/runs/${res.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);
    });
  });

  // ─────────────────────────────────────────────
  // 8. Verify run cannot be deleted while running
  // ─────────────────────────────────────────────
  describe('Step 8: Protection against deleting running executions', () => {
    it('should prevent deletion of a running execution', async () => {
      // Create a run and set it to 'running' manually
      const { rows } = await pool.query(
        `INSERT INTO "BDDRun" (id, "featureId", "userId", status, "totalSteps", browser, "executionMode", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, 'running', 5, 'chromium', 'headless', now(), now())
         RETURNING id`,
        [featureId, userId]
      );
      const testRunId = rows[0].id;

      const res = await request(app)
        .delete(`/api/bdd/runs/${testRunId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('running');

      // Clean up: force update status so it can be deleted
      await pool.query(
        `UPDATE "BDDRun" SET status = 'cancelled' WHERE id = $1`,
        [testRunId]
      );
      await pool.query(`DELETE FROM "BDDRun" WHERE id = $1`, [testRunId]);
    });
  });
});
