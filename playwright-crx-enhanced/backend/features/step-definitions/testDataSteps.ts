/**
 * Step Definitions for Test Data Management
 * Manages fixtures and seed data for project-specific tests
 */

import { Given, When, Then, World } from '@cucumber/cucumber';
import { getTestDataManager } from '../support/testDataManager';

/**
 * Given I load the test fixture "{fixtureName}"
 * Loads a fixture from test data
 */
Given('I load the test fixture {string}', async function(this: World & any, fixtureName: string) {
  const dataManager = getTestDataManager(this.projectName);

  try {
    const fixture = dataManager.loadFixture(fixtureName);
    this.testFixture = fixture;
    this.testFixtures = this.testFixtures || {};
    this.testFixtures[fixtureName] = fixture;

    console.log(`✓ Loaded fixture: ${fixtureName}`);
    console.log(`  Keys: ${Object.keys(fixture).join(', ')}`);
  } catch (error: any) {
    throw new Error(`Failed to load fixture "${fixtureName}": ${error.message}`);
  }
});

/**
 * Given I load seed data "{seedName}"
 * Loads seed data from the project's test data
 */
Given('I load seed data {string}', async function(this: World & any, seedName: string) {
  const dataManager = getTestDataManager(this.projectName);

  try {
    const seedData = dataManager.loadSeedData(seedName);
    this.seedData = seedData;
    this.seedDataMap = this.seedDataMap || {};
    this.seedDataMap[seedName] = seedData;

    console.log(`✓ Loaded seed data: ${seedName}`);
    console.log(`  Records: ${seedData.length}`);
  } catch (error: any) {
    throw new Error(`Failed to load seed data "${seedName}": ${error.message}`);
  }
});

/**
 * Given I have a test user with the following data
 * Creates a test user fixture from inline data
 */
Given('I have a test user with the following data:', async function(
  this: World & any,
  dataTable: any
) {
  const data = dataTable.rowsHash();
  this.testUser = data;
  this.testFixture = data;

  console.log(`✓ Created test user fixture`);
  console.log(`  Email: ${data.email}`);
});

/**
 * Given the fixture "{fixtureName}" is modified with
 * Creates a modified copy of a fixture
 */
Given('the fixture {string} is modified with:', async function(
  this: World & any,
  fixtureName: string,
  dataTable: any
) {
  const dataManager = getTestDataManager(this.projectName);
  const modifications = dataTable.rowsHash();

  try {
    const modified = dataManager.cloneAndModify(fixtureName, modifications);
    this.testFixture = modified;
    this.modifiedFixture = modified;

    console.log(`✓ Modified fixture: ${fixtureName}`);
    console.log(`  Applied ${Object.keys(modifications).length} modifications`);
  } catch (error: any) {
    throw new Error(`Failed to modify fixture: ${error.message}`);
  }
});

/**
 * When I use the test fixture
 * Prepares the loaded fixture for use
 */
When('I use the test fixture', async function(this: World & any) {
  if (!this.testFixture) {
    throw new Error('No fixture loaded. Use "Given I load the test fixture" first');
  }

  this.activeFixture = { ...this.testFixture };
  console.log(`✓ Test fixture is ready`);
});

/**
 * When I use seed data "{seedName}"
 * Prepares seed data for use in tests
 */
When('I use seed data {string}', async function(this: World & any, seedName: string) {
  const dataManager = getTestDataManager(this.projectName);

  try {
    const seedData = dataManager.loadSeedData(seedName);
    this.activeSeedData = seedData;
    this.currentSeedName = seedName;

    console.log(`✓ Seed data ready: ${seedName}`);
    console.log(`  Available records: ${seedData.length}`);
  } catch (error: any) {
    throw new Error(`Failed to prepare seed data: ${error.message}`);
  }
});

/**
 * Then the fixture should have {string} property
 * Verifies the fixture contains expected properties
 */
