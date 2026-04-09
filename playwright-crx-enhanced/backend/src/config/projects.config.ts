/**
 * Project Configuration Manager
 * Dynamically loads project-specific settings from .env files or database
 */

import pool from '../db';

export interface ProjectConfig {
  id: string;
  name: string;
  environment: string;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    schema: string;
    url: string;
    maxClients: number;
    minClients: number;
  };
  server: {
    port: number;
    nodeEnv: string;
    allowedOrigins: string[];
  };
  externalApis: {
    boundaryApiUrl: string;
    positiveApiUrl: string;
    negativeApiUrl: string;
    securityApiUrl: string;
    equivalenceApiUrl: string;
    xpathDeepAnalysisUrl: string;
    uploadScriptXpathUrl: string;
    apiToken: string;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
  };
  features: {
    enableQueue: boolean;
    enableWorkerPool: boolean;
    workerPoolSize: number;
    workerConcurrency: number;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
  };
}

export interface ProjectsRegistry {
  [key: string]: ProjectConfig;
}

// --- Env Parsing Helpers ---

const parseBoolean = (value: string | undefined): boolean => {
  return value?.toLowerCase() === 'true';
};

const parseArrayFromEnv = (value: string | undefined): string[] => {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
};

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  return parseInt(value || String(fallback), 10);
};

/**
 * Build shared config sections that are identical between env-based and DB-based loading.
 * These sections only come from env vars (never from DB project rows).
 */
function buildSharedEnvSections() {
  const env = process.env;
  return {
    server: {
      port: parseIntEnv(env.PORT, 3001),
      nodeEnv: env.NODE_ENV || 'development',
      allowedOrigins: parseArrayFromEnv(env.ALLOWED_ORIGINS),
    },
    externalApis: {
      boundaryApiUrl: env.EXTERNAL_BOUNDARY_API_URL || '',
      positiveApiUrl: env.EXTERNAL_POSITIVE_API_URL || '',
      negativeApiUrl: env.EXTERNAL_NEGATIVE_API_URL || '',
      securityApiUrl: env.EXTERNAL_SECURITY_API_URL || '',
      equivalenceApiUrl: env.EXTERNAL_EQUIVALENCE_API_URL || '',
      xpathDeepAnalysisUrl: env.EXTERNAL_XPATH_DEEP_ANALYSIS_URL || '',
      uploadScriptXpathUrl: env.EXTERNAL_UPLOAD_SCRIPT_XPATH_URL || '',
      apiToken: env.EXTERNAL_API_TOKEN || '',
    },
    redis: {
      host: env.REDIS_HOST || 'localhost',
      port: parseIntEnv(env.REDIS_PORT, 6379),
      password: env.REDIS_PASSWORD || '',
      db: parseIntEnv(env.REDIS_DB, 0),
    },
    features: {
      enableQueue: parseBoolean(env.ENABLE_QUEUE),
      enableWorkerPool: parseBoolean(env.ENABLE_WORKER_POOL),
      workerPoolSize: parseIntEnv(env.WORKER_POOL_SIZE, 3),
      workerConcurrency: parseIntEnv(env.WORKER_CONCURRENCY, 5),
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET || 'default-access-secret',
      refreshSecret: env.JWT_REFRESH_SECRET || 'default-refresh-secret',
    },
  };
}

// --- Config Builders ---

/**
 * Build project configuration from environment variables
 */
export function buildProjectConfig(projectName: string): ProjectConfig {
  const env = process.env;

  if (!env.DB_HOST) throw new Error('DB_HOST is required');
  if (!env.DB_PORT) throw new Error('DB_PORT is required');
  if (!env.DB_NAME) throw new Error('DB_NAME is required');
  if (!env.DB_USER) throw new Error('DB_USER is required');
  if (!env.DB_PASSWORD) throw new Error('DB_PASSWORD is required');

  const dbPort = parseIntEnv(env.DB_PORT, 5432);

  return {
    id: projectName,
    name: env.PROJECT_DISPLAY_NAME || projectName,
    environment: env.NODE_ENV || 'development',
    database: {
      host: env.DB_HOST,
      port: dbPort,
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      schema: env.DB_SCHEMA || 'public',
      url: env.DATABASE_URL || `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${dbPort}/${env.DB_NAME}?schema=${env.DB_SCHEMA || 'public'}`,
      maxClients: parseIntEnv(env.DB_MAX_CLIENTS, 10),
      minClients: parseIntEnv(env.DB_MIN_CLIENTS, 2),
    },
    ...buildSharedEnvSections(),
  };
}

