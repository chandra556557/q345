/**
 * Cucumber Hooks for Project Management
 * Loads project-specific configuration before each scenario
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

/**
 * Before All Hook - Runs once before all scenarios
 */
BeforeAll(async function() {
  const projectName = process.env.ACTIVE_PROJECT || 'default';
  console.log(`\n📦 Initializing Cucumber tests for project: ${projectName}`);

  // List available projects
  const projects = listAvailableProjects();
  if (projects.length > 0) {
    console.log(`📋 Available projects: ${projects.map(p => p.name).join(', ')}`);
  }
});

/**
 * Before Hook - Runs before each scenario
 */
Before(async function(scenario) {
  const projectName = process.env.ACTIVE_PROJECT || scenario.pickle.tags.find(tag => tag.name.startsWith('@project'))?.name || 'default';

  console.log(`\n🎯 Scenario: ${scenario.pickle.name}`);
  console.log(`📍 Project: ${projectName}`);

  // Skip database config for SauceDemo UI tests
  const isSaucedemoTest = scenario.pickle.tags.some(tag => tag.name === '@saucedemo' || tag.name === '@login' || tag.name === '@logout' || tag.name === '@shopping-cart' || tag.name === '@checkout');

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

    // Load project configuration
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
  const projectTag = scenario.pickle.tags.find(tag => tag.name.startsWith('@project'));
  if (projectTag) {
    const projectName = projectTag.name.replace('@project(', '').replace(')', '');
    process.env.ACTIVE_PROJECT = projectName;
    console.log(`🏷️  Project tag: ${projectName}`);
  }
});

/**
 * After Hook - Runs after each scenario
 */
After(async function(scenario) {
  if (scenario.result?.status === 'PASSED') {
    console.log(`✓ Scenario passed`);
  } else if (scenario.result?.status === 'FAILED') {
    console.log(`✗ Scenario failed`);
    console.log(`  Error: ${scenario.result.message}`);
  } else {
    console.log(`⊘ Scenario skipped`);
  }
});

/**
 * After All Hook - Runs once after all scenarios
 */
AfterAll(async function() {
  console.log(`\n✓ All Cucumber tests completed`);
});

/**
 * Helper to get current project context
 */
export function getProjectContext(): ProjectContext {
  return projectContext;
}

/**
 * Helper to set project context
 */
export function setProjectContext(context: Partial<ProjectContext>) {
  Object.assign(projectContext, context);
}

/**
 * Helper to get API base URL
 */
export function getApiBaseUrl(): string {
  return projectContext.apiBaseUrl || 'http://localhost:3001';
}

/**
 * Helper to get database connection info
 */
export function getDatabaseInfo() {
  return projectContext.config?.database;
}
