/**
 * Step Definitions for Project Management
 * Allows switching projects and managing project-specific configurations
 */

import { Given, When, Then, World } from '@cucumber/cucumber';
import axios from 'axios';
import { loadProjectEnvironmentWithFallback, listAvailableProjects } from '../../src/utils/projectManager';
import { loadProjectConfig } from '../../src/config/projects.config';
import { setProjectContext, getApiBaseUrl } from '../hooks/projectHooks';

/**
 * Given I use project "{projectName}"
 * Switches to a specific project configuration
 */
Given('I use project {string}', async function(this: World & any, projectName: string) {
  console.log(`\n📦 Switching to project: ${projectName}`);

  try {
    // Load project environment
    loadProjectEnvironmentWithFallback(projectName);

    // Load project configuration
    const config = loadProjectConfig();

    // Update context
    setProjectContext({
      projectName,
      config,
      apiBaseUrl: `http://localhost:${config.server.port}`,
    });

    // Store in world
    this.projectName = projectName;
    this.projectConfig = config;
    this.apiBaseUrl = getApiBaseUrl();

    console.log(`✓ Switched to project: ${projectName}`);
    console.log(`✓ API URL: ${this.apiBaseUrl}`);
    console.log(`✓ Database: ${config.database.host}:${config.database.port}/${config.database.name}`);
  } catch (error: any) {
    throw new Error(`Failed to switch project: ${error.message}`);
  }
});

/**
 * Given the following projects are available
 * Verifies that specified projects exist
 */
Given('the following projects are available:', async function(this: World & any, dataTable: any) {
  const projects = listAvailableProjects();
  const projectNames = projects.map(p => p.name);

  const requiredProjects = dataTable.raw().flat();
  const missingProjects = requiredProjects.filter((p: string) => !projectNames.includes(p));

  if (missingProjects.length > 0) {
    throw new Error(
      `Missing projects: ${missingProjects.join(', ')}. ` +
      `Available: ${projectNames.join(', ')}`
    );
  }

  console.log(`✓ All required projects are available`);
  this.availableProjects = projectNames;
});

/**
 * Given I have project "{projectName}" with database name "{dbName}"
 * Validates project database configuration
 */
Given('I have project {string} with database name {string}', async function(
  this: World & any,
  projectName: string,
  expectedDbName: string
) {
  try {
    // Set environment variable and reload
    process.env.ACTIVE_PROJECT = projectName;
    loadProjectEnvironmentWithFallback(projectName);
    const config = loadProjectConfig();

    if (config.database.name !== expectedDbName) {
      throw new Error(
        `Expected database "${expectedDbName}" but got "${config.database.name}"`
      );
    }

    // Update world context
    this.projectName = projectName;
    this.projectConfig = config;
    this.apiBaseUrl = `http://localhost:${config.server.port}`;
    this.database = config.database;

    console.log(`✓ Project "${projectName}" uses database "${expectedDbName}"`);
  } catch (error: any) {
    throw new Error(`Failed to verify project: ${error.message}`);
  }
});

/**
 * When I call the health check endpoint
 * Verifies the API is healthy for the current project
 */
When('I call the health check endpoint', async function(this: World & any) {
  const apiUrl = this.apiBaseUrl || getApiBaseUrl();

  try {
    const response = await axios.get(`${apiUrl}/health`, {
      timeout: 5000,
    });

    this.healthResponse = response.data;
    this.lastResponse = response;

    console.log(`✓ Health check successful`);
    console.log(`  Status: ${response.data.status}`);
  } catch (error: any) {
    this.lastError = error;
    throw new Error(
      `Health check failed: ${error.response?.data?.message || error.message}`
    );
  }
});

/**
 * When I call the database health check endpoint
 * Verifies the database connection for the current project
 */
When('I call the database health check endpoint', async function(this: World & any) {
  const apiUrl = this.apiBaseUrl || getApiBaseUrl();

  try {
    const response = await axios.get(`${apiUrl}/db/health`, {
      timeout: 5000,
    });

    this.dbHealthResponse = response.data;
    this.lastResponse = response;

    console.log(`✓ Database health check successful`);
    console.log(`  Status: ${response.data.status}`);
  } catch (error: any) {
    this.lastError = error;
    throw new Error(
      `Database health check failed: ${error.response?.data?.message || error.message}`
    );
  }
});

