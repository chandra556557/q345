#!/usr/bin/env node

/**
 * Project Manager CLI
 * Manage multiple Playwright projects with dynamic environment configuration
 */

const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '../');

// ANSI Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * List all available projects
 */
function listProjects() {
  log('📋 Available Projects:\n', 'cyan');

  const files = fs.readdirSync(baseDir);
  const projects = files.filter(f => f.startsWith('.env.') && !f.endsWith('.example'));

  if (projects.length === 0) {
    log('No projects found. Create .env.{projectName} files to get started.', 'yellow');
    return;
  }

  projects.forEach((file, index) => {
    const projectName = file.replace('.env.', '');
    const filePath = path.join(baseDir, file);
    const stats = fs.statSync(filePath);
    const size = (stats.size / 1024).toFixed(2);

    log(`  ${index + 1}. ${projectName.padEnd(20)} (${size} KB)`, 'green');
  });

  log('\n' + 'Usage:'.padEnd(20) + 'npm start {projectName}', 'cyan');
  log('Example:'.padEnd(20) + 'npm start project1\n', 'cyan');
}

/**
 * Show project details
 */
function showProjectDetails(projectName) {
  const envFile = path.join(baseDir, `.env.${projectName}`);

  if (!fs.existsSync(envFile)) {
    log(`✗ Project not found: ${projectName}`, 'red');
    return;
  }

  log(`📊 Project Details: ${projectName}\n`, 'cyan');

  const content = fs.readFileSync(envFile, 'utf-8');
  const lines = content.split('\n');

  const config = {};
  let currentSection = '';

  lines.forEach(line => {
    if (line.startsWith('#')) {
      currentSection = line.replace(/^#\s*/, '').trim();
    } else if (line.includes('=') && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      const cleanKey = key.trim();
      const cleanValue = value.trim().replace(/^["']|["']$/g, '');

      if (!config[currentSection]) config[currentSection] = {};
      config[currentSection][cleanKey] = cleanValue;
    }
  });

  Object.entries(config).forEach(([section, values]) => {
    if (section && Object.keys(values).length > 0) {
      log(`\n${section}`, 'yellow');
      Object.entries(values).forEach(([key, value]) => {
        // Mask sensitive values
        const isSensitive = ['PASSWORD', 'SECRET', 'TOKEN'].some(s => key.includes(s));
        const displayValue = isSensitive ? '***' : value;
        log(`  ${key.padEnd(30)} = ${displayValue}`);
      });
    }
  });

  log('\n', 'reset');
}

/**
 * Create a new project
 */
function createProject(projectName) {
  if (!projectName) {
    log('✗ Project name is required', 'red');
    return;
  }

  const envFile = path.join(baseDir, `.env.${projectName}`);

  if (fs.existsSync(envFile)) {
    log(`✗ Project already exists: ${projectName}`, 'red');
    return;
  }

  const template = `# ============================================
# ${projectName.toUpperCase()} ENVIRONMENT CONFIGURATION
# ============================================

# Project Identifier
ACTIVE_PROJECT=${projectName}
PROJECT_DISPLAY_NAME=${projectName}

# ============================================
# DATABASE CONFIGURATION
# ============================================

DB_HOST=localhost
DB_PORT=5432
DB_NAME=playwright_${projectName}
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SCHEMA=public
DATABASE_URL="postgresql://postgres:your_password_here@localhost:5432/playwright_${projectName}?schema=public"

# Database Pool Configuration
DB_MAX_CLIENTS=10
DB_MIN_CLIENTS=2
DB_IDLE_TIMEOUT=30000
DB_QUERY_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=5000

# ============================================
# SERVER CONFIGURATION
# ============================================

PORT=3001
NODE_ENV=development

# JWT Secrets
JWT_ACCESS_SECRET="your_access_secret_here_change_in_production"
JWT_REFRESH_SECRET="your_refresh_secret_here_change_in_production"

# ============================================
# CORS & ORIGINS
# ============================================

ALLOWED_ORIGINS="chrome-extension://your-extension-id,http://localhost:3001,http://localhost:5173"

# ============================================
# EXTERNAL API CONFIGURATION
# ============================================

AI_ANALYSIS_SERVICE_URL=http://localhost:8000

EXTERNAL_BOUNDARY_API_URL=http://api-server:3000/genieapi/assistant/testdata/boundary/generate
EXTERNAL_POSITIVE_API_URL=http://api-server:3000/genieapi/assistant/testdata/positive/generate
EXTERNAL_NEGATIVE_API_URL=http://api-server:3000/genieapi/assistant/testdata/negative/generate
EXTERNAL_SECURITY_API_URL=http://api-server:3000/genieapi/assistant/testdata/security/generate
EXTERNAL_EQUIVALENCE_API_URL=http://api-server:3000/genieapi/assistant/testdata/equivalence/generate
EXTERNAL_XPATH_DEEP_ANALYSIS_URL=http://api-server:3000/genieapi/ai-analysis/xpath-deep-analysis
EXTERNAL_UPLOAD_SCRIPT_XPATH_URL=http://api-server:3000/genieapi/ai-analysis/upload-script-xpath-analysis
EXTERNAL_API_TOKEN=your_api_token_here

# ============================================
# REDIS CONFIGURATION
# ============================================

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ============================================
# FEATURE FLAGS
# ============================================

ENABLE_QUEUE=false
ENABLE_WORKER_POOL=false
WORKER_POOL_SIZE=3
WORKER_CONCURRENCY=5
WORKER_HEARTBEAT_INTERVAL=30000

# ============================================
# LOGGING & RATE LIMITING
# ============================================

LOG_LEVEL=debug
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ============================================
# FILE UPLOAD
# ============================================

MAX_FILE_SIZE=10485760
UPLOAD_DIR="./uploads/${projectName}"

# ============================================
# SESSION
# ============================================

SESSION_TIMEOUT_MINUTES=15
REFRESH_TOKEN_DAYS=7
`;

  fs.writeFileSync(envFile, template, 'utf-8');
  log(`✓ Created new project: ${projectName}`, 'green');
  log(`  File: ${envFile}`, 'cyan');
  log(`  Run: npm start ${projectName}\n`, 'cyan');
}

/**
 * Delete a project
 */
function deleteProject(projectName) {
  if (!projectName) {
    log('✗ Project name is required', 'red');
    return;
  }

  const envFile = path.join(baseDir, `.env.${projectName}`);

  if (!fs.existsSync(envFile)) {
    log(`✗ Project not found: ${projectName}`, 'red');
    return;
  }

  fs.unlinkSync(envFile);
  log(`✓ Deleted project: ${projectName}`, 'green');
}

/**
 * Show help
 */
function showHelp() {
  log(`
${colors.bold}Project Manager CLI${colors.reset}
Manage multiple Playwright projects with dynamic environment configuration

${colors.bold}Usage:${colors.reset}
  node scripts/project-manager.js [command] [args]

${colors.bold}Commands:${colors.reset}
  list                      List all available projects
  show <projectName>        Show project configuration details
  create <projectName>      Create a new project with template
  delete <projectName>      Delete a project
  help                      Show this help message

${colors.bold}Examples:${colors.reset}
  node scripts/project-manager.js list
  node scripts/project-manager.js show project1
  node scripts/project-manager.js create myproject
  node scripts/project-manager.js delete myproject

${colors.bold}Environment Variables:${colors.reset}
  Set ACTIVE_PROJECT to dynamically load project configuration:
  ACTIVE_PROJECT=project1 npm start

${colors.bold}Project Files:${colors.reset}
  Project-specific configuration files are located at:
  ${baseDir}/.env.{projectName}
  `);
}

// CLI Entry Point
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'list':
    listProjects();
    break;
  case 'show':
    showProjectDetails(args[0]);
    break;
  case 'create':
    createProject(args[0]);
    break;
  case 'delete':
    deleteProject(args[0]);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    if (command) {
      log(`Unknown command: ${command}\n`, 'red');
    }
    showHelp();
}
