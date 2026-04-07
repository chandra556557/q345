/**
 * Custom Cucumber World Type
 * Provides strong typing for step definitions with IDE autocomplete
 */

import { World, IWorldOptions } from '@cucumber/cucumber';
import { AxiosResponse } from 'axios';
import { ProjectConfig } from '../../src/config/projects.config';

/**
 * Custom World interface with all test context properties
 */
export interface CucumberWorld extends World {
  // Project Configuration
  projectName: string;
  projectConfig: ProjectConfig;
  apiBaseUrl: string;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    schema: string;
    url: string;
  };

  // HTTP Responses
  lastResponse?: AxiosResponse;
  lastError?: any;
  responseBody?: any;
  responseStatus?: number;
  healthResponse?: {
    status: string;
    timestamp: string;
    environment?: string;
  };
  dbHealthResponse?: {
    status: string;
    result?: any;
  };

  // Test Data
  testFixture?: any;
  testFixtures?: Map<string, any>;
  modifiedFixture?: any;
  seedData?: any[];
  seedDataMap?: Map<string, any[]>;
  activeSeedData?: any[];
  activeFixture?: any;
  testUser?: any;
  availableProjects?: string[];
  currentSeedName?: string;

  // Utility properties
  [key: string]: any;
}

/**
 * Custom World class extending Cucumber's World
 */
export default class CustomWorld extends World implements CucumberWorld {
  projectName: string = 'default';
  projectConfig: any;
  apiBaseUrl: string = 'http://localhost:3001';
  database: any;
  lastResponse?: AxiosResponse;
  lastError?: any;
  responseBody?: any;
  responseStatus?: number;
  healthResponse?: any;
  dbHealthResponse?: any;
  testFixture?: any;
  testFixtures: Map<string, any> = new Map();
  modifiedFixture?: any;
  seedData?: any[];
  seedDataMap: Map<string, any[]> = new Map();
  activeSeedData?: any[];
  activeFixture?: any;
  testUser?: any;
  availableProjects?: string[];
  currentSeedName?: string;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

/**
 * Type guard to check if world is CucumberWorld
 */
export function isCucumberWorld(world: any): world is CucumberWorld {
  return world && typeof world === 'object' && 'projectName' in world;
}

/**
 * Helper to get typed world
 */
export function getTypedWorld(world: World): CucumberWorld {
  return world as any as CucumberWorld;
}
