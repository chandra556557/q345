# Dynamic Project Configuration Guide

This guide explains how to set up and manage multiple projects with different configurations using environment variables.

## Overview

The dynamic project configuration system allows you to:
- Run multiple projects with different databases, API endpoints, and configurations
- Switch between projects easily using environment variables
- Maintain separate `.env` files for each project
- Manage project configurations via CLI commands

## Directory Structure

```
playwright-crx-enhanced/backend/
├── .env                          # Default environment (fallback)
├── .env.example                  # Template for default .env
├── .env.project1                 # Project 1 configuration
├── .env.project2                 # Project 2 configuration
├── scripts/
│   └── project-manager.js        # CLI for managing projects
└── src/
    ├── config/
    │   └── projects.config.ts    # Project configuration manager
    ├── utils/
    │   └── projectManager.ts     # Project utilities
    └── index.ts                  # Main app entry point
```

## Setup Instructions

### 1. Create Project Configuration Files

Create `.env.{projectName}` files in the `playwright-crx-enhanced/backend/` directory.

**Example: `.env.project1`**
```bash
ACTIVE_PROJECT=project1
PROJECT_DISPLAY_NAME=Project 1 - Development
DB_HOST=localhost
DB_PORT=5433
DB_NAME=playwright_project1
DB_USER=postgres
DB_PASSWORD=your_password_here
PORT=3001
NODE_ENV=development
```

**Example: `.env.project2`**
```bash
ACTIVE_PROJECT=project2
PROJECT_DISPLAY_NAME=Project 2 - Staging
DB_HOST=localhost
DB_PORT=5434
DB_NAME=playwright_project2
DB_USER=postgres
DB_PASSWORD=your_password_here
PORT=3002
NODE_ENV=staging
```

### 2. Update `package.json` Scripts

Add project-specific start scripts to your `package.json`:

```json
{
  "scripts": {
    "start": "node dist/index.js",
    "start:dev": "ACTIVE_PROJECT=project1 npm start",
    "start:staging": "ACTIVE_PROJECT=project2 npm start",
    "start:project": "npm start",
    "dev": "npm run build && ACTIVE_PROJECT=project1 npm run dev",
    "project:list": "node scripts/project-manager.js list",
    "project:show": "node scripts/project-manager.js show",
    "project:create": "node scripts/project-manager.js create",
    "project:delete": "node scripts/project-manager.js delete"
  }
}
```

## Usage

### Method 1: Using Environment Variable

```bash
# Load project1 configuration
ACTIVE_PROJECT=project1 npm start

# Load project2 configuration
ACTIVE_PROJECT=project2 npm start

# Load default configuration
npm start
```

### Method 2: Using package.json Scripts

```bash
# Run with project1
npm run start:dev

# Run with project2
npm run start:staging
```

### Method 3: Using Project Manager CLI

```bash
# List all available projects
node scripts/project-manager.js list

# Show project details
node scripts/project-manager.js show project1

# Create a new project
node scripts/project-manager.js create myproject

# Delete a project
node scripts/project-manager.js delete myproject
```

## Project Manager CLI Commands

### List Projects
```bash
node scripts/project-manager.js list
```
Lists all `.env.{projectName}` files and their sizes.

**Output:**
```
📋 Available Projects:

  1. project1              (2.35 KB)
  2. project2              (2.45 KB)

Usage:                   npm start {projectName}
Example:                 npm start project1
```

### Show Project Details
```bash
node scripts/project-manager.js show project1
```
Displays project configuration (sensitive values masked).

**Output:**
```
📊 Project Details: project1

PROJECT MANAGEMENT (DYNAMIC PROJECT LOADING)
  ACTIVE_PROJECT         = project1
  PROJECT_DISPLAY_NAME   = Project 1 - Development

DATABASE CONFIGURATION
  DB_HOST                = localhost
  DB_PORT                = 5433
  DB_NAME                = playwright_project1
  ...
```

### Create New Project
```bash
node scripts/project-manager.js create myproject
```
Creates a new `.env.myproject` file with template configuration.

### Delete Project
```bash
node scripts/project-manager.js delete myproject
```
Deletes the `.env.myproject` file.

## Environment Variables

### Required Variables

Every project configuration must include:

```bash
# Project Identity
ACTIVE_PROJECT=project1
PROJECT_DISPLAY_NAME=Project 1

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=playwright_db
DB_USER=postgres
DB_PASSWORD=your_password

# Server
PORT=3001
NODE_ENV=development
```

### Optional Variables

```bash
# External APIs
EXTERNAL_BOUNDARY_API_URL=http://api-server:3000/...
EXTERNAL_API_TOKEN=your_token

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Features
ENABLE_QUEUE=false
ENABLE_WORKER_POOL=false
WORKER_POOL_SIZE=3

# JWT
JWT_ACCESS_SECRET=your_secret
JWT_REFRESH_SECRET=your_secret

# CORS
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:5173

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_DIR=./uploads/project1
```

## Configuration Priority

The application loads environment variables in this order:

