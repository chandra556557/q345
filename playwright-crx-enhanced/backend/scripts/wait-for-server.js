#!/usr/bin/env node

/**
 * Wait for server to be ready before running tests
 * Checks health endpoint with configurable retries and timeout
 */

const http = require('http');

const PORT = process.env.PORT || 3001;
const MAX_RETRIES = 30;
const RETRY_DELAY = 1000; // 1 second
const HEALTH_PATH = '/health';

let retries = 0;

function checkHealth() {
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: HEALTH_PATH,
    method: 'GET',
    timeout: 5000
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        console.log(`✅ Server is ready on port ${PORT}`);
        resolve(true);
      } else {
        resolve(false);
      }
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function waitForServer() {
  console.log(`⏳ Waiting for server on http://localhost:${PORT}${HEALTH_PATH}...`);

  while (retries < MAX_RETRIES) {
    const isReady = await checkHealth();
    if (isReady) {
      console.log('🚀 Server is ready! Starting tests...\n');
      process.exit(0);
    }

    retries++;
    if (retries < MAX_RETRIES) {
      console.log(`⏳ Retry ${retries}/${MAX_RETRIES}...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }

  console.error(
    `❌ Server did not start within ${MAX_RETRIES * RETRY_DELAY / 1000} seconds`
  );
  process.exit(1);
}

waitForServer();
