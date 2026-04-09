/**
 * Cucumber Hooks for Project Management
 * Loads project-specific configuration before each scenario
 * Cleans up database and restores env vars after each scenario
 */

import { Before, After, BeforeAll, AfterAll } from '@cucumber/cucumber';
import { loadProjectEnvironmentWithFallback, listAvailableProjects } from '../../src/utils/projectManager';
import { loadProjectConfig } from '../../src/config/projects.config';

// Global context for storing project config during tests
export interface ProjectContext {
  projectName: string;
  config?: any;
  database?: any;
  apiBaseUrl?: string;
}

const projectContext: ProjectContext = {
  projectName: process.env.ACTIVE_PROJECT || 'default',
};

// Snapshot of env vars before each scenario — used to restore after
let envSnapshot: Record<string, string | undefined> = {};

/** Take snapshot of critical env vars */
function snapshotEnv(): void {
  const TRACKED_KEYS = [
    'ACTIVE_PROJECT', 'API_BASE_URL', 'BASE_URL',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'NODE_ENV', 'PORT',
  ];
  envSnapshot = {};
  for (const key of TRACKED_KEYS) {
    envSnapshot[key] = process.env[key];
  }
}

/** Restore env vars from snapshot */
function restoreEnv(): void {
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Before All Hook - Runs once before all scenarios
 */
BeforeAll(async function() {
  const projectName = process.env.ACTIVE_PROJECT || 'default';
  console.log(`\n📦 Initializing Cucumber tests for project: ${projectName}`);

  // Take initial env snapshot
  snapshotEnv();

  const projects = listAvailableProjects();
  if (projects.length > 0) {
    console.log(`📋 Available projects: ${projects.map(p => p.name).join(', ')}`);
  }
});

/**
 * Before Hook - Runs before each scenario
 */
Before(async function(scenario) {
  // Snapshot env before any project switching
  snapshotEnv();

  const projectName = process.env.ACTIVE_PROJECT || scenario.pickle.tags.find(tag => tag.name.startsWith('@project'))?.name || 'default';

  console.log(`\n🎯 Scenario: ${scenario.pickle.name}`);
  console.log(`📍 Project: ${projectName}`);

  // Initialize cleanup tracker for this scenario
  this._cleanupActions = [];

  // Skip database config for SauceDemo UI tests
  const isSaucedemoTest = scenario.pickle.tags.some(
    (tag: any) => tag.name === '@saucedemo' || tag.name === '@login' || tag.name === '@logout' || tag.name === '@shopping-cart' || tag.name === '@checkout'
  );

  if (isSaucedemoTest) {
    console.log(`✓ SauceDemo test detected - skipping database config`);
    this.projectName = 'saucedemo';
    this.apiBaseUrl = 'https://saucedemo.com';
    return;
  }

  // Load project environment
  try {
    if (projectName !== 'default') {
      loadProjectEnvironmentWithFallback(projectName);
    }
    projectContext.projectName = projectName;

    const config = loadProjectConfig();
    projectContext.config = config;
    projectContext.apiBaseUrl = `http://localhost:${config.server.port}`;

    // Store in Cucumber world
    this.projectName = projectName;
    this.projectConfig = config;
    this.apiBaseUrl = projectContext.apiBaseUrl;
    this.database = config.database;

    console.log(`✓ Project config loaded`);
    console.log(`✓ API Base URL: ${this.apiBaseUrl}`);
    console.log(`✓ Database: ${config.database.host}:${config.database.port}/${config.database.name}`);
  } catch (error: any) {
    console.error(`✗ Failed to load project config: ${error.message}`);
    throw error;
  }
});

/**
 * Before Hook for @project tag parsing
 * Allows scenarios to specify project using @project(name) tag
 */
Before({ tags: '@project' }, async function(scenario) {
  const projectTag = scenario.pickle.tags.find((tag: any) => tag.name.startsWith('@project'));
  if (projectTag) {
    const projectName = projectTag.name.replace('@project(', '').replace(')', '');
    process.env.ACTIVE_PROJECT = projectName;
    console.log(`🏷️  Project tag: ${projectName}`);
  }
});

/**
 * After Hook - Runs after each scenario
 * Handles: logging, database cleanup, env var restoration
 */
After(async function(scenario) {
  // Log result
  if (scenario.result?.status === 'PASSED') {
    console.log(`✓ Scenario passed`);
  } else if (scenario.result?.status === 'FAILED') {
    console.log(`✗ Scenario failed`);
    console.log(`  Error: ${scenario.result.message}`);
  } else {
    console.log(`⊘ Scenario skipped`);
  }

  // Run any registered cleanup actions (e.g., delete test data)
  if (this._cleanupActions && Array.isArray(this._cleanupActions)) {
    for (const cleanup of this._cleanupActions) {
      try {
        await cleanup();
      } catch (cleanupErr: any) {
        console.warn(`⚠ Cleanup action failed: ${cleanupErr.message}`);
      }
    }
    this._cleanupActions = [];
  }

  // Database cleanup: rollback any uncommitted transactions
  if (this._dbClient) {
    try {
      await this._dbClient.query('ROLLBACK');
      this._dbClient.release();
      this._dbClient = null;
      console.log(`✓ Database transaction rolled back`);
    } catch {
      // Connection already released or no active transaction
    }
  }

  // Clear test-specific world state to prevent leaks
  this.lastResponse = undefined;
  this.lastError = undefined;
  this.responseStatus = undefined;
  this.testFixtures = new Map();
  this.seedDataMap = new Map();

  // Restore env vars to pre-scenario state
  restoreEnv();
  console.log(`✓ Environment restored`);
});

/**
 * After All Hook - Runs once after all scenarios
 */
AfterAll(async function() {
  // Final env restoration
  restoreEnv();
  console.log(`\n✓ All Cucumber tests completed`);
  console.log(`✓ Environment variables restored to original state`);
});

// --- Exported Helpers ---

export function getProjectContext(): ProjectContext {
  return projectContext;
}

export function setProjectContext(context: Partial<ProjectContext>) {
  Object.assign(projectContext, context);
}

export function getApiBaseUrl(): string {
  return projectContext.apiBaseUrl || 'http://localhost:3001';
}

export function getDatabaseInfo() {
  return projectContext.config?.database;
}
