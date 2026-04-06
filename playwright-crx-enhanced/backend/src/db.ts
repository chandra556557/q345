import { Pool } from 'pg';
import dotenv from 'dotenv';
import { logger } from './utils/logger';

dotenv.config();

const DB_USER = process.env.DB_USER || process.env.PGUSER || process.env.user || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.PGPASSWORD || process.env.password || 'postgres124112';
const DB_HOST = process.env.DB_HOST || process.env.PGHOST || process.env.host || 'localhost';
const DB_PORT = process.env.DB_PORT || process.env.PGPORT || process.env.port || '5433';
const DB_NAME = process.env.DB_NAME || process.env.PGDATABASE || process.env.database || 'playwright_crx1';

const rawEnvUrl = process.env.DATABASE_URL;
const envUrl = typeof rawEnvUrl === 'string' ? rawEnvUrl.trim() : '';

// Helper to safely log a redacted DATABASE_URL without password
function redactDbUrl(url: string): string {
  try {
    const u = new URL(url);
    const protocol = u.protocol;
    const user = u.username ? `${u.username}:***@` : '';
    const host = u.hostname;
    const port = u.port ? `:${u.port}` : '';
    const db = u.pathname;
    return `${protocol}//${user}${host}${port}${db}`;
  } catch {
    return 'INVALID_URL';
  }
}

// Validate DATABASE_URL via WHATWG URL and ensure it includes a db name
let connectionString: string | undefined;
if (envUrl) {
  try {
    const parsed = new URL(envUrl);
    const protocolOk = parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
    const hasDbName = parsed.pathname && parsed.pathname !== '/' && parsed.pathname.length > 1;
    if (protocolOk && hasDbName) {
      connectionString = envUrl;
      logger.info('Using DATABASE_URL for PostgreSQL connection', { db: redactDbUrl(envUrl) });
    } else {
      logger.warn('Invalid DATABASE_URL format; falling back to discrete DB_* settings', {
        db: redactDbUrl(envUrl)
      });
    }
  } catch (error: any) {
    logger.warn('Failed to parse DATABASE_URL; falling back to discrete DB_* settings', {
      error: error?.message,
      db: redactDbUrl(envUrl)
    });
  }
}
if (!connectionString) {
  connectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  logger.info('Using discrete DB_* environment variables for PostgreSQL connection', {
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER
  });
}
const ssl =
  process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined;

const DB_MAX_CLIENTS = parseInt(process.env.DB_MAX_CLIENTS || '10', 10);
const DB_MIN_CLIENTS = parseInt(process.env.DB_MIN_CLIENTS || '2', 10);
const DB_IDLE_TIMEOUT = parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10);
const DB_QUERY_TIMEOUT = parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10);
const DB_CONNECTION_TIMEOUT = parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000', 10);

const pool = new Pool({
  connectionString,
  ssl,
  max: DB_MAX_CLIENTS,
  min: DB_MIN_CLIENTS,
  idleTimeoutMillis: DB_IDLE_TIMEOUT,
  query_timeout: DB_QUERY_TIMEOUT,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT,
});

export default pool;