1. **ACTIVE_PROJECT environment variable** → Loads `.env.{projectName}`
2. **Command line argument** → `npm start project1` → Loads `.env.project1`
3. **Default .env file** → Falls back to `.env` if project file not found
4. **Hardcoded defaults** → Falls back to internal defaults

## Docker Compose Example

```yaml
version: '3.8'

services:
  app-project1:
    build: .
    ports:
      - "3001:3001"
    environment:
      - ACTIVE_PROJECT=project1
      - NODE_ENV=development
    depends_on:
      - postgres1
      - redis1

  app-project2:
    build: .
    ports:
      - "3002:3002"
    environment:
      - ACTIVE_PROJECT=project2
      - NODE_ENV=staging
    depends_on:
      - postgres2
      - redis2

  postgres1:
    image: postgres:15
    environment:
      POSTGRES_DB: playwright_project1
      POSTGRES_PASSWORD: postgres124112
    ports:
      - "5433:5432"

  postgres2:
    image: postgres:15
    environment:
      POSTGRES_DB: playwright_project2
      POSTGRES_PASSWORD: postgres124112
    ports:
      - "5434:5432"
```

Run with Docker:
```bash
docker-compose up app-project1 app-project2
```

## Best Practices

### 1. **Project Naming**
- Use descriptive project names: `project1`, `staging`, `production`, `client-a`
- Avoid special characters and spaces

### 2. **Database Configuration**
- Use different database names for each project
- Use different ports for local databases (5433, 5434, etc.)
- Keep credentials secure in production environments

### 3. **Port Management**
- Assign unique ports to each project (3001, 3002, 3003, etc.)
- Document port assignments in a README

### 4. **Secrets Management**
- Never commit sensitive values to `.env` files
- Add `.env.*` to `.gitignore` (except `.env.example`)
- Use `.env.example` as template documentation

### 5. **Version Control**
```bash
# .gitignore
.env
.env.local
.env.*.local
.env.*  # Ignore all project .env files
!.env.example
```

## Troubleshooting

### Project Configuration Not Loading

**Issue:** Error message `ACTIVE_PROJECT environment variable is not set`

**Solution:**
```bash
# Set the variable before starting
ACTIVE_PROJECT=project1 npm start

# Or update package.json scripts
"start:project1": "ACTIVE_PROJECT=project1 npm start"
```

### Database Connection Failed

**Issue:** `Error: connect ECONNREFUSED 127.0.0.1:5433`

**Solution:**
1. Verify database host/port in `.env.{projectName}`
2. Ensure PostgreSQL is running on specified port
3. Check database credentials

### Wrong Environment Loaded

**Issue:** Using project1 configuration but project2 variables are loaded

**Solution:**
1. Clear NODE_ENV and ACTIVE_PROJECT variables: `unset ACTIVE_PROJECT`
2. Verify correct `.env.{projectName}` file exists
3. Check process environment: `node -e "console.log(process.env.ACTIVE_PROJECT)"`

## Advanced Usage

### Load Multiple Projects in Tests

```typescript
// tests/setup.ts
import { loadProjectEnvironmentWithFallback } from '../src/utils/projectManager';

describe('Multi-project tests', () => {
  describe('Project 1', () => {
    before(() => {
      loadProjectEnvironmentWithFallback('project1');
    });
    // Tests...
  });

  describe('Project 2', () => {
    before(() => {
      loadProjectEnvironmentWithFallback('project2');
    });
    // Tests...
  });
});
```

### Programmatic Project Switching

```typescript
import { loadProjectConfig, getActiveProjectName } from './config/projects.config';

// Get current project
const projectName = getActiveProjectName();
console.log(`Running project: ${projectName}`);

// Load configuration
const config = loadProjectConfig();
console.log(`Database: ${config.database.name}`);
console.log(`Port: ${config.server.port}`);
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Test Multiple Projects

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        project: [project1, project2]
    steps:
      - uses: actions/checkout@v2
      - name: Run tests for ${{ matrix.project }}
        env:
          ACTIVE_PROJECT: ${{ matrix.project }}
        run: npm test
```

## Monitoring & Logging

The project configuration is logged on startup:

```bash
ACTIVE_PROJECT=project1 npm start

# Console output:
# ✓ Loaded environment configuration for project: project1
# Environment Configuration:
# {
#   projectName: 'project1',
#   environment: 'development',
#   port: '3001',
#   database: { host: 'localhost', port: '5433', name: 'playwright_project1' }
# }
```

## Summary

The dynamic project configuration system provides:
- **Flexibility**: Easily manage multiple projects with different configurations
- **Scalability**: Add new projects without code changes
- **Safety**: Separate configurations prevent cross-project contamination
- **Simplicity**: CLI tools for easy project management
- **Production Ready**: Supports Docker, CI/CD, and cloud deployments

For more information, see the utilities:
- [projects.config.ts](src/config/projects.config.ts) - Core configuration management
- [projectManager.ts](src/utils/projectManager.ts) - Project utilities and helpers
- [project-manager.js](scripts/project-manager.js) - CLI commands
