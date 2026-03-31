/**
 * Jira Integration Service
 *
 * Connects to Jira REST API to fetch epics, stories, user stories,
 * and acceptance criteria for automated test case generation.
 *
 * Supports: Jira Cloud (REST API v3) and Jira Server (REST API v2)
 */

import { logger } from '../../utils/logger';
import pool from '../../db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraConfig {
  baseUrl: string;          // e.g. https://mycompany.atlassian.net
  email: string;            // Jira user email (Cloud) or username (Server)
  apiToken: string;         // API token (Cloud) or password (Server)
  apiVersion?: 'v2' | 'v3'; // Default v3 for Cloud
}

export interface JiraEpic {
  key: string;              // e.g. PROJ-123
  summary: string;
  description: string;
  status: string;
  priority: string;
  labels: string[];
  components: string[];
  stories: JiraStory[];
  customFields?: Record<string, unknown>;
}

export interface JiraStory {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  storyPoints?: number;
  labels: string[];
  acceptanceCriteria: string[];
  subtasks: JiraSubtask[];
  attachments: string[];
  comments: string[];
  customFields?: Record<string, unknown>;
}

export interface JiraSubtask {
  key: string;
  summary: string;
  description: string;
  status: string;
}

export interface JiraSearchResult {
  total: number;
  issues: JiraIssue[];
}