Then('the fixture should have {string} property', function(
  this: World & any,
  propertyName: string
) {
  const fixture = this.testFixture || this.activeFixture;

  if (!fixture) {
    throw new Error('No fixture loaded');
  }

  if (!(propertyName in fixture)) {
    throw new Error(
      `Fixture does not have property "${propertyName}". ` +
      `Available: ${Object.keys(fixture).join(', ')}`
    );
  }

  console.log(`✓ Fixture has property: ${propertyName}`);
});

/**
 * Then the fixture property "{propertyName}" should be {string}
 * Verifies fixture property values
 */
Then('the fixture property {string} should be {string}', function(
  this: World & any,
  propertyName: string,
  expectedValue: string
) {
  const fixture = this.testFixture || this.activeFixture;

  if (!fixture) {
    throw new Error('No fixture loaded');
  }

  const actualValue = String(fixture[propertyName]);

  if (actualValue !== expectedValue) {
    throw new Error(
      `Expected property "${propertyName}" to be "${expectedValue}" ` +
      `but got "${actualValue}"`
    );
  }

  console.log(`✓ Property "${propertyName}" = "${expectedValue}"`);
});

/**
 * Then seed data should have {int} records
 * Verifies seed data count
 */
Then('seed data should have {int} records', function(
  this: World & any,
  expectedCount: number
) {
  const seedData = this.seedData || this.activeSeedData;

  if (!seedData) {
    throw new Error('No seed data loaded');
  }

  if (seedData.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} seed records but got ${seedData.length}`
    );
  }

  console.log(`✓ Seed data has ${expectedCount} records`);
});

/**
 * Then I should have test data for "{projectName}"
 * Verifies test data exists for a project
 */
Then('I should have test data for {string}', function(this: World & any, projectName: string) {
  const dataManager = getTestDataManager(projectName);
  const summary = dataManager.getSummary();

  if (summary.fixtures.length === 0 && summary.seeds.length === 0) {
    throw new Error(`No test data found for project "${projectName}"`);
  }

  console.log(`✓ Test data exists for "${projectName}"`);
  console.log(`  Fixtures: ${summary.fixtures.length}`);
  console.log(`  Seeds: ${summary.seeds.length}`);
});

/**
 * Then the available fixtures should include {string}
 * Verifies specific fixtures exist
 */
Then('the available fixtures should include {string}', function(
  this: World & any,
  fixtureName: string
) {
  const dataManager = getTestDataManager(this.projectName);
  const fixtures = dataManager.getAvailableFixtures();

  if (!fixtures.includes(fixtureName)) {
    throw new Error(
      `Fixture "${fixtureName}" not found. Available: ${fixtures.join(', ')}`
    );
  }

  console.log(`✓ Fixture available: ${fixtureName}`);
});

/**
 * Then the available seed data should include {string}
 * Verifies specific seed data exists
 */
Then('the available seed data should include {string}', function(
  this: World & any,
  seedName: string
) {
  const dataManager = getTestDataManager(this.projectName);
  const seeds = dataManager.getAvailableSeedData();

  if (!seeds.includes(seedName)) {
    throw new Error(
      `Seed data "${seedName}" not found. Available: ${seeds.join(', ')}`
    );
  }

  console.log(`✓ Seed data available: ${seedName}`);
});

/**
 * Then I can view the test data summary
 * Displays test data summary for current project
 */
Then('I can view the test data summary', function(this: World & any) {
  const dataManager = getTestDataManager(this.projectName);
  const summary = dataManager.getSummary();

  console.log(`\n📊 Test Data Summary for "${summary.projectName}":`);
  console.log(`  Directory: ${summary.dataDir}`);
  console.log(`  Fixtures (${summary.fixtures.length}): ${summary.fixtures.join(', ') || 'none'}`);
  console.log(`  Seeds (${summary.seeds.length}): ${summary.seeds.join(', ') || 'none'}`);
});
