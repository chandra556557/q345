/**
 * INT-005: Screenplay Pattern Integration Flow
 *
 * Test complete flow:
 *   Create actions > Create questions > Compose task from actions + questions >
 *   Generate step definition code > Verify presets > Delete entities
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
  // Clean screenplay data
  await pool.query(`DELETE FROM "ScreenplayTask" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "ScreenplayAction" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "ScreenplayQuestion" WHERE "userId" = $1`, [userId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM "ScreenplayTask" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "ScreenplayAction" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "ScreenplayQuestion" WHERE "userId" = $1`, [userId]);
  await pool.end();
});

describe('INT-005: Screenplay Pattern Integration Flow', () => {
  let actionId1: string;
  let actionId2: string;
  let questionId1: string;
  let questionId2: string;
  let taskId: string;

  // ─────────────────────────────────────────────
  // 1. Get preset actions and questions
  // ─────────────────────────────────────────────
  describe('Step 1: Verify presets are available', () => {
    it('should return preset actions', async () => {
      const res = await request(app)
        .get('/api/screenplay/presets/actions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Each preset should have name, code, actionType
      const preset = res.body.data[0];
      expect(preset.name).toBeDefined();
      expect(preset.code).toBeDefined();
    });

    it('should return preset questions', async () => {
      const res = await request(app)
        .get('/api/screenplay/presets/questions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Create actions
  // ─────────────────────────────────────────────
  describe('Step 2: Create Screenplay Actions', () => {
    it('should create a navigation action', async () => {
      const res = await request(app)
        .post('/api/screenplay/actions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Navigate to login page',
          description: 'Open the login page of the application',
          actionType: 'navigation',
          code: "await page.goto('https://example.com/login');",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Navigate to login page');
      expect(res.body.data.actionType).toBe('navigation');
      actionId1 = res.body.data.id;
    });

    it('should create an input action', async () => {
      const res = await request(app)
        .post('/api/screenplay/actions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Fill login credentials',
          description: 'Enter username and password',
          actionType: 'input',
          code: "await page.getByLabel('Email').fill('admin@test.com');\nawait page.getByLabel('Password').fill('password123');\nawait page.getByRole('button', { name: 'Login' }).click();",
        });

      expect(res.status).toBe(201);
      actionId2 = res.body.data.id;
    });

    it('should reject action without name', async () => {
      const res = await request(app)
        .post('/api/screenplay/actions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: "await page.goto('/test');",
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('should list created actions', async () => {
      const res = await request(app)
        .get('/api/screenplay/actions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Create questions
  // ─────────────────────────────────────────────
  describe('Step 3: Create Screenplay Questions', () => {
    it('should create a visibility question', async () => {
      const res = await request(app)
        .post('/api/screenplay/questions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Dashboard is visible',
          description: 'Verify the dashboard page is displayed',
          questionType: 'visibility',
          code: "await expect(page.getByText('Dashboard')).toBeVisible();",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.questionType).toBe('visibility');
      questionId1 = res.body.data.id;
    });

    it('should create a URL question', async () => {
      const res = await request(app)
        .post('/api/screenplay/questions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'URL contains dashboard',
          description: 'Verify we are on the dashboard URL',
          questionType: 'url',
          code: "await expect(page).toHaveURL(/dashboard/);",
        });

      expect(res.status).toBe(201);
      questionId2 = res.body.data.id;
    });

    it('should list created questions', async () => {
      const res = await request(app)
        .get('/api/screenplay/questions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Compose a Task from actions + questions
  // ─────────────────────────────────────────────
  describe('Step 4: Compose a Task', () => {
    it('should create a task composed of actions and questions', async () => {
      const res = await request(app)
        .post('/api/screenplay/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Login as admin',
          description: 'Complete login flow and verify dashboard',
          actorType: 'Admin',
          actions: [actionId1, actionId2],
          questions: [questionId1, questionId2],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Login as admin');
      expect(res.body.data.actorType).toBe('Admin');
      taskId = res.body.data.id;
    });

    it('should list the created task', async () => {
      const res = await request(app)
        .get('/api/screenplay/tasks')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const task = res.body.data.find((t: any) => t.id === taskId);
      expect(task).toBeDefined();
      expect(task.name).toBe('Login as admin');
    });
  });

  // ─────────────────────────────────────────────
  // 5. Generate step definition code from task
  // ─────────────────────────────────────────────
  describe('Step 5: Generate step definition code', () => {
    it('should generate Cucumber step definition code for the task', async () => {
      const res = await request(app)
        .post(`/api/screenplay/tasks/${taskId}/generate`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.code).toBeDefined();
      expect(typeof res.body.data.code).toBe('string');
      expect(res.body.data.code.length).toBeGreaterThan(0);
      // Should contain Given/When/Then style step definition
      expect(res.body.data.code).toMatch(/Given|When|Then/);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Delete entities in correct order
  // ─────────────────────────────────────────────
  describe('Step 6: Delete screenplay entities', () => {
    it('should delete the task', async () => {
      const res = await request(app)
        .delete(`/api/screenplay/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });

    it('should delete questions', async () => {
      for (const qId of [questionId1, questionId2]) {
        const res = await request(app)
          .delete(`/api/screenplay/questions/${qId}`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
      }
    });

    it('should delete actions', async () => {
      for (const aId of [actionId1, actionId2]) {
        const res = await request(app)
          .delete(`/api/screenplay/actions/${aId}`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
      }
    });

    it('should have empty lists after deletion', async () => {
      const [actRes, qRes, taskRes] = await Promise.all([
        request(app).get('/api/screenplay/actions').set('Authorization', `Bearer ${authToken}`),
        request(app).get('/api/screenplay/questions').set('Authorization', `Bearer ${authToken}`),
        request(app).get('/api/screenplay/tasks').set('Authorization', `Bearer ${authToken}`),
      ]);

      expect(actRes.body.data.filter((a: any) => a.userId === userId).length).toBe(0);
      expect(qRes.body.data.filter((q: any) => q.userId === userId).length).toBe(0);
      expect(taskRes.body.data.filter((t: any) => t.userId === userId).length).toBe(0);
    });
  });
});
