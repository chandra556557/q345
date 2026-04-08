/**
 * Dynamic Features Support
 * Handles variable replacement in feature files and tags
 * Allows ${VARIABLE_NAME} substitution throughout scenarios
 */

import { Before } from '@cucumber/cucumber';
import { logger } from '../../src/utils/logger';

/**
 * Dynamic variables available in feature files
 * Can be referenced as ${VARIABLE_NAME}
 */
export const dynamicVariables = {
  PROJECT_NAME: process.env.ACTIVE_PROJECT || 'project1',
  API_BASE_URL: process.env.API_URL || 'http://localhost:3001',
  API_PORT: process.env.PORT || '3001',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || '5433',
  DB_NAME: process.env.DB_NAME || 'playwright_project1',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  TIMESTAMP: new Date().toISOString(),
  DATE: new Date().toISOString().split('T')[0]
};

/**
 * Resolve dynamic variables in a string
 * Replaces ${VARIABLE_NAME} with actual values
 */
export function resolveVariables(input: string, variables?: Record<string, any>): string {
  const varsToUse = (variables as Record<string, any>) || (dynamicVariables as Record<string, any>);

  return input.replace(/\$\{([A-Z_]+)\}/g, (match, variableName: string) => {
    const value = varsToUse[variableName];
    if (value === undefined) {
      logger.warn(`⚠️ Unknown variable: ${variableName}, keeping original`);
      return match;
    }
    return String(value);
  });
}

/**
 * Parse and resolve tags with variables
 * Converts @tag(${VAR}) to @tag(value)
 */
export function resolveTags(tags: Array<{ name: string }> | readonly any[], projectName: string): Array<{ name: string }> {
  return (tags as Array<any>).map(tag => ({
    ...tag,
    name: resolveVariables(tag.name, { ...dynamicVariables, PROJECT_NAME: projectName })
  }));
}

/**
 * Extract project name from scenario tags
 * Looks for @project(project1) or @project(${PROJECT_NAME})
 */
export function extractProjectFromTags(tags: Array<{ name: string }> | readonly any[], fallbackProject: string = 'project1'): string {
  const projectTag = (tags as Array<any>).find((tag: any) => tag.name.includes('@project'));

  if (!projectTag) {
    return fallbackProject;
  }

  // Extract: @project(project1) or @project(${PROJECT_NAME})
  const match = projectTag.name.match(/@project\(([^)]+)\)/);
  if (match) {
    let projectName = match[1];
    // Resolve variables
    projectName = resolveVariables(projectName);
    return projectName || fallbackProject;
  }

  return fallbackProject;
}

/**
 * Before Hook - Initialize dynamic variables for each scenario
 */
Before(function(scenario) {
  const projectName = process.env.ACTIVE_PROJECT || extractProjectFromTags(scenario.pickle.tags, 'project1');

  // Update dynamic variables
  dynamicVariables.PROJECT_NAME = projectName;
  dynamicVariables.API_BASE_URL = `http://localhost:3001?project=${projectName}`;
  dynamicVariables.TIMESTAMP = new Date().toISOString();
  dynamicVariables.DATE = new Date().toISOString().split('T')[0];

  // Store in Cucumber world
  this.projectName = projectName;
  this.apiBaseUrl = dynamicVariables.API_BASE_URL;
  this.resolveVariables = resolveVariables;
  this.dynamicVariables = dynamicVariables;

  logger.info(`\n📋 Scenario: ${scenario.pickle.name}`);
  logger.info(`🔹 Project: ${projectName}`);
  logger.info(`🔗 API URL: ${dynamicVariables.API_BASE_URL}`);
  logger.info(`🗓️  Timestamp: ${dynamicVariables.TIMESTAMP}`);
});

/**
 * Helper to resolve step parameters
 * Used in step definitions to replace variables in step text
 */
export function resolveStepParameter(stepText: string, world: any): string {
  return resolveVariables(stepText, {
    ...dynamicVariables,
    PROJECT_NAME: world.projectName,
    API_BASE_URL: world.apiBaseUrl
  });
}

/**
 * Example usage in step definitions:
 *
 * When('I send a GET request to {string}', async function(url: string) {
 *   const resolvedUrl = resolveStepParameter(url, this);
 *   // resolvedUrl: "http://localhost:3001?project=project1/api/users"
 *   const response = await axios.get(resolvedUrl);
 * });
 *
 * Given('the API is running on {string}', function(apiUrl: string) {
 *   const resolvedUrl = resolveStepParameter(apiUrl, this);
 *   // resolvedUrl: "http://localhost:3001?project=project1"
 *   this.apiUrl = resolvedUrl;
 * });
 */

export default {
  resolveVariables,
  resolveTags,
  extractProjectFromTags,
  resolveStepParameter,
  dynamicVariables
};