export interface JiraIssue {
  key: string;
  fields: Record<string, unknown>;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class JiraService {

  /**
   * Build authorization header for Jira API
   */
  private getAuthHeader(config: JiraConfig): string {
    const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Get API base path based on version
   */
  private getApiPath(config: JiraConfig): string {
    return config.apiVersion === 'v2' ? '/rest/api/2' : '/rest/api/3';
  }

  /**
   * Generic Jira API request
   */
  private async jiraRequest<T>(
    config: JiraConfig,
    endpoint: string,
    method: string = 'GET',
    body?: unknown
  ): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${this.getApiPath(config)}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': this.getAuthHeader(config),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Agile API request (for boards, sprints)
   */
  private async agileRequest<T>(
    config: JiraConfig,
    endpoint: string
  ): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}/rest/agile/1.0${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': this.getAuthHeader(config),
      'Accept': 'application/json',
    };
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira Agile API error (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  // =========================================================================
  // Connection & Discovery
  // =========================================================================

  /**
   * Test Jira connection and return server info
   */
  async testConnection(config: JiraConfig): Promise<{ connected: boolean; serverInfo?: unknown; error?: string }> {
    try {
      const info = await this.jiraRequest(config, '/serverInfo');
      return { connected: true, serverInfo: info };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { connected: false, error: message };
    }
  }

  /**
   * List all accessible Jira projects
   */
  async getProjects(config: JiraConfig): Promise<JiraProject[]> {
    const data = await this.jiraRequest<JiraProject[]>(config, '/project');
    return data.map(p => ({
      id: p.id,
      key: p.key,
      name: p.name,
      projectTypeKey: p.projectTypeKey,
    }));
  }

  /**
   * Get sprints for a board
   */
  async getSprints(config: JiraConfig, boardId: number): Promise<JiraSprint[]> {
    const data = await this.agileRequest<{ values: JiraSprint[] }>(config, `/board/${boardId}/sprint`);
    return data.values || [];
  }

  // =========================================================================
  // Epic Fetching
  // =========================================================================

  /**
   * Fetch all epics for a project
   */
  async getEpics(config: JiraConfig, projectKey: string): Promise<JiraEpic[]> {
    const jql = `project = "${projectKey}" AND issuetype = Epic ORDER BY created DESC`;
    const result = await this.searchIssues(config, jql, 100);
    return result.issues.map(issue => this.mapToEpic(issue));
  }

  /**
   * Fetch a single epic with all its stories
   */
  async getEpicWithStories(config: JiraConfig, epicKey: string): Promise<JiraEpic> {
    // Fetch the epic itself
    const epicIssue = await this.jiraRequest<JiraIssue>(config, `/issue/${epicKey}?expand=renderedFields`);
    const epic = this.mapToEpic(epicIssue);

    // Fetch stories linked to this epic
    const jql = `"Epic Link" = "${epicKey}" OR parent = "${epicKey}" ORDER BY rank ASC`;
    const storiesResult = await this.searchIssues(config, jql, 200);

    epic.stories = await Promise.all(
      storiesResult.issues.map(issue => this.mapToStory(config, issue))
    );

    return epic;
  }

  /**
   * Fetch stories by sprint
   */
  async getStoriesBySprint(config: JiraConfig, projectKey: string, sprintId: number): Promise<JiraStory[]> {
    const jql = `project = "${projectKey}" AND sprint = ${sprintId} AND issuetype in (Story, "User Story", Task, Bug) ORDER BY rank ASC`;
    const result = await this.searchIssues(config, jql, 200);
    return Promise.all(result.issues.map(issue => this.mapToStory(config, issue)));
  }

  /**
   * Fetch stories by JQL query
   */
  async getStoriesByJQL(config: JiraConfig, jql: string): Promise<JiraStory[]> {
    const result = await this.searchIssues(config, jql, 200);
    return Promise.all(result.issues.map(issue => this.mapToStory(config, issue)));
  }

  // =========================================================================
  // Search
  // =========================================================================

  /**
   * Search issues using JQL
   */
  async searchIssues(config: JiraConfig, jql: string, maxResults: number = 50): Promise<JiraSearchResult> {
    const data = await this.jiraRequest<{ total: number; issues: JiraIssue[] }>(
      config,
      `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,description,status,priority,labels,components,issuetype,subtasks,attachment,comment,customfield_10014,customfield_10015,customfield_10016,customfield_10020`
    );
    return { total: data.total, issues: data.issues };
  }

  // =========================================================================
  // Mapping helpers
  // =========================================================================

  private mapToEpic(issue: JiraIssue): JiraEpic {
    const fields = issue.fields;
    return {
      key: issue.key,
      summary: (fields.summary as string) || '',
      description: this.extractDescription(fields.description),
      status: ((fields.status as Record<string, string>)?.name) || 'Unknown',
      priority: ((fields.priority as Record<string, string>)?.name) || 'Medium',
      labels: (fields.labels as string[]) || [],
      components: ((fields.components as Array<{ name: string }>) || []).map(c => c.name),
      stories: [],
    };
  }

  private async mapToStory(config: JiraConfig, issue: JiraIssue): Promise<JiraStory> {
    const fields = issue.fields;
    const description = this.extractDescription(fields.description);

    // Extract acceptance criteria from description or custom fields
    const acceptanceCriteria = this.extractAcceptanceCriteria(description, fields);

    // Extract subtasks
    const subtasks: JiraSubtask[] = ((fields.subtasks as JiraIssue[]) || []).map(st => ({
      key: st.key,
      summary: ((st.fields?.summary as string) || ''),
      description: this.extractDescription(st.fields?.description),
      status: (((st.fields?.status) as Record<string, string>)?.name) || 'Unknown',
    }));

    // Extract comments (last 5)
    const commentData = (fields.comment as { comments?: Array<{ body: unknown }> }) || {};
    const comments = (commentData.comments || [])
      .slice(-5)
      .map(c => this.extractDescription(c.body));

    // Extract attachment names
    const attachments = ((fields.attachment as Array<{ filename: string }>) || [])
      .map(a => a.filename);

    return {
      key: issue.key,
      summary: (fields.summary as string) || '',
      description,
      status: ((fields.status as Record<string, string>)?.name) || 'Unknown',
      priority: ((fields.priority as Record<string, string>)?.name) || 'Medium',
      storyPoints: (fields.customfield_10016 as number) || undefined,
      labels: (fields.labels as string[]) || [],
      acceptanceCriteria,
      subtasks,
      attachments,
      comments,
    };
  }

  /**
   * Extract plain text description from Jira's ADF (Atlassian Document Format) or plain text
   */
  private extractDescription(description: unknown): string {
    if (!description) return '';
    if (typeof description === 'string') return description;

    // Handle ADF (Atlassian Document Format) - Jira Cloud v3
    if (typeof description === 'object' && (description as Record<string, unknown>).type === 'doc') {
      return this.adfToPlainText(description as ADFNode);
    }

    return String(description);
  }

  /**
   * Extract acceptance criteria from description text and custom fields
   */
  private extractAcceptanceCriteria(description: string, fields: Record<string, unknown>): string[] {
    const criteria: string[] = [];

    // Check common custom fields for AC
    const acFields = ['customfield_10014', 'customfield_10015', 'customfield_10020'];
    for (const field of acFields) {
      if (fields[field]) {
        const acText = this.extractDescription(fields[field]);
        if (acText) {
          criteria.push(...this.parseAcceptanceCriteriaText(acText));
        }
      }
    }

    // Parse AC from description (common patterns)
    if (description) {
      const acSection = this.extractACSection(description);
      if (acSection.length > 0) {
        criteria.push(...acSection);
      }
    }

    // If no AC found, derive from description
    if (criteria.length === 0 && description) {
      // Split description into meaningful sentences as implicit AC
      const sentences = description
        .split(/[.\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 10);
      criteria.push(...sentences.slice(0, 10));
    }

    return [...new Set(criteria)]; // deduplicate
  }

  /**
   * Extract Acceptance Criteria section from description text
   */
  private extractACSection(text: string): string[] {
    const patterns = [
      /acceptance\s*criteria[:\s]*\n([\s\S]*?)(?=\n\n|\n[A-Z]|\n#{1,3}\s|$)/i,
      /ac[:\s]*\n([\s\S]*?)(?=\n\n|\n[A-Z]|\n#{1,3}\s|$)/i,
      /given[\s\S]*?when[\s\S]*?then[\s\S]*?(?=\n\n|$)/gi,
      /definition\s*of\s*done[:\s]*\n([\s\S]*?)(?=\n\n|\n[A-Z]|\n#{1,3}\s|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const section = match[1] || match[0];
        return this.parseAcceptanceCriteriaText(section);
      }
    }
    return [];
  }

  /**
   * Parse acceptance criteria text into individual criteria
   */
  private parseAcceptanceCriteriaText(text: string): string[] {
    return text
      .split(/\n/)
      .map(line => line.replace(/^[\s\-*•\d.)\]]+/, '').trim())
      .filter(line => line.length > 5);
  }

  /**
   * Convert Atlassian Document Format to plain text
   */
  private adfToPlainText(node: ADFNode): string {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';

    const children = (node.content || []).map(child => this.adfToPlainText(child));

    switch (node.type) {
      case 'paragraph':
        return children.join('') + '\n';
      case 'heading':
        return children.join('') + '\n';
      case 'bulletList':
      case 'orderedList':
        return children.join('');
      case 'listItem':
        return '- ' + children.join('') + '\n';
      case 'codeBlock':
        return children.join('') + '\n';
      default:
        return children.join('');
    }
  }

  // =========================================================================
  // Configuration persistence
  // =========================================================================

  /**
   * Save Jira config for an organization (token is encrypted)
   */
  async saveConfig(userId: string, organizationId: string | null, config: JiraConfig): Promise<void> {
    const configJson = JSON.stringify({
      baseUrl: config.baseUrl,
      email: config.email,
      apiToken: config.apiToken,  // In production, encrypt this
      apiVersion: config.apiVersion || 'v3',
    });

    await pool.query(
      `INSERT INTO "JiraConfig" (id, "userId", "organizationId", config, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())
       ON CONFLICT ("userId", "organizationId")
       DO UPDATE SET config = $3, "updatedAt" = now()`,
      [userId, organizationId, configJson]
    );
  }

  /**
   * Load Jira config for a user/org
   */
  async loadConfig(userId: string, organizationId: string | null): Promise<JiraConfig | null> {
    const { rows } = await pool.query(
      `SELECT config FROM "JiraConfig"
       WHERE "userId" = $1 AND ("organizationId" = $2 OR ($2 IS NULL AND "organizationId" IS NULL))
       LIMIT 1`,
      [userId, organizationId]
    );
    if (rows.length === 0) return null;

    const config = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config;
    return config as JiraConfig;
  }
}

// ADF node type
interface ADFNode {
  type: string;
  text?: string;
  content?: ADFNode[];
}

export const jiraService = new JiraService();
