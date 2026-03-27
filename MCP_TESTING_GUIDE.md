# MCP (Model Control Protocol) Testing Guide

## Overview

This guide explains how to test MCP (Model Control Protocol) features in the Playwright environment. MCP enables AI-driven browser automation capabilities through structured tool calls.

## Testing MCP Features

### 1. Understanding MCP Tools

MCP provides several categories of tools for AI agents to interact with browsers:

- **Navigation tools**: `browser_navigate`, `browser_navigate_back`
- **Interaction tools**: `browser_click`, `browser_drag`, `browser_hover`, `browser_select_option`
- **Snapshot tools**: `browser_snapshot` for accessibility tree capture
- **Input tools**: Keyboard and mouse interaction tools
- **Form tools**: Tools for form filling and submission
- **Network tools**: For monitoring and controlling network requests
- **Console tools**: For accessing browser console messages

### 2. Running MCP Tests

#### Prerequisites
- Install Playwright browsers: `npx playwright install`
- Ensure Node.js and npm are installed

#### Execute the Test Suite
```bash
# Run all MCP feature tests
npx playwright test test_mcp_features.spec.ts

# Run with UI mode to see the interactions
npx playwright test test_mcp_features.spec.ts --ui

# Run in headed mode to observe browser actions
npx playwright test test_mcp_features.spec.ts --headed
```

### 3. Test Structure

Our test suite covers the following MCP capabilities:

#### Basic Navigation and Interaction
- Tests navigation to web pages
- Verifies element interaction (click, fill, submit)
- Confirms element identification and state

#### Page Snapshot and Element Identification
- Tests accessibility snapshot capture
- Validates element selection mechanisms
- Ensures proper element state management

#### Form Handling and Submission
- Tests form filling operations
- Verifies form submission behavior
- Checks for proper response handling

#### Advanced Interactions
- Tests keyboard interactions (typing, special keys)
- Validates mouse operations (click, double-click, hover)
- Ensures complex interactions work correctly

#### Network and Console Monitoring
- Simulates network request interception
- Tests console message capture
- Validates monitoring capabilities

#### MCP Server Interaction Simulation
- Demonstrates how AI models would use MCP tools
- Shows the workflow for structured browser control
- Validates the complete interaction cycle

### 4. MCP Server Testing

To test the MCP server directly:

#### Start the MCP Server
```bash
# Basic server start
npx playwright run-mcp-server --port 8080

# With specific capabilities
npx playwright run-mcp-server --port 8080 --caps vision,pdf

# With browser specification
npx playwright run-mcp-server --port 8080 --browser chrome
```

#### Test Server Connectivity
The server accepts JSON-RPC requests in the format:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "browser_navigate",
    "arguments": {
      "url": "https://example.com"
    }
  }
}
```

### 5. Configuration for MCP Testing

You can configure MCP behavior using:

#### Environment Variables
```bash
PLAYWRIGHT_MCP_PORT=8080
PLAYWRIGHT_MCP_HOST=localhost
PLAYWRIGHT_MCP_BROWSER=chrome
PLAYWRIGHT_MCP_CAPS=core,vision,pdf
PLAYWRIGHT_MCP_HEADLESS=true
```

#### Configuration File
```json
{
  "browser": {
    "browserName": "chromium",
    "launchOptions": {
      "channel": "chrome",
      "headless": false
    },
    "contextOptions": {
      "viewport": {"width": 1280, "height": 720}
    }
  },
  "server": {
    "port": 8080,
    "host": "localhost"
  },
  "capabilities": ["core", "vision", "pdf"],
  "snapshot": {
    "mode": "incremental",
    "output": "stdout"
  },
  "timeouts": {
    "action": 5000,
    "navigation": 30000
  }
}
```

### 6. Validating MCP Functionality

To validate that MCP features are working correctly:

1. **Tool Availability**: Verify that all expected MCP tools are registered and callable
2. **Security Controls**: Confirm that origin restrictions and file access controls work as expected
3. **Response Quality**: Ensure that accessibility snapshots and other responses provide sufficient information for AI agents
4. **Error Handling**: Test that invalid tool calls return appropriate error messages
5. **Performance**: Validate that tools respond within acceptable time limits

### 7. Troubleshooting Common Issues

- **Missing Browser Executables**: Run `npx playwright install` to download required browsers
- **Port Conflicts**: Use different ports or ensure previous MCP servers are stopped
- **Security Restrictions**: Adjust allowed origins and file access policies as needed
- **Capability Limitations**: Ensure required capabilities are enabled for your use case

### 8. Best Practices for MCP Testing

- Use accessibility snapshots instead of screenshots for better AI interpretability
- Test with various web applications to ensure robustness
- Validate error conditions and edge cases
- Monitor performance metrics for tool responses
- Secure MCP endpoints appropriately for your environment
- Test with both headless and headed browsers as appropriate