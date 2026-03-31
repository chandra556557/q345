/**
 * Workflow Orchestrator Service
 *
 * End-to-end pipeline: Jira Epic → Test Cases → Gherkin → Playwright
 *
 * Steps:
 *  1. PICK   — Fetch epic/stories from Jira
 *  2. ANALYZE — Extract acceptance criteria and context
 *  3. GENERATE — Generate test cases (positive, negative, edge, boundary, security)
 *  4. CONVERT — Convert test cases to Gherkin feature files
 *  5. EXECUTE — Generate Playwright code and optionally run tests
 */

import { logger } from '../../utils/logger';
import pool from '../../db';
import { jiraService, JiraConfig, JiraEpic, JiraStory } from './jira.service';
import {
  testCaseGenerator,
  GenerationOptions,
  TestCaseGenerationResult,
  TestCaseCategory,
  GeneratedTestCase,
} from './testCaseGenerator.service';
import { testCaseConverter } from './testCaseConverter.service';
import { bddService } from './bdd.service';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | 'pending'
  | 'fetching_jira'
  | 'analyzing'
  | 'generating_testcases'
  | 'converting_gherkin'
  | 'generating_playwright'
  | 'executing'
  | 'completed'
  | 'failed';

export interface WorkflowConfig {
  jiraConfig: JiraConfig;
  epicKey?: string;                      // Fetch by epic key
  storyKeys?: string[];                  // Or specific stories
  jql?: string;                          // Or custom JQL
  sprintId?: number;                     // Or sprint-based
  projectKey?: string;                   // Jira project key
  generation: GenerationOptions;         // Test case generation options
  autoCreateFeatures?: boolean;          // Auto-save Gherkin as BDD features (default true)
  autoExecute?: boolean;                 // Auto-run generated tests (default false)
  executionBrowser?: string;             // chromium, firefox, webkit
  executionMode?: string;                // headless, headed
}

export interface WorkflowRun {
  id: string;
  userId: string;
  organizationId: string | null;
  status: WorkflowStatus;
  config: WorkflowConfig;
  // Results at each stage
  jiraData?: {
    epic?: JiraEpic;
    stories: JiraStory[];
    fetchedAt: string;
  };
  testCaseResults?: TestCaseGenerationResult[];
  gherkinFeatures?: Array<{
    storyKey: string;
    featureContent: string;
    featureId?: string;    // ID in BDDFeature table if auto-saved
  }>;
  playwrightCode?: Array<{
    storyKey: string;
    code: string;
  }>;
  executionResults?: Array<{
    storyKey: string;
    runId: string;
    status: string;
  }>;
  // Metrics
  totalStories: number;
  totalTestCases: number;
  categoryCounts: Record<TestCaseCategory, number>;
  // Timing
  startedAt?: string;
  completedAt?: string;
  error?: string;
  // Progress tracking (0-100)
  progress: number;
  currentStep: string;
}

