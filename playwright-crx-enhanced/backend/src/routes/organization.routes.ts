/**
 * Organization Routes
 * 
 * API routes for organization/tenant management.
 */

import { Router } from 'express';
import { 
  authMiddleware, 
  tenantMiddleware, 
  requireRole 
} from '../middleware/auth.middleware';
import * as organizationController from '../controllers/organization.controller';

const router = Router();

// ============================================
// Public routes (require only auth)
// ============================================

/**
 * @swagger
 * /api/organizations:
 *   post:
 *     summary: Create a new organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', authMiddleware, organizationController.createOrganization);

/**
 * @swagger
 * /api/organizations/my-organizations:
 *   get:
 *     summary: Get user's organizations
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get('/my-organizations', authMiddleware, organizationController.getMyOrganizations);

// ============================================
// Organization-scoped routes (require tenant context)
// ============================================

/**
 * @swagger
 * /api/organizations/{slug}:
 *   get:
 *     summary: Get organization details
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 */
router.get(
  '/:slug', 
  authMiddleware, 
  tenantMiddleware, 
  organizationController.getOrganization
);

/**
 * @swagger
 * /api/organizations/{slug}/settings:
 *   patch:
 *     summary: Update organization settings
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:slug/settings', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.updateOrganization
);

/**
 * @swagger
 * /api/organizations/{slug}/members:
 *   get:
 *     summary: Get organization members
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:slug/members', 
  authMiddleware, 
  tenantMiddleware, 
  organizationController.getMembers
);

/**
 * @swagger
 * /api/organizations/{slug}/invite:
 *   post:
 *     summary: Invite user to organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:slug/invite', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.inviteUser
);

/**
 * @swagger
 * /api/organizations/{slug}/members/{userId}/role:
 *   patch:
 *     summary: Update member role
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:slug/members/:userId/role', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.updateMemberRole
);

/**
 * @swagger
 * /api/organizations/{slug}/members/{userId}:
 *   delete:
 *     summary: Remove member from organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:slug/members/:userId', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.removeMember
);

/**
 * @swagger
 * /api/organizations/{slug}/environments:
 *   get:
 *     summary: Get organization environments
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:slug/environments', 
  authMiddleware, 
  tenantMiddleware, 
  organizationController.getEnvironments
);

/**
 * @swagger
 * /api/organizations/{slug}/environments:
 *   post:
 *     summary: Create environment
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:slug/environments', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.createEnvironment
);

/**
 * @swagger
 * /api/organizations/{slug}/environments/{envId}:
 *   patch:
 *     summary: Update environment
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:slug/environments/:envId', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.updateEnvironment
);

/**
 * @swagger
 * /api/organizations/{slug}/environments/{envId}:
 *   delete:
 *     summary: Delete environment
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:slug/environments/:envId', 
  authMiddleware, 
  tenantMiddleware, 
  requireRole(['owner', 'admin']),
  organizationController.deleteEnvironment
);

/**
 * @swagger
 * /api/organizations/{slug}/limits:
 *   get:
 *     summary: Check organization limits
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:slug/limits', 
  authMiddleware, 
  tenantMiddleware, 
  organizationController.checkLimits
);

export default router;
