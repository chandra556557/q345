/**
 * AI-Powered Test Case Generator Service
 *
 * Generates comprehensive test cases from Jira stories/acceptance criteria:
 *  - Positive test cases (happy path)
 *  - Negative test cases (invalid inputs, error paths)
 *  - Edge cases (boundary conditions, empty states)
 *  - Boundary value analysis cases
 *  - Security test cases (XSS, injection, auth bypass, etc.)
 *
 * Supports: OpenAI, Claude (Anthropic), and rule-based fallback
 */

import { logger } from '../../utils/logger';
import { JiraStory, JiraEpic } from './jira.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestCaseCategory = 'positive' | 'negative' | 'edge' | 'boundary' | 'security';

export interface GeneratedTestCase {
  id: string;
  category: TestCaseCategory;
  title: string;
  description: string;
  preconditions: string[];
  steps: TestCaseStep[];
  expectedResult: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tags: string[];
  dataVariations?: Record<string, string>[];
}

export interface TestCaseStep {
  stepNumber: number;
  action: string;
  expectedResult?: string;
  testData?: string;
}

export interface TestCaseGenerationResult {
  storyKey: string;
  storySummary: string;
  totalCases: number;
  categories: Record<TestCaseCategory, GeneratedTestCase[]>;
  gherkinFeature: string;
  generatedAt: string;
  generationMethod: 'ai' | 'rule-based';
}

