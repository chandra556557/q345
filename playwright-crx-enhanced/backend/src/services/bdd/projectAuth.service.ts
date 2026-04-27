// Per-project storageState management.
// Stored encrypted inside Project.settings.bddAuth so we don't need a schema
// migration. The runFeature/generatePOM paths can ask for the project's auth
// without the user pasting it every time.

import pool from '../../db';
import { encryptJSON, decryptJSON } from '../../utils/encryption';
import { logger } from '../../utils/logger';

export interface ProjectAuthRecord {
  storageStateEncrypted: string;
  ttlMinutes: number;           // how long the storageState stays "fresh" — after this, UI flags it stale
  updatedAt: string;            // ISO timestamp of last save/refresh
  refreshNote?: string;         // free-text reminder for the user (e.g. "run npm run login:staging")
}

export interface ProjectAuthStatus {
  configured: boolean;
  updatedAt?: string;
  ttlMinutes?: number;
  stale: boolean;
  ageMinutes?: number;
  refreshNote?: string;
}

class ProjectAuthService {
  async get(projectId: string): Promise<{ storageState: any; record: ProjectAuthRecord } | null> {
    const { rows } = await pool.query(
      `SELECT settings FROM "Project" WHERE id = $1`,
      [projectId],
    );
    const record: ProjectAuthRecord | undefined = rows[0]?.settings?.bddAuth;
    if (!record?.storageStateEncrypted) return null;
    try {
      const storageState = decryptJSON<any>(record.storageStateEncrypted);
      return { storageState, record };
    } catch (e: any) {
      logger.warn(`ProjectAuth: failed to decrypt for project ${projectId}: ${e?.message}`);
      return null;
    }
  }

  async save(
    projectId: string,
    storageState: any,
    opts: { ttlMinutes?: number; refreshNote?: string } = {},
  ): Promise<void> {
    if (!storageState || typeof storageState !== 'object') {
      throw new Error('storageState must be an object');
    }
    const record: ProjectAuthRecord = {
      storageStateEncrypted: encryptJSON(storageState),
      ttlMinutes: opts.ttlMinutes ?? 60,
      updatedAt: new Date().toISOString(),
      refreshNote: opts.refreshNote,
    };
    // Merge into the existing settings JSON so we don't clobber unrelated keys.
    await pool.query(
      `UPDATE "Project"
         SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('bddAuth', $1::jsonb),
             "updatedAt" = now()
       WHERE id = $2`,
      [JSON.stringify(record), projectId],
    );
    logger.info(`ProjectAuth: saved for project ${projectId} (ttl=${record.ttlMinutes}m)`);
  }

  async clear(projectId: string): Promise<void> {
    await pool.query(
      `UPDATE "Project"
         SET settings = COALESCE(settings, '{}'::jsonb) - 'bddAuth',
             "updatedAt" = now()
       WHERE id = $1`,
      [projectId],
    );
  }

  async status(projectId: string): Promise<ProjectAuthStatus> {
    const { rows } = await pool.query(
      `SELECT settings FROM "Project" WHERE id = $1`,
      [projectId],
    );
    const record: ProjectAuthRecord | undefined = rows[0]?.settings?.bddAuth;
    if (!record?.storageStateEncrypted) {
      return { configured: false, stale: false };
    }
    const ageMs = Date.now() - new Date(record.updatedAt).getTime();
    const ageMinutes = Math.max(0, Math.floor(ageMs / 60000));
    return {
      configured: true,
      updatedAt: record.updatedAt,
      ttlMinutes: record.ttlMinutes,
      ageMinutes,
      stale: ageMinutes > (record.ttlMinutes || 60),
      refreshNote: record.refreshNote,
    };
  }
}

export const projectAuthService = new ProjectAuthService();
