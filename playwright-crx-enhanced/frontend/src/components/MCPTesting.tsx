import React, { useState, useEffect } from 'react';
import axios from 'axios';

declare global {
  interface ImportMeta {
    env: Record<string, string>;
  }
}

interface Page {
  id: string;
  title: string;
  url: string;
  createdAt: string;
}

interface SessionInfo {
  id: string;
  pageCount: number;
  createdAt: string;
}

const MCPTesting: React.FC = () => {
  const [sessionId, setSessionId] = useState<string>('');
  const [pageId, setPageId] = useState<string>('');
  const [url, setUrl] = useState<string>('https://demo.playwright.dev/todomvc');
  const [selector, setSelector] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [expression, setExpression] = useState<string>('document.title');
  const [screenshotPath, setScreenshotPath] = useState<string>('');
  const [activePages, setActivePages] = useState<Page[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

  const addToLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const executeMCPCommand = async (endpoint: string, data: any, successMessage: string) => {
    setIsLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/mcp/${endpoint}`, data);
      addToLog(`✅ ${successMessage}: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
      addToLog(`❌ Error: ${errorMessage}`);
      console.error('MCP Command Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const initializeSession = async () => {
    const newSessionId = `session_${Date.now()}`;
    setSessionId(newSessionId);
    await executeMCPCommand('initialize', { sessionId: newSessionId, headless: false }, 'Session initialized');
  };

  const createPage = async () => {
    if (!sessionId) {
      addToLog('❌ No session ID provided');
      return;
    }
    const result = await executeMCPCommand('create-page', { sessionId }, 'Page created');
    if (result && result.pageInfo) {
      setPageId(result.pageInfo.id);
      addToLog(`Page ID set to: ${result.pageInfo.id}`);
    }
  };

  const navigateToUrl = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('navigate', { sessionId, pageId, url }, `Navigated to ${url}`);
  };

  const clickElement = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('click', { sessionId, pageId, selector }, `Clicked element: ${selector}`);
  };

  const fillField = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('fill', { sessionId, pageId, selector, value }, `Filled field: ${selector} with ${value}`);
  };

  const evaluateExpression = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('evaluate', { sessionId, pageId, expression }, `Evaluated: ${expression}`);
  };

  const takeScreenshot = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('screenshot', { 
      sessionId, 
      pageId, 
      path: screenshotPath || undefined, 
      fullPage: true 
    }, 'Screenshot taken');
  };

  const getPageContent = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('page-content', { sessionId, pageId }, 'Page content retrieved');
  };

  const getActivePages = async () => {
    if (!sessionId) {
      addToLog('❌ Session ID required');
      return;
    }
    const result = await executeMCPCommand('active-pages', { sessionId }, 'Active pages retrieved');
    if (result && result.activePages) {
      setActivePages(result.activePages);
    }
  };

  const getSessionInfo = async () => {
    if (!sessionId) {
      addToLog('❌ Session ID required');
      return;
    }
    const result = await executeMCPCommand('session-info', { sessionId }, 'Session info retrieved');
    if (result && result.sessionInfo) {
      setSessionInfo(result.sessionInfo);
    }
  };

  const closePage = async () => {
    if (!sessionId || !pageId) {
      addToLog('❌ Session ID and Page ID required');
      return;
    }
    await executeMCPCommand('close-page', { sessionId, pageId }, `Page ${pageId} closed`);
  };

  const closeSession = async () => {
    if (!sessionId) {
      addToLog('❌ Session ID required');
      return;
    }
    await executeMCPCommand('close-session', { sessionId }, `Session ${sessionId} closed`);
    setSessionId('');
    setPageId('');
    setActivePages([]);
    setSessionInfo(null);
  };

  return (
    <div className="mcp-testing-container p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">MCP (Model Control Protocol) Testing</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Session Management */}
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h3 className="text-lg font-semibold mb-3 text-blue-700">Session Management</h3>
          
          <div className="space-y-3">
            <div className="flex space-x-2">
              <button
                onClick={initializeSession}
                disabled={isLoading}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Initialize Session
              </button>
              <button
                onClick={createPage}
                disabled={isLoading || !sessionId}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Create Page
              </button>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={getSessionInfo}
                disabled={isLoading || !sessionId}
                className="flex-1 bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Get Session Info
              </button>
              <button
                onClick={getActivePages}
                disabled={isLoading || !sessionId}
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Get Active Pages
              </button>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={closePage}
                disabled={isLoading || !sessionId || !pageId}
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Close Page
              </button>
              <button
                onClick={closeSession}
                disabled={isLoading || !sessionId}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Close Session
              </button>
            </div>
            
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Session ID</label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Session ID"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Page ID</label>
              <input
                type="text"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Page ID"
              />
            </div>
          </div>
        </div>
        
        {/* Page Operations */}
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h3 className="text-lg font-semibold mb-3 text-blue-700">Page Operations</h3>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="https://example.com"
              />
              <button
                onClick={navigateToUrl}
                disabled={isLoading || !sessionId || !pageId}
                className="mt-2 w-full bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Navigate to URL
              </button>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Selector</label>
              <input
                type="text"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="CSS selector (e.g., #element-id, .class-name)"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={clickElement}
                disabled={isLoading || !sessionId || !pageId || !selector}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Click Element
              </button>
              <button
                onClick={getPageContent}
                disabled={isLoading || !sessionId || !pageId}
                className="bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Get Page Content
              </button>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Value to fill"
              />
              <button
                onClick={fillField}
                disabled={isLoading || !sessionId || !pageId || !selector || !value}
                className="mt-2 w-full bg-lime-500 hover:bg-lime-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Fill Field
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Advanced Operations */}
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h3 className="text-lg font-semibold mb-3 text-blue-700">Advanced Operations</h3>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">JavaScript Expression</label>
              <input
                type="text"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="JavaScript expression to evaluate"
              />
              <button
                onClick={evaluateExpression}
                disabled={isLoading || !sessionId || !pageId}
                className="mt-2 w-full bg-pink-500 hover:bg-pink-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Evaluate JS
              </button>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot Path (optional)</label>
              <input
                type="text"
                value={screenshotPath}
                onChange={(e) => setScreenshotPath(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Path to save screenshot (optional)"
              />
              <button
                onClick={takeScreenshot}
                disabled={isLoading || !sessionId || !pageId}
                className="mt-2 w-full bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Take Screenshot
              </button>
            </div>
          </div>
        </div>
        
        {/* Session Info and Active Pages */}
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h3 className="text-lg font-semibold mb-3 text-blue-700">Session & Page Info</h3>
          
          {sessionInfo && (
            <div className="mb-4 p-3 bg-blue-50 rounded border">
              <h4 className="font-medium text-blue-800">Session Info:</h4>
              <p>ID: {sessionInfo.id}</p>
              <p>Pages: {sessionInfo.pageCount}</p>
              <p>Created: {new Date(sessionInfo.createdAt).toLocaleString()}</p>
            </div>
          )}
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Active Pages ({activePages.length}):</h4>
            <div className="max-h-40 overflow-y-auto">
              {activePages.length > 0 ? (
                <ul className="space-y-1">
                  {activePages.map((page, index) => (
                    <li key={index} className="text-sm p-1 bg-white border rounded">
                      <span className="font-medium">{page.id}</span>: {page.title} - {page.url}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 text-sm">No active pages</p>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Logs */}
      <div className="bg-gray-50 p-4 rounded-lg border">
        <h3 className="text-lg font-semibold mb-3 text-blue-700">Operation Logs</h3>
        <div className="h-40 overflow-y-auto bg-white p-3 border rounded">
          {logs.length > 0 ? (
            <ul className="space-y-1">
              {logs.map((log, index) => (
                <li key={index} className="text-sm font-mono">{log}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-center h-full flex items-center justify-center">No logs yet</p>
          )}
        </div>
        <button
          onClick={() => setLogs([])}
          className="mt-2 bg-gray-300 hover:bg-gray-400 text-gray-800 px-3 py-1 rounded text-sm"
        >
          Clear Logs
        </button>
      </div>
      
      {/* MCP Info */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="text-lg font-semibold text-blue-800 mb-2">About MCP (Model Control Protocol)</h3>
        <p className="text-gray-700">
          MCP enables AI-driven browser automation capabilities. It provides structured tools for AI agents to interact with browsers,
          including navigation, interaction, inspection, and more. This interface allows you to test MCP functionality directly.
        </p>
      </div>
    </div>
  );
};

export default MCPTesting;