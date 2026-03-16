/**
 * MCP (Model Context Protocol) Server Integration
 * 
 * Integrates Microsoft's @playwright/mcp package to provide
 * AI agents with browser automation capabilities via SSE transport.
 * 
 * Features:
 * - Browser Control: navigate, click, type, screenshot, etc.
 * - DOM Snapshots: accessibility tree for AI understanding
 * - Console & Network: logs and request monitoring
 * - File Operations: uploads, downloads, session management
 */

import { logger } from '../utils/logger';
import type { Response } from 'express';

// Dynamic imports for optional MCP dependencies
let createServer: any;
let SSEServerTransport: any;

// Try to import MCP modules (optional dependency)
try {
  const playwrightMcp = require('@playwright/mcp');
  createServer = playwrightMcp.createServer;
} catch (e) {
  logger.warn('@playwright/mcp not installed, MCP features disabled');
}

try {
  const mcpSdk = require('@modelcontextprotocol/sdk/server/sse.js');
  SSEServerTransport = mcpSdk.SSEServerTransport;
} catch (e) {
  logger.warn('@modelcontextprotocol/sdk not installed, MCP features disabled');
}

// MCP Server configuration
export interface MCPConfig {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  capabilities?: ('core' | 'tabs' | 'pdf' | 'history' | 'wait' | 'files' | 'install')[];
}

// Default configuration
const defaultConfig: MCPConfig = {
  browser: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 720 },
  capabilities: ['core', 'tabs', 'wait', 'files']
};

// Active MCP connections
const activeConnections = new Map<string, { transport: any; server: any }>();

/**
 * Create and initialize an MCP server instance for SSE connection
 */
export async function createMCPConnection(connectionId: string, res: Response, config?: Partial<MCPConfig>): Promise<void> {
  // Check if MCP modules are available
  if (!createServer || !SSEServerTransport) {
    throw new Error('MCP modules not installed. Run: npm install @playwright/mcp @modelcontextprotocol/sdk');
  }

  const mergedConfig = { ...defaultConfig, ...config };
  
  logger.info(`Creating MCP connection: ${connectionId}`, { config: mergedConfig });

  try {
    // Create MCP server from @playwright/mcp
    const server = await createServer({
      browser: mergedConfig.browser,
      headless: mergedConfig.headless,
      viewport: mergedConfig.viewport,
      userAgent: mergedConfig.userAgent,
    });

    // Create SSE transport
    const transport = new SSEServerTransport('/messages', res);

    // Store connection
    activeConnections.set(connectionId, { transport, server });

    // Connect server to transport
    await server.connect(transport);

    logger.info(`MCP connection established: ${connectionId}`);

    // Handle connection close
    res.on('close', () => {
      closeMCPConnection(connectionId);
    });

  } catch (error) {
    logger.error(`Failed to create MCP connection: ${connectionId}`, { error });
    throw error;
  }
}

/**
 * Close an MCP connection
 */
export async function closeMCPConnection(connectionId: string): Promise<void> {
  const connection = activeConnections.get(connectionId);
  
  if (connection) {
    try {
      await connection.server.close();
      activeConnections.delete(connectionId);
      logger.info(`MCP connection closed: ${connectionId}`);
    } catch (error) {
      logger.error(`Error closing MCP connection: ${connectionId}`, { error });
    }
  }
}

/**
 * Get active connection count
 */
export function getActiveConnectionCount(): number {
  return activeConnections.size;
}

/**
 * List active connections
 */
export function listActiveConnections(): string[] {
  return Array.from(activeConnections.keys());
}

/**
 * Check if MCP is enabled via environment variable
 */
export function isMCPEnabled(): boolean {
  return process.env.MCP_ENABLED === 'true';
}

/**
 * Get MCP configuration from environment
 */
export function getMCPConfigFromEnv(): MCPConfig {
  return {
    browser: (process.env.MCP_BROWSER as MCPConfig['browser']) || 'chromium',
    headless: process.env.MCP_HEADLESS !== 'false',
    viewport: {
      width: parseInt(process.env.MCP_VIEWPORT_WIDTH || '1280'),
      height: parseInt(process.env.MCP_VIEWPORT_HEIGHT || '720')
    }
  };
}

export default {
  createMCPConnection,
  closeMCPConnection,
  getActiveConnectionCount,
  listActiveConnections,
  isMCPEnabled,
  getMCPConfigFromEnv
};