export interface GenerationOptions {
  categories?: TestCaseCategory[];       // Which categories to generate (default: all)
  maxCasesPerCategory?: number;          // Max test cases per category (default: 5)
  includeDataVariations?: boolean;       // Generate data-driven variations
  securityDepth?: 'basic' | 'thorough';  // Security testing depth
  aiProvider?: 'openai' | 'anthropic' | 'none'; // AI provider (none = rule-based)
  aiApiKey?: string;                     // API key for AI provider
  aiModel?: string;                      // Model override
  applicationContext?: string;           // e.g. "web application", "mobile app", "REST API"
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TestCaseGeneratorService {

  private defaultCategories: TestCaseCategory[] = ['positive', 'negative', 'edge', 'boundary', 'security'];

  /**
   * Generate test cases from a single Jira story
   */
  async generateFromStory(
    story: JiraStory,
    options: GenerationOptions = {}
  ): Promise<TestCaseGenerationResult> {
    const categories = options.categories || this.defaultCategories;
    const maxPerCategory = options.maxCasesPerCategory || 5;
    const provider = options.aiProvider || 'none';

    logger.info(`Generating test cases for ${story.key}: ${story.summary} (provider: ${provider})`);

    let allCases: Record<TestCaseCategory, GeneratedTestCase[]>;

    if (provider !== 'none' && options.aiApiKey) {
      allCases = await this.generateWithAI(story, categories, maxPerCategory, options);
    } else {
      allCases = this.generateRuleBased(story, categories, maxPerCategory, options);
    }

    // Convert all test cases to Gherkin
    const gherkinFeature = this.convertToGherkin(story, allCases);

    const totalCases = Object.values(allCases).reduce((sum, arr) => sum + arr.length, 0);

    return {
      storyKey: story.key,
      storySummary: story.summary,
      totalCases,
      categories: allCases,
      gherkinFeature,
      generatedAt: new Date().toISOString(),
      generationMethod: provider !== 'none' && options.aiApiKey ? 'ai' : 'rule-based',
    };
  }

  /**
   * Generate test cases for an entire epic (all stories)
   */
  async generateFromEpic(
    epic: JiraEpic,
    options: GenerationOptions = {}
  ): Promise<TestCaseGenerationResult[]> {
    const results: TestCaseGenerationResult[] = [];

    for (const story of epic.stories) {
      const result = await this.generateFromStory(story, options);
      results.push(result);
    }

    return results;
  }

  // =========================================================================
  // AI-powered generation
  // =========================================================================

  private async generateWithAI(
    story: JiraStory,
    categories: TestCaseCategory[],
    maxPerCategory: number,
    options: GenerationOptions
  ): Promise<Record<TestCaseCategory, GeneratedTestCase[]>> {
    const prompt = this.buildAIPrompt(story, categories, maxPerCategory, options);

    try {
      let responseText: string;

      if (options.aiProvider === 'anthropic') {
        responseText = await this.callAnthropicAPI(prompt, options);
      } else {
        responseText = await this.callOpenAIAPI(prompt, options);
      }

      const parsed = this.parseAIResponse(responseText, categories);
      return parsed;
    } catch (err) {
      logger.warn(`AI generation failed, falling back to rule-based: ${err}`);
      return this.generateRuleBased(story, categories, maxPerCategory, options);
    }
  }

  private buildAIPrompt(
    story: JiraStory,
    categories: TestCaseCategory[],
    maxPerCategory: number,
    options: GenerationOptions
  ): string {
    const appContext = options.applicationContext || 'web application';

    return `You are a senior QA engineer. Generate comprehensive test cases for the following user story.

## User Story
**Key:** ${story.key}
**Summary:** ${story.summary}
**Description:** ${story.description}
**Priority:** ${story.priority}
**Acceptance Criteria:**
${story.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')}
${story.subtasks.length > 0 ? `\n**Subtasks:**\n${story.subtasks.map(st => `- [${st.key}] ${st.summary}`).join('\n')}` : ''}

## Application Context
This is a ${appContext}.

## Requirements
Generate up to ${maxPerCategory} test cases for EACH of these categories:
${categories.map(c => `- **${c}**: ${this.getCategoryDescription(c)}`).join('\n')}

## Output Format
Return ONLY valid JSON (no markdown fences) with this structure:
{
  "testCases": {
    "${categories[0]}": [
      {
        "title": "Test case title",
        "description": "What this test verifies",
        "preconditions": ["User is logged in", "Data exists"],
        "steps": [
          {"stepNumber": 1, "action": "Navigate to page", "expectedResult": "Page loads", "testData": "url: /dashboard"}
        ],
        "expectedResult": "Overall expected outcome",
        "priority": "high",
        "tags": ["smoke", "regression"]
      }
    ]
  }
}

Be specific with test data values. Include realistic boundary values. For security cases, include actual payloads to test (XSS, SQL injection, etc.).`;
  }

  private getCategoryDescription(category: TestCaseCategory): string {
    const descriptions: Record<TestCaseCategory, string> = {
      positive: 'Happy path scenarios where all inputs are valid and the system behaves as expected',
      negative: 'Invalid inputs, missing required fields, wrong data types, unauthorized access, error handling',
      edge: 'Empty states, maximum lengths, special characters, concurrent operations, timeout scenarios',
      boundary: 'Min/max values, off-by-one errors, integer overflow, date boundaries, pagination limits',
      security: 'XSS attacks, SQL injection, CSRF, auth bypass, privilege escalation, session hijacking, input sanitization',
    };
    return descriptions[category];
  }

  private async callOpenAIAPI(prompt: string, options: GenerationOptions): Promise<string> {
    const model = options.aiModel || 'gpt-4o';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a senior QA engineer who generates comprehensive test cases. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || '';
  }

  private async callAnthropicAPI(prompt: string, options: GenerationOptions): Promise<string> {
    const model = options.aiModel || 'claude-sonnet-4-20250514';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': options.aiApiKey!,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text || '';
  }

  private parseAIResponse(
    responseText: string,
    categories: TestCaseCategory[]
  ): Record<TestCaseCategory, GeneratedTestCase[]> {
    const result: Record<TestCaseCategory, GeneratedTestCase[]> = {
      positive: [], negative: [], edge: [], boundary: [], security: [],
    };

    try {
      // Clean response - remove markdown code fences if present
      const cleaned = responseText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const testCases = parsed.testCases || parsed;

      for (const category of categories) {
        const cases = testCases[category] || [];
        result[category] = cases.map((tc: Record<string, unknown>, idx: number) => ({
          id: `${category}-${idx + 1}`,
          category,
          title: tc.title as string || `${category} case ${idx + 1}`,
          description: tc.description as string || '',
          preconditions: (tc.preconditions as string[]) || [],
          steps: ((tc.steps as TestCaseStep[]) || []).map((s, sIdx) => ({
            stepNumber: s.stepNumber || sIdx + 1,
            action: s.action || '',
            expectedResult: s.expectedResult,
            testData: s.testData,
          })),
          expectedResult: tc.expectedResult as string || '',
          priority: (tc.priority as GeneratedTestCase['priority']) || 'medium',
          tags: (tc.tags as string[]) || [category],
          dataVariations: tc.dataVariations as Record<string, string>[] | undefined,
        }));
      }
    } catch (err) {
      logger.warn(`Failed to parse AI response, falling back: ${err}`);
    }

    return result;
  }

  // =========================================================================
  // Rule-based generation (no AI required)
  // =========================================================================

  generateRuleBased(
    story: JiraStory,
    categories: TestCaseCategory[],
    maxPerCategory: number,
    options: GenerationOptions
  ): Record<TestCaseCategory, GeneratedTestCase[]> {
    const result: Record<TestCaseCategory, GeneratedTestCase[]> = {
      positive: [], negative: [], edge: [], boundary: [], security: [],
    };

    const context = this.analyzeStoryContext(story);

    if (categories.includes('positive')) {
      result.positive = this.generatePositiveCases(story, context, maxPerCategory);
    }
    if (categories.includes('negative')) {
      result.negative = this.generateNegativeCases(story, context, maxPerCategory);
    }
    if (categories.includes('edge')) {
      result.edge = this.generateEdgeCases(story, context, maxPerCategory);
    }
    if (categories.includes('boundary')) {
      result.boundary = this.generateBoundaryCases(story, context, maxPerCategory);
    }
    if (categories.includes('security')) {
      result.security = this.generateSecurityCases(story, context, maxPerCategory, options);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Context analysis
  // ---------------------------------------------------------------------------

  private analyzeStoryContext(story: JiraStory): StoryContext {
    const text = `${story.summary} ${story.description} ${story.acceptanceCriteria.join(' ')}`.toLowerCase();

    return {
      hasLogin: /log\s?in|sign\s?in|auth|password|credential/i.test(text),
      hasForm: /form|input|field|submit|fill|enter|type/i.test(text),
      hasSearch: /search|filter|find|query|lookup/i.test(text),
      hasUpload: /upload|file|image|document|attachment/i.test(text),
      hasPayment: /pay|checkout|cart|order|purchase|price|amount/i.test(text),
      hasNavigation: /navigate|page|redirect|url|link|menu|tab/i.test(text),
      hasDataDisplay: /list|table|grid|display|show|view|dashboard/i.test(text),
      hasCRUD: /create|add|edit|update|delete|remove|save/i.test(text),
      hasAPI: /api|endpoint|request|response|rest|graphql/i.test(text),
      hasPermissions: /role|permission|admin|access|restrict|authorize/i.test(text),
      hasNotification: /notification|email|alert|message|sms/i.test(text),
      hasDatetime: /date|time|schedule|calendar|deadline|duration/i.test(text),
      hasNumeric: /amount|price|quantity|count|number|total|sum|percentage/i.test(text),
      inputFields: this.detectInputFields(text),
      actions: this.detectActions(text),
    };
  }

  private detectInputFields(text: string): string[] {
    const fieldPatterns: Array<{ pattern: RegExp; field: string }> = [
      { pattern: /email/i, field: 'email' },
      { pattern: /password/i, field: 'password' },
      { pattern: /username|user\s?name/i, field: 'username' },
      { pattern: /phone|mobile|tel/i, field: 'phone' },
      { pattern: /name|first\s?name|last\s?name/i, field: 'name' },
      { pattern: /address|street|city|zip|postal/i, field: 'address' },
      { pattern: /amount|price|cost/i, field: 'amount' },
      { pattern: /date|dob|birthday/i, field: 'date' },
      { pattern: /description|comment|note|text/i, field: 'text' },
      { pattern: /url|link|website/i, field: 'url' },
      { pattern: /file|image|photo|document/i, field: 'file' },
      { pattern: /dropdown|select|option/i, field: 'select' },
      { pattern: /checkbox|toggle|switch/i, field: 'checkbox' },
    ];

    const fields: string[] = [];
    for (const { pattern, field } of fieldPatterns) {
      if (pattern.test(text) && !fields.includes(field)) fields.push(field);
    }
    return fields;
  }

  private detectActions(text: string): string[] {
    const actionPatterns: Array<{ pattern: RegExp; action: string }> = [
      { pattern: /click|press|tap/i, action: 'click' },
      { pattern: /type|enter|input|fill/i, action: 'type' },
      { pattern: /select|choose|pick/i, action: 'select' },
      { pattern: /upload|attach/i, action: 'upload' },
      { pattern: /submit|save|confirm/i, action: 'submit' },
      { pattern: /navigate|go to|open|visit/i, action: 'navigate' },
      { pattern: /search|find|filter/i, action: 'search' },
      { pattern: /delete|remove|clear/i, action: 'delete' },
      { pattern: /drag|drop|sort/i, action: 'drag' },
      { pattern: /scroll|swipe/i, action: 'scroll' },
    ];

    const actions: string[] = [];
    for (const { pattern, action } of actionPatterns) {
      if (pattern.test(text) && !actions.includes(action)) actions.push(action);
    }
    return actions;
  }

  // ---------------------------------------------------------------------------
  // Positive test cases
  // ---------------------------------------------------------------------------

  private generatePositiveCases(story: JiraStory, ctx: StoryContext, max: number): GeneratedTestCase[] {
    const cases: GeneratedTestCase[] = [];
    let caseNum = 0;

    // Generate from acceptance criteria (each AC = one positive case)
    for (const ac of story.acceptanceCriteria.slice(0, max)) {
      caseNum++;
      cases.push({
        id: `positive-${caseNum}`,
        category: 'positive',
        title: `Verify: ${this.truncate(ac, 80)}`,
        description: `Validates that the acceptance criteria is met: ${ac}`,
        preconditions: this.getDefaultPreconditions(ctx),
        steps: this.generateStepsFromAC(ac, ctx),
        expectedResult: ac,
        priority: caseNum <= 2 ? 'critical' : 'high',
        tags: ['positive', 'happy-path', ...(caseNum <= 2 ? ['smoke'] : ['regression'])],
      });
    }

    // If no AC, generate from story summary
    if (cases.length === 0) {
      cases.push({
        id: 'positive-1',
        category: 'positive',
        title: `Verify: ${story.summary}`,
        description: `Happy path test for: ${story.summary}`,
        preconditions: this.getDefaultPreconditions(ctx),
        steps: this.generateStepsFromSummary(story.summary, ctx),
        expectedResult: `${story.summary} works as expected`,
        priority: 'critical',
        tags: ['positive', 'happy-path', 'smoke'],
      });
    }

    // Add data-driven positive case if form context detected
    if (ctx.hasForm && cases.length < max) {
      caseNum++;
      cases.push({
        id: `positive-${caseNum}`,
        category: 'positive',
        title: 'Verify form submission with all valid fields',
        description: 'Submit form with valid data in all fields',
        preconditions: [...this.getDefaultPreconditions(ctx), 'All form fields are visible'],
        steps: this.generateFormSubmitSteps(ctx, 'valid'),
        expectedResult: 'Form is submitted successfully, confirmation is displayed',
        priority: 'high',
        tags: ['positive', 'form', 'regression'],
        dataVariations: this.getValidDataVariations(ctx),
      });
    }

    return cases.slice(0, max);
  }

  // ---------------------------------------------------------------------------
  // Negative test cases
  // ---------------------------------------------------------------------------

  private generateNegativeCases(_story: JiraStory, ctx: StoryContext, max: number): GeneratedTestCase[] {
    const cases: GeneratedTestCase[] = [];
    let caseNum = 0;

    // Required field validation
    for (const field of ctx.inputFields.slice(0, 3)) {
      caseNum++;
      cases.push({
        id: `negative-${caseNum}`,
        category: 'negative',
        title: `Submit with empty ${field} field`,
        description: `Verify error when ${field} is left empty`,
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to the form/page' },
          { stepNumber: 2, action: `Leave the ${field} field empty` },
          { stepNumber: 3, action: 'Fill all other required fields with valid data' },
          { stepNumber: 4, action: 'Click Submit/Save button' },
        ],
        expectedResult: `Validation error is displayed for ${field} field. Form is not submitted.`,
        priority: 'high',
        tags: ['negative', 'validation', field],
      });
    }

    // Invalid format cases
    const formatCases: Array<{ field: string; value: string; desc: string }> = [];
    if (ctx.inputFields.includes('email')) {
      formatCases.push({ field: 'email', value: 'invalid-email', desc: 'invalid email format' });
      formatCases.push({ field: 'email', value: 'user@', desc: 'incomplete email address' });
    }
    if (ctx.inputFields.includes('phone')) {
      formatCases.push({ field: 'phone', value: 'abc123', desc: 'alphabetic characters in phone' });
    }
    if (ctx.inputFields.includes('url')) {
      formatCases.push({ field: 'url', value: 'not-a-url', desc: 'invalid URL format' });
    }
    if (ctx.inputFields.includes('date')) {
      formatCases.push({ field: 'date', value: '99/99/9999', desc: 'invalid date' });
    }

    for (const fc of formatCases.slice(0, max - cases.length)) {
      caseNum++;
      cases.push({
        id: `negative-${caseNum}`,
        category: 'negative',
        title: `Submit with ${fc.desc}`,
        description: `Verify error message when ${fc.field} has ${fc.desc}`,
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to the form/page' },
          { stepNumber: 2, action: `Enter "${fc.value}" in the ${fc.field} field`, testData: fc.value },
          { stepNumber: 3, action: 'Click Submit/Save button' },
        ],
        expectedResult: `Validation error is shown for ${fc.field}: invalid format`,
        priority: 'high',
        tags: ['negative', 'validation', fc.field],
      });
    }

    // Unauthorized access
    if (ctx.hasPermissions && cases.length < max) {
      caseNum++;
      cases.push({
        id: `negative-${caseNum}`,
        category: 'negative',
        title: 'Access restricted feature without proper role',
        description: 'Verify unauthorized users cannot access restricted functionality',
        preconditions: ['User is logged in with basic/viewer role'],
        steps: [
          { stepNumber: 1, action: 'Navigate to the restricted page/feature directly via URL' },
          { stepNumber: 2, action: 'Attempt to perform the restricted action' },
        ],
        expectedResult: 'Access denied error or redirect to unauthorized page. Action is not performed.',
        priority: 'critical',
        tags: ['negative', 'authorization', 'security'],
      });
    }

    // Login-specific negatives
    if (ctx.hasLogin && cases.length < max) {
      caseNum++;
      cases.push({
        id: `negative-${caseNum}`,
        category: 'negative',
        title: 'Login with wrong password',
        description: 'Verify error with incorrect credentials',
        preconditions: ['User account exists in the system'],
        steps: [
          { stepNumber: 1, action: 'Navigate to login page' },
          { stepNumber: 2, action: 'Enter valid username/email', testData: 'user@test.com' },
          { stepNumber: 3, action: 'Enter incorrect password', testData: 'WrongPass123!' },
          { stepNumber: 4, action: 'Click Login button' },
        ],
        expectedResult: 'Error message displayed: "Invalid credentials". User is not logged in.',
        priority: 'critical',
        tags: ['negative', 'login', 'authentication'],
      });
    }

    return cases.slice(0, max);
  }

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  private generateEdgeCases(_story: JiraStory, ctx: StoryContext, max: number): GeneratedTestCase[] {
    const cases: GeneratedTestCase[] = [];
    let caseNum = 0;

    // Empty state
    if (ctx.hasDataDisplay) {
      caseNum++;
      cases.push({
        id: `edge-${caseNum}`,
        category: 'edge',
        title: 'Display with no data (empty state)',
        description: 'Verify the page handles empty data gracefully',
        preconditions: ['No data exists in the system for this view'],
        steps: [
          { stepNumber: 1, action: 'Navigate to the data display page' },
          { stepNumber: 2, action: 'Observe the page content' },
        ],
        expectedResult: 'Empty state message is displayed (e.g., "No items found"). No errors or blank page.',
        priority: 'medium',
        tags: ['edge', 'empty-state', 'ui'],
      });
    }

    // Special characters in text fields
    if (ctx.inputFields.includes('text') || ctx.inputFields.includes('name')) {
      caseNum++;
      cases.push({
        id: `edge-${caseNum}`,
        category: 'edge',
        title: 'Input with special characters',
        description: 'Verify special characters are handled correctly',
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to the input form' },
          { stepNumber: 2, action: 'Enter text with special characters', testData: `O'Brien-Smith <test> & "quotes" © ™ 日本語` },
          { stepNumber: 3, action: 'Submit the form' },
        ],
        expectedResult: 'Data is saved and displayed correctly with all special characters preserved',
        priority: 'medium',
        tags: ['edge', 'special-characters', 'i18n'],
      });
    }

    // Maximum length input
    for (const field of ctx.inputFields.filter(f => ['text', 'name', 'email'].includes(f)).slice(0, 1)) {
      caseNum++;
      cases.push({
        id: `edge-${caseNum}`,
        category: 'edge',
        title: `${field} field with maximum length input`,
        description: `Verify ${field} handles very long input`,
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to the form' },
          { stepNumber: 2, action: `Enter 500+ characters in ${field} field`, testData: 'A'.repeat(500) },
          { stepNumber: 3, action: 'Submit the form' },
        ],
        expectedResult: 'Input is either truncated to max length or validation error is shown. No crash or data corruption.',
        priority: 'medium',
        tags: ['edge', 'max-length', field],
      });
    }

