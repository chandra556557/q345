import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth/auth.service';
import { logger } from '../utils/logger';
import pool from '../db';

// Extend Express Request type to include user and tenant
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
      tenant?: {
        organizationId: string;
        organizationSlug: string;
        organizationName: string;
        role: string;
        permissions: Record<string, boolean> | null;
      };
    }
  }
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user info to request
 */
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): any => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyAccessToken(token);

    req.user = { userId: String(decoded.userId), email: String(decoded.email) };
    next();
  } catch (error: any) {
    logger.error('Authentication error:', error);
    return res.status(401).json({ error: 'Unauthorized', message: error.message || 'Invalid or expired token' });
  }
};

/**
 * Tenant context middleware
 * Extracts organization context from header and validates user membership
 */
export const tenantMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    // Extract organization from header or query
    const orgSlug = req.headers['x-organization'] as string || req.query.organization as string;

    if (!orgSlug) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Organization context required. Set X-Organization header.' 
      });
    }

    // Get user's organization membership
    const { rows } = await pool.query(
      `SELECT uo.role, uo.permissions, o.id as "organizationId", o.slug as "organizationSlug", 
              o.name as "organizationName", o.status as "orgStatus", uo.status as "memberStatus"
       FROM "UserOrganization" uo
       INNER JOIN "Organization" o ON o.id = uo."organizationId"
       WHERE uo."userId" = $1 AND o.slug = $2`,
      [req.user.userId, orgSlug]
    );

    if (!rows[0]) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'You do not have access to this organization' 
      });
    }

    const membership = rows[0];

    if (membership.memberStatus !== 'active') {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Your membership in this organization is not active' 
      });
    }

    if (membership.orgStatus !== 'active') {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'This organization is not active' 
      });
    }

    req.tenant = {
      organizationId: membership.organizationId,
      organizationSlug: membership.organizationSlug,
      organizationName: membership.organizationName,
      role: membership.role,
      permissions: membership.permissions,
    };

    next();
  } catch (error: any) {
    logger.error('Tenant middleware error:', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
};

/**
 * Optional tenant middleware
 * Attaches tenant context if provided, but doesn't fail if not
 */
export const optionalTenantMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      return next();
    }

    const orgSlug = req.headers['x-organization'] as string || req.query.organization as string;

    if (!orgSlug) {
      return next();
    }

    const { rows } = await pool.query(
      `SELECT uo.role, uo.permissions, o.id as "organizationId", o.slug as "organizationSlug",
              o.name as "organizationName"
       FROM "UserOrganization" uo
       INNER JOIN "Organization" o ON o.id = uo."organizationId"
       WHERE uo."userId" = $1 AND o.slug = $2 AND uo.status = 'active' AND o.status = 'active'`,
      [req.user.userId, orgSlug]
    );

    if (rows[0]) {
      req.tenant = {
        organizationId: rows[0].organizationId,
        organizationSlug: rows[0].organizationSlug,
        organizationName: rows[0].organizationName,
        role: rows[0].role,
        permissions: rows[0].permissions,
      };
    }

    next();
  } catch (error) {
    // Silently continue without tenant context
    next();
  }
};

/**
 * Role-based access control middleware
 * Restricts access to users with specific roles
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    if (!req.tenant) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Organization context required' 
      });
    }

    if (!allowedRoles.includes(req.tenant.role)) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}. Your role: ${req.tenant.role}` 
      });
    }

    next();
  };
};

/**
 * Permission-based access control middleware
 * Restricts access based on specific permissions
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    if (!req.tenant) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Organization context required' 
      });
    }

    // Owners and admins have all permissions
    if (['owner', 'admin'].includes(req.tenant.role)) {
      return next();
    }

    // Check specific permission
    if (req.tenant.permissions && req.tenant.permissions[permission]) {
      return next();
    }

    return res.status(403).json({ 
      error: 'Forbidden', 
      message: `You don't have the '${permission}' permission` 
    });
  };
};

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't fail if no token
 */
export const optionalAuthMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = authService.verifyAccessToken(token);
      req.user = { userId: String(decoded.userId), email: String(decoded.email) };
    }
    next();
  } catch (_error) {
    next();
  }
};
