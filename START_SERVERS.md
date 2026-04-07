# Starting Frontend & Backend Servers

Complete guide to run your application locally

---

## 📋 Prerequisites

```bash
# Install dependencies (if not already done)
cd playwright-crx-enhanced/backend && npm install
cd ../frontend && npm install
```

---

## 🚀 Quick Start (All in One)

### Option 1: Start in Separate Terminals (Recommended)

**Terminal 1: Backend (Port 3001)**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend

# Start with project1 config (dev)
npm run dev:project1

# Or: npm run start:project1 (compiled version)
# Or: npm run dev (default project)
```

**Terminal 2: Frontend (Port 5173)**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/frontend

# Start dev server
npm run dev
```

**Expected Output:**

Terminal 1 (Backend):
```
✓ Loaded environment configuration for project: project1
✓ Project config loaded
✓ API Base URL: http://localhost:3001
✓ Database: localhost:5433/playwright_project1

Server running on http://localhost:3001
```

Terminal 2 (Frontend):
```
  VITE v4.x.x ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

---

## 🎯 Start Backend Only

### Development Mode (With Hot Reload)
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend

# Project 1 (Development)
npm run dev:project1
# Runs on: http://localhost:3001

# Project 2 (Staging)
npm run dev:project2
# Runs on: http://localhost:3002

# Default
npm run dev
# Runs on: http://localhost:3001
```

### Production Mode (Compiled)
```bash
# Build first
npm run build

# Then start
npm run start:project1
# Runs on: http://localhost:3001

npm run start:project2
# Runs on: http://localhost:3002
```

---

## 🎨 Start Frontend Only

### Development Mode (With Hot Reload)
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/frontend

npm run dev

# Output:
#   ➜  Local:   http://localhost:5173/
#   ➜  press h + enter to show help
```

### Preview Build
```bash
npm run build
npm run preview

# Preview the production build locally
# Runs on: http://localhost:4173/
```

---

## 🔗 Full Stack Setup (Both Servers)

### Step-by-Step Guide

**Step 1: Build Backend**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npm run build

# Output: TypeScript compiled to dist/
```

**Step 2: Start Backend (Terminal 1)**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend

# Development mode with hot reload
npm run dev:project1

# OR production mode
npm start
```

**Step 3: Start Frontend (Terminal 2)**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/frontend
npm run dev
```

**Step 4: Access Application**
```
Frontend: http://localhost:5173
Backend API: http://localhost:3001
```

---

## 📊 Server Ports Reference

| Service | Port | URL | Command |
|---------|------|-----|---------|
| Frontend Dev | 5173 | http://localhost:5173 | `npm run dev` |
| Frontend Build | 4173 | http://localhost:4173 | `npm run preview` |
| Backend (Project1) | 3001 | http://localhost:3001 | `npm run dev:project1` |
| Backend (Project2) | 3002 | http://localhost:3002 | `npm run dev:project2` |
| API Docs | 3001 | http://localhost:3001/api-docs | `npm run dev:project1` |

---

## ✅ Verify Servers Are Running

### Check Backend
```bash
# Test health endpoint
curl http://localhost:3001/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2026-04-07T12:30:00.000Z",
#   "environment": "development"
# }
```

### Check Frontend
```bash
# Open in browser
open http://localhost:5173

# Or test with curl
curl -I http://localhost:5173
```

### Check Database Connection
```bash
# Test database health endpoint
curl http://localhost:3001/db/health

# Expected response:
# {
#   "status": "ok",
#   "result": { "ok": 1 }
# }
```

---

## 🎬 Script Examples

