/**
 * Project Manager Utility
 * Manages dynamic environment loading for multiple projects
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { logger } from './logger';

export interface ProjectInfo {
  name: string;
  envFilePath: string;
  exists: boolean;
  description?: string;
}

/**
 * Load environment variables from a specific project .env file
 * @param projectName - Name of the project (e.g., 'project1', 'project2')
 * @param baseDir - Base directory where .env files are located
 */
export function loadProjectEnvironment(
  projectName: string,
  baseDir: string = path.resolve(__dirname, '../../')
): void {
  const envFileName = `.env.${projectName}`;
  const envFilePath = path.join(baseDir, envFileName);

  if (!fs.existsSync(envFilePath)) {
    throw new Error(
      `Environment file not found: ${envFilePath}. ` +
      `Please create .env.${projectName} file in ${baseDir}`
    );
  }

  const envConfig = dotenv.parse(fs.readFileSync(envFilePath));

  // Load into process.env (always override for project-specific vars)
  const projectSpecificKeys = [
    'ACTIVE_PROJECT', 'PROJECT_DISPLAY_NAME',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SCHEMA', 'DATABASE_URL',
    'DB_MAX_CLIENTS', 'DB_MIN_CLIENTS', 'DB_IDLE_TIMEOUT', 'DB_QUERY_TIMEOUT', 'DB_CONNECTION_TIMEOUT',
    'PORT', 'NODE_ENV', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
    'ALLOWED_ORIGINS', 'AI_ANALYSIS_SERVICE_URL',
    'EXTERNAL_BOUNDARY_API_URL', 'EXTERNAL_POSITIVE_API_URL', 'EXTERNAL_NEGATIVE_API_URL',
    'EXTERNAL_SECURITY_API_URL', 'EXTERNAL_EQUIVALENCE_API_URL', 'EXTERNAL_XPATH_DEEP_ANALYSIS_URL',
    'EXTERNAL_UPLOAD_SCRIPT_XPATH_URL', 'EXTERNAL_API_TOKEN',
    'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_DB',
    'ENABLE_QUEUE', 'ENABLE_WORKER_POOL', 'WORKER_POOL_SIZE', 'WORKER_CONCURRENCY',
    'LOG_LEVEL', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS',
    'MAX_FILE_SIZE', 'UPLOAD_DIR', 'WS_PORT',
    'SESSION_TIMEOUT_MINUTES', 'REFRESH_TOKEN_DAYS'
  ];

  Object.keys(envConfig).forEach(key => {
    // Always set project-specific keys, for others only if not already set
    if (projectSpecificKeys.includes(key) || !process.env[key]) {
      process.env[key] = envConfig[key];
    }
  });

  logger.info(`✓ Loaded environment configuration for project: ${projectName}`);
}

/**
 * Load environment variables with fallback to default .env
 * @param projectName - Name of the project
 * @param baseDir - Base directory where .env files are located
 */
export function loadProjectEnvironmentWithFallback(
  projectName: string,
  baseDir: string = path.resolve(__dirname, '../../')
): void {
  try {
    loadProjectEnvironment(projectName, baseDir);
  } catch (error) {
    logger.warn(`Failed to load .env.${projectName}, falling back to .env`);
    const defaultEnvPath = path.join(baseDir, '.env');
    if (fs.existsSync(defaultEnvPath)) {
      dotenv.config({ path: defaultEnvPath });
      logger.info('✓ Loaded default .env file');
    } else {
      throw new Error(
        `Neither .env.${projectName} nor .env found. ` +
        `Please create at least one environment file.`
      );
    }
  }
}

/**
 * List all available project environment files
 * @param baseDir - Base directory to search for .env files
 */
export function listAvailableProjects(
  baseDir: string = path.resolve(__dirname, '../../')
): ProjectInfo[] {
  const files = fs.readdirSync(baseDir);
  const projects: ProjectInfo[] = [];

  // Find all .env.* files
  files.forEach(file => {
    if (file.startsWith('.env.') && !file.endsWith('.example')) {
      const projectName = file.replace('.env.', '');
      projects.push({
        name: projectName,
        envFilePath: path.join(baseDir, file),
        exists: true,
      });
    }
  });

  return projects;
}

/**
 * Verify that all required environment variables are set for a project
 * @param requiredVars - List of required environment variable names
 */
export function validateRequiredEnvVars(requiredVars: string[]): string[] {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  return missingVars;
}

/**
 * Get environment variable with type safety
 */
export function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value || defaultValue || '';
}

export function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  const numValue = parseInt(value || String(defaultValue), 10);
  if (isNaN(numValue)) {
    throw new Error(`Environment variable ${key} is not a valid number: ${value}`);
  }
  return numValue;
}

export function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  const boolValue = (value || String(defaultValue)).toLowerCase() === 'true';
  return boolValue;
}

export function getEnvArray(key: string, defaultValue?: string[]): string[] {
  const value = process.env[key];
  if (!value && !defaultValue) {
    return [];
  }
  const arrayValue = (value || '').split(',').map(s => s.trim()).filter(Boolean);
  return arrayValue.length > 0 ? arrayValue : (defaultValue || []);
}

/**
 * Print current environment configuration (sensitive values masked)
 */
export function printEnvironmentSummary(): void {

  const summary = {
    projectName: process.env.ACTIVE_PROJECT || 'default',
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || '3001',
    database: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      name: process.env.DB_NAME,
    },
  };

  logger.info('Environment Configuration:');
  logger.info(JSON.stringify(summary, null, 2));
}

/**
 * Create a .env file from template
 */
export function createProjectEnvFile(
  projectName: string,
  templatePath?: string,
  outputDir: string = path.resolve(__dirname, '../../')
): void {
  const envFileName = `.env.${projectName}`;
  const outputPath = path.join(outputDir, envFileName);

  if (fs.existsSync(outputPath)) {
    throw new Error(`File already exists: ${outputPath}`);
  }

  let template = '';
  if (templatePath && fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf-8');
  } else {
    // Create basic template
    template = `# ============================================
# ${projectName.toUpperCase()} ENVIRONMENT CONFIGURATION
# ============================================

ACTIVE_PROJECT=${projectName}
PROJECT_DISPLAY_NAME=${projectName}

# DATABASE CONFIGURATION
DB_HOST=localhost
DB_PORT=5432
DB_NAME=playwright_${projectName}
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SCHEMA=public

# SERVER CONFIGURATION
PORT=3001
NODE_ENV=development

# JWT Secrets
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# REDIS CONFIGURATION
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# FEATURE FLAGS
ENABLE_QUEUE=false
ENABLE_WORKER_POOL=false
`;
  }

  fs.writeFileSync(outputPath, template, 'utf-8');
  logger.info(`✓ Created environment file: ${outputPath}`);
}
