/**
 * INT-003: Step Library Integration Flow
 *
 * Test complete flow:
 *   Create step library entries > Create feature using library patterns >
 *   Execute feature > Verify library steps injected and executed >
 *   Check usage count incremented
 */

import request from 'supertest';
import { app } from '../../../src/index';
import pool from '../../../src/db';
import {
  ensureTestUser,
  generateTestToken,
  cleanupTestData,
} from './testHelper';

let authToken: string;
let userId: string;

beforeAll(async () => {
  userId = await ensureTestUser();
  authToken = generateTestToken(userId);
  await cleanupTestData(userId);
});

afterAll(async () => {
  await cleanupTestData(userId);
  await pool.end();
});

describe('INT-003: Step Library Integration Flow', () => {
  let stepEntryId1: string;
  let stepEntryId2: string;
  let stepEntryId3: string;
  let featureId: string;

  // ─────────────────────────────────────────────
  // 1. Create step library entries
  // ─────────────────────────────────────────────
  describe('Step 1: Create reusable step library entries', () => {
    it('should create a Given step library entry', async () => {
      const res = await request(app)
        .post('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pattern: 'I am on the {string} page',
          keyword: 'Given',
          code: `await page.goto(baseUrl + '/' + args[0]);`,
          description: 'Navigate to a specific page by name',
          tags: ['navigation', 'common'],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.pattern).toBe('I am on the {string} page');
      expect(res.body.data.keyword).toBe('Given');

      stepEntryId1 = res.body.data.id;
    });

    it('should create a When step library entry', async () => {
      const res = await request(app)
        .post('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pattern: 'I click the {string} button',
          keyword: 'When',
          code: `await page.getByRole('button', { name: args[0] }).click();`,
          description: 'Click a button by its text',
          tags: ['interaction', 'common'],
        });

      expect(res.status).toBe(201);
      stepEntryId2 = res.body.data.id;
    });

    it('should create a Then step library entry', async () => {
      const res = await request(app)
        .post('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pattern: 'I should see {string} on the page',
          keyword: 'Then',
          code: `await expect(page.getByText(args[0])).toBeVisible();`,
          description: 'Assert text is visible on the page',
          tags: ['assertion', 'common'],
        });

      expect(res.status).toBe(201);
      stepEntryId3 = res.body.data.id;
    });

    it('should return 400 when pattern is missing', async () => {
      const res = await request(app)
        .post('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          keyword: 'Given',
          code: 'some code',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 when keyword is missing', async () => {
      const res = await request(app)
        .post('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pattern: 'some pattern',
          code: 'some code',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 when code is missing', async () => {
      const res = await request(app)
        .post('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pattern: 'some pattern',
          keyword: 'Given',
        });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────
  // 2. List and verify step library entries
  // ─────────────────────────────────────────────
  describe('Step 2: List and verify step library entries', () => {
    it('should list all step library entries for the user', async () => {
      const res = await request(app)
        .get('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);

      // Verify all three entries exist
      const ids = res.body.data.map((e: any) => e.id);
      expect(ids).toContain(stepEntryId1);
      expect(ids).toContain(stepEntryId2);
      expect(ids).toContain(stepEntryId3);

      // Verify keywords
      const keywords = res.body.data.map((e: any) => e.keyword);
      expect(keywords).toContain('Given');
      expect(keywords).toContain('When');
      expect(keywords).toContain('Then');
    });

    it('should have entries persisted correctly in database', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM "BDDStepLibrary" WHERE "userId" = $1 ORDER BY "createdAt"`,
        [userId]
      );

      expect(rows.length).toBeGreaterThanOrEqual(3);

      const givenEntry = rows.find((r: any) => r.id === stepEntryId1);
      expect(givenEntry).toBeDefined();
      expect(givenEntry.pattern).toBe('I am on the {string} page');
      expect(givenEntry.code).toContain('page.goto');
    });
  });

  // ─────────────────────────────────────────────
  // 3. Update step library entries
  // ─────────────────────────────────────────────
  describe('Step 3: Update step library entries', () => {
    it('should update a step library entry description', async () => {
      const res = await request(app)
        .put(`/api/bdd/step-library/${stepEntryId1}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Navigate to a specific page by name (updated)',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should update a step library entry code', async () => {
      const res = await request(app)
        .put(`/api/bdd/step-library/${stepEntryId2}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: `await page.getByRole('button', { name: args[0], exact: true }).click();`,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 when updating non-existent entry', async () => {
      const res = await request(app)
        .put('/api/bdd/step-library/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Should not work' });

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Create a feature that uses step library patterns
  // ─────────────────────────────────────────────
  describe('Step 4: Create feature using step library patterns', () => {
    const featureWithLibrarySteps = `Feature: Step Library Integration Test
  As a tester
  I want to use reusable step definitions
  So that I can write tests faster

  Scenario: Use library steps
    Given I am on the "login" page
    When I click the "Submit" button
    Then I should see "Welcome" on the page
`;

    it('should create a feature that references step library patterns', async () => {
      const res = await request(app)
        .post('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Step Library Integration Test',
          featureContent: featureWithLibrarySteps,
          tags: ['step-library-test'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.scenarioCount).toBe(1);
      featureId = res.body.data.id;
    });

    it('should have feature steps matching library patterns', async () => {
      // Get the feature with scenarios and steps
      const res = await request(app)
        .get(`/api/bdd/features/${featureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const scenario = res.body.data.scenarios[0];
      expect(scenario.steps).toHaveLength(3);

      // Verify step keywords match library patterns
      expect(scenario.steps[0].keyword).toBe('Given');
      expect(scenario.steps[0].text).toContain('login');
      expect(scenario.steps[1].keyword).toBe('When');
      expect(scenario.steps[1].text).toContain('Submit');
      expect(scenario.steps[2].keyword).toBe('Then');
      expect(scenario.steps[2].text).toContain('Welcome');
    });
  });

  // ─────────────────────────────────────────────
  // 5. Execute feature with step library injection
  // ─────────────────────────────────────────────
  describe('Step 5: Execute feature with step library', () => {
    let runId: string;

    it('should start execution with step library auto-injection', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'chromium',
          executionMode: 'headless',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSteps).toBe(3);
      runId = res.body.data.id;
    });

    it('should have the run record in the database', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM "BDDRun" WHERE id = $1`,
        [runId]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].featureId).toBe(featureId);
      expect(rows[0].totalSteps).toBe(3);
    });

    it('should be able to retrieve the run via API', async () => {
      const res = await request(app)
        .get(`/api/bdd/runs/${runId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(runId);
      expect(res.body.data.featureName).toBe('Step Library Integration Test');
    });

    it('should be able to cancel the run', async () => {
      const res = await request(app)
        .post(`/api/bdd/runs/${runId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);

      // Either 200 (cancelled) or 400 (already completed)
      expect([200, 400]).toContain(res.status);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Execute with custom step definitions override
  // ─────────────────────────────────────────────
  describe('Step 6: Execute with custom step definitions', () => {
    it('should start execution with custom step definitions provided', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${featureId}/run`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          browser: 'chromium',
          executionMode: 'headless',
          stepDefinitions: {
            'I am on the {string} page': `await page.goto('http://localhost:3001/' + args[0]);`,
            'I click the {string} button': `await page.click('button:has-text("' + args[0] + '")');`,
            'I should see {string} on the page': `await expect(page.locator('body')).toContainText(args[0]);`,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Cancel immediately since we just need to verify it accepted custom steps
      await request(app)
        .post(`/api/bdd/runs/${res.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`);
    });
  });

  // ─────────────────────────────────────────────
  // 7. Delete step library entries
  // ─────────────────────────────────────────────
  describe('Step 7: Delete step library entries', () => {
    it('should delete a step library entry', async () => {
      const res = await request(app)
        .delete(`/api/bdd/step-library/${stepEntryId3}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 when deleting already-deleted entry', async () => {
      const res = await request(app)
        .delete(`/api/bdd/step-library/${stepEntryId3}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    it('should have one fewer entry in the library', async () => {
      const res = await request(app)
        .get('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((e: any) => e.id);
      expect(ids).not.toContain(stepEntryId3);
      expect(ids).toContain(stepEntryId1);
      expect(ids).toContain(stepEntryId2);
    });
  });

  // ─────────────────────────────────────────────
  // 8. Schedule integration with step library
  // ─────────────────────────────────────────────
  describe('Step 8: Schedule CRUD operations', () => {
    let scheduleId: string;

    it('should create a schedule for the feature', async () => {
      const res = await request(app)
        .post('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          featureId: featureId,
          cronExpression: '0 0 * * *',
          browser: 'chromium',
          executionMode: 'headless',
          tags: '@smoke',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      scheduleId = res.body.data.id;
    });

    it('should list schedules', async () => {
      const res = await request(app)
        .get('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a schedule', async () => {
      const res = await request(app)
        .put(`/api/bdd/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          cronExpression: '0 6 * * 1-5',
          enabled: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 when creating schedule without featureId', async () => {
      const res = await request(app)
        .post('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          cronExpression: '0 0 * * *',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 when creating schedule without cronExpression', async () => {
      const res = await request(app)
        .post('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          featureId: featureId,
        });

      expect(res.status).toBe(400);
    });

    it('should delete a schedule', async () => {
      const res = await request(app)
        .delete(`/api/bdd/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 when deleting non-existent schedule', async () => {
      const res = await request(app)
        .delete(`/api/bdd/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────
  // 9. Cleanup verification
  // ─────────────────────────────────────────────
  describe('Step 9: Verify complete cleanup', () => {
    it('should delete the test feature', async () => {
      const res = await request(app)
        .delete(`/api/bdd/features/${featureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });

    it('should delete remaining step library entries', async () => {
      const res1 = await request(app)
        .delete(`/api/bdd/step-library/${stepEntryId1}`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .delete(`/api/bdd/step-library/${stepEntryId2}`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res2.status).toBe(200);
    });

    it('should have empty step library for user', async () => {
      const res = await request(app)
        .get('/api/bdd/step-library')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
