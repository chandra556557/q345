import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import pool from '../db';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Column sets for SELECT queries
// Never return dbPassword in API responses
const PROJECT_COLUMNS = `id, name, description, "baseUrl", "apiBaseUrl", environment, "dbHost", "dbPort", "dbName", "dbUser", tags, "envVars", "createdAt", "updatedAt"`;
// Full columns for internal queries (includes password)
export const PROJECT_COLUMNS_INTERNAL = `id, name, description, "baseUrl", "apiBaseUrl", environment, "dbHost", "dbPort", "dbName", "dbUser", "dbPassword", tags, "envVars", "createdAt", "updatedAt"`;

/** Extract authenticated userId or throw 401 */
function getUserId(req: Request): string {
  const userId = (req as any).user?.userId;
  if (!userId) throw { status: 401, message: 'Unauthorized' };
  return userId;
}

/** Validate URL starts with http:// or https:// */
function isValidUrl(url: string | undefined | null): boolean {
  if (!url) return true; // optional field
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate URL fields, returns error string or null */
function validateUrls(baseUrl?: string, apiBaseUrl?: string): string | null {
  if (!isValidUrl(baseUrl)) return 'baseUrl must be a valid http:// or https:// URL';
  if (!isValidUrl(apiBaseUrl)) return 'apiBaseUrl must be a valid http:// or https:// URL';
  return null;
}

/** Extract project config fields from request body */
function extractProjectFields(body: any) {
  const { name, description, baseUrl, apiBaseUrl, environment, dbHost, dbPort, dbName, dbUser, dbPassword, tags, envVars } = body;
  return {
    name, description: description || null,
    baseUrl: baseUrl || null, apiBaseUrl: apiBaseUrl || null,
    environment: environment || 'development',
    dbHost: dbHost || null, dbPort: dbPort || null, dbName: dbName || null,
    dbUser: dbUser || null, dbPassword: dbPassword || null,
    tags: tags || null, envVars: envVars ? JSON.stringify(envVars) : '{}',
  };
}

// Get all projects for authenticated user
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { rows } = await pool.query(
      `SELECT ${PROJECT_COLUMNS} FROM "Project" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
      [userId]
    );
    logger.info(`Retrieved ${rows.length} projects for user ${userId}`);
    return res.json({ data: rows });
  } catch (error: any) {
    if (error.status === 401) return res.status(401).json({ error: error.message });
    logger.error('Error fetching projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Create a new project
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const fields = extractProjectFields(req.body);

    if (!fields.name || typeof fields.name !== 'string' || fields.name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const urlError = validateUrls(req.body.baseUrl, req.body.apiBaseUrl);
    if (urlError) return res.status(400).json({ error: urlError });

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "Project"(id, name, description, "baseUrl", "apiBaseUrl", environment, "dbHost", "dbPort", "dbName", "dbUser", "dbPassword", tags, "envVars", "userId", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now())
       RETURNING ${PROJECT_COLUMNS}`,
      [id, fields.name.trim(), fields.description, fields.baseUrl, fields.apiBaseUrl, fields.environment, fields.dbHost, fields.dbPort, fields.dbName, fields.dbUser, fields.dbPassword, fields.tags, fields.envVars, userId]
    );

    logger.info(`Created project ${rows[0].id} for user ${userId}`);
    return res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    if (error.status === 401) return res.status(401).json({ error: error.message });
    logger.error('Error creating project:', error);
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get a specific project
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { rows } = await pool.query(
      `SELECT ${PROJECT_COLUMNS} FROM "Project" WHERE id = $1 AND "userId" = $2`,
      [req.params.id, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });

    logger.info(`Retrieved project: ${rows[0].id}`);
    return res.json({ data: rows[0] });
  } catch (error: any) {
    if (error.status === 401) return res.status(401).json({ error: error.message });
    logger.error('Error fetching project:', error);
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Update a project
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const fields = extractProjectFields(req.body);

    const urlError = validateUrls(req.body.baseUrl, req.body.apiBaseUrl);
    if (urlError) return res.status(400).json({ error: urlError });

    const { rows } = await pool.query(
      `UPDATE "Project" SET
        name = $1, description = $2, "baseUrl" = $3, "apiBaseUrl" = $4, environment = $5,
        "dbHost" = $6, "dbPort" = $7, "dbName" = $8, "dbUser" = $9, "dbPassword" = $10,
        tags = $11, "envVars" = $12, "updatedAt" = now()
       WHERE id = $13 AND "userId" = $14
       RETURNING ${PROJECT_COLUMNS}`,
      [fields.name, fields.description, fields.baseUrl, fields.apiBaseUrl, fields.environment, fields.dbHost, fields.dbPort, fields.dbName, fields.dbUser, fields.dbPassword, fields.tags, fields.envVars, req.params.id, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });

    logger.info(`Updated project: ${rows[0].id}`);
    return res.json({ data: rows[0] });
  } catch (error: any) {
    if (error.status === 401) return res.status(401).json({ error: error.message });
    logger.error('Error updating project:', error);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete a project
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { rowCount } = await pool.query(
      'DELETE FROM "Project" WHERE id = $1 AND "userId" = $2 RETURNING id',
      [req.params.id, userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Project not found' });

    logger.info(`Deleted project with id: ${req.params.id}`);
    return res.status(204).send();
  } catch (error: any) {
    if (error.status === 401) return res.status(401).json({ error: error.message });
    logger.error('Error deleting project:', error);
    return res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
