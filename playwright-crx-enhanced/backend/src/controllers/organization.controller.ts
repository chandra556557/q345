/**
 * Organization Controller
 * 
 * Handles organization/tenant management operations.
 */

import { Request, Response } from 'express';
import { tenantService } from '../services/tenant';
import { logger } from '../utils/logger';

/**
 * @swagger
 * /api/organizations:
 *   post:
 *     summary: Create a new organization
 *     tags: [Organizations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               subscription:
 *                 type: string
 *               maxConcurrentRuns:
 *                 type: number
 *               maxUsers:
 *                 type: number
 */
export const createOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { name, slug, subscription, maxConcurrentRuns, maxUsers } = req.body;

    if (!name || !slug) {
      res.status(400).json({ 
        success: false, 
        error: 'Name and slug are required' 
      });
      return;
    }

    const organization = await tenantService.createOrganization({
      name,
      slug,
      subscription,
      maxConcurrentRuns,
      maxUsers,
      createdByUserId: userId,
    });

    res.status(201).json({ success: true, data: organization });
  } catch (error: any) {
    logger.error('Create organization error:', { error: error.message });
    res.status(error.message.includes('already exists') ? 409 : 500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * @swagger
 * /api/organizations/my-organizations:
 *   get:
 *     summary: Get user's organizations
 *     tags: [Organizations]
 */
export const getMyOrganizations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const organizations = await tenantService.getUserOrganizations(userId);

    res.status(200).json({ success: true, data: organizations });
  } catch (error: any) {
    logger.error('Get organizations error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}:
 *   get:
 *     summary: Get organization details
 *     tags: [Organizations]
 */
export const getOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.tenant!.organizationId;
    const organization = await tenantService.getOrganization(organizationId);

    if (!organization) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    res.status(200).json({ success: true, data: organization });
  } catch (error: any) {
    logger.error('Get organization error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/settings:
 *   patch:
 *     summary: Update organization settings
 *     tags: [Organizations]
 */
export const updateOrganization = async (req: Request, res: Response) => {
  try {
    const organizationId = req.tenant!.organizationId;
    const { name, settings, logoUrl, maxConcurrentRuns, maxUsers } = req.body;

    const organization = await tenantService.updateOrganization(organizationId, {
      name,
      settings,
      logoUrl,
      maxConcurrentRuns,
      maxUsers,
    });

    res.status(200).json({ success: true, data: organization });
  } catch (error: any) {
    logger.error('Update organization error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/members:
 *   get:
 *     summary: Get organization members
 *     tags: [Organizations]
 */
export const getMembers = async (req: Request, res: Response) => {
  try {
    const organizationId = req.tenant!.organizationId;
    const members = await tenantService.getOrganizationMembers(organizationId);

    res.status(200).json({ success: true, data: members });
  } catch (error: any) {
    logger.error('Get members error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/invite:
 *   post:
 *     summary: Invite user to organization
 *     tags: [Organizations]
 */
export const inviteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.tenant!.organizationId;
    const { email, role } = req.body;
    const invitedBy = req.user!.userId;

    if (!email || !role) {
      res.status(400).json({ 
        success: false, 
        error: 'Email and role are required' 
      });
      return;
    }

    if (!['admin', 'developer', 'viewer'].includes(role)) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid role. Allowed: admin, developer, viewer' 
      });
      return;
    }

    const membership = await tenantService.inviteUser({
      organizationId,
      email,
      role,
      invitedBy,
    });

    res.status(200).json({ success: true, data: membership, message: 'User invited successfully' });
  } catch (error: any) {
    logger.error('Invite user error:', { error: error.message });
    res.status(error.message.includes('not found') || error.message.includes('already') ? 400 : 500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/members/{userId}/role:
 *   patch:
 *     summary: Update member role
 *     tags: [Organizations]
 */
export const updateMemberRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.tenant!.organizationId;
    const { userId } = req.params;
    const { role } = req.body;

    if (!role) {
      res.status(400).json({ success: false, error: 'Role is required' });
      return;
    }

    if (!['owner', 'admin', 'developer', 'viewer'].includes(role)) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid role. Allowed: owner, admin, developer, viewer' 
      });
      return;
    }

    const membership = await tenantService.updateMemberRole(organizationId, userId, role);

    res.status(200).json({ success: true, data: membership });
  } catch (error: any) {
    logger.error('Update member role error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/members/{userId}:
 *   delete:
 *     summary: Remove member from organization
 *     tags: [Organizations]
 */
export const removeMember = async (req: Request, res: Response) => {
  try {
    const organizationId = req.tenant!.organizationId;
    const { userId } = req.params;

    await tenantService.removeMember(organizationId, userId);

    res.status(200).json({ success: true, message: 'Member removed successfully' });
  } catch (error: any) {
    logger.error('Remove member error:', { error: error.message });
    res.status(error.message.includes('owner') ? 400 : 500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/environments:
 *   get:
 *     summary: Get organization environments
 *     tags: [Organizations]
 */
export const getEnvironments = async (req: Request, res: Response) => {
  try {
    const organizationId = req.tenant!.organizationId;
    const environments = await tenantService.getEnvironments(organizationId);

    res.status(200).json({ success: true, data: environments });
  } catch (error: any) {
    logger.error('Get environments error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/environments:
 *   post:
 *     summary: Create environment
 *     tags: [Organizations]
 */
export const createEnvironment = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.tenant!.organizationId;
    const { name, displayName, description, config, variables, baseUrl, isDefault } = req.body;

    if (!name || !displayName) {
      res.status(400).json({ 
        success: false, 
        error: 'Name and displayName are required' 
      });
      return;
    }

    const environment = await tenantService.createEnvironment(organizationId, {
      name,
      displayName,
      description,
      config: config || {},
      variables,
      baseUrl,
      isDefault: isDefault || false,
    });

    res.status(201).json({ success: true, data: environment });
  } catch (error: any) {
    logger.error('Create environment error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/environments/{envId}:
 *   patch:
 *     summary: Update environment
 *     tags: [Organizations]
 */
export const updateEnvironment = async (req: Request, res: Response) => {
  try {
    const { envId } = req.params;
    const { displayName, description, config, variables, baseUrl } = req.body;

    const environment = await tenantService.updateEnvironment(envId, {
      displayName,
      description,
      config,
      variables,
      baseUrl,
    });

    res.status(200).json({ success: true, data: environment });
  } catch (error: any) {
    logger.error('Update environment error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/environments/{envId}:
 *   delete:
 *     summary: Delete environment
 *     tags: [Organizations]
 */
export const deleteEnvironment = async (req: Request, res: Response) => {
  try {
    const { envId } = req.params;

    await tenantService.deleteEnvironment(envId);

    res.status(200).json({ success: true, message: 'Environment deleted successfully' });
  } catch (error: any) {
    logger.error('Delete environment error:', { error: error.message });
    res.status(error.message.includes('default') ? 400 : 500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * @swagger
 * /api/organizations/{slug}/limits:
 *   get:
 *     summary: Check organization limits
 *     tags: [Organizations]
 */
export const checkLimits = async (req: Request, res: Response) => {
  try {
    const organizationId = req.tenant!.organizationId;
    
    const canExecute = await tenantService.checkConcurrencyLimit(organizationId);
    const org = await tenantService.getOrganization(organizationId);
    const members = await tenantService.getOrganizationMembers(organizationId);

    res.status(200).json({ 
      success: true, 
      data: {
        canExecuteTests: canExecute,
        maxConcurrentRuns: org?.maxConcurrentRuns,
        maxUsers: org?.maxUsers,
        currentMembers: members.length,
      }
    });
  } catch (error: any) {
    logger.error('Check limits error:', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};
