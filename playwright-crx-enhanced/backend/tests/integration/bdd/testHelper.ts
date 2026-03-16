import * as jwt from 'jsonwebtoken';
import pool from '../../../src/db';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';

// Test user that will be created/reused across tests
export const TEST_USER = {
  email: 'bdd-test-user@integration.test',
  password: 'TestPassword123!',
  name: 'BDD Test User',
};

let testUserId: string | null = null;

/**
 * Ensure a test user exists in the database and return their ID
 */
export async function ensureTestUser(): Promise<string> {
  if (testUserId) return testUserId;

  // Check if user already exists
  const { rows: existing } = await pool.query(
    `SELECT id FROM "User" WHERE email = $1`,
    [TEST_USER.email]
  );

  if (existing.length > 0) {
    testUserId = existing[0].id;
    return testUserId!;
  }

  // Create user with hashed password
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(TEST_USER.password, 10);

  const { rows } = await pool.query(
    `INSERT INTO "User" (id, email, password, name, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())
     RETURNING id`,
    [TEST_USER.email, hashedPassword, TEST_USER.name]
  );

  testUserId = rows[0].id;
  return testUserId!;
}

/**
 * Generate a valid JWT access token for the test user
 */
export function generateTestToken(userId: string, email: string = TEST_USER.email): string {
  return jwt.sign(
    { userId, email, type: 'access' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Clean up all BDD test data created by the test user
 */
export async function cleanupTestData(userId: string): Promise<void> {
  await pool.query(`DELETE FROM "BDDRun" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "BDDFeature" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "BDDStepLibrary" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "BDDSchedule" WHERE "userId" = $1`, [userId]);
}

/**
 * Clean up test user entirely
 */
export async function cleanupTestUser(): Promise<void> {
  if (testUserId) {
    await cleanupTestData(testUserId);
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [testUserId]);
    testUserId = null;
  }
}

/**
 * Sample Gherkin feature content for testing
 */
export const SAMPLE_FEATURE_CONTENT = `Feature: User Login
  As a registered user
  I want to login to the application
  So that I can access my dashboard

  @smoke
  Scenario: Successful login with valid credentials
    Given I am on the login page
    When I enter "admin@test.com" in the email field
    And I enter "password123" in the password field
    And I click the "Login" button
    Then I should see the dashboard page
    And I should see a welcome message

  @regression
  Scenario: Failed login with invalid password
    Given I am on the login page
    When I enter "admin@test.com" in the email field
    And I enter "wrongpassword" in the password field
    And I click the "Login" button
    Then I should see an error message "Invalid credentials"
`;

export const SAMPLE_FEATURE_CONTENT_OUTLINE = `Feature: Search Functionality
  As a user
  I want to search for products
  So that I can find what I need

  @data-driven
  Scenario Outline: Search with different keywords
    Given I am on the search page
    When I search for "<keyword>"
    Then I should see results containing "<keyword>"
    And the result count should be greater than 0

    Examples:
      | keyword   |
      | laptop    |
      | phone     |
      | headphones|
`;

export const UPDATED_FEATURE_CONTENT = `Feature: User Login - Updated
  As a registered user
  I want to login to the application
  So that I can access my dashboard

  @smoke @updated
  Scenario: Successful login with valid credentials
    Given I am on the login page
    When I enter valid credentials
    Then I should see the dashboard page

  @regression @updated
  Scenario: Failed login with empty fields
    Given I am on the login page
    When I click the "Login" button without entering credentials
    Then I should see validation errors
`;
