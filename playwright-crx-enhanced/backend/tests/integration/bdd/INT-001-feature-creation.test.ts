/**
 * INT-001: End-to-End Feature Creation Flow
 *
 * Test complete flow:
 *   Create feature with Gherkin content > Parse and preview scenarios >
 *   Save to database > Verify feature appears in list > Edit and update > Delete feature
 */

import request from 'supertest';
import { app } from '../../../src/index';
import pool from '../../../src/db';
import {
  ensureTestUser,
  generateTestToken,
  cleanupTestData,
  SAMPLE_FEATURE_CONTENT,
  SAMPLE_FEATURE_CONTENT_OUTLINE,
  UPDATED_FEATURE_CONTENT,
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
});

describe('INT-001: End-to-End Feature Creation Flow', () => {
  let createdFeatureId: string;
  let createdOutlineFeatureId: string;

  // ─────────────────────────────────────────────
  // 1. Parse Gherkin content (preview without saving)
  // ─────────────────────────────────────────────
  describe('Step 1: Parse and preview Gherkin content', () => {
    it('should parse valid Gherkin feature content and return structured data', async () => {
      const res = await request(app)
        .post('/api/bdd/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ featureContent: SAMPLE_FEATURE_CONTENT });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parsed).toBeDefined();
      expect(res.body.data.playwrightCode).toBeDefined();

      const parsed = res.body.data.parsed;
      expect(parsed.name).toBe('User Login');
      expect(parsed.scenarios).toHaveLength(2);
      expect(parsed.scenarios[0].name).toBe('Successful login with valid credentials');
      expect(parsed.scenarios[0].type).toBe('Scenario');
      expect(parsed.scenarios[0].steps.length).toBeGreaterThanOrEqual(4);
      expect(parsed.scenarios[1].name).toBe('Failed login with invalid password');
    });

    it('should parse Scenario Outline with Examples table', async () => {
      const res = await request(app)
        .post('/api/bdd/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ featureContent: SAMPLE_FEATURE_CONTENT_OUTLINE });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const parsed = res.body.data.parsed;
      expect(parsed.name).toBe('Search Functionality');
      expect(parsed.scenarios).toHaveLength(1);
      expect(parsed.scenarios[0].type).toBe('Scenario Outline');
      expect(parsed.scenarios[0].examples).toBeDefined();
      expect(parsed.scenarios[0].examples.length).toBeGreaterThanOrEqual(2);
    });

    it('should generate Playwright code from parsed feature', async () => {
      const res = await request(app)
        .post('/api/bdd/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ featureContent: SAMPLE_FEATURE_CONTENT });

      expect(res.status).toBe(200);
      const code = res.body.data.playwrightCode;
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });

    it('should return 400 when featureContent is missing', async () => {
      const res = await request(app)
        .post('/api/bdd/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .post('/api/bdd/parse')
        .send({ featureContent: SAMPLE_FEATURE_CONTENT });

      expect(res.status).toBe(401);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Create a feature (save to database)
  // ─────────────────────────────────────────────
  describe('Step 2: Create features in database', () => {
    it('should create a feature with Gherkin content and auto-parse scenarios', async () => {
      const res = await request(app)
        .post('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'User Login',
          description: 'Tests for user login functionality',
          featureContent: SAMPLE_FEATURE_CONTENT,
          tags: ['smoke', 'login'],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('User Login');
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.scenarioCount).toBe(2);

      createdFeatureId = res.body.data.id;
    });

    it('should create a Scenario Outline feature', async () => {
      const res = await request(app)
        .post('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Search Functionality',
          featureContent: SAMPLE_FEATURE_CONTENT_OUTLINE,
          tags: ['search', 'data-driven'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.scenarioCount).toBe(1);
      createdOutlineFeatureId = res.body.data.id;
    });

    it('should return 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ featureContent: SAMPLE_FEATURE_CONTENT });

      expect(res.status).toBe(400);
    });

    it('should return 400 when featureContent is missing', async () => {
      const res = await request(app)
        .post('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Missing Content' });

      expect(res.status).toBe(400);
    });

    it('should auto-create scenarios and steps in database', async () => {
      // Verify scenarios were persisted
      const { rows: scenarios } = await pool.query(
        `SELECT * FROM "BDDScenario" WHERE "featureId" = $1 ORDER BY "sortOrder"`,
        [createdFeatureId]
      );
      expect(scenarios).toHaveLength(2);
      expect(scenarios[0].name).toBe('Successful login with valid credentials');
      expect(scenarios[0].scenarioType).toBe('Scenario');
      expect(scenarios[1].name).toBe('Failed login with invalid password');

      // Verify steps were persisted for first scenario
      const { rows: steps } = await pool.query(
        `SELECT * FROM "BDDStep" WHERE "scenarioId" = $1 ORDER BY "sortOrder"`,
        [scenarios[0].id]
      );
      expect(steps.length).toBeGreaterThanOrEqual(4);
      expect(steps[0].keyword).toBe('Given');
      expect(steps[0].text).toContain('login page');
    });
  });

  // ─────────────────────────────────────────────
  // 3. Verify feature appears in list
  // ─────────────────────────────────────────────
  describe('Step 3: List and retrieve features', () => {
    it('should list all features for the user', async () => {
      const res = await request(app)
        .get('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      const feature = res.body.data.find((f: any) => f.id === createdFeatureId);
      expect(feature).toBeDefined();
      expect(feature.name).toBe('User Login');
      expect(parseInt(feature.scenarioCount)).toBe(2);
    });

    it('should get a single feature with scenarios and steps', async () => {
      const res = await request(app)
        .get(`/api/bdd/features/${createdFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdFeatureId);
      expect(res.body.data.featureContent).toBe(SAMPLE_FEATURE_CONTENT);
      expect(res.body.data.scenarios).toHaveLength(2);
      expect(res.body.data.scenarios[0].steps.length).toBeGreaterThanOrEqual(4);
    });

    it('should return 404 for non-existent feature', async () => {
      const res = await request(app)
        .get('/api/bdd/features/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    it('should generate Playwright code from a saved feature', async () => {
      const res = await request(app)
        .post(`/api/bdd/features/${createdFeatureId}/generate`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.playwrightCode).toBeDefined();
      expect(typeof res.body.data.playwrightCode).toBe('string');
      expect(res.body.data.playwrightCode.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Update feature
  // ─────────────────────────────────────────────
  describe('Step 4: Update feature', () => {
    it('should update feature name and description', async () => {
      const res = await request(app)
        .put(`/api/bdd/features/${createdFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'User Login - Updated',
          description: 'Updated description for login tests',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('User Login - Updated');
      expect(res.body.data.description).toBe('Updated description for login tests');
    });

    it('should update feature content and re-parse scenarios/steps', async () => {
      const res = await request(app)
        .put(`/api/bdd/features/${createdFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          featureContent: UPDATED_FEATURE_CONTENT,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify scenarios were rebuilt
      const { rows: scenarios } = await pool.query(
        `SELECT * FROM "BDDScenario" WHERE "featureId" = $1 ORDER BY "sortOrder"`,
        [createdFeatureId]
      );
      expect(scenarios).toHaveLength(2);
      // New first scenario from UPDATED_FEATURE_CONTENT
      expect(scenarios[0].name).toBe('Successful login with valid credentials');

      // Verify old steps were replaced with new ones
      const { rows: steps } = await pool.query(
        `SELECT * FROM "BDDStep" WHERE "scenarioId" = $1 ORDER BY "sortOrder"`,
        [scenarios[0].id]
      );
      expect(steps.length).toBeGreaterThanOrEqual(2);
    });

    it('should update feature status', async () => {
      const res = await request(app)
        .put(`/api/bdd/features/${createdFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });

    it('should update feature tags', async () => {
      const res = await request(app)
        .put(`/api/bdd/features/${createdFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ tags: ['smoke', 'login', 'updated'] });

      expect(res.status).toBe(200);
    });

    it('should return 404 when updating non-existent feature', async () => {
      const res = await request(app)
        .put('/api/bdd/features/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Does not exist' });

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────
  // 5. Delete feature
  // ─────────────────────────────────────────────
  describe('Step 5: Delete features', () => {
    it('should delete the outline feature and cascade to scenarios/steps', async () => {
      const res = await request(app)
        .delete(`/api/bdd/features/${createdOutlineFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify cascade deletion of scenarios
      const { rows: scenarios } = await pool.query(
        `SELECT * FROM "BDDScenario" WHERE "featureId" = $1`,
        [createdOutlineFeatureId]
      );
      expect(scenarios).toHaveLength(0);
    });

    it('should return 404 when deleting already-deleted feature', async () => {
      const res = await request(app)
        .delete(`/api/bdd/features/${createdOutlineFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    it('should delete the main feature', async () => {
      const res = await request(app)
        .delete(`/api/bdd/features/${createdFeatureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone from list
      const listRes = await request(app)
        .get('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`);

      const found = listRes.body.data.find((f: any) => f.id === createdFeatureId);
      expect(found).toBeUndefined();
    });
  });
});
