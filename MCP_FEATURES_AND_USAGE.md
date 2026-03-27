# Model Control Protocol (MCP) Features and Usage Guide

## Overview

MCP (Model Control Protocol) is a protocol integrated into Playwright that enables AI-driven browser automation capabilities. It provides a standardized way for AI models and tools to interact with browsers and test runners through structured tool calls.

## Core Features

### 1. Browser Control Tools
- **Navigation**: Navigate to URLs, go back/forward in history
  - `browser_navigate`: Navigate to a specific URL
  - `browser_navigate_back`: Go back to the previous page
  
- **Interaction Tools**:
  - `browser_click`: Click on elements
  - `browser_drag`: Perform drag and drop operations
  - `browser_hover`: Hover over elements
  - `browser_select_option`: Select options in dropdowns

### 2. Page Inspection & Snapshot Tools
- **Page Snapshots**: Capture accessibility snapshots of the current page
  - `browser_snapshot`: Capture detailed accessibility tree representation of the page
  - Better than screenshots for AI understanding of page structure

### 3. Input Tools
- **Keyboard**: Simulate keyboard input
  - `keyboard_type`: Type text into input fields
  - `keyboard_press`: Press specific keys
  - `keyboard_down`/`keyboard_up`: Key press/release events
  
- **Mouse**: Mouse movement and interaction
  - `mouse_move`: Move mouse to coordinates
  - `mouse_click`: Click at coordinates
  - `mouse_down`/`mouse_up`: Mouse button events

### 4. Content Management
- **Form Handling**: Interact with forms
  - `fill_form`: Fill form fields
  - `submit_form`: Submit forms
  
- **File Operations**: Handle file uploads/downloads
  - `upload_file`: Upload files
  - `download_file`: Manage downloads

### 5. Network & Console Tools
- **Network Monitoring**: Inspect network traffic
  - `network_capture`: Capture network requests/responses
  - `network_block`: Block specific URLs
  
- **Console Inspection**: Access browser console
  - `console_get_messages`: Retrieve console messages
  - `console_clear`: Clear console

### 6. Advanced Capabilities
- **PDF Generation**: Create PDFs from pages
  - `pdf_create`: Generate PDF documents
  
- **Screenshots**: Take visual snapshots
  - `screenshot_page`: Capture full page screenshots
  - `screenshot_element`: Capture specific elements

## How to Use MCP

### Command Line Interface

MCP provides several command-line options through Playwright:

```bash
# Start browser MCP server
npx playwright run-mcp-server [options]

# Start test runner MCP server  
npx playwright run-test-mcp-server [options]

# Options include:
# --port: Port to listen on
# --host: Host to bind server to
# --browser: Browser to use (chrome, firefox, webkit)
# --headless: Run in headless mode
# --caps: Additional capabilities (vision, pdf)
# --timeout-action: Action timeout in ms
# --timeout-navigation: Navigation timeout in ms
```

### Environment Variables

MCP can be configured using environment variables:

```bash
# Server configuration
PLAYWRIGHT_MCP_HOST=0.0.0.0
PLAYWRIGHT_MCP_PORT=8080
PLAYWRIGHT_MCP_ALLOWED_HOSTNAMES=localhost,127.0.0.1

# Browser configuration
PLAYWRIGHT_MCP_BROWSER=chrome
PLAYWRIGHT_MCP_HEADLESS=true
PLAYWRIGHT_MCP_VIEWPORT_SIZE=1280x720

# Security and network
PLAYWRIGHT_MCP_ALLOWED_ORIGINS=https://example.com
PLAYWRIGHT_MCP_BLOCKED_ORIGINS=http://malicious-site.com
PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=false
```

### Configuration File

MCP can be configured using a JSON configuration file:

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

### Programmatic Usage

You can also use MCP programmatically:

```javascript
const { createConnection } = require('playwright/lib/mcp');

async function setupMCP() {
  const config = {
    browser: {
      launchOptions: { headless: true }
    },
    server: {
      port: 8080
    }
  };

  const server = await createConnection(config);
  // Use the server to handle MCP requests
}
```

## Capabilities System

MCP uses a capability-based system to control which features are available:

- **Core capabilities**: Basic browser control (navigate, click, type, etc.)
- **Vision capabilities**: Screenshot and visual analysis tools
- **PDF capabilities**: PDF generation features
- **Testing capabilities**: Test-specific tools and utilities
- **Internal capabilities**: Advanced debugging and development tools

## Security Features

MCP includes several security measures:

- **Origin restrictions**: Control which origins the browser can access
- **File access controls**: Restrict access to local file system
- **Host validation**: Validate request origins
- **Permission management**: Control browser permissions (geolocation, camera, etc.)

## Use Cases

1. **AI-Driven Testing**: Allow AI models to control browsers for automated testing
2. **Automated QA**: Build automated quality assurance workflows
3. **Web Scraping**: Structured data extraction with AI assistance
4. **Accessibility Testing**: Automated accessibility compliance checking
5. **Regression Testing**: Automated UI regression detection

## Best Practices

1. Use accessibility snapshots instead of screenshots when possible for better AI understanding
2. Set appropriate timeouts for different types of interactions
3. Configure security settings appropriately for your environment
4. Use capabilities system to limit available tools based on trust level
5. Monitor network and console tools for debugging information