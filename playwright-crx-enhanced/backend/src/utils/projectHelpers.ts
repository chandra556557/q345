/**
 * Shared project helper functions used by multiple controllers
 */

import pool from '../db';

/** Fetch project config from DB by projectId, returns null if not found or empty */
export async function fetchProjectConfig(projectId: string | undefined | null): Promise<any | null> {
  if (!projectId) return null;
  const { rows } = await pool.query(`SELECT * FROM "Project" WHERE id = $1`, [projectId]);
  return rows[0] || null;
}

/** Build env vars object from project config for child process spawning */
export function buildProjectEnvVars(projectConfig: any): Record<string, string> {
  const BLOCKED_ENV_KEYS = new Set([
    'PATH', 'HOME', 'NODE_ENV', 'DATABASE_URL', 'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET', 'REDIS_PASSWORD', 'PGPASSWORD',
  ]);

  const envVars: Record<string, string> = {
    ACTIVE_PROJECT: projectConfig.name || 'default',
  };
  if (projectConfig.baseUrl) envVars.BASE_URL = projectConfig.baseUrl;
  if (projectConfig.apiBaseUrl) envVars.API_BASE_URL = projectConfig.apiBaseUrl;
  if (projectConfig.dbHost) envVars.DB_HOST = projectConfig.dbHost;
  if (projectConfig.dbPort) envVars.DB_PORT = String(projectConfig.dbPort);
  if (projectConfig.dbName) envVars.DB_NAME = projectConfig.dbName;
  if (projectConfig.dbUser) envVars.DB_USER = projectConfig.dbUser;
  if (projectConfig.dbPassword) envVars.DB_PASSWORD = projectConfig.dbPassword;

  if (projectConfig.envVars && typeof projectConfig.envVars === 'object') {
    for (const [key, val] of Object.entries(projectConfig.envVars)) {
      if (!BLOCKED_ENV_KEYS.has(key.toUpperCase()) && typeof val === 'string') {
        envVars[key] = val;
      }
    }
  }
  return envVars;
}

/** Mark a BDDRun as failed with an error message */
export async function markRunFailed(runId: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE "BDDRun" SET status = 'failed', "errorMsg" = $1, "completedAt" = now(), "updatedAt" = now() WHERE id = $2`,
    [message, runId]
  );
}
