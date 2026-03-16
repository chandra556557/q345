import { Browser, Page } from 'playwright-core';
import { chromium } from 'playwright-core';

export interface MCPPageInfo {
  id: string;
  title: string;
  url: string;
  createdAt: Date;
}

export interface MCPSession {
  browser: Browser;
  pages: Map<string, Page>;
  createdAt: Date;
}

export class MCPService {
  private sessions: Map<string, MCPSession> = new Map();

  /**
   * Create a new MCP session with a browser instance
   */
  async createSession(sessionId: string, headless: boolean = true): Promise<string> {
    const browser = await chromium.launch({ 
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const session: MCPSession = {
      browser,
      pages: new Map<string, Page>(),
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Get an existing session
   */
  getSession(sessionId: string): MCPSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Create a new page in a session
   */
  async createPage(sessionId: string): Promise<MCPPageInfo> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const context = await session.browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    // Generate a unique ID for the page
    const pageId = `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    session.pages.set(pageId, page);

    const pageInfo: MCPPageInfo = {
      id: pageId,
      title: await page.title(),
      url: page.url(),
      createdAt: new Date()
    };

    return pageInfo;
  }

  /**
   * Get a page by session and page ID
   */
  getPage(sessionId: string, pageId: string): Page | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }
    return session.pages.get(pageId) || null;
  }

  /**
   * Navigate to a URL
   */
  async navigate(sessionId: string, pageId: string, url: string): Promise<boolean> {
    const page = this.getPage(sessionId, pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    await page.goto(url, { waitUntil: 'networkidle' });
    return true;
  }

  /**
   * Click on an element
   */
  async click(sessionId: string, pageId: string, selector: string, options?: { button?: 'left' | 'right' | 'middle', clickCount?: number }): Promise<boolean> {
    const page = this.getPage(sessionId, pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });

    const button = options?.button || 'left';
    const clickCount = options?.clickCount || 1;

    if (clickCount === 2) {
      await page.dblclick(selector);
    } else {
      await page.click(selector, { button });
    }

    return true;
  }

  /**
   * Fill an input field
   */
  async fill(sessionId: string, pageId: string, selector: string, value: string): Promise<boolean> {
    const page = this.getPage(sessionId, pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await page.fill(selector, value);

    return true;
  }

  /**
   * Evaluate JavaScript expression
   */
  async evaluate<T>(sessionId: string, pageId: string, expression: string): Promise<T> {
    const page = this.getPage(sessionId, pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    return await page.evaluate(expression);
  }

  /**
   * Take a screenshot
   */
  async screenshot(sessionId: string, pageId: string, options?: { path?: string, fullPage?: boolean, selector?: string }): Promise<string> {
    const page = this.getPage(sessionId, pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    let screenshotBuffer: Buffer;

    if (options?.selector) {
      // Screenshot specific element
      const element = await page.waitForSelector(options.selector, { state: 'visible', timeout: 10000 });
      screenshotBuffer = await element.screenshot();
    } else {
      // Screenshot entire page or viewport
      screenshotBuffer = await page.screenshot({ fullPage: options?.fullPage || false });
    }

    if (options?.path) {
      // Save to file if path provided
      const fs = require('fs');
      fs.writeFileSync(options.path, screenshotBuffer);
      return options.path;
    } else {
      // Return as base64 string
      return screenshotBuffer.toString('base64');
    }
  }

  /**
   * Get page content
   */
  async getPageContent(sessionId: string, pageId: string): Promise<{ content: string, title: string }> {
    const page = this.getPage(sessionId, pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    const content = await page.content();
    const title = await page.title();

    return { content, title };
  }

  /**
   * Get all active pages in a session
   */
  getActivePages(sessionId: string): MCPPageInfo[] {
    const session = this.getSession(sessionId);
    if (!session) {
      return [];
    }

    const pages: MCPPageInfo[] = [];
    for (const [pageId, page] of session.pages) {
      pages.push({
        id: pageId,
        title: page.url(),
        url: page.url(),
        createdAt: new Date() // In a real implementation, you'd track the actual creation time
      });
    }

    return pages;
  }

  /**
   * Close a specific page
   */
  async closePage(sessionId: string, pageId: string): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const page = session.pages.get(pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    await page.close();
    session.pages.delete(pageId);

    return true;
  }

  /**
   * Close an entire session (browser and all pages)
   */
  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Close all pages first
    for (const [pageId, page] of session.pages) {
      try {
        await page.close();
      } catch (error) {
        console.error(`Error closing page ${pageId}:`, error);
      }
    }

    // Close the browser
    await session.browser.close();

    // Remove the session
    this.sessions.delete(sessionId);

    return true;
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId: string): { id: string, pageCount: number, createdAt: Date } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      id: sessionId,
      pageCount: session.pages.size,
      createdAt: session.createdAt
    };
  }
}

// Export singleton instance
export const mcpService = new MCPService();