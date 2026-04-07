/**
 * Project Configuration Manager
 * Dynamically loads project-specific settings from .env files
 */

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

const parseBoolean = (value: string | undefined): boolean => {
  return value?.toLowerCase() === 'true';
};

const parseArrayFromEnv = (value: string | undefined): string[] => {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
};

/**
 * Build project configuration from environment variables
 */
export function buildProjectConfig(projectName: string): ProjectConfig {
  const env = process.env;

  // Validate required environment variables
  if (!env.DB_HOST) throw new Error('DB_HOST is required');
  if (!env.DB_PORT) throw new Error('DB_PORT is required');
  if (!env.DB_NAME) throw new Error('DB_NAME is required');
  if (!env.DB_USER) throw new Error('DB_USER is required');
  if (!env.DB_PASSWORD) throw new Error('DB_PASSWORD is required');

  const dbPort = parseInt(env.DB_PORT || '5432', 10);
  const redisPort = parseInt(env.REDIS_PORT || '6379', 10);
  const serverPort = parseInt(env.PORT || '3001', 10);
  const dbMaxClients = parseInt(env.DB_MAX_CLIENTS || '10', 10);
  const dbMinClients = parseInt(env.DB_MIN_CLIENTS || '2', 10);
  const workerPoolSize = parseInt(env.WORKER_POOL_SIZE || '3', 10);
  const workerConcurrency = parseInt(env.WORKER_CONCURRENCY || '5', 10);

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
      maxClients: dbMaxClients,
      minClients: dbMinClients,
    },
    server: {
      port: serverPort,
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
      port: redisPort,
      password: env.REDIS_PASSWORD || '',
      db: parseInt(env.REDIS_DB || '0', 10),
    },
    features: {
      enableQueue: parseBoolean(env.ENABLE_QUEUE),
      enableWorkerPool: parseBoolean(env.ENABLE_WORKER_POOL),
      workerPoolSize,
      workerConcurrency,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET || 'default-access-secret',
      refreshSecret: env.JWT_REFRESH_SECRET || 'default-refresh-secret',
    },
  };
}

/**
 * Dynamically load project configuration based on environment
 */
export function loadProjectConfig(): ProjectConfig {
  const projectName = process.env.ACTIVE_PROJECT || 'default';

  if (!projectName) {
    throw new Error(
      'ACTIVE_PROJECT environment variable is not set. ' +
      'Please set ACTIVE_PROJECT in your .env file (e.g., ACTIVE_PROJECT=project1)'
    );
  }

  const config = buildProjectConfig(projectName);

  // Validate critical configuration
  if (!config.database.url) {
    throw new Error('Database URL could not be constructed from environment variables');
  }

  return config;
}

/**
 * Get all available project configurations
 * This would typically load from a projects directory
 */
export function getAllProjectConfigs(): ProjectsRegistry {
  const registry: ProjectsRegistry = {};

  // You can extend this to load from multiple .env.* files
  // or from a configuration directory
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
 * Validate that all required environment variables are set
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
