/**
 * Tenant Management Service
 * 
 * Handles organization/tenant lifecycle, membership, and settings.
 */

import { randomUUID } from 'crypto';
import pool from '../../db';
import { logger } from '../../utils/logger';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  subscription: string;
  maxConcurrentRuns: number;
  maxUsers: number;
  settings?: Record<string, unknown>;
  logoUrl?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserOrganization {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  permissions?: Record<string, boolean>;
  status: string;
  joinedAt: Date;
}

export interface Environment {
  id: string;
  organizationId: string;
  name: string;
  displayName: string;
  description?: string;
  config: Record<string, unknown>;
  variables?: Record<string, string>;
  baseUrl?: string;
  isDefault: boolean;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  subscription?: string;
  maxConcurrentRuns?: number;
  maxUsers?: number;
  createdByUserId: string;
}

export interface InviteUserInput {
  organizationId: string;
  email: string;
  role: string;
  invitedBy: string;
}

export interface OrganizationWithRole extends Organization {
  role: string;
  memberStatus: string;
}

class TenantService {
  /**
   * Create a new organization
   */
  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    const {
      name,
      slug,
      subscription = 'free',
      maxConcurrentRuns = 5,
      maxUsers = 10,
      createdByUserId,
    } = input;

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error('Slug must contain only lowercase letters, numbers, and hyphens');
    }

    // Check slug uniqueness
    const existing = await pool.query(
      `SELECT id FROM "Organization" WHERE slug = $1`,
      [slug]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error('Organization slug already exists');
    }

    const orgId = randomUUID();

    // Create organization
    const { rows } = await pool.query(
      `INSERT INTO "Organization" (
        id, name, slug, subscription, "maxConcurrentRuns", "maxUsers", 
        status, "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), now())
      RETURNING *`,
      [orgId, name, slug, subscription, maxConcurrentRuns, maxUsers]
    );

    const org = rows[0];

    // Add creator as owner
    await pool.query(
      `INSERT INTO "UserOrganization" (
        id, "userId", "organizationId", role, "joinedAt", status
      )
      VALUES (gen_random_uuid(), $1, $2, 'owner', now(), 'active')`,
      [createdByUserId, orgId]
    );

    // Create default environments
    const defaultEnvs = [
      { name: 'dev', displayName: 'Development', isDefault: true },
      { name: 'staging', displayName: 'Staging', isDefault: false },
      { name: 'production', displayName: 'Production', isDefault: false },
    ];

    for (const env of defaultEnvs) {
      await pool.query(
        `INSERT INTO "Environment" (
          id, "organizationId", name, "displayName", config, "isDefault", 
          "createdAt", "updatedAt"
        )
        VALUES (gen_random_uuid(), $1, $2, $3, '{}', $4, now(), now())`,
        [orgId, env.name, env.displayName, env.isDefault]
      );
    }

    logger.info(`Organization created: ${name} (${slug})`, { orgId, createdByUserId });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      domain: org.domain,
      subscription: org.subscription,
      maxConcurrentRuns: org.maxConcurrentRuns,
      maxUsers: org.maxUsers,
      settings: org.settings,
      logoUrl: org.logoUrl,
      status: org.status,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  /**
   * Get user's organizations
   */
  async getUserOrganizations(userId: string): Promise<OrganizationWithRole[]> {
    const { rows } = await pool.query(
      `SELECT o.*, uo.role, uo.status as "memberStatus"
       FROM "Organization" o
       INNER JOIN "UserOrganization" uo ON uo."organizationId" = o.id
       WHERE uo."userId" = $1 AND uo.status = 'active' AND o.status = 'active'
       ORDER BY o."createdAt" DESC`,
      [userId]
    );

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      domain: row.domain,
      subscription: row.subscription,
      maxConcurrentRuns: row.maxConcurrentRuns,
      maxUsers: row.maxUsers,
      settings: row.settings,
      logoUrl: row.logoUrl,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      role: row.role,
      memberStatus: row.memberStatus,
    }));
  }

  /**
   * Get organization by ID
   */
  async getOrganization(id: string): Promise<Organization | null> {
    const { rows } = await pool.query(
      `SELECT * FROM "Organization" WHERE id = $1`,
      [id]
    );

    if (!rows[0]) return null;

    return rows[0];
  }

  /**
   * Get organization by slug
   */
  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    const { rows } = await pool.query(
      `SELECT * FROM "Organization" WHERE slug = $1`,
      [slug]
    );

    if (!rows[0]) return null;

    return rows[0];
  }

  /**
   * Update organization settings
   */
  async updateOrganization(
    id: string,
    updates: Partial<Pick<Organization, 'name' | 'settings' | 'logoUrl' | 'maxConcurrentRuns' | 'maxUsers'>>
  ): Promise<Organization> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.settings !== undefined) {
      fields.push(`settings = $${paramIndex++}`);
      values.push(JSON.stringify(updates.settings));
    }
    if (updates.logoUrl !== undefined) {
      fields.push(`"logoUrl" = $${paramIndex++}`);
      values.push(updates.logoUrl);
    }
    if (updates.maxConcurrentRuns !== undefined) {
      fields.push(`"maxConcurrentRuns" = $${paramIndex++}`);
      values.push(updates.maxConcurrentRuns);
    }
    if (updates.maxUsers !== undefined) {
      fields.push(`"maxUsers" = $${paramIndex++}`);
      values.push(updates.maxUsers);
    }

    if (fields.length === 0) {
      const org = await this.getOrganization(id);
      if (!org) throw new Error('Organization not found');
      return org;
    }

    fields.push(`"updatedAt" = now()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE "Organization" SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (!rows[0]) {
      throw new Error('Organization not found');
    }

    logger.info(`Organization updated: ${id}`);
    return rows[0];
  }

  /**
   * Get organization members
   */
  async getOrganizationMembers(organizationId: string): Promise<UserOrganization[]> {
    const { rows } = await pool.query(
      `SELECT uo.*, u.email, u.name as "userName"
       FROM "UserOrganization" uo
       INNER JOIN "User" u ON u.id = uo."userId"
       WHERE uo."organizationId" = $1
       ORDER BY uo."joinedAt" DESC`,
      [organizationId]
    );

    return rows;
  }

  /**
   * Invite user to organization
   */
  async inviteUser(input: InviteUserInput): Promise<UserOrganization> {
    const { organizationId, email, role, invitedBy } = input;

    // Check if user exists
    const userRes = await pool.query(
      `SELECT id FROM "User" WHERE email = $1`,
      [email]
    );

    if (!userRes.rows[0]) {
      throw new Error('User not found. They must register first.');
    }

    const userId = userRes.rows[0].id;

    // Check if already a member
    const existingMember = await pool.query(
      `SELECT id, status FROM "UserOrganization" 
       WHERE "userId" = $1 AND "organizationId" = $2`,
      [userId, organizationId]
    );

    if (existingMember.rows[0]) {
      if (existingMember.rows[0].status === 'active') {
        throw new Error('User is already a member of this organization');
      }
      // Reactivate if previously removed
      const { rows } = await pool.query(
        `UPDATE "UserOrganization" 
         SET status = 'active', role = $3, "updatedAt" = now()
         WHERE id = $1
         RETURNING *`,
        [existingMember.rows[0].id, role]
      );
      return rows[0];
    }

    // Check org member limit
    const org = await this.getOrganization(organizationId);
    if (!org) {
      throw new Error('Organization not found');
    }

    const memberCount = await pool.query(
      `SELECT COUNT(*) FROM "UserOrganization" 
       WHERE "organizationId" = $1 AND status = 'active'`,
      [organizationId]
    );

    if (parseInt(memberCount.rows[0].count) >= org.maxUsers) {
      throw new Error(`Organization has reached maximum member limit (${org.maxUsers})`);
    }

    // Create membership
    const { rows } = await pool.query(
      `INSERT INTO "UserOrganization" (
        id, "userId", "organizationId", role, "invitedBy", "invitedAt", "joinedAt", status
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now(), 'active')
      RETURNING *`,
      [userId, organizationId, role, invitedBy]
    );

    logger.info(`User invited to organization`, { userId, organizationId, role });

    return rows[0];
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    organizationId: string,
    userId: string,
    newRole: string
  ): Promise<UserOrganization> {
    const { rows } = await pool.query(
      `UPDATE "UserOrganization" 
       SET role = $3, "updatedAt" = now()
       WHERE "organizationId" = $1 AND "userId" = $2
       RETURNING *`,
      [organizationId, userId, newRole]
    );

    if (!rows[0]) {
      throw new Error('Member not found');
    }

    logger.info(`Member role updated`, { organizationId, userId, newRole });
    return rows[0];
  }

  /**
   * Remove member from organization
   */
  async removeMember(organizationId: string, userId: string): Promise<void> {
    // Check if this is the last owner
    const ownerCount = await pool.query(
      `SELECT COUNT(*) FROM "UserOrganization" 
       WHERE "organizationId" = $1 AND role = 'owner' AND status = 'active'`,
      [organizationId]
    );

    const memberRes = await pool.query(
      `SELECT role FROM "UserOrganization" 
       WHERE "organizationId" = $1 AND "userId" = $2`,
      [organizationId, userId]
    );

    if (memberRes.rows[0]?.role === 'owner' && parseInt(ownerCount.rows[0].count) <= 1) {
      throw new Error('Cannot remove the last owner. Transfer ownership first.');
    }

    await pool.query(
      `UPDATE "UserOrganization" 
       SET status = 'removed', "updatedAt" = now()
       WHERE "organizationId" = $1 AND "userId" = $2`,
      [organizationId, userId]
    );

    logger.info(`Member removed from organization`, { organizationId, userId });
  }

  /**
   * Check user's role in organization
   */
  async getUserRole(organizationId: string, userId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT role FROM "UserOrganization" 
       WHERE "organizationId" = $1 AND "userId" = $2 AND status = 'active'`,
      [organizationId, userId]
    );

    return rows[0]?.role || null;
  }

  /**
   * Check concurrency limit for organization
   */
  async checkConcurrencyLimit(organizationId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT o."maxConcurrentRuns",
              COUNT(tr.id) FILTER (WHERE tr.status IN ('running', 'queued')) as "currentRuns"
       FROM "Organization" o
       LEFT JOIN "TestRun" tr ON tr."organizationId" = o.id
       WHERE o.id = $1
       GROUP BY o.id, o."maxConcurrentRuns"`,
      [organizationId]
    );

    if (!rows[0]) {
      throw new Error('Organization not found');
    }

    const { maxConcurrentRuns, currentRuns } = rows[0];
    return parseInt(currentRuns || '0') < maxConcurrentRuns;
  }

  /**
   * Get organization environments
   */
  async getEnvironments(organizationId: string): Promise<Environment[]> {
    const { rows } = await pool.query(
      `SELECT * FROM "Environment" 
       WHERE "organizationId" = $1
       ORDER BY "isDefault" DESC, name ASC`,
      [organizationId]
    );

    return rows;
  }

  /**
   * Create environment
   */
  async createEnvironment(
    organizationId: string,
    data: Omit<Environment, 'id' | 'organizationId'>
  ): Promise<Environment> {
    const { rows } = await pool.query(
      `INSERT INTO "Environment" (
        id, "organizationId", name, "displayName", description, config, 
        variables, "baseUrl", "isDefault", "createdAt", "updatedAt"
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), now())
      RETURNING *`,
      [
        organizationId,
        data.name,
        data.displayName,
        data.description,
        JSON.stringify(data.config),
        data.variables ? JSON.stringify(data.variables) : null,
        data.baseUrl,
        data.isDefault,
      ]
    );

    logger.info(`Environment created: ${data.name}`, { organizationId });
    return rows[0];
  }

  /**
   * Update environment
   */
  async updateEnvironment(
    environmentId: string,
    updates: Partial<Omit<Environment, 'id' | 'organizationId'>>
  ): Promise<Environment> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.displayName !== undefined) {
      fields.push(`"displayName" = $${paramIndex++}`);
      values.push(updates.displayName);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.config !== undefined) {
      fields.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(updates.config));
    }
    if (updates.variables !== undefined) {
      fields.push(`variables = $${paramIndex++}`);
      values.push(JSON.stringify(updates.variables));
    }
    if (updates.baseUrl !== undefined) {
      fields.push(`"baseUrl" = $${paramIndex++}`);
      values.push(updates.baseUrl);
    }

    if (fields.length === 0) {
      const { rows } = await pool.query(
        `SELECT * FROM "Environment" WHERE id = $1`,
        [environmentId]
      );
      return rows[0];
    }

    fields.push(`"updatedAt" = now()`);
    values.push(environmentId);

    const { rows } = await pool.query(
      `UPDATE "Environment" SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return rows[0];
  }

  /**
   * Delete environment
   */
  async deleteEnvironment(environmentId: string): Promise<void> {
    // Check if it's the default environment
    const { rows } = await pool.query(
      `SELECT "isDefault" FROM "Environment" WHERE id = $1`,
      [environmentId]
    );

    if (rows[0]?.isDefault) {
      throw new Error('Cannot delete the default environment');
    }

    await pool.query(`DELETE FROM "Environment" WHERE id = $1`, [environmentId]);
    logger.info(`Environment deleted: ${environmentId}`);
  }
}

// Export singleton instance
export const tenantService = new TenantService();

export default tenantService;
