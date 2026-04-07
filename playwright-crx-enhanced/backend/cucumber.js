/**
 * Cucumber Configuration
 * Enables dynamic project loading for BDD tests
 */

const fs = require('fs');
const path = require('path');

// Load project environment before running tests
const projectName = process.env.ACTIVE_PROJECT || process.argv[process.argv.length - 1];

if (projectName && !projectName.includes('--')) {
  const envFile = path.join(__dirname, `.env.${projectName}`);
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
    console.log(`✓ Loaded Cucumber environment: ${projectName}`);
  }
}

module.exports = {
  default: {
    // Features directory
    paths: ['features/**/*.feature'],

    // Support files (hooks, step definitions, helpers)
    support: [
      'features/support/world.ts',
      'features/support/**/*.ts',
      'features/hooks/**/*.ts',
      'features/step-definitions/**/*.ts'
    ],

    // Format options
    format: [
      'progress-bar',
      'html:test-results/cucumber-report.html',
      'json:test-results/cucumber-report.json',
      'junit:test-results/cucumber-report.xml'
    ],

    // Parallel execution
    parallel: 2,

    // Require modules
    require: ['features/support/**/*.ts', 'features/step-definitions/**/*.ts'],

    // TypeScript support
    requireModule: ['ts-node/register'],

    // Formatting
    dryRun: false,
    failFast: false,
    strict: true,

    // Tags filter
    tags: process.env.CUCUMBER_TAGS || '',

    // Timeout
    timeout: 60000
  },

  // Project-specific profiles
  project1: {
    paths: ['features/**/*.feature'],
    support: [
      'features/support/world.ts',
      'features/support/**/*.ts',
      'features/hooks/**/*.ts',
      'features/step-definitions/**/*.ts'
    ],
    format: [
      'progress-bar',
      'html:test-results/project1-cucumber-report.html',
      'json:test-results/project1-cucumber-report.json'
    ],
    timeout: 60000
  },

  project2: {
    paths: ['features/**/*.feature'],
    support: [
      'features/support/world.ts',
      'features/support/**/*.ts',
      'features/hooks/**/*.ts',
      'features/step-definitions/**/*.ts'
    ],
    format: [
      'progress-bar',
      'html:test-results/project2-cucumber-report.html',
      'json:test-results/project2-cucumber-report.json'
    ],
    timeout: 60000
  }
};