/**
 * Load project configuration from the database.
 * Merges DB-stored values with env defaults as fallback.
 */
export async function loadProjectConfigFromDb(projectId: string): Promise<ProjectConfig> {
  const { rows } = await pool.query('SELECT * FROM "Project" WHERE id = $1', [projectId]);
  if (!rows[0]) throw new Error(`Project ${projectId} not found in database`);

  const row = rows[0];
  const env = process.env;
  const dbPort = row.dbPort || parseIntEnv(env.DB_PORT, 5432);
  const dbHost = row.dbHost || env.DB_HOST || 'localhost';
  const dbName = row.dbName || env.DB_NAME || 'playwright_crx';
  const dbUser = row.dbUser || env.DB_USER || 'postgres';
  const dbPassword = row.dbPassword || env.DB_PASSWORD || '';

  return {
    id: row.id,
    name: row.name,
    environment: row.environment || env.NODE_ENV || 'development',
    database: {
      host: dbHost, port: dbPort, name: dbName, user: dbUser, password: dbPassword,
      schema: env.DB_SCHEMA || 'public',
      url: `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}?schema=${env.DB_SCHEMA || 'public'}`,
      maxClients: parseIntEnv(env.DB_MAX_CLIENTS, 10),
      minClients: parseIntEnv(env.DB_MIN_CLIENTS, 2),
    },
    ...buildSharedEnvSections(),
  };
}

// --- Loaders ---

/**
 * Dynamically load project configuration based on ACTIVE_PROJECT env var
 */
export function loadProjectConfig(): ProjectConfig {
  const projectName = process.env.ACTIVE_PROJECT;

  if (!projectName) {
    throw new Error(
      'ACTIVE_PROJECT environment variable is not set. ' +
      'Please set ACTIVE_PROJECT in your .env file (e.g., ACTIVE_PROJECT=project1)'
    );
  }

  const config = buildProjectConfig(projectName);

  if (!config.database.url) {
    throw new Error('Database URL could not be constructed from environment variables');
  }

  return config;
}

/**
 * Get all available project configurations from env
 */
export function getAllProjectConfigs(): ProjectsRegistry {
  const registry: ProjectsRegistry = {};
  const projectNames = (process.env.AVAILABLE_PROJECTS || 'default').split(',');

  projectNames.forEach(projectName => {
    try {
      registry[projectName.trim()] = buildProjectConfig(projectName.trim());
    } catch (error) {
      console.warn(`Failed to load configuration for project ${projectName}:`, error);
    }
  });

  return registry;
}

/**
 * Get all projects from database
 */
export async function getAllProjectsFromDb(): Promise<Array<{ id: string; name: string; baseUrl: string; apiBaseUrl: string; environment: string; tags: string }>> {
  const { rows } = await pool.query(
    'SELECT id, name, "baseUrl", "apiBaseUrl", environment, tags FROM "Project" ORDER BY name'
  );
  return rows;
}

/**
 * Validate that all required fields are set in a project config
 */
export function validateProjectConfig(config: ProjectConfig): void {
  const errors: string[] = [];
  if (!config.database.host) errors.push('Database host is required');
  if (!config.database.port) errors.push('Database port is required');
  if (!config.database.name) errors.push('Database name is required');
  if (!config.database.user) errors.push('Database user is required');
  if (!config.database.password) errors.push('Database password is required');

  if (errors.length > 0) {
    throw new Error(`Project configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get the current active project name
 */
export function getActiveProjectName(): string {
  return process.env.ACTIVE_PROJECT || 'default';
}
