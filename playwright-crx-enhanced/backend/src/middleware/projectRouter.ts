/**
 * Project Router Middleware
 * Routes requests to the correct project based on query param, header, or env var
 * Allows single server to handle multiple projects
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface ProjectRequest extends Request {
  projectName?: string;
  projectConfig?: ProjectConfig;
}

export interface ProjectConfig {
  name: string;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  server: {
    port: number;
  };
  apiUrl: string;
}

// Project configurations - single server handles all
const projectConfigs: Record<string, ProjectConfig> = {
  project1: {
    name: 'project1',
    database: {
      host: process.env.PROJECT1_DB_HOST || 'localhost',
      port: parseInt(process.env.PROJECT1_DB_PORT || '5433', 10),
      name: process.env.PROJECT1_DB_NAME || 'playwright_project1',
      user: process.env.PROJECT1_DB_USER || 'postgres',
      password: process.env.PROJECT1_DB_PASSWORD || 'postgres'
    },
    server: {
      port: 3001
    },
    apiUrl: 'http://localhost:3001'
  },
  project2: {
    name: 'project2',
    database: {
      host: process.env.PROJECT2_DB_HOST || 'localhost',
      port: parseInt(process.env.PROJECT2_DB_PORT || '5434', 10),
      name: process.env.PROJECT2_DB_NAME || 'playwright_project2',
      user: process.env.PROJECT2_DB_USER || 'postgres',
      password: process.env.PROJECT2_DB_PASSWORD || 'postgres'
    },
    server: {
      port: 3001
    },
    apiUrl: 'http://localhost:3001'
  },
  project3: {
    name: 'project3',
    database: {
      host: process.env.PROJECT3_DB_HOST || 'localhost',
      port: parseInt(process.env.PROJECT3_DB_PORT || '5435', 10),
      name: process.env.PROJECT3_DB_NAME || 'playwright_project3',
      user: process.env.PROJECT3_DB_USER || 'postgres',
      password: process.env.PROJECT3_DB_PASSWORD || 'postgres'
    },
    server: {
      port: 3001
    },
    apiUrl: 'http://localhost:3001'
  }
};

/**
 * Project Router Middleware
 * Extracts project name from request and sets up project config
 */
export const projectRouterMiddleware = (req: ProjectRequest, res: Response, next: NextFunction) => {
  try {
    // Get project from (in order of priority):
    // 1. Query parameter: ?project=project1
    // 2. Header: X-Project: project1
    // 3. Cookie: project=project1
    // 4. Environment: ACTIVE_PROJECT
    // 5. Default: project1

    const projectName =
      (req.query.project as string) ||
      (req.headers['x-project'] as string) ||
      (req.cookies?.project as string) ||
      process.env.ACTIVE_PROJECT ||
      'project1';

    // Validate project exists
    if (!projectConfigs[projectName]) {
      logger.warn(`Project '${projectName}' not found. Using 'project1' as fallback.`);
      req.projectName = 'project1';
      req.projectConfig = projectConfigs['project1'];
    } else {
      req.projectName = projectName;
      req.projectConfig = projectConfigs[projectName];
    }

    // Log project routing
    logger.info(`📍 Routing request to project: ${req.projectName}`);
    logger.debug(`Database: ${req.projectConfig.database.host}:${req.projectConfig.database.port}/${req.projectConfig.database.name}`);

    next();
  } catch (error) {
    logger.error(`Error in projectRouterMiddleware: ${error}`);
    req.projectName = 'project1';
    req.projectConfig = projectConfigs['project1'];
    next();
  }
};

/**
 * Get project config for a specific project
 */
export function getProjectConfig(projectName: string): ProjectConfig {
  return projectConfigs[projectName] || projectConfigs['project1'];
}

/**
 * Get all available projects
 */
export function getAvailableProjects(): ProjectConfig[] {
  return Object.values(projectConfigs);
}

/**
 * Add or update project config
 */
export function setProjectConfig(projectName: string, config: ProjectConfig): void {
  projectConfigs[projectName] = config;
  logger.info(`✅ Project config added/updated: ${projectName}`);
}

/**
 * Get current project from request
 */
export function getCurrentProjectName(req: ProjectRequest): string {
  return req.projectName || 'project1';
}

/**
 * Get current project config from request
 */
export function getCurrentProjectConfig(req: ProjectRequest): ProjectConfig {
  return req.projectConfig || projectConfigs['project1'];
}
