/**
 * Test Data Manager
 * Manages project-specific test data, fixtures, and seeding
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TestDataConfig {
  projectName: string;
  dataDir: string;
  fixtures: Map<string, any>;
  seedData: Map<string, any[]>;
}

class TestDataManager {
  private config: TestDataConfig;
  private projectName: string;

  constructor(projectName: string = 'default') {
    this.projectName = projectName;
    this.config = {
      projectName,
      dataDir: path.resolve(__dirname, `../test-data/${projectName}`),
      fixtures: new Map(),
      seedData: new Map(),
    };

    this.initializeDataDirectory();
  }

  /**
   * Initialize test data directory structure
   */
  private initializeDataDirectory(): void {
    const dirs = [
      this.config.dataDir,
      path.join(this.config.dataDir, 'fixtures'),
      path.join(this.config.dataDir, 'seeds'),
      path.join(this.config.dataDir, 'expected-results'),
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    console.log(`✓ Test data directory initialized: ${this.config.dataDir}`);
  }

  /**
   * Load a fixture file
   */
  loadFixture<T = any>(fixtureName: string): T {
    // Check cache first
    if (this.config.fixtures.has(fixtureName)) {
      return this.config.fixtures.get(fixtureName) as T;
    }

    const fixturePath = path.join(this.config.dataDir, 'fixtures', `${fixtureName}.json`);

    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Fixture not found: ${fixtureName} at ${fixturePath}`);
    }

    const content = fs.readFileSync(fixturePath, 'utf-8');
    const data = JSON.parse(content) as T;

    // Cache the fixture
    this.config.fixtures.set(fixtureName, data);

    return data;
  }

  /**
   * Load seed data
   */
  loadSeedData<T = any>(seedName: string): T[] {
    if (this.config.seedData.has(seedName)) {
      return this.config.seedData.get(seedName) as T[];
    }

    const seedPath = path.join(this.config.dataDir, 'seeds', `${seedName}.json`);

    if (!fs.existsSync(seedPath)) {
      throw new Error(`Seed data not found: ${seedName} at ${seedPath}`);
    }

    const content = fs.readFileSync(seedPath, 'utf-8');
    const data = JSON.parse(content) as T[];

    this.config.seedData.set(seedName, data);

    return data;
  }

  /**
   * Create a fixture
   */
  createFixture(fixtureName: string, data: any): void {
    const fixturePath = path.join(this.config.dataDir, 'fixtures', `${fixtureName}.json`);
    fs.writeFileSync(fixturePath, JSON.stringify(data, null, 2), 'utf-8');
    this.config.fixtures.set(fixtureName, data);
    console.log(`✓ Created fixture: ${fixtureName}`);
  }

  /**
   * Create seed data
   */
  createSeedData(seedName: string, data: any[]): void {
    const seedPath = path.join(this.config.dataDir, 'seeds', `${seedName}.json`);
    fs.writeFileSync(seedPath, JSON.stringify(data, null, 2), 'utf-8');
    this.config.seedData.set(seedName, data);
    console.log(`✓ Created seed data: ${seedName}`);
  }

  /**
   * Get all available fixtures
   */
  getAvailableFixtures(): string[] {
    const fixturesDir = path.join(this.config.dataDir, 'fixtures');
    if (!fs.existsSync(fixturesDir)) return [];

    return fs.readdirSync(fixturesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Get all available seed data
   */
  getAvailableSeedData(): string[] {
    const seedsDir = path.join(this.config.dataDir, 'seeds');
    if (!fs.existsSync(seedsDir)) return [];

    return fs.readdirSync(seedsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Get test data summary
   */
  getSummary(): {
    projectName: string;
    fixtures: string[];
    seeds: string[];
    dataDir: string;
  } {
    return {
      projectName: this.projectName,
      fixtures: this.getAvailableFixtures(),
      seeds: this.getAvailableSeedData(),
      dataDir: this.config.dataDir,
    };
  }

  /**
   * Clone fixture with modifications
   */
  cloneAndModify<T = any>(fixtureName: string, modifications: Partial<T>): T {
    const original = this.loadFixture<T>(fixtureName);
    return { ...original, ...modifications };
  }

  /**
   * Generate test data from template
   */
  generateFromTemplate(templateName: string, count: number, generator: (index: number) => any): any[] {
    const template = this.loadFixture(templateName);
    const generated: any[] = [];

    for (let i = 0; i < count; i++) {
      const variations = generator(i);
      generated.push({ ...template, ...variations });
    }

    return generated;
  }

  /**
   * Clear all cached data (for test cleanup)
   */
  clearCache(): void {
    this.config.fixtures.clear();
    this.config.seedData.clear();
    console.log(`✓ Test data cache cleared`);
  }
}

/**
 * Global test data managers per project
 */
const managers = new Map<string, TestDataManager>();

/**
 * Get or create test data manager for a project
 */
export function getTestDataManager(projectName?: string): TestDataManager {
  const project = projectName || process.env.ACTIVE_PROJECT || 'default';

  if (!managers.has(project)) {
    managers.set(project, new TestDataManager(project));
  }

  return managers.get(project)!;
}

/**
 * Create test data manager for specific project
 */
export function createTestDataManager(projectName: string): TestDataManager {
  return new TestDataManager(projectName);
}

/**
 * Clear all managers cache
 */
export function clearAllCaches(): void {
  managers.forEach(manager => manager.clearCache());
}

export default TestDataManager;
