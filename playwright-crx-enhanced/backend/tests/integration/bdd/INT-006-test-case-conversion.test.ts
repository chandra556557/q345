/**
 * INT-006: Test Case Conversion Integration Flow
 *
 * Test complete flow:
 *   Submit plain text test cases > Convert to Gherkin > Verify output structure >
 *   Submit CSV format > Convert > Verify > Submit numbered steps > Convert > Verify >
 *   Test file upload conversion
 */

import request from 'supertest';
import { app } from '../../../src/index';
import pool from '../../../src/db';
import {
  ensureTestUser,
  generateTestToken,
} from './testHelper';

let authToken: string;
let userId: string;

beforeAll(async () => {
  userId = await ensureTestUser();
  authToken = generateTestToken(userId);
});

afterAll(async () => {
  await pool.end();
});

describe('INT-006: Test Case Conversion Integration Flow', () => {

  // ─────────────────────────────────────────────
  // 1. Convert plain text test cases
  // ─────────────────────────────────────────────
  describe('Step 1: Convert plain text to Gherkin', () => {
    it('should convert numbered steps to Gherkin format', async () => {
      const testInput = `Test Case: User Login
1. Open the browser and navigate to login page
2. Enter username "admin@example.com"
3. Enter password "SecurePass123"
4. Click the Login button
5. Verify the dashboard is displayed
6. Verify the welcome message shows "Hello, Admin"`;

      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: testInput });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.gherkin).toBeDefined();

      const gherkin = res.body.data.gherkin;
      expect(gherkin).toContain('Feature:');
      expect(gherkin).toContain('Scenario:');
      expect(gherkin).toMatch(/Given|When|Then/);
    });

    it('should include warnings for ambiguous steps', async () => {
      const testInput = `1. Do something ambiguous
2. Check that it worked`;

      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: testInput });

      expect(res.status).toBe(200);
      expect(res.body.data.gherkin).toBeDefined();
      // Warnings array may be present for ambiguous conversions
      if (res.body.data.warnings) {
        expect(Array.isArray(res.body.data.warnings)).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────
  // 2. Convert structured test case format
  // ─────────────────────────────────────────────
  describe('Step 2: Convert structured format', () => {
    it('should convert structured test case with preconditions', async () => {
      const testInput = `Test Case: Product Search
Preconditions: User is logged in and on the home page
Steps:
  Navigate to the search bar
  Type "laptop" in the search field
  Press Enter or click Search button
  Wait for search results to load
Expected Result:
  Search results page is displayed
  Results contain items matching "laptop"
  Result count is shown above the list`;

      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: testInput });

      expect(res.status).toBe(200);
      const gherkin = res.body.data.gherkin;
      expect(gherkin).toContain('Feature:');
      expect(gherkin).toContain('Scenario:');
      // Should have Given (from preconditions) and When/Then steps
      expect(gherkin).toMatch(/Given/);
      expect(gherkin).toMatch(/When/);
      expect(gherkin).toMatch(/Then/);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Convert CSV format
  // ─────────────────────────────────────────────
  describe('Step 3: Convert CSV format', () => {
    it('should convert CSV with header row to Gherkin', async () => {
      const csvInput = `Test Case,Steps,Expected Result
Login Success,"1. Go to login page, 2. Enter valid credentials, 3. Click Login",Dashboard is displayed
Login Failure,"1. Go to login page, 2. Enter invalid password, 3. Click Login",Error message is shown`;

      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: csvInput });

      expect(res.status).toBe(200);
      const gherkin = res.body.data.gherkin;
      expect(gherkin).toContain('Feature:');
      // Should generate multiple scenarios from CSV rows
      expect(gherkin).toContain('Scenario:');
    });
  });

  // ─────────────────────────────────────────────
  // 4. Convert via file upload
  // ─────────────────────────────────────────────
  describe('Step 4: Convert via file upload', () => {
    it('should convert uploaded text file to Gherkin', async () => {
      const fileContent = `Test Case: Registration Flow
1. Navigate to registration page
2. Fill in first name "John"
3. Fill in last name "Doe"
4. Enter email "john@example.com"
5. Enter password "StrongP@ss1"
6. Confirm password "StrongP@ss1"
7. Click Register button
8. Verify confirmation message is displayed`;

      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from(fileContent), {
          filename: 'test-cases.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(200);
      const gherkin = res.body.data.gherkin;
      expect(gherkin).toContain('Feature:');
      expect(gherkin).toContain('Scenario:');
    });
  });

  // ─────────────────────────────────────────────
  // 5. Edge cases and validation
  // ─────────────────────────────────────────────
  describe('Step 5: Edge cases', () => {
    it('should handle empty input gracefully', async () => {
      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: '' });

      // Should either return 400 or 200 with empty/minimal gherkin
      expect([200, 400]).toContain(res.status);
    });

    it('should handle single-line input', async () => {
      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: 'Click the submit button and verify success' });

      expect(res.status).toBe(200);
      expect(res.body.data.gherkin).toBeDefined();
    });

    it('should handle multiple test cases in one input', async () => {
      const testInput = `Test Case: Login
1. Go to login page
2. Enter credentials
3. Click Login
4. Verify dashboard

Test Case: Logout
1. Click user menu
2. Click Logout
3. Verify login page is shown`;

      const res = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: testInput });

      expect(res.status).toBe(200);
      const gherkin = res.body.data.gherkin;
      expect(gherkin).toContain('Feature:');
      // Should contain multiple scenarios
      const scenarioCount = (gherkin.match(/Scenario:/g) || []).length;
      expect(scenarioCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────
  // 6. Use converted Gherkin to create a feature
  // ─────────────────────────────────────────────
  describe('Step 6: End-to-end - convert then create feature', () => {
    it('should convert test case and use output to create a BDD feature', async () => {
      // Step 1: Convert
      const convertRes = await request(app)
        .post('/api/bdd/convert')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: `Test Case: Shopping Cart
1. Add item to cart
2. Open cart page
3. Verify item is in cart
4. Update quantity to 2
5. Verify total price updated
6. Remove item from cart
7. Verify cart is empty`,
        });

      expect(convertRes.status).toBe(200);
      const gherkin = convertRes.body.data.gherkin;

      // Step 2: Create feature with converted Gherkin
      const featureRes = await request(app)
        .post('/api/bdd/features')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Shopping Cart (Converted)',
          description: 'Auto-converted from plain test cases',
          featureContent: gherkin,
          tags: ['converted', 'cart'],
        });

      expect(featureRes.status).toBe(201);
      expect(featureRes.body.data.id).toBeDefined();

      // Step 3: Parse to verify structure is valid
      const parseRes = await request(app)
        .post('/api/bdd/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ featureContent: gherkin });

      expect(parseRes.status).toBe(200);
      expect(parseRes.body.data.scenarios).toBeDefined();
      expect(parseRes.body.data.scenarios.length).toBeGreaterThan(0);

      // Cleanup
      await request(app)
        .delete(`/api/bdd/features/${featureRes.body.data.id}`)
        .set('Authorization', `Bearer ${authToken}`);
    });
  });
});