    // Rapid double-click / double-submit
    if (ctx.actions.includes('submit')) {
      caseNum++;
      cases.push({
        id: `edge-${caseNum}`,
        category: 'edge',
        title: 'Double-click on submit button',
        description: 'Verify double submission is prevented',
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Fill form with valid data' },
          { stepNumber: 2, action: 'Rapidly double-click the submit button' },
        ],
        expectedResult: 'Only one submission is processed. No duplicate records created.',
        priority: 'high',
        tags: ['edge', 'double-submit', 'race-condition'],
      });
    }

    // Network error / timeout
    caseNum++;
    cases.push({
      id: `edge-${caseNum}`,
      category: 'edge',
      title: 'Handle slow network / timeout',
      description: 'Verify behavior when network is slow or request times out',
      preconditions: [...this.getDefaultPreconditions(ctx), 'Network throttling enabled'],
      steps: [
        { stepNumber: 1, action: 'Enable network throttling (slow 3G)' },
        { stepNumber: 2, action: 'Perform the main action of the feature' },
        { stepNumber: 3, action: 'Wait for response' },
      ],
      expectedResult: 'Loading indicator is shown. Request either completes or shows a timeout error. No UI hang.',
      priority: 'medium',
      tags: ['edge', 'network', 'timeout', 'performance'],
    });

    // Back button / browser navigation
    if (ctx.hasNavigation) {
      caseNum++;
      cases.push({
        id: `edge-${caseNum}`,
        category: 'edge',
        title: 'Browser back button after form submission',
        description: 'Verify behavior when user clicks back after completing an action',
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Complete the main flow successfully' },
          { stepNumber: 2, action: 'Click browser back button' },
          { stepNumber: 3, action: 'Attempt to resubmit' },
        ],
        expectedResult: 'No duplicate submission. Either previous form state is shown or user is redirected appropriately.',
        priority: 'medium',
        tags: ['edge', 'navigation', 'browser-back'],
      });
    }

    return cases.slice(0, max);
  }

  // ---------------------------------------------------------------------------
  // Boundary value analysis
  // ---------------------------------------------------------------------------

  private generateBoundaryCases(_story: JiraStory, ctx: StoryContext, max: number): GeneratedTestCase[] {
    const cases: GeneratedTestCase[] = [];
    let caseNum = 0;

    // Numeric field boundaries
    if (ctx.hasNumeric) {
      const numericTests = [
        { value: '0', desc: 'zero value', priority: 'high' as const },
        { value: '-1', desc: 'negative value', priority: 'high' as const },
        { value: '0.01', desc: 'minimum positive decimal', priority: 'medium' as const },
        { value: '999999999', desc: 'very large number', priority: 'medium' as const },
        { value: '2147483647', desc: 'max 32-bit integer', priority: 'low' as const },
      ];

      for (const test of numericTests.slice(0, max)) {
        caseNum++;
        cases.push({
          id: `boundary-${caseNum}`,
          category: 'boundary',
          title: `Numeric field with ${test.desc} (${test.value})`,
          description: `Verify numeric field handles ${test.desc}`,
          preconditions: this.getDefaultPreconditions(ctx),
          steps: [
            { stepNumber: 1, action: 'Navigate to the form' },
            { stepNumber: 2, action: `Enter ${test.value} in the numeric field`, testData: test.value },
            { stepNumber: 3, action: 'Submit' },
          ],
          expectedResult: `System handles ${test.desc} correctly — either accepts or shows appropriate validation`,
          priority: test.priority,
          tags: ['boundary', 'numeric', test.desc.replace(/\s/g, '-')],
        });
      }
    }

    // Date boundaries
    if (ctx.hasDatetime && cases.length < max) {
      const dateBoundaries = [
        { value: '2000-01-01', desc: 'past date (Y2K)' },
        { value: '2099-12-31', desc: 'far future date' },
        { value: '1970-01-01', desc: 'Unix epoch' },
        { value: new Date().toISOString().split('T')[0], desc: 'today\'s date' },
      ];

      for (const db of dateBoundaries.slice(0, max - cases.length)) {
        caseNum++;
        cases.push({
          id: `boundary-${caseNum}`,
          category: 'boundary',
          title: `Date field with ${db.desc}`,
          description: `Verify date field handles ${db.desc}`,
          preconditions: this.getDefaultPreconditions(ctx),
          steps: [
            { stepNumber: 1, action: 'Navigate to the form' },
            { stepNumber: 2, action: `Enter date: ${db.value}`, testData: db.value },
            { stepNumber: 3, action: 'Submit' },
          ],
          expectedResult: `Date ${db.value} is handled correctly`,
          priority: 'medium',
          tags: ['boundary', 'date', db.desc.replace(/\s/g, '-')],
        });
      }
    }

    // String length boundaries
    if (ctx.inputFields.length > 0 && cases.length < max) {
      const lengthTests = [
        { length: 1, desc: 'single character' },
        { length: 255, desc: 'max common DB varchar length (255)' },
        { length: 256, desc: 'one beyond varchar limit (256)' },
      ];

      for (const lt of lengthTests.slice(0, max - cases.length)) {
        caseNum++;
        cases.push({
          id: `boundary-${caseNum}`,
          category: 'boundary',
          title: `Text field with ${lt.desc} (${lt.length} chars)`,
          description: `Verify text field at ${lt.length} character boundary`,
          preconditions: this.getDefaultPreconditions(ctx),
          steps: [
            { stepNumber: 1, action: 'Navigate to the form' },
            { stepNumber: 2, action: `Enter ${lt.length} characters`, testData: 'A'.repeat(Math.min(lt.length, 20)) + `... (${lt.length} total)` },
            { stepNumber: 3, action: 'Submit' },
          ],
          expectedResult: `Input of ${lt.length} characters is handled — accepted if within limit, rejected gracefully if over`,
          priority: 'medium',
          tags: ['boundary', 'string-length'],
        });
      }
    }

    // Pagination boundary
    if (ctx.hasDataDisplay && cases.length < max) {
      caseNum++;
      cases.push({
        id: `boundary-${caseNum}`,
        category: 'boundary',
        title: 'Pagination at exact page boundary',
        description: 'Verify pagination when total items equals page size exactly',
        preconditions: ['Data set has exactly N items where N = page size (e.g., 10, 20, 50)'],
        steps: [
          { stepNumber: 1, action: 'Navigate to the list/table view' },
          { stepNumber: 2, action: 'Observe pagination controls' },
          { stepNumber: 3, action: 'Click next page' },
        ],
        expectedResult: 'Pagination shows correct page count. No empty page shown. "Next" is disabled on last page.',
        priority: 'medium',
        tags: ['boundary', 'pagination'],
      });
    }

    return cases.slice(0, max);
  }

  // ---------------------------------------------------------------------------
  // Security test cases
  // ---------------------------------------------------------------------------

  private generateSecurityCases(
    _story: JiraStory,
    ctx: StoryContext,
    max: number,
    options: GenerationOptions
  ): GeneratedTestCase[] {
    const cases: GeneratedTestCase[] = [];
    let caseNum = 0;
    const thorough = options.securityDepth === 'thorough';

    // XSS in input fields
    if (ctx.inputFields.length > 0) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'XSS attack via text input',
        description: 'Verify the application sanitizes script injection in input fields',
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to the form' },
          { stepNumber: 2, action: 'Enter XSS payload in text field', testData: '<script>alert("XSS")</script>' },
          { stepNumber: 3, action: 'Submit the form' },
          { stepNumber: 4, action: 'View the saved/displayed data' },
        ],
        expectedResult: 'Script is NOT executed. Input is either rejected, escaped, or sanitized. No alert popup.',
        priority: 'critical',
        tags: ['security', 'xss', 'owasp-a7'],
      });

      if (thorough) {
        caseNum++;
        cases.push({
          id: `security-${caseNum}`,
          category: 'security',
          title: 'Stored XSS via attribute injection',
          description: 'Verify attribute-based XSS is prevented',
          preconditions: this.getDefaultPreconditions(ctx),
          steps: [
            { stepNumber: 1, action: 'Enter payload in text field', testData: '" onmouseover="alert(1)" x="' },
            { stepNumber: 2, action: 'Submit and view the data' },
          ],
          expectedResult: 'Payload is escaped. No event handlers injected into HTML attributes.',
          priority: 'high',
          tags: ['security', 'xss', 'stored-xss'],
        });
      }
    }

    // SQL injection
    if (ctx.hasSearch || ctx.hasForm) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'SQL injection via input field',
        description: 'Verify the application is protected against SQL injection',
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to search/form' },
          { stepNumber: 2, action: 'Enter SQL injection payload', testData: "' OR '1'='1'; DROP TABLE users; --" },
          { stepNumber: 3, action: 'Submit/search' },
        ],
        expectedResult: 'Query is parameterized. No data leak or DB manipulation. Error or no results returned.',
        priority: 'critical',
        tags: ['security', 'sql-injection', 'owasp-a3'],
      });
    }

    // Authentication bypass
    if (ctx.hasLogin) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'Access protected page without authentication',
        description: 'Verify unauthenticated users cannot access protected resources',
        preconditions: ['User is NOT logged in', 'Session/token is cleared'],
        steps: [
          { stepNumber: 1, action: 'Clear all cookies and local storage' },
          { stepNumber: 2, action: 'Navigate directly to a protected page URL' },
        ],
        expectedResult: 'User is redirected to login page. Protected content is NOT displayed.',
        priority: 'critical',
        tags: ['security', 'authentication', 'owasp-a2'],
      });
    }

    // CSRF
    if (ctx.hasForm && cases.length < max) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'CSRF protection on form submission',
        description: 'Verify CSRF tokens are validated on state-changing requests',
        preconditions: ['User is logged in'],
        steps: [
          { stepNumber: 1, action: 'Intercept form submission request' },
          { stepNumber: 2, action: 'Remove or modify CSRF token' },
          { stepNumber: 3, action: 'Replay the modified request' },
        ],
        expectedResult: 'Request is rejected with 403 or CSRF error. Action is not performed.',
        priority: 'high',
        tags: ['security', 'csrf', 'owasp-a5'],
      });
    }

    // File upload security
    if (ctx.hasUpload && cases.length < max) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'Upload malicious file type',
        description: 'Verify file upload rejects dangerous file types',
        preconditions: this.getDefaultPreconditions(ctx),
        steps: [
          { stepNumber: 1, action: 'Navigate to file upload' },
          { stepNumber: 2, action: 'Attempt to upload a .exe file renamed to .jpg' },
          { stepNumber: 3, action: 'Attempt to upload a .php file' },
          { stepNumber: 4, action: 'Attempt to upload a file exceeding size limit' },
        ],
        expectedResult: 'Malicious files are rejected. Only allowed MIME types accepted. Size limit enforced.',
        priority: 'critical',
        tags: ['security', 'file-upload', 'owasp-a8'],
      });
    }

    // Privilege escalation
    if (ctx.hasPermissions && cases.length < max) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'Horizontal privilege escalation (IDOR)',
        description: 'Verify users cannot access other users resources by manipulating IDs',
        preconditions: ['User A and User B both have accounts', 'User A is logged in'],
        steps: [
          { stepNumber: 1, action: 'Navigate to User A resource (e.g., /profile/123)' },
          { stepNumber: 2, action: 'Change ID in URL to User B resource (e.g., /profile/456)' },
          { stepNumber: 3, action: 'Attempt to view/edit User B data' },
        ],
        expectedResult: 'Access denied or 404. User A cannot see/modify User B data.',
        priority: 'critical',
        tags: ['security', 'idor', 'authorization', 'owasp-a1'],
      });
    }

    // Session security
    if (ctx.hasLogin && thorough && cases.length < max) {
      caseNum++;
      cases.push({
        id: `security-${caseNum}`,
        category: 'security',
        title: 'Session fixation and token exposure',
        description: 'Verify session tokens are regenerated after login and not exposed in URLs',
        preconditions: ['User account exists'],
        steps: [
          { stepNumber: 1, action: 'Note the session token before login' },
          { stepNumber: 2, action: 'Login with valid credentials' },
          { stepNumber: 3, action: 'Verify session token changed after login' },
          { stepNumber: 4, action: 'Check that token is not in any URL parameters' },
        ],
        expectedResult: 'Session token is regenerated after login. Token not visible in URL or logs.',
        priority: 'high',
        tags: ['security', 'session', 'owasp-a2'],
      });
    }

    return cases.slice(0, max);
  }

  // =========================================================================
  // Gherkin conversion
  // =========================================================================

  /**
   * Convert all generated test cases into a Gherkin feature file
   */
  convertToGherkin(
    story: JiraStory,
    allCases: Record<TestCaseCategory, GeneratedTestCase[]>
  ): string {
    const lines: string[] = [];

    // Feature header
    lines.push(`@${story.key.replace('-', '_')} @auto-generated`);
    lines.push(`Feature: ${story.summary}`);
    lines.push(`  As a user`);
    lines.push(`  I want to ${story.summary.toLowerCase()}`);
    lines.push(`  So that the acceptance criteria are met`);
    lines.push('');
    lines.push(`  # Story: ${story.key}`);
    lines.push(`  # Priority: ${story.priority}`);
    if (story.acceptanceCriteria.length > 0) {
      lines.push(`  # Acceptance Criteria:`);
      for (const ac of story.acceptanceCriteria) {
        lines.push(`  #   - ${ac}`);
      }
    }
    lines.push('');

    // Background (common preconditions)
    const commonPreconditions = this.findCommonPreconditions(allCases);
    if (commonPreconditions.length > 0) {
      lines.push('  Background:');
      for (const pre of commonPreconditions) {
        lines.push(`    Given ${this.rewriteStepForCucumber(pre, 'Given')}`);
      }
      lines.push('');
    }

    // Generate scenarios by category
    const categoryOrder: TestCaseCategory[] = ['positive', 'negative', 'edge', 'boundary', 'security'];

    for (const category of categoryOrder) {
      const cases = allCases[category] || [];
      if (cases.length === 0) continue;

      lines.push(`  # ============================================================`);
      lines.push(`  # ${category.toUpperCase()} TEST CASES`);
      lines.push(`  # ============================================================`);
      lines.push('');

      for (const tc of cases) {
        // Tags
        const tagLine = [`@${category}`, ...tc.tags.filter(t => t !== category).map(t => `@${t}`)];
        if (tc.priority === 'critical') tagLine.push('@critical');
        lines.push(`  ${tagLine.join(' ')}`);

        // Scenario or Scenario Outline
        if (tc.dataVariations && tc.dataVariations.length > 0) {
          lines.push(`  Scenario Outline: ${tc.title}`);
        } else {
          lines.push(`  Scenario: ${tc.title}`);
        }

        // Preconditions (Given) — rewrite to match built-in Cucumber step patterns
        const uniquePreconditions = tc.preconditions.filter(p => !commonPreconditions.includes(p));
        for (let i = 0; i < uniquePreconditions.length; i++) {
          const keyword = i === 0 ? 'Given' : 'And';
          const rewritten = this.rewriteStepForCucumber(uniquePreconditions[i], 'Given');
          lines.push(`    ${keyword} ${rewritten}`);
        }

        // Steps (When) — rewrite to match built-in Cucumber step patterns
        for (let i = 0; i < tc.steps.length; i++) {
          const step = tc.steps[i];
          const keyword = i === 0 ? 'When' : 'And';
          let stepText = this.rewriteStepForCucumber(step.action, keyword, step.testData);
          if (step.testData && tc.dataVariations && tc.dataVariations.length > 0) {
            stepText = stepText.replace(`"${step.testData}"`, `"<${this.toParameterName(step.action)}>"`);
          }
          lines.push(`    ${keyword} ${stepText}`);
        }

        // Expected result (Then) — rewrite to match built-in assertion patterns
        lines.push(`    Then ${this.rewriteStepForCucumber(tc.expectedResult, 'Then')}`);

        // Examples table for Scenario Outline
        if (tc.dataVariations && tc.dataVariations.length > 0) {
          lines.push('');
          const headers = Object.keys(tc.dataVariations[0]);
          lines.push(`    Examples:`);
          lines.push(`      | ${headers.join(' | ')} |`);
          for (const row of tc.dataVariations) {
            const values = headers.map(h => row[h] || '');
            lines.push(`      | ${values.join(' | ')} |`);
          }
        }

        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // =========================================================================
  // Step rewriting — convert natural language to Cucumber-matchable patterns
  // =========================================================================

  /**
   * Rewrite a step action/assertion to match built-in Cucumber step definitions.
   * The built-in steps use patterns like:
   *   Given I navigate to {string}
   *   When I click {string} / I fill {string} with {string}
   *   Then I should see {string} / the URL should contain {string}
   */
  private rewriteStepForCucumber(text: string, keyword: string, testData?: string): string {
    const lower = text.toLowerCase();

    // ── Given / setup steps ──
    if (keyword === 'Given' || keyword === 'And') {
      if (/navigate|go to|open|visit/i.test(lower)) {
        const target = this.extractTarget(text) || 'the page';
        return `I navigate to "${target}"`;
      }
      if (/launch|start.*app/i.test(lower)) {
        const target = this.extractTarget(text);
        return target ? `I navigate to "${target}"` : `the application is open`;
      }
      // "logged in with X credentials" or "logged in with X"
      if (/logged in.*with|log in.*with|sign in.*with/i.test(lower)) {
        const credMatch = text.match(/with\s+["']?(\w+)["']?/i);
        const credName = credMatch ? credMatch[1] : 'default';
        return `the user is logged in with "${credName}" credentials`;
      }
      if (/logged in|log in|sign in|authenticated/i.test(lower)) {
        return `the user is logged in`;
      }
      // "has item in cart" or similar setup — treat as logged in (login is prerequisite)
      if (/has.*item.*cart|has.*product.*cart|cart.*not.*empty/i.test(lower)) {
        return `the user is logged in`;
      }
      if (/empty.*cart/i.test(lower)) {
        return `the user is logged in`;
      }
      // User is on "url" — already matches built-in
      if (/^user is on\s+"/i.test(text) || /^the user is on\s+"/i.test(text)) {
        return text; // keep as-is, matches built-in
      }
      if (/on the.*page|on the application/i.test(lower)) {
        return text; // keep as-is, matches built-in
      }
    }

    // ── When / action steps ──
    if (keyword === 'When' || keyword === 'And') {
      // Navigate (check before click since "click" is very broad)
      if (/navigate|go to|open|visit/i.test(lower) && !/click/i.test(lower)) {
        const target = this.extractTarget(text) || 'the page';
        return `I navigate to "${target}"`;
      }
      // Click the "X" button/link/icon — preserve button/link specificity
      if (/click|press|tap/i.test(lower)) {
        const target = this.extractTarget(text) || this.extractQuotedOrLastWord(text);
        if (/button/i.test(lower)) return `I click the "${target}" button`;
        if (/link/i.test(lower)) return `I click the "${target}" link`;
        if (/icon/i.test(lower)) return `I click the "${target}" icon`;
        if (/cart\s*icon/i.test(lower)) return `I click the "cart" icon`;
        if (/hamburger|menu\s*icon/i.test(lower)) return `I click the "menu" icon`;
        return `I click "${target}"`;
      }
      // Fill/type actions with explicit testData
      if (/enter|fill|type|input|set/i.test(lower) && testData) {
        const field = this.extractFieldName(text);
        return `I enter "${testData}" in the "${field}" field`;
      }
      // Fill/type with value in text (e.g., Enter "standard_user" in the Username field)
      if (/enter|fill|type|input/i.test(lower)) {
        const field = this.extractFieldName(text);
        const value = this.extractQuotedContent(text) || this.extractTarget(text) || 'test value';
        return `I enter "${value}" in the "${field}" field`;
      }
      // Leave empty
      if (/leave.*empty|clear|empty/i.test(lower)) {
        const field = this.extractFieldName(text);
        return `I clear the "${field}" field`;
      }
      // Submit
      if (/submit/i.test(lower)) {
        return `I click the "Submit" button`;
      }
      if (/save/i.test(lower)) {
        return `I click the "Save" button`;
      }
      if (/confirm/i.test(lower)) {
        return `I click the "Confirm" button`;
      }
      // Select from dropdown
      if (/select|choose/i.test(lower)) {
        const option = this.extractQuotedContent(text) || this.extractTarget(text) || 'option';
        const field = this.extractFieldName(text) || 'dropdown';
        return `I select "${option}" from "${field}"`;
      }
      // Upload
      if (/upload|attach/i.test(lower)) {
        const file = testData || 'test-file.pdf';
        return `I attach the file "${file}"`;
      }
      // Wait
      if (/wait/i.test(lower)) {
        return `I wait for the page to load`;
      }
      // Scroll
      if (/scroll/i.test(lower)) {
        return `I scroll to the bottom`;
      }
      // Verify (sometimes "When Verify..." is used, treat as assertion)
      if (/verify|assert|check/i.test(lower)) {
        const message = this.extractQuotedContent(text) || this.extractMeaningfulPhrase(text);
        return `I should see "${message}"`;
      }
    }

    // ── Then / assertion steps ──
    if (keyword === 'Then') {
      // Error/message visibility
      if (/error|message|displayed|shown|visible|appear|see/i.test(lower)) {
        const message = this.extractQuotedContent(text) || this.extractMeaningfulPhrase(text);
        return `I should see "${message}"`;
      }
      // Redirect
      if (/redirect|url.*should|url.*contain/i.test(lower)) {
        const url = this.extractTarget(text) || '/expected-page';
        return `the URL should contain "${url}"`;
      }
      // Not visible / not displayed
      if (/not.*visible|not.*displayed|not.*shown|hidden|disappear/i.test(lower)) {
        const target = this.extractMeaningfulPhrase(text);
        return `I should not see "${target}"`;
      }
      // Disabled
      if (/disabled|cannot|denied|rejected|not.*allowed/i.test(lower)) {
        const message = this.extractMeaningfulPhrase(text);
        return `I should see "${message}"`;
      }
      // Generic assertion — wrap in "should see" for Cucumber matching
      const assertionText = this.extractMeaningfulPhrase(text);
      return `I should see "${assertionText}"`;
    }

    // Fallback: if the text already has quotes, keep it; otherwise wrap key part
    if (text.includes('"')) return text;
    return text;
  }

  private extractTarget(text: string): string | null {
    // Extract quoted content first
    const quoted = text.match(/"([^"]+)"/);
    if (quoted) return quoted[1];

    // Extract URL-like content
    const url = text.match(/(https?:\/\/\S+|\/\S+)/);
    if (url) return url[1];

    return null;
  }

  private extractFieldName(text: string): string {
    // Try to find field name from patterns like "in the X field", "the X field", "X field"
    const fieldMatch = text.match(/(?:the|in|into)\s+["']?(\w+)["']?\s+field/i)
      || text.match(/["'](\w+)["']\s+field/i)
      || text.match(/(?:enter|fill|type|input|set)\s+.*?(?:in|into|for)\s+["']?(\w+)["']?/i);
    if (fieldMatch) return fieldMatch[1];

    // Try extracting from "Leave the email field empty"
    const leaveMatch = text.match(/(?:leave|clear)\s+(?:the\s+)?["']?(\w+)["']?/i);
    if (leaveMatch) return leaveMatch[1];

    return 'input';
  }

  private extractQuotedContent(text: string): string | null {
    const match = text.match(/"([^"]+)"|'([^']+)'/);
    return match ? (match[1] || match[2]) : null;
  }

  private extractQuotedOrLastWord(text: string): string {
    const quoted = this.extractQuotedContent(text);
    if (quoted) return quoted;
    // Get the meaningful noun/phrase after the verb
    const words = text.replace(/^(click|press|tap|hit)\s+(the\s+|on\s+the\s+|on\s+)?/i, '').trim();
    return words.split(/\s+/).slice(0, 3).join(' ') || 'element';
  }

  private extractMeaningfulPhrase(text: string): string {
    // Remove common filler prefixes and return the core content
    let cleaned = text
      .replace(/^(verify|assert|expect|should|check|ensure|confirm|observe|notice)\s+(that\s+)?/i, '')
      .replace(/^(the\s+)?(system|page|user|application|form|it)\s+(should\s+|is\s+|will\s+|must\s+)?/i, '')
      .replace(/\.\s*$/, '')
      .trim();
    // Truncate to reasonable length for a Cucumber string parameter
    if (cleaned.length > 80) cleaned = cleaned.substring(0, 77) + '...';
    return cleaned || text.substring(0, 60);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private getDefaultPreconditions(ctx: StoryContext): string[] {
    const preconditions: string[] = [];
    if (ctx.hasLogin) preconditions.push('the user is logged in');
    preconditions.push('the user is on the application page');
    return preconditions;
  }

  private generateStepsFromAC(ac: string, ctx: StoryContext): TestCaseStep[] {
    const steps: TestCaseStep[] = [];
    let stepNum = 1;

    // Parse Given/When/Then from AC if present
    const givenMatch = ac.match(/given\s+(.+?)(?=\s+when\s+|\s+then\s+|$)/i);
    const whenMatch = ac.match(/when\s+(.+?)(?=\s+then\s+|$)/i);
    const thenMatch = ac.match(/then\s+(.+)/i);

    if (givenMatch) {
      steps.push({ stepNumber: stepNum++, action: givenMatch[1].trim() });
    }
    if (whenMatch) {
      steps.push({ stepNumber: stepNum++, action: whenMatch[1].trim() });
    } else {
      // Derive action from context
      if (ctx.actions.includes('navigate')) steps.push({ stepNumber: stepNum++, action: 'Navigate to the relevant page' });
      steps.push({ stepNumber: stepNum++, action: 'Perform the main action described in the story' });
    }
    if (thenMatch) {
      steps.push({ stepNumber: stepNum++, action: `Verify: ${thenMatch[1].trim()}` });
    }

    // Ensure at least one step
    if (steps.length === 0) {
      steps.push({ stepNumber: 1, action: ac });
    }

    return steps;
  }

  private generateStepsFromSummary(summary: string, ctx: StoryContext): TestCaseStep[] {
    const steps: TestCaseStep[] = [];
    let stepNum = 1;

    if (ctx.hasNavigation) steps.push({ stepNumber: stepNum++, action: 'Navigate to the relevant page' });
    if (ctx.hasForm) steps.push({ stepNumber: stepNum++, action: 'Fill in all required form fields with valid data' });
    if (ctx.hasSearch) steps.push({ stepNumber: stepNum++, action: 'Enter search criteria' });
    if (ctx.hasUpload) steps.push({ stepNumber: stepNum++, action: 'Upload a valid file' });
    steps.push({ stepNumber: stepNum++, action: `Perform: ${summary}` });
    steps.push({ stepNumber: stepNum++, action: 'Verify the expected outcome' });

    return steps;
  }

  private generateFormSubmitSteps(ctx: StoryContext, mode: 'valid' | 'invalid'): TestCaseStep[] {
    const steps: TestCaseStep[] = [];
    let stepNum = 1;

    steps.push({ stepNumber: stepNum++, action: 'Navigate to the form page' });

    for (const field of ctx.inputFields) {
      const data = mode === 'valid' ? this.getValidDataForField(field) : this.getInvalidDataForField(field);
      steps.push({ stepNumber: stepNum++, action: `Enter ${data} in the ${field} field`, testData: data });
    }

    steps.push({ stepNumber: stepNum++, action: 'Click Submit/Save button' });
    return steps;
  }

  private getValidDataForField(field: string): string {
    const validData: Record<string, string> = {
      email: 'testuser@example.com',
      password: 'SecurePass123!',
      username: 'testuser',
      phone: '+1-555-123-4567',
      name: 'John Doe',
      address: '123 Main St, City, State 12345',
      amount: '99.99',
      date: '2025-06-15',
      text: 'Sample test description text',
      url: 'https://example.com',
      file: 'test-document.pdf',
      select: 'Option A',
      checkbox: 'checked',
    };
    return validData[field] || 'test-value';
  }

  private getInvalidDataForField(field: string): string {
    const invalidData: Record<string, string> = {
      email: 'not-an-email',
      password: '123',
      username: '',
      phone: 'abc',
      name: '',
      amount: '-1',
      date: '99/99/9999',
      url: 'not-a-url',
    };
    return invalidData[field] || '';
  }

  private getValidDataVariations(ctx: StoryContext): Record<string, string>[] {
    const variations: Record<string, string>[] = [];

    if (ctx.inputFields.includes('email')) {
      variations.push({ email: 'user@example.com', expected: 'success' });
      variations.push({ email: 'user+tag@example.com', expected: 'success' });
      variations.push({ email: 'user@subdomain.example.co.uk', expected: 'success' });
    }

    return variations;
  }

  private findCommonPreconditions(allCases: Record<TestCaseCategory, GeneratedTestCase[]>): string[] {
    const allPreconditions = Object.values(allCases)
      .flat()
      .map(tc => tc.preconditions);

    if (allPreconditions.length === 0) return [];

    return allPreconditions[0].filter(pre =>
      allPreconditions.every(pres => pres.includes(pre))
    );
  }

  private truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.substring(0, maxLen - 3) + '...' : text;
  }

  private toParameterName(text: string): string {
    return text.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 30);
  }
}

// Context interface
interface StoryContext {
  hasLogin: boolean;
  hasForm: boolean;
  hasSearch: boolean;
  hasUpload: boolean;
  hasPayment: boolean;
  hasNavigation: boolean;
  hasDataDisplay: boolean;
  hasCRUD: boolean;
  hasAPI: boolean;
  hasPermissions: boolean;
  hasNotification: boolean;
  hasDatetime: boolean;
  hasNumeric: boolean;
  inputFields: string[];
  actions: string[];
}

export const testCaseGenerator = new TestCaseGeneratorService();
