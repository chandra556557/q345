import pool from '../../db';

/**
 * Screenplay Pattern Service
 *
 * Implements the Screenplay Pattern concepts from Serenity BDD:
 * - Tasks: High-level business actions (e.g., "Login as admin")
 * - Actions: Low-level interactions (e.g., "Click button", "Fill field")
 * - Questions: Assertions/verifications (e.g., "Is the dashboard visible?")
 *
 * These compose together to create reusable, layered step definitions
 * that are more maintainable than flat Cucumber steps.
 */

export interface ScreenplayTask {
  id: string;
  name: string;
  description?: string;
  actorType: string;  // e.g., "User", "Admin", "API Client"
  actions: string[];  // ordered list of action IDs
  questions: string[]; // optional verification action IDs
  tags: string[];
  generatedCode?: string;
  usageCount: number;
  userId: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenplayAction {
  id: string;
  name: string;
  description?: string;
  actionType: 'interaction' | 'navigation' | 'input' | 'wait' | 'custom';
  target?: string;    // CSS selector, role, label
  value?: string;     // value for fill, select, etc.
  code: string;       // Playwright code snippet
  tags: string[];
  usageCount: number;
  userId: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenplayQuestion {
  id: string;
  name: string;
  description?: string;
  questionType: 'visibility' | 'text' | 'url' | 'title' | 'attribute' | 'count' | 'custom';
  target?: string;
  expected?: string;
  code: string;
  tags: string[];
  usageCount: number;
  userId: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

class ScreenplayService {

  // ===========================
  // TASKS CRUD
  // ===========================

  async createTask(
    userId: string,
    organizationId: string | null,
    data: {
      name: string;
      description?: string;
      actorType?: string;
      actions?: string[];
      questions?: string[];
      tags?: string[];
    }
  ): Promise<ScreenplayTask> {
    // Generate Playwright code from composed actions/questions
    const generatedCode = await this.generateTaskCode(userId, organizationId, data.actions || [], data.questions || []);

    const { rows } = await pool.query(
      `INSERT INTO "ScreenplayTask" (id, "userId", "organizationId", name, description, "actorType", actions, questions, tags, "generatedCode", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       RETURNING *`,
      [
        userId, organizationId, data.name, data.description || null,
        data.actorType || 'User',
        JSON.stringify(data.actions || []),
        JSON.stringify(data.questions || []),
        JSON.stringify(data.tags || []),
        generatedCode,
      ]
    );
    return rows[0];
  }

  async getTasks(userId: string, organizationId: string | null): Promise<ScreenplayTask[]> {
    let query = `SELECT * FROM "ScreenplayTask" WHERE ("userId" = $1`;
    const params: string[] = [userId];
    if (organizationId) {
      query += ` OR "organizationId" = $2`;
      params.push(organizationId);
    }
    query += `) ORDER BY "usageCount" DESC, "createdAt" DESC`;
    const { rows } = await pool.query(query, params);
    return rows;
  }

  async getTask(id: string, userId: string): Promise<ScreenplayTask | null> {
    const { rows } = await pool.query(
      `SELECT * FROM "ScreenplayTask" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    return rows[0] || null;
  }

  async updateTask(
    id: string,
    userId: string,
    data: Partial<{
      name: string;
      description: string;
      actorType: string;
      actions: string[];
      questions: string[];
      tags: string[];
    }>
  ): Promise<ScreenplayTask | null> {
    // Pre-generate code before building the query to avoid async work mid-construction
    let generatedCode: string | undefined;
    if (data.actions !== undefined || data.questions !== undefined) {
      const existing = await this.getTask(id, userId);
      if (existing) {
        const orgId = existing.organizationId || null;
        const actions = data.actions ?? (Array.isArray(existing.actions) ? existing.actions : JSON.parse(existing.actions as unknown as string) as string[]);
        const questions = data.questions ?? (Array.isArray(existing.questions) ? existing.questions : JSON.parse(existing.questions as unknown as string) as string[]);
        generatedCode = await this.generateTaskCode(userId, orgId, actions, questions);
      }
    }

    const updates: string[] = [];
    const params: (string | null)[] = [];
    let idx = 1;

    if (data.name !== undefined) { updates.push(`name = $${idx}`); params.push(data.name); idx++; }
    if (data.description !== undefined) { updates.push(`description = $${idx}`); params.push(data.description); idx++; }
    if (data.actorType !== undefined) { updates.push(`"actorType" = $${idx}`); params.push(data.actorType); idx++; }
    if (data.actions !== undefined) { updates.push(`actions = $${idx}`); params.push(JSON.stringify(data.actions)); idx++; }
    if (data.questions !== undefined) { updates.push(`questions = $${idx}`); params.push(JSON.stringify(data.questions)); idx++; }
    if (data.tags !== undefined) { updates.push(`tags = $${idx}`); params.push(JSON.stringify(data.tags)); idx++; }
    if (generatedCode !== undefined) { updates.push(`"generatedCode" = $${idx}`); params.push(generatedCode); idx++; }

    updates.push(`"updatedAt" = now()`);
    params.push(id, userId);

    const { rows } = await pool.query(
      `UPDATE "ScreenplayTask" SET ${updates.join(', ')} WHERE id = $${idx} AND "userId" = $${idx + 1} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  async deleteTask(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM "ScreenplayTask" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    return (rowCount || 0) > 0;
  }

  // ===========================
  // ACTIONS CRUD
  // ===========================

  async createAction(
    userId: string,
    organizationId: string | null,
    data: {
      name: string;
      description?: string;
      actionType?: string;
      target?: string;
      value?: string;
      code: string;
      tags?: string[];
    }
  ): Promise<ScreenplayAction> {
    const { rows } = await pool.query(
      `INSERT INTO "ScreenplayAction" (id, "userId", "organizationId", name, description, "actionType", target, value, code, tags, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       RETURNING *`,
      [
        userId, organizationId, data.name, data.description || null,
        data.actionType || 'custom',
        data.target || null, data.value || null, data.code,
        JSON.stringify(data.tags || []),
      ]
    );
    return rows[0];
  }

  async getActions(userId: string, organizationId: string | null): Promise<ScreenplayAction[]> {
    let query = `SELECT * FROM "ScreenplayAction" WHERE ("userId" = $1`;
    const params: string[] = [userId];
    if (organizationId) {
      query += ` OR "organizationId" = $2`;
      params.push(organizationId);
    }
    query += `) ORDER BY "usageCount" DESC, "createdAt" DESC`;
    const { rows } = await pool.query(query, params);
    return rows;
  }

  async getAction(id: string, userId: string): Promise<ScreenplayAction | null> {
    const { rows } = await pool.query(
      `SELECT * FROM "ScreenplayAction" WHERE id = $1 AND ("userId" = $2 OR "organizationId" IN (SELECT "organizationId" FROM "ScreenplayAction" WHERE id = $1))`,
      [id, userId]
    );
    return rows[0] || null;
  }

  async updateAction(
    id: string,
    userId: string,
    data: Partial<{
      name: string;
      description: string;
      actionType: string;
      target: string;
      value: string;
      code: string;
      tags: string[];
    }>
  ): Promise<ScreenplayAction | null> {
    const updates: string[] = [];
    const params: (string | null)[] = [];
    let idx = 1;

    if (data.name !== undefined) { updates.push(`name = $${idx}`); params.push(data.name); idx++; }
    if (data.description !== undefined) { updates.push(`description = $${idx}`); params.push(data.description); idx++; }
    if (data.actionType !== undefined) { updates.push(`"actionType" = $${idx}`); params.push(data.actionType); idx++; }
    if (data.target !== undefined) { updates.push(`target = $${idx}`); params.push(data.target); idx++; }
    if (data.value !== undefined) { updates.push(`value = $${idx}`); params.push(data.value); idx++; }
    if (data.code !== undefined) { updates.push(`code = $${idx}`); params.push(data.code); idx++; }
    if (data.tags !== undefined) { updates.push(`tags = $${idx}`); params.push(JSON.stringify(data.tags)); idx++; }
    updates.push(`"updatedAt" = now()`);

    params.push(id, userId);
    const { rows } = await pool.query(
      `UPDATE "ScreenplayAction" SET ${updates.join(', ')} WHERE id = $${idx} AND "userId" = $${idx + 1} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  async deleteAction(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM "ScreenplayAction" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    return (rowCount || 0) > 0;
  }

  // ===========================
  // QUESTIONS CRUD
  // ===========================

  async createQuestion(
    userId: string,
    organizationId: string | null,
    data: {
      name: string;
      description?: string;
      questionType?: string;
      target?: string;
      expected?: string;
      code: string;
      tags?: string[];
    }
  ): Promise<ScreenplayQuestion> {
    const { rows } = await pool.query(
      `INSERT INTO "ScreenplayQuestion" (id, "userId", "organizationId", name, description, "questionType", target, expected, code, tags, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       RETURNING *`,
      [
        userId, organizationId, data.name, data.description || null,
        data.questionType || 'custom',
        data.target || null, data.expected || null, data.code,
        JSON.stringify(data.tags || []),
      ]
    );
    return rows[0];
  }

  async getQuestions(userId: string, organizationId: string | null): Promise<ScreenplayQuestion[]> {
    let query = `SELECT * FROM "ScreenplayQuestion" WHERE ("userId" = $1`;
    const params: string[] = [userId];
    if (organizationId) {
      query += ` OR "organizationId" = $2`;
      params.push(organizationId);
    }
    query += `) ORDER BY "usageCount" DESC, "createdAt" DESC`;
    const { rows } = await pool.query(query, params);
    return rows;
  }

  async updateQuestion(
    id: string,
    userId: string,
    data: Partial<{
      name: string;
      description: string;
      questionType: string;
      target: string;
      expected: string;
      code: string;
      tags: string[];
    }>
  ): Promise<ScreenplayQuestion | null> {
    const updates: string[] = [];
    const params: (string | null)[] = [];
    let idx = 1;

    if (data.name !== undefined) { updates.push(`name = $${idx}`); params.push(data.name); idx++; }
    if (data.description !== undefined) { updates.push(`description = $${idx}`); params.push(data.description); idx++; }
    if (data.questionType !== undefined) { updates.push(`"questionType" = $${idx}`); params.push(data.questionType); idx++; }
    if (data.target !== undefined) { updates.push(`target = $${idx}`); params.push(data.target); idx++; }
    if (data.expected !== undefined) { updates.push(`expected = $${idx}`); params.push(data.expected); idx++; }
    if (data.code !== undefined) { updates.push(`code = $${idx}`); params.push(data.code); idx++; }
    if (data.tags !== undefined) { updates.push(`tags = $${idx}`); params.push(JSON.stringify(data.tags)); idx++; }
    updates.push(`"updatedAt" = now()`);

    params.push(id, userId);
    const { rows } = await pool.query(
      `UPDATE "ScreenplayQuestion" SET ${updates.join(', ')} WHERE id = $${idx} AND "userId" = $${idx + 1} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  async deleteQuestion(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM "ScreenplayQuestion" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );
    return (rowCount || 0) > 0;
  }

  // ===========================
  // CODE GENERATION
  // ===========================

  /**
   * Generate a Cucumber step definition from a Task composed of Actions + Questions.
   * This creates a reusable, Screenplay-pattern BDD step.
   */
  async generateTaskCode(
    _userId: string,
    _organizationId: string | null,
    actionIds: string[],
    questionIds: string[]
  ): Promise<string> {
    const lines: string[] = [];

    // Load actions
    if (actionIds.length > 0) {
      const { rows: actions } = await pool.query(
        `SELECT * FROM "ScreenplayAction" WHERE id = ANY($1) ORDER BY array_position($1, id)`,
        [actionIds]
      );
      for (const action of actions) {
        lines.push(`  // Action: ${action.name}`);
        lines.push(`  ${action.code}`);
      }
    }

    // Load questions (verifications)
    if (questionIds.length > 0) {
      if (lines.length > 0) lines.push('');
      const { rows: questions } = await pool.query(
        `SELECT * FROM "ScreenplayQuestion" WHERE id = ANY($1) ORDER BY array_position($1, id)`,
        [questionIds]
      );
      for (const question of questions) {
        lines.push(`  // Question: ${question.name}`);
        lines.push(`  ${question.code}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate a complete Cucumber step definition wrapping a Task.
   * Returns code ready to inject into step definitions.
   */
  async generateTaskStepDefinition(
    taskId: string,
    userId: string,
    incrementUsage: boolean = true
  ): Promise<string> {
    const task = await this.getTask(taskId, userId);
    if (!task) throw new Error('Task not found');

    const actionIds = typeof task.actions === 'string' ? JSON.parse(task.actions) : task.actions;
    const questionIds = typeof task.questions === 'string' ? JSON.parse(task.questions) : task.questions;
    const orgId = task.organizationId || null;

    const innerCode = await this.generateTaskCode(userId, orgId, actionIds, questionIds);

    // Create a Given/When/Then step that executes this task
    const stepName = task.name.replace(/'/g, "\\'");
    const lines: string[] = [
      `// Screenplay Task: ${task.name}`,
      `// Actor: ${task.actorType}`,
      `Given('${stepName}', async function () {`,
      innerCode,
      `});`,
      `When('${stepName}', async function () {`,
      innerCode,
      `});`,
    ];

    if (incrementUsage) {
      await pool.query(
        `UPDATE "ScreenplayTask" SET "usageCount" = "usageCount" + 1, "updatedAt" = now() WHERE id = $1`,
        [taskId]
      );
    }

    return lines.join('\n');
  }

  /**
   * Load all Screenplay tasks for a user and generate their step definitions.
   * Used during BDD execution to inject Screenplay-based steps.
   */
  async loadScreenplayStepDefinitions(userId: string, organizationId: string | null): Promise<string> {
    const tasks = await this.getTasks(userId, organizationId);
    if (tasks.length === 0) return '';

    const lines: string[] = [
      '// ========================================',
      '// Screenplay Pattern - Task Definitions',
      '// ========================================',
    ];

    for (const task of tasks) {
      try {
        const stepDef = await this.generateTaskStepDefinition(task.id, userId, false);
        lines.push('');
        lines.push(stepDef);
      } catch (e: any) {
        lines.push(`// Error generating task "${task.name}": ${e.message}`);
      }
    }

    return lines.join('\n');
  }

  // ===========================
  // PRESET ACTIONS & QUESTIONS
  // ===========================

  /**
   * Get built-in preset actions that users can pick from
   */
  getPresetActions(): { name: string; description: string; actionType: string; code: string }[] {
    return [
      {
        name: 'Navigate to URL',
        description: 'Open a web page by URL',
        actionType: 'navigation',
        code: `await page.goto('{url}');`,
      },
      {
        name: 'Click element by role',
        description: 'Click a button, link, or other element by its role and name',
        actionType: 'interaction',
        code: `await page.getByRole('{role}', { name: '{name}' }).click();`,
      },
      {
        name: 'Click element by text',
        description: 'Click an element matching visible text',
        actionType: 'interaction',
        code: `await page.getByText('{text}', { exact: true }).click();`,
      },
      {
        name: 'Fill input by label',
        description: 'Type text into an input field identified by its label',
        actionType: 'input',
        code: `await page.getByLabel('{label}').fill('{value}');`,
      },
      {
        name: 'Fill input by placeholder',
        description: 'Type text into an input field identified by its placeholder',
        actionType: 'input',
        code: `await page.getByPlaceholder('{placeholder}').fill('{value}');`,
      },
      {
        name: 'Select dropdown option',
        description: 'Select an option from a dropdown',
        actionType: 'input',
        code: `await page.getByLabel('{label}').selectOption('{value}');`,
      },
      {
        name: 'Press keyboard key',
        description: 'Press a key like Enter, Tab, Escape',
        actionType: 'interaction',
        code: `await page.keyboard.press('{key}');`,
      },
      {
        name: 'Wait for timeout',
        description: 'Wait a specified number of milliseconds',
        actionType: 'wait',
        code: `await page.waitForTimeout({ms});`,
      },
      {
        name: 'Wait for element',
        description: 'Wait until an element is visible on the page',
        actionType: 'wait',
        code: `await page.getByText('{text}').waitFor({ state: 'visible', timeout: 10000 });`,
      },
      {
        name: 'Upload file',
        description: 'Upload a file to a file input',
        actionType: 'input',
        code: `await page.getByLabel('{label}').setInputFiles('{filePath}');`,
      },
      {
        name: 'Hover over element',
        description: 'Hover the mouse over an element',
        actionType: 'interaction',
        code: `await page.getByText('{text}').hover();`,
      },
      {
        name: 'Check checkbox',
        description: 'Check a checkbox input',
        actionType: 'interaction',
        code: `await page.getByLabel('{label}').check();`,
      },
    ];
  }

  /**
   * Get built-in preset questions (assertions)
   */
  getPresetQuestions(): { name: string; description: string; questionType: string; code: string }[] {
    return [
      {
        name: 'Element is visible',
        description: 'Verify that an element with given text is visible',
        questionType: 'visibility',
        code: `const { expect } = require('@playwright/test');\nawait expect(page.getByText('{text}')).toBeVisible({ timeout: 10000 });`,
      },
      {
        name: 'Element is hidden',
        description: 'Verify that an element is not visible',
        questionType: 'visibility',
        code: `const { expect } = require('@playwright/test');\nawait expect(page.getByText('{text}')).toBeHidden({ timeout: 5000 });`,
      },
      {
        name: 'Page has title',
        description: 'Verify the page title matches',
        questionType: 'title',
        code: `const { expect } = require('@playwright/test');\nawait expect(page).toHaveTitle('{title}');`,
      },
      {
        name: 'URL contains',
        description: 'Verify the current URL contains a string',
        questionType: 'url',
        code: `const { expect } = require('@playwright/test');\nawait expect(page).toHaveURL(new RegExp('{urlPart}'));`,
      },
      {
        name: 'Page contains text',
        description: 'Verify the page body contains specific text',
        questionType: 'text',
        code: `const { expect } = require('@playwright/test');\nawait expect(page.locator('body')).toContainText('{text}');`,
      },
      {
        name: 'Element has text',
        description: 'Verify an element has specific text content',
        questionType: 'text',
        code: `const { expect } = require('@playwright/test');\nawait expect(page.getByLabel('{label}')).toHaveValue('{value}');`,
      },
      {
        name: 'Element count equals',
        description: 'Verify the number of elements matching a locator',
        questionType: 'count',
        code: `const { expect } = require('@playwright/test');\nawait expect(page.getByRole('{role}', { name: '{name}' })).toHaveCount({count});`,
      },
      {
        name: 'Element has attribute',
        description: 'Verify an element has a specific attribute value',
        questionType: 'attribute',
        code: `const { expect } = require('@playwright/test');\nawait expect(page.getByLabel('{label}')).toHaveAttribute('{attr}', '{value}');`,
      },
    ];
  }
}

export const screenplayService = new ScreenplayService();