// SSE event emitter for live progress
export const workflowEventEmitter = new EventEmitter();
workflowEventEmitter.setMaxListeners(50);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WorkflowOrchestratorService {

  /**
   * Execute the full workflow pipeline
   */
  async executeWorkflow(
    userId: string,
    organizationId: string | null,
    config: WorkflowConfig
  ): Promise<WorkflowRun> {
    // Create workflow run record
    const run = await this.createWorkflowRun(userId, organizationId, config);

    // Execute asynchronously
    this.runPipeline(run).catch(err => {
      logger.error(`Workflow ${run.id} failed: ${err.message}`);
    });

    return run;
  }

  /**
   * Run the full pipeline
   */
  private async runPipeline(run: WorkflowRun): Promise<void> {
    try {
      run.startedAt = new Date().toISOString();

      // Step 1: Fetch from Jira
      await this.stepFetchJira(run);

      // Step 2: Analyze stories
      await this.stepAnalyze(run);

      // Step 3: Generate test cases
      await this.stepGenerateTestCases(run);

      // Step 4: Convert to Gherkin
      await this.stepConvertToGherkin(run);

      // Step 5: Generate Playwright code
      await this.stepGeneratePlaywright(run);

      // Step 6 (optional): Execute tests
      if (run.config.autoExecute) {
        await this.stepExecuteTests(run);
      }

      // Complete
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      run.progress = 100;
      run.currentStep = 'Workflow completed successfully';
      await this.updateWorkflowRun(run);
      this.emitProgress(run);

      logger.info(`Workflow ${run.id} completed: ${run.totalTestCases} test cases for ${run.totalStories} stories`);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      run.status = 'failed';
      run.error = message;
      run.completedAt = new Date().toISOString();
      await this.updateWorkflowRun(run);
      this.emitProgress(run);
      logger.error(`Workflow ${run.id} failed: ${message}`);
    }
  }

  // =========================================================================
  // Pipeline Steps
  // =========================================================================

  /**
   * Step 1: Fetch epic/stories from Jira
   */
  private async stepFetchJira(run: WorkflowRun): Promise<void> {
    run.status = 'fetching_jira';
    run.progress = 5;
    run.currentStep = 'Fetching data from Jira...';
    await this.updateWorkflowRun(run);
    this.emitProgress(run);

    const config = run.config.jiraConfig;
    let stories: JiraStory[] = [];
    let epic: JiraEpic | undefined;

    if (run.config.epicKey) {
      // Fetch epic with all stories
      epic = await jiraService.getEpicWithStories(config, run.config.epicKey);
      stories = epic.stories;
    } else if (run.config.storyKeys && run.config.storyKeys.length > 0) {
      // Fetch specific stories
      const jql = `key in (${run.config.storyKeys.map(k => `"${k}"`).join(',')})`;
      stories = await jiraService.getStoriesByJQL(config, jql);
    } else if (run.config.sprintId && run.config.projectKey) {
      // Fetch by sprint
      stories = await jiraService.getStoriesBySprint(config, run.config.projectKey, run.config.sprintId);
    } else if (run.config.jql) {
      // Fetch by custom JQL
      stories = await jiraService.getStoriesByJQL(config, run.config.jql);
    } else {
      throw new Error('Must provide epicKey, storyKeys, sprintId+projectKey, or jql');
    }

    if (stories.length === 0) {
      throw new Error('No stories found matching the criteria');
    }

    run.jiraData = {
      epic,
      stories,
      fetchedAt: new Date().toISOString(),
    };
    run.totalStories = stories.length;
    run.progress = 15;
    run.currentStep = `Fetched ${stories.length} stories from Jira`;
    await this.updateWorkflowRun(run);
    this.emitProgress(run);
  }

  /**
   * Step 2: Analyze stories (extract context, enrich AC)
   */
  private async stepAnalyze(run: WorkflowRun): Promise<void> {
    run.status = 'analyzing';
    run.progress = 20;
    run.currentStep = 'Analyzing stories and acceptance criteria...';
    await this.updateWorkflowRun(run);
    this.emitProgress(run);

    // Enrich stories: ensure each has meaningful acceptance criteria
    for (const story of run.jiraData!.stories) {
      if (story.acceptanceCriteria.length === 0) {
        // Derive AC from description if none found
        if (story.description) {
          const sentences = story.description
            .split(/[.\n]/)
            .map(s => s.trim())
            .filter(s => s.length > 10);
          story.acceptanceCriteria = sentences.slice(0, 5);
        }
        // Derive from subtasks if still empty
        if (story.acceptanceCriteria.length === 0 && story.subtasks.length > 0) {
          story.acceptanceCriteria = story.subtasks.map(st => st.summary);
        }
        // Last resort: use summary
        if (story.acceptanceCriteria.length === 0) {
          story.acceptanceCriteria = [story.summary];
        }
      }
    }

    run.progress = 25;
    run.currentStep = `Analyzed ${run.totalStories} stories`;
    await this.updateWorkflowRun(run);
    this.emitProgress(run);
  }

  /**
   * Step 3: Generate test cases for all stories
   */
  private async stepGenerateTestCases(run: WorkflowRun): Promise<void> {
    run.status = 'generating_testcases';
    run.progress = 30;
    run.currentStep = 'Generating test cases...';
    await this.updateWorkflowRun(run);
    this.emitProgress(run);

    const results: TestCaseGenerationResult[] = [];
    const stories = run.jiraData!.stories;
    const progressPerStory = 30 / stories.length;

    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      run.currentStep = `Generating test cases for ${story.key} (${i + 1}/${stories.length})...`;
      this.emitProgress(run);

      const result = await testCaseGenerator.generateFromStory(story, run.config.generation);
      results.push(result);

      run.progress = 30 + Math.round(progressPerStory * (i + 1));
      await this.updateWorkflowRun(run);
    }

    run.testCaseResults = results;
    run.totalTestCases = results.reduce((sum, r) => sum + r.totalCases, 0);
    run.categoryCounts = this.aggregateCategoryCounts(results);
    run.progress = 60;
    run.currentStep = `Generated ${run.totalTestCases} test cases across ${stories.length} stories`;
    await this.updateWorkflowRun(run);
    this.emitProgress(run);
  }

  /**
   * Step 4: Convert test cases to Gherkin feature files
   */
  private async stepConvertToGherkin(run: WorkflowRun): Promise<void> {
    run.status = 'converting_gherkin';
    run.progress = 65;
    run.currentStep = 'Converting test cases to Gherkin...';
    await this.updateWorkflowRun(run);
    this.emitProgress(run);

    const features: WorkflowRun['gherkinFeatures'] = [];

    for (const result of run.testCaseResults!) {
      const featureContent = result.gherkinFeature;
      let featureId: string | undefined;

      // Auto-save as BDD feature if configured
      if (run.config.autoCreateFeatures !== false) {
        featureId = await this.saveAsFeature(run, result, featureContent);
      }

      features.push({
        storyKey: result.storyKey,
        featureContent,
        featureId,
      });
    }

    run.gherkinFeatures = features;
    run.progress = 75;
    run.currentStep = `Created ${features.length} Gherkin feature files`;
    await this.updateWorkflowRun(run);
    this.emitProgress(run);
  }

  /**
   * Step 5: Generate Playwright code from features
   */
  private async stepGeneratePlaywright(run: WorkflowRun): Promise<void> {
    run.status = 'generating_playwright';
    run.progress = 80;
    run.currentStep = 'Generating Playwright test code...';
    await this.updateWorkflowRun(run);
    this.emitProgress(run);

    const playwrightCode: WorkflowRun['playwrightCode'] = [];

    for (const feature of run.gherkinFeatures!) {
      // Parse the Gherkin and generate Playwright code
      const parsed = bddService.parseFeatureContent(feature.featureContent);
      const code = bddService.generatePlaywrightCode(parsed, feature.featureContent);

      playwrightCode.push({
        storyKey: feature.storyKey,
        code,
      });
    }

    run.playwrightCode = playwrightCode;
    run.progress = 90;
    run.currentStep = `Generated Playwright code for ${playwrightCode.length} features`;
    await this.updateWorkflowRun(run);
    this.emitProgress(run);
  }

  /**
   * Step 6 (optional): Execute generated tests
   */
  private async stepExecuteTests(run: WorkflowRun): Promise<void> {
    run.status = 'executing';
    run.progress = 92;
    run.currentStep = 'Executing Playwright tests...';
    await this.updateWorkflowRun(run);
    this.emitProgress(run);

    const executionResults: WorkflowRun['executionResults'] = [];

    for (const feature of run.gherkinFeatures!) {
      if (!feature.featureId) continue;

      try {
        const bddRun = await bddService.executeFeature(
          feature.featureId,
          run.userId,
          run.organizationId,
          {
            browser: run.config.executionBrowser || 'chromium',
            executionMode: run.config.executionMode || 'headless',
          }
        );

        executionResults.push({
          storyKey: feature.storyKey,
          runId: bddRun.id,
          status: bddRun.status,
        });
      } catch (err) {
        logger.warn(`Execution failed for ${feature.storyKey}: ${err}`);
        executionResults.push({
          storyKey: feature.storyKey,
          runId: '',
          status: 'failed',
        });
      }
    }

    run.executionResults = executionResults;
    run.progress = 98;
    run.currentStep = `Executed ${executionResults.length} test suites`;
    await this.updateWorkflowRun(run);
    this.emitProgress(run);
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  private async createWorkflowRun(
    userId: string,
    organizationId: string | null,
    config: WorkflowConfig
  ): Promise<WorkflowRun> {
    const { rows } = await pool.query(
      `INSERT INTO "WorkflowRun" (id, "userId", "organizationId", status, config, "totalStories", "totalTestCases", "categoryCounts", progress, "currentStep", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'pending', $3, 0, 0, $4, 0, 'Initializing...', now(), now())
       RETURNING *`,
      [userId, organizationId, JSON.stringify(this.sanitizeConfig(config)), JSON.stringify({})]
    );

    return {
      id: rows[0].id,
      userId,
      organizationId,
      status: 'pending',
      config,
      totalStories: 0,
      totalTestCases: 0,
      categoryCounts: { positive: 0, negative: 0, edge: 0, boundary: 0, security: 0 },
      progress: 0,
      currentStep: 'Initializing...',
    };
  }

  private async updateWorkflowRun(run: WorkflowRun): Promise<void> {
    await pool.query(
      `UPDATE "WorkflowRun"
       SET status = $1, "totalStories" = $2, "totalTestCases" = $3, "categoryCounts" = $4,
           progress = $5, "currentStep" = $6, "startedAt" = $7, "completedAt" = $8,
           error = $9, results = $10, "updatedAt" = now()
       WHERE id = $11`,
      [
        run.status,
        run.totalStories,
        run.totalTestCases,
        JSON.stringify(run.categoryCounts),
        run.progress,
        run.currentStep,
        run.startedAt || null,
        run.completedAt || null,
        run.error || null,
        JSON.stringify({
          jiraData: run.jiraData ? { epic: run.jiraData.epic?.key, storyCount: run.jiraData.stories.length, fetchedAt: run.jiraData.fetchedAt } : null,
          testCaseResults: run.testCaseResults?.map(r => ({ storyKey: r.storyKey, totalCases: r.totalCases, method: r.generationMethod })),
          gherkinFeatures: run.gherkinFeatures?.map(f => ({ storyKey: f.storyKey, featureId: f.featureId })),
          executionResults: run.executionResults,
        }),
        run.id,
      ]
    );
  }

  /**
   * Save generated Gherkin as a BDD Feature in the database
   */
  private async saveAsFeature(
    run: WorkflowRun,
    result: TestCaseGenerationResult,
    featureContent: string
  ): Promise<string> {
    const parsed = bddService.parseFeatureContent(featureContent);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO "BDDFeature" (id, "userId", "organizationId", name, description, "featureContent", tags, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'draft', now(), now())
         RETURNING id`,
        [
          run.userId,
          run.organizationId,
          `[${result.storyKey}] ${result.storySummary}`,
          `Auto-generated from Jira story ${result.storyKey}. Contains ${result.totalCases} test cases.`,
          featureContent,
          JSON.stringify([result.storyKey, 'auto-generated', ...Object.keys(result.categories).filter(c => (result.categories[c as TestCaseCategory] || []).length > 0)]),
        ]
      );

      const featureId = rows[0].id;

      // Save scenarios
      for (let sIdx = 0; sIdx < parsed.scenarios.length; sIdx++) {
        const scenario = parsed.scenarios[sIdx];
        const { rows: scenarioRows } = await client.query(
          `INSERT INTO "BDDScenario" (id, "featureId", name, description, "scenarioType", tags, "examplesData", "sortOrder", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
           RETURNING id`,
          [featureId, scenario.name, scenario.description || null, scenario.type, JSON.stringify(scenario.tags || []), scenario.examples ? JSON.stringify(scenario.examples) : null, sIdx]
        );
        const scenarioId = scenarioRows[0].id;

        for (let stIdx = 0; stIdx < scenario.steps.length; stIdx++) {
          const step = scenario.steps[stIdx];
          await client.query(
            `INSERT INTO "BDDStep" (id, "scenarioId", keyword, text, "dataTable", "docString", "sortOrder", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())`,
            [scenarioId, step.keyword, step.text, step.dataTable ? JSON.stringify(step.dataTable) : null, step.docString || null, stIdx]
          );
        }
      }

      await client.query('COMMIT');
      return featureId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // Query methods
  // =========================================================================

  /**
   * Get workflow run by ID
   */
  async getWorkflowRun(runId: string, userId: string): Promise<WorkflowRun | null> {
    const { rows } = await pool.query(
      `SELECT * FROM "WorkflowRun" WHERE id = $1 AND "userId" = $2`,
      [runId, userId]
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      userId: row.userId,
      organizationId: row.organizationId,
      status: row.status,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      totalStories: row.totalStories,
      totalTestCases: row.totalTestCases,
      categoryCounts: typeof row.categoryCounts === 'string' ? JSON.parse(row.categoryCounts) : row.categoryCounts,
      progress: row.progress,
      currentStep: row.currentStep,
      startedAt: row.startedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      error: row.error,
    };
  }

  /**
   * List workflow runs for a user
   */
  async listWorkflowRuns(userId: string, organizationId: string | null): Promise<WorkflowRun[]> {
    const { rows } = await pool.query(
      `SELECT * FROM "WorkflowRun"
       WHERE "userId" = $1 AND ("organizationId" = $2 OR ($2 IS NULL AND "organizationId" IS NULL))
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [userId, organizationId]
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.userId as string,
      organizationId: row.organizationId as string | null,
      status: row.status as WorkflowStatus,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      totalStories: row.totalStories as number,
      totalTestCases: row.totalTestCases as number,
      categoryCounts: typeof row.categoryCounts === 'string' ? JSON.parse(row.categoryCounts as string) : row.categoryCounts,
      progress: row.progress as number,
      currentStep: row.currentStep as string,
      startedAt: (row.startedAt as Date)?.toISOString(),
      completedAt: (row.completedAt as Date)?.toISOString(),
      error: row.error as string | undefined,
    }));
  }

  /**
   * Generate test cases from manual input (no Jira needed)
   */
  async generateFromManualInput(
    userId: string,
    organizationId: string | null,
    input: {
      summary: string;
      description: string;
      acceptanceCriteria: string[];
      priority?: string;
    },
    options: GenerationOptions = {}
  ): Promise<TestCaseGenerationResult> {
    const story: JiraStory = {
      key: 'MANUAL-' + Date.now(),
      summary: input.summary,
      description: input.description,
      status: 'Draft',
      priority: input.priority || 'Medium',
      labels: [],
      acceptanceCriteria: input.acceptanceCriteria,
      subtasks: [],
      attachments: [],
      comments: [],
    };

    return testCaseGenerator.generateFromStory(story, options);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private sanitizeConfig(config: WorkflowConfig): Record<string, unknown> {
    // Remove sensitive data before saving to DB
    const sanitized = { ...config } as Record<string, unknown>;
    if (config.jiraConfig) {
      sanitized.jiraConfig = {
        baseUrl: config.jiraConfig.baseUrl,
        email: config.jiraConfig.email,
        apiVersion: config.jiraConfig.apiVersion,
        // Do NOT store apiToken in results
      };
    }
    if (config.generation?.aiApiKey) {
      const gen = { ...config.generation };
      delete gen.aiApiKey;
      sanitized.generation = gen;
    }
    return sanitized;
  }

  private aggregateCategoryCounts(results: TestCaseGenerationResult[]): Record<TestCaseCategory, number> {
    const counts: Record<TestCaseCategory, number> = {
      positive: 0, negative: 0, edge: 0, boundary: 0, security: 0,
    };
    for (const result of results) {
      for (const [cat, cases] of Object.entries(result.categories)) {
        counts[cat as TestCaseCategory] += cases.length;
      }
    }
    return counts;
  }

  private emitProgress(run: WorkflowRun): void {
    workflowEventEmitter.emit(`workflow:${run.id}`, {
      id: run.id,
      status: run.status,
      progress: run.progress,
      currentStep: run.currentStep,
      totalStories: run.totalStories,
      totalTestCases: run.totalTestCases,
      categoryCounts: run.categoryCounts,
      error: run.error,
    });
  }
}

export const workflowOrchestrator = new WorkflowOrchestratorService();
