# Quick Test - Run Everything in One Command ⚡

## The Simplest Way

```bash
cd playwright-crx-enhanced/backend
npm run test:full-stack:project1
```

**That's it!** Everything starts automatically:
- ✅ Backend (port 3001)
- ✅ Frontend (port 3000)
- ✅ All 136 Cucumber tests run

---

## What Happens Step-by-Step

1. **Backend starts** - Loads Project 1 config from `.env.project1`
2. **Frontend starts** - React development server
3. **Wait script runs** - Checks if backend is ready
4. **Tests execute** - All 136 BDD scenarios run automatically
5. **Reports generated** - Shows pass/fail results

---

## For Project 2

```bash
npm run test:full-stack:project2
```

Uses `.env.project2` configuration (port 3002)

---

## Just Specific Tests

### SauceDemo (Real Browser)
```bash
npm run test:saucedemo
```
Opens real Chrome browser, tests e-commerce flow

### Smoke Tests (30 seconds)
```bash
npm run cucumber:smoke
```

### API Tests
```bash
npm run test:api
```

### Form Tests
```bash
npm run test:frontend
```

### Database Tests
```bash
npm run cucumber:database
```

---

## Stop Tests

Press `Ctrl+C` to stop all processes (backend, frontend, tests)

---

## View Results

Look at terminal output:
```
✅ 120 scenarios passed
❌ 5 scenarios failed
⏭️ 11 scenarios pending
Duration: 2m 34s
```

Or generate HTML report:
```bash
npm run cucumber:report
```

---

## Troubleshooting

**"Port already in use"**
```bash
# Kill existing process on port 3001
lsof -ti:3001 | xargs kill -9  # Mac/Linux
```

**"Server did not start"**
```bash
# Install dependencies
npm install
```

**"Tests won't run"**
- Check backend is running on correct port
- Check `.env.project1` exists
- Check database is accessible

---

**Ready to test? Run this now:**
```bash
cd playwright-crx-enhanced/backend && npm run test:full-stack:project1
```

🚀 All tests will start automatically!