/**
 * When I make a request to "{endpoint}"
 * Makes an HTTP request to the specified endpoint
 */
When('I make a request to {string}', async function(this: World & any, endpoint: string) {
  const apiUrl = this.apiBaseUrl || getApiBaseUrl();
  const fullUrl = `${apiUrl}${endpoint}`;

  try {
    const response = await axios.get(fullUrl, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.lastResponse = response;
    this.responseBody = response.data;
    this.responseStatus = response.status;

    console.log(`✓ Request successful: ${response.status}`);
  } catch (error: any) {
    this.lastError = error;
    this.lastResponse = error.response;
    this.responseStatus = error.response?.status;
    throw new Error(`Request failed: ${error.message}`);
  }
});

/**
 * Then the API should return status {int}
 * Verifies the HTTP response status code
 */
Then('the API should return status {int}', function(this: World & any, expectedStatus: number) {
  const actualStatus = this.responseStatus || this.lastResponse?.status;

  if (actualStatus !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus} but got ${actualStatus}`
    );
  }

  console.log(`✓ Correct status: ${expectedStatus}`);
});

/**
 * Then the response should contain {string}
 * Verifies response contains a specific property or text
 */
Then('the response should contain {string}', function(this: World & any, expectedContent: string) {
  const responseBody = JSON.stringify(this.responseBody || this.lastResponse?.data || {});

  if (!responseBody.includes(expectedContent)) {
    throw new Error(
      `Expected response to contain "${expectedContent}" but got: ${responseBody}`
    );
  }

  console.log(`✓ Response contains: ${expectedContent}`);
});

/**
 * Then the health check status should be {string}
 * Verifies health check status
 */
Then('the health check status should be {string}', function(
  this: World & any,
  expectedStatus: string
) {
  const actualStatus = this.healthResponse?.status || this.lastResponse?.data?.status;

  if (actualStatus !== expectedStatus) {
    throw new Error(
      `Expected health status "${expectedStatus}" but got "${actualStatus}"`
    );
  }

  console.log(`✓ Health status: ${expectedStatus}`);
});

/**
 * Then the environment should be {string}
 * Verifies the environment returned by health check
 */
Then('the environment should be {string}', function(
  this: World & any,
  expectedEnv: string
) {
  const actualEnv = this.healthResponse?.environment || this.lastResponse?.data?.environment;

  if (actualEnv !== expectedEnv) {
    throw new Error(
      `Expected environment "${expectedEnv}" but got "${actualEnv}"`
    );
  }

  console.log(`✓ Environment: ${expectedEnv}`);
});

/**
 * Then I should be using project {string}
 * Verifies the current active project
 */
Then('I should be using project {string}', function(this: World & any, expectedProject: string) {
  const actualProject = this.projectName || process.env.ACTIVE_PROJECT || 'default';

  if (actualProject !== expectedProject) {
    throw new Error(
      `Expected project "${expectedProject}" but got "${actualProject}"`
    );
  }

  console.log(`✓ Using project: ${expectedProject}`);
});

/**
 * Then the project should have database {string}
 * Verifies the project uses the expected database
 */
Then('the project should have database {string}', function(
  this: World & any,
  expectedDb: string
) {
  const actualDb = this.projectConfig?.database?.name;

  if (actualDb !== expectedDb) {
    throw new Error(
      `Expected database "${expectedDb}" but got "${actualDb}"`
    );
  }

  console.log(`✓ Database: ${expectedDb}`);
});

/**
 * Then the project should use port {int}
 * Verifies the project uses the expected port
 */
Then('the project should use port {int}', function(this: World & any, expectedPort: number) {
  const actualPort = this.projectConfig?.server?.port;

  if (actualPort !== expectedPort) {
    throw new Error(
      `Expected port ${expectedPort} but got ${actualPort}`
    );
  }

  console.log(`✓ Port: ${expectedPort}`);
});
