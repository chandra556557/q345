/**
 * INT-004: Scheduled Runs Integration Flow
 *
 * Test complete flow:
 *   Create feature > Create schedule with cron > Verify schedule in list >
 *   Toggle enable/disable > Update cron expression > Delete schedule
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

  // Create a feature for scheduling
  const res = await request(app)
    .post('/api/bdd/features')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      name: 'Schedule Test Feature',
      description: 'Feature for scheduled runs testing',
      featureContent: SAMPLE_FEATURE_CONTENT,
      tags: ['schedule-test'],
    });

  featureId = res.body.data.id;
});

afterAll(async () => {
  await cleanupTestData(userId);
  await pool.end();
});

describe('INT-004: Scheduled Runs Integration Flow', () => {
  let scheduleId: string;

  // ─────────────────────────────────────────────
  // 1. Create a schedule
  // ─────────────────────────────────────────────
  describe('Step 1: Create a BDD schedule', () => {
    it('should create a schedule with cron expression', async () => {
      const res = await request(app)
        .post('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          featureId,
          cronExpression: '0 9 * * 1-5', // Weekdays at 9am
          browser: 'chromium',
          executionMode: 'headless',
          tags: '@smoke',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.cronExpression).toBe('0 9 * * 1-5');
      expect(res.body.data.browser).toBe('chromium');
      expect(res.body.data.enabled).toBe(true);
      scheduleId = res.body.data.id;
    });

    it('should reject schedule without featureId', async () => {
      const res = await request(app)
        .post('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          cronExpression: '0 9 * * *',
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ─────────────────────────────────────────────
  // 2. List schedules
  // ─────────────────────────────────────────────
  describe('Step 2: List schedules', () => {
    it('should return schedules for the user', async () => {
      const res = await request(app)
        .get('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const schedule = res.body.data.find((s: any) => s.id === scheduleId);
      expect(schedule).toBeDefined();
      expect(schedule.featureId).toBe(featureId);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Update schedule (toggle enable, change cron)
  // ─────────────────────────────────────────────
  describe('Step 3: Update schedule', () => {
    it('should disable the schedule', async () => {
      const res = await request(app)
        .put(`/api/bdd/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);
    });

    it('should update cron expression', async () => {
      const res = await request(app)
        .put(`/api/bdd/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          cronExpression: '30 18 * * *', // Daily at 6:30pm
          enabled: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.cronExpression).toBe('30 18 * * *');
      expect(res.body.data.enabled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Delete schedule
  // ─────────────────────────────────────────────
  describe('Step 4: Delete schedule', () => {
    it('should delete the schedule', async () => {
      const res = await request(app)
        .delete(`/api/bdd/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });

    it('should no longer appear in schedules list', async () => {
      const res = await request(app)
        .get('/api/bdd/schedules')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const schedule = res.body.data.find((s: any) => s.id === scheduleId);
      expect(schedule).toBeUndefined();
    });
  });
});
