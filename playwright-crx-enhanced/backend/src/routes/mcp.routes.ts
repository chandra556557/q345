/**
 * MCP (Model Context Protocol) Routes
 * 
 * Exposes SSE endpoints for AI agents to connect and control browser automation.
 * 
 * Endpoints:
 * - GET /api/mcp/sse - SSE connection for MCP protocol
 * - GET /api/mcp/status - Get MCP server status
 * - GET /api/mcp/connections - List active connections
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { 
  createMCPConnection, 
  closeMCPConnection,
  getActiveConnectionCount, 
  listActiveConnections,
  isMCPEnabled,
  getMCPConfigFromEnv
} from '../mcp';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @swagger
 * /api/mcp/status:
 *   get:
 *     summary: Get MCP server status
 *     tags: [MCP]
 *     responses:
 *       200:
 *         description: MCP server status
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    enabled: isMCPEnabled(),
    activeConnections: getActiveConnectionCount(),
    config: getMCPConfigFromEnv(),
    capabilities: [
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_screenshot',
      'browser_snapshot',
      'browser_press_key',
      'browser_select_option',
      'browser_hover',
      'browser_drag',
      'browser_scroll',
      'browser_wait',
      'browser_evaluate',
      'browser_go_back',
      'browser_go_forward',
      'browser_reload',
      'browser_close',
      'browser_tab_new',
      'browser_tab_close',
      'browser_tab_list',
      'browser_tab_select',
      'browser_file_upload',
      'browser_pdf_save'
    ]
  });
});

/**
 * @swagger
 * /api/mcp/connections:
 *   get:
 *     summary: List active MCP connections
 *     tags: [MCP]
 *     responses:
 *       200:
 *         description: List of active connections
 */
router.get('/connections', (_req: Request, res: Response) => {
  res.json({
    count: getActiveConnectionCount(),
    connections: listActiveConnections()
  });
});

/**
 * @swagger
 * /api/mcp/sse:
 *   get:
 *     summary: SSE endpoint for MCP protocol
 *     tags: [MCP]
 *     description: Establishes an SSE connection for AI agents to communicate via MCP
 *     responses:
 *       200:
 *         description: SSE connection established
 */
router.get('/sse', async (req: Request, res: Response) => {
  if (!isMCPEnabled()) {
    res.status(503).json({ 
      error: 'MCP is not enabled',
      message: 'Set MCP_ENABLED=true in environment variables to enable MCP server'
    });
    return;
  }

  // Check max connections limit
  const maxConnections = parseInt(process.env.MCP_MAX_CONNECTIONS || '10');
  if (getActiveConnectionCount() >= maxConnections) {
    res.status(503).json({
      error: 'Maximum connections reached',
      message: `MCP server has reached maximum connection limit of ${maxConnections}`
    });
    return;
  }

  // Generate unique connection ID
  const connectionId = req.query.connectionId as string || uuidv4();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  logger.info(`New MCP SSE connection request: ${connectionId}`);

  try {
    // Create MCP connection with environment config
    await createMCPConnection(connectionId, res, getMCPConfigFromEnv());
    
    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': heartbeat\n\n');
      }
    }, 30000);

    // Cleanup on close
    res.on('close', () => {
      clearInterval(heartbeatInterval);
      logger.info(`MCP SSE connection closed: ${connectionId}`);
    });

  } catch (error: any) {
    logger.error(`Failed to establish MCP connection: ${connectionId}`, { error: error.message });
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to establish MCP connection',
        message: error.message
      });
    }
  }
});

/**
 * @swagger
 * /api/mcp/sse/{connectionId}:
 *   delete:
 *     summary: Close an MCP connection
 *     tags: [MCP]
 *     parameters:
 *       - name: connectionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Connection closed
 */
router.delete('/sse/:connectionId', async (req: Request, res: Response) => {
  const { connectionId } = req.params;
  
  try {
    await closeMCPConnection(connectionId);
    res.json({ 
      success: true, 
      message: `Connection ${connectionId} closed` 
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to close connection',
      message: error.message
    });
  }
});

export default router;
