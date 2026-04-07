# Quick Start: Dynamic Projects

Get up and running with multiple projects in 5 minutes.

## 1️⃣ Create Your First Project

```bash
# List available projects
node scripts/project-manager.js list

# Create a new project
node scripts/project-manager.js create myproject

# Show project configuration
node scripts/project-manager.js show myproject
```

## 2️⃣ Configure Database

Edit `.env.myproject` and update database settings:

```bash
# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=playwright_myproject
DB_USER=postgres
DB_PASSWORD=your_password

# Or PostgreSQL remote
DB_HOST=db.example.com
DB_PORT=5432
DB_NAME=prod_database
DB_USER=app_user
DB_PASSWORD=secure_password
```

## 3️⃣ Run Your Project

### Option A: Environment Variable
```bash
ACTIVE_PROJECT=myproject npm start
```

### Option B: npm Script
Add to `package.json`:
```json
{
  "scripts": {
    "start:myproject": "ACTIVE_PROJECT=myproject npm start"
  }
}
```

Then run:
```bash
npm run start:myproject
```

### Option C: Manual .env
Copy configuration to `.env`:
```bash
cp .env.myproject .env
npm start
```

## 4️⃣ Verify It Works

```bash
curl http://localhost:3001/health

# Response:
# {
#   "status": "ok",
#   "timestamp": "2024-01-15T10:30:00.000Z",
#   "environment": "development"
# }
```

## 5️⃣ Common Commands

```bash
# List all projects
node scripts/project-manager.js list

# Show specific project
node scripts/project-manager.js show project1

# Create new project
node scripts/project-manager.js create myproject

# Delete project
node scripts/project-manager.js delete myproject

# Run with specific project
ACTIVE_PROJECT=project1 npm start

# Run with different port
ACTIVE_PROJECT=project2 PORT=3002 npm start
```

## Key Environment Variables

| Variable | Required | Example |
|----------|----------|---------|
| `ACTIVE_PROJECT` | ✓ | `project1` |
| `DB_HOST` | ✓ | `localhost` |
| `DB_PORT` | ✓ | `5432` |
| `DB_NAME` | ✓ | `playwright_db` |
| `DB_USER` | ✓ | `postgres` |
| `DB_PASSWORD` | ✓ | `secret123` |
| `PORT` | ✗ | `3001` |
| `NODE_ENV` | ✗ | `development` |

## Pre-configured Projects

Already set up and ready to use:

### Project 1 (Development)
```bash
ACTIVE_PROJECT=project1 npm start
# Port: 3001
# Database: localhost:5433/playwright_project1
```

### Project 2 (Staging)
```bash
ACTIVE_PROJECT=project2 npm start
# Port: 3002
# Database: localhost:5434/playwright_project2
```

## Troubleshooting

### Issue: Database connection failed
```
Error: connect ECONNREFUSED
```
- Check `DB_HOST` and `DB_PORT` are correct
- Verify database is running
- Check credentials in `.env.{projectName}`

### Issue: Project not found
```
Error: Environment file not found
```
- Run `node scripts/project-manager.js list` to see available projects
- Create project: `node scripts/project-manager.js create myproject`

### Issue: Different environment than expected
```
curl http://localhost:3001/health
# Returns wrong project
```
- Check ACTIVE_PROJECT: `echo $ACTIVE_PROJECT`
- Verify .env file: `cat .env.myproject`
- Try: `unset ACTIVE_PROJECT && ACTIVE_PROJECT=myproject npm start`

## Next Steps

- Read [PROJECT_CONFIGURATION.md](PROJECT_CONFIGURATION.md) for advanced usage
- Check `.env.project1` and `.env.project2` for example configurations
- Review [src/utils/projectManager.ts](src/utils/projectManager.ts) for API usage

## File Locations

```
playwright-crx-enhanced/backend/
├── .env.project1           ← Project 1 config
├── .env.project2           ← Project 2 config
├── .env.myproject          ← Your new project
├── scripts/
│   └── project-manager.js  ← CLI tool
└── src/
    ├── config/
    │   └── projects.config.ts
    └── utils/
        └── projectManager.ts
```

## Examples

### Run multiple projects locally

**Terminal 1:**
```bash
ACTIVE_PROJECT=project1 npm start
# App running on :3001
```

**Terminal 2:**
```bash
ACTIVE_PROJECT=project2 npm start
# App running on :3002
```

### Run with Docker

```yaml
# docker-compose.yml
services:
  app1:
    build: .
    environment:
      ACTIVE_PROJECT: project1
    ports:
      - "3001:3001"
  app2:
    build: .
    environment:
      ACTIVE_PROJECT: project2
    ports:
      - "3002:3002"
```

### Run tests for all projects

```bash
for project in project1 project2; do
  echo "Testing $project..."
  ACTIVE_PROJECT=$project npm test
done
```

## Support

- Check logs: `npm start` shows which project is loaded
- Verify config: `node scripts/project-manager.js show {projectName}`
- Review: [PROJECT_CONFIGURATION.md](PROJECT_CONFIGURATION.md)
