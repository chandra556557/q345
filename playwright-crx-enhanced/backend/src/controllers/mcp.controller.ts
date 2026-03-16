import { Request, Response } from 'express';
import { z } from 'zod';
import { mcpService } from '../services/mcp.service';

// Define MCP Tool schemas
const InitializeSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  headless: z.boolean().optional().default(true)
});

const CreatePageSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required')
});

const NavigateSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  url: z.string().url('URL must be a valid URL')
});

const ClickSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  selector: z.string().min(1, 'Selector is required'),
  button: z.enum(['left', 'right', 'middle']).optional().default('left'),
  clickCount: z.number().min(1).max(2).optional().default(1)
});

const FillSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  selector: z.string().min(1, 'Selector is required'),
  value: z.string().min(1, 'Value is required')
});

const EvaluateSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  expression: z.string().min(1, 'Expression is required')
});

const ScreenshotSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  path: z.string().optional(),
  fullPage: z.boolean().optional().default(false),
  selector: z.string().optional()
});

const ClosePageSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required')
});

const GetPageContentSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageId: z.string().min(1, 'Page ID is required')
});

// MCP Controller class
export class MCPController {
  /**
   * Initialize MCP browser instance
   */
  async initializeBrowser(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, headless } = InitializeSchema.parse(req.body);

      await mcpService.createSession(sessionId, headless);

      res.status(200).json({
        success: true,
        message: 'MCP browser session initialized successfully',
        sessionId
      });
    } catch (error: any) {
      console.error('Error initializing MCP browser:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to initialize MCP browser'
      });
    }
  }

  /**
   * Create a new browser context and page
   */
  async createPage(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = CreatePageSchema.parse(req.body);

      const pageInfo = await mcpService.createPage(sessionId);

      res.status(200).json({
        success: true,
        pageInfo,
        message: 'Page created successfully'
      });
    } catch (error: any) {
      console.error('Error creating page:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create page'
      });
    }
  }

  /**
   * Navigate to a URL
   */
  async navigate(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId, url } = NavigateSchema.parse(req.body);

      await mcpService.navigate(sessionId, pageId, url);

      res.status(200).json({
        success: true,
        message: `Navigated to ${url}`,
        url
      });
    } catch (error: any) {
      console.error('Error navigating:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to navigate to URL'
      });
    }
  }

  /**
   * Click on an element
   */
  async click(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId, selector, button, clickCount } = ClickSchema.parse(req.body);

      await mcpService.click(sessionId, pageId, selector, { button, clickCount });

      res.status(200).json({
        success: true,
        message: `Clicked on element with selector: ${selector}`
      });
    } catch (error: any) {
      console.error('Error clicking:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to click on element'
      });
    }
  }

  /**
   * Fill an input field
   */
  async fill(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId, selector, value } = FillSchema.parse(req.body);

      await mcpService.fill(sessionId, pageId, selector, value);

      res.status(200).json({
        success: true,
        message: `Filled element with selector: ${selector}`,
        filledValue: value
      });
    } catch (error: any) {
      console.error('Error filling:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fill element'
      });
    }
  }

  /**
   * Evaluate JavaScript expression in the browser context
   */
  async evaluate(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId, expression } = EvaluateSchema.parse(req.body);

      const result = await mcpService.evaluate(sessionId, pageId, expression);

      res.status(200).json({
        success: true,
        result,
        expression
      });
    } catch (error: any) {
      console.error('Error evaluating:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to evaluate expression'
      });
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId, path, fullPage, selector } = ScreenshotSchema.parse(req.body);

      const result = await mcpService.screenshot(sessionId, pageId, { path, fullPage, selector });

      if (path) {
        res.status(200).json({
          success: true,
          message: `Screenshot saved to ${path}`,
          path
        });
      } else {
        res.status(200).json({
          success: true,
          screenshot: `data:image/png;base64,${result}`
        });
      }
    } catch (error: any) {
      console.error('Error taking screenshot:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to take screenshot'
      });
    }
  }

  /**
   * Get page content as HTML
   */
  async getPageContent(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId } = GetPageContentSchema.parse(req.body);

      const { content, title } = await mcpService.getPageContent(sessionId, pageId);
      
      res.status(200).json({
        success: true,
        content,
        title
      });
    } catch (error: any) {
      console.error('Error getting page content:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get page content'
      });
    }
  }

  /**
   * Close a specific page
   */
  async closePage(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, pageId } = ClosePageSchema.parse(req.body);

      await mcpService.closePage(sessionId, pageId);

      res.status(200).json({
        success: true,
        message: `Page ${pageId} closed successfully`
      });
    } catch (error: any) {
      console.error('Error closing page:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to close page'
      });
    }
  }

  /**
   * Close the browser and all pages
   */
  async closeBrowser(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.body;

      const result = await mcpService.closeSession(sessionId);

      if (result) {
        res.status(200).json({
          success: true,
          message: 'Browser session closed successfully'
        });
      } else {
        res.status(404).json({
          success: false,
          error: `Session ${sessionId} not found`
        });
      }
    } catch (error: any) {
      console.error('Error closing browser session:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to close browser session'
      });
    }
  }

  /**
   * Get list of active pages
   */
  async getActivePages(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.body;

      const pages = mcpService.getActivePages(sessionId);
      
      res.status(200).json({
        success: true,
        activePages: pages,
        count: pages.length
      });
    } catch (error: any) {
      console.error('Error getting active pages:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get active pages'
      });
    }
  }

  /**
   * Get session info
   */
  async getSessionInfo(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.body;

      const sessionInfo = mcpService.getSessionInfo(sessionId);
      
      if (!sessionInfo) {
        res.status(404).json({
          success: false,
          error: `Session ${sessionId} not found`
        });
        return;
      }
      
      res.status(200).json({
        success: true,
        sessionInfo
      });
    } catch (error: any) {
      console.error('Error getting session info:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get session info'
      });
    }
  }
}

// Export singleton instance
export const mcpController = new MCPController();