### Example 1: Start Both Servers (Bash Script)
```bash
#!/bin/bash

echo "🚀 Starting Full Stack Application"
echo "===================================="

# Create background processes
(
  cd /c/chandra-1212-main/playwright-crx-enhanced/backend
  npm run dev:project1
) &

BACKEND_PID=$!
echo "✓ Backend started (PID: $BACKEND_PID)"

sleep 3

(
  cd /c/chandra-1212-main/playwright-crx-enhanced/frontend
  npm run dev
) &

FRONTEND_PID=$!
echo "✓ Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "📱 Frontend: http://localhost:5173"
echo "🔧 Backend: http://localhost:3001"
echo "📚 API Docs: http://localhost:3001/api-docs"
echo ""
echo "Press Ctrl+C to stop both servers"

wait
```

### Example 2: Run Servers & Tests
```bash
#!/bin/bash

# Start backend in background
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npm run build
npm run dev:project1 &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 3

# Run Cucumber tests
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npx cucumber-js features/project-management.feature --tags "@smoke"

# Kill background process
kill $BACKEND_PID
```

---

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check if port 3001 is already in use
lsof -i :3001

# Kill process on port
kill -9 <PID>

# Or use different port
PORT=3005 npm run dev:project1
```

### Frontend won't connect to backend
```bash
# Check CORS settings in backend
# Check that both servers are running
curl http://localhost:3001/health
curl http://localhost:5173

# Check backend URL in frontend config
cat /c/chandra-1212-main/playwright-crx-enhanced/frontend/vite.config.ts
```

### Dependencies not installed
```bash
# Reinstall all dependencies
cd backend && rm -rf node_modules && npm install
cd ../frontend && rm -rf node_modules && npm install
```

---

## 🧪 Testing with Running Servers

### Run Cucumber Tests Against Running Backend
```bash
# Terminal 1: Start Backend
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npm run dev:project1

# Terminal 2: Run Tests
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npx cucumber-js features/project-management.feature --tags "@smoke"

# Tests will now pass because backend is running!
```

### Run SauceDemo Tests
```bash
# Terminal 1: Start Backend (needed for some tests)
npm run dev:project1

# Terminal 2: Run SauceDemo tests
npx cucumber-js features/saucedemo.feature --tags "@login"
```

---

## 📈 Performance Tips

### Speed Up Backend Startup
```bash
# Use compiled version instead of tsx watch
npm run build
npm start:project1

# Instead of:
# npm run dev:project1
```

### Disable TypeScript Checking During Dev
```bash
# In frontend vite.config.ts, disable vue type checking if slow
# Speeds up HMR (Hot Module Reload)
```

### Clear Node Modules Cache
```bash
# If experiencing issues
cd backend && npm cache clean --force
cd ../frontend && npm cache clean --force
```

---

## 🔄 Multi-Project Setup

### Run Project1 and Project2 Simultaneously

**Terminal 1: Backend Project1**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npm run dev:project1
# Port: 3001
# Database: playwright_project1
```

**Terminal 2: Backend Project2**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
npm run dev:project2
# Port: 3002
# Database: playwright_project2
```

**Terminal 3: Frontend**
```bash
cd /c/chandra-1212-main/playwright-crx-enhanced/frontend
npm run dev
# Port: 5173
# Can switch between APIs via config
```

---

## ✨ Quick Reference

```bash
# Build
npm run build

# Development (with hot reload)
npm run dev:project1          # Backend Project1
npm run dev:project2          # Backend Project2
npm run dev                   # Backend Default
npm run dev                   # Frontend (separate terminal)

# Production
npm run start:project1        # Backend Project1
npm run start:project2        # Backend Project2
npm run preview              # Frontend Preview

# Testing
npm run cucumber:project1     # Test Project1
npm run cucumber:project2     # Test Project2
npm run cucumber:all         # Test Both

# Verification
curl http://localhost:3001/health
curl http://localhost:5173
curl http://localhost:3001/api-docs
```

---

## 🎯 Next Steps

1. **Start Backend**: `npm run dev:project1`
2. **Start Frontend**: `npm run dev`
3. **Open Browser**: `http://localhost:5173`
4. **Run Tests**: `npx cucumber-js features/saucedemo.feature --tags "@smoke"`

---

**Ready to run! 🚀**
