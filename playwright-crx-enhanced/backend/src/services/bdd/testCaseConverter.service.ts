/**
 * Converts plain test cases (text, CSV, structured) into Gherkin feature files.
 *
 * Supported input formats:
 *  - Structured  : sections labelled "Test Case:", "Preconditions:", "Steps:", "Expected Result:"
 *  - CSV         : comma- or pipe-delimited rows with header row detection
 *  - Numbered    : "1. Do something" / "Step 1: Do something"
 *  - Plain text  : free-form natural language sentences / bullet list
 */

export interface ConvertedGherkin {
  gherkin: string;
  scenarioCount: number;
  warnings: string[];
}

interface RawTestCase {
  name: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
}

// ---------------------------------------------------------------------------
// Keyword lists used for step classification
// ---------------------------------------------------------------------------
const GIVEN_KEYWORDS = [
  'given', 'assuming', 'precondition', 'setup', 'starting', 'background',
  'user is logged', 'user has', 'user is on', 'browser is open',
  'application is', 'system is', 'database has', 'user navigates to',
  'logged in', 'authenticated', 'authorized',
];

const WHEN_KEYWORDS = [
  'when', 'click', 'press', 'select', 'choose', 'enter', 'type', 'fill',
  'submit', 'upload', 'drag', 'drop', 'hover', 'scroll', 'navigate',
  'go to', 'open', 'visit', 'input', 'search', 'tap', 'swipe',
  'set', 'check', 'uncheck', 'toggle',
];

const THEN_KEYWORDS = [
  'then', 'verify', 'assert', 'expect', 'should', 'see', 'visible',
  'displayed', 'shown', 'contains', 'shows', 'validates', 'confirm',
  'ensure', 'observe', 'notice', 'user sees', 'page shows',
  'redirected', 'url should', 'is shown', 'is displayed', 'is visible',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export class TestCaseConverterService {
  convert(input: string, filename?: string): ConvertedGherkin {
    const format = this.detectFormat(input, filename);
    let rawCases: RawTestCase[] = [];

    switch (format) {
      case 'csv':
        rawCases = this.parseCSV(input);
        break;
      case 'structured':
        rawCases = this.parseStructured(input);
        break;
      default:
        rawCases = this.parsePlainText(input);
    }

    if (rawCases.length === 0) {
      rawCases = this.parsePlainText(input);
    }

    const warnings: string[] = [];
    const featureName = rawCases[0]?.name || 'Converted Feature';
    const lines: string[] = [];

    lines.push(`Feature: ${featureName}`);
    lines.push(`  # Auto-converted from ${format} format`);
    lines.push('');

    for (let i = 0; i < rawCases.length; i++) {
      const tc = rawCases[i];
      const scenarioName = rawCases.length === 1 ? tc.name : (tc.name || `Scenario ${i + 1}`);
      lines.push(`  Scenario: ${scenarioName}`);

      // Preconditions → Given
      for (const pre of tc.preconditions) {
        const cleaned = this.cleanStep(pre);
        if (cleaned) lines.push(`    Given ${cleaned}`);
      }

      // Steps → Given / When / Then
      let lastKeyword = tc.preconditions.length > 0 ? 'Given' : '';
      for (const step of tc.steps) {
        const cleaned = this.cleanStep(step);
        if (!cleaned) continue;
        const classified = this.classifyStep(cleaned);
        const keyword = this.chooseKeyword(classified, lastKeyword);
        lastKeyword = classified !== 'And' ? classified : lastKeyword;
        lines.push(`    ${keyword} ${cleaned}`);
      }

      // Expected results → Then
      for (const exp of tc.expectedResults) {
        const cleaned = this.cleanStep(exp);
        if (!cleaned) continue;
        const keyword = lastKeyword === 'Then' ? 'And' : 'Then';
        lastKeyword = 'Then';
        lines.push(`    ${keyword} ${cleaned}`);
      }

      if (tc.steps.length === 0 && tc.expectedResults.length === 0) {
        warnings.push(`Scenario "${scenarioName}" has no steps — placeholder added`);
        lines.push(`    # TODO: Add steps for this scenario`);
      }

      lines.push('');
    }

    return {
      gherkin: lines.join('\n'),
      scenarioCount: rawCases.length,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Format detection
  // ---------------------------------------------------------------------------
  private detectFormat(input: string, filename?: string): 'csv' | 'structured' | 'plain' {
    if (filename && (filename.endsWith('.csv') || filename.endsWith('.tsv'))) return 'csv';

    const lines = input.split('\n').filter(l => l.trim());

    // CSV: majority of lines have commas or pipes
    const delimitedCount = lines.filter(l => l.includes(',') || l.includes('|')).length;
    if (delimitedCount > lines.length * 0.5 && lines.length > 1) return 'csv';

    // Structured: has labelled sections
    const structuredPattern = /^(test case|test id|precondition|steps?|expected|description|scenario)[\s:]/im;
    if (structuredPattern.test(input)) return 'structured';

    return 'plain';
  }

  // ---------------------------------------------------------------------------
  // CSV parser (RFC 4180 compliant — handles quoted fields with embedded
  // newlines and escaped double-quotes "")
  // ---------------------------------------------------------------------------
  private parseCSV(input: string): RawTestCase[] {
    const rows = this.parseCSVRows(input);
    if (rows.length < 2) return this.parsePlainText(input);

    const header = rows[0].map(h => h.toLowerCase().trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim().length > 0));

    // Map column indices
    const nameIdx = this.findColIdx(header, ['test case', 'test name', 'name', 'title', 'scenario', 'id']);
    const stepIdx = this.findColIdx(header, ['steps', 'step', 'action', 'actions', 'description']);
    const preIdx = this.findColIdx(header, ['precondition', 'preconditions', 'given', 'setup']);
    const expIdx = this.findColIdx(header, ['expected', 'expected result', 'result', 'then', 'outcome']);

    // If no header detected, treat first col as name, second as steps, third as expected
    const hasHeader = nameIdx !== -1 || stepIdx !== -1 || expIdx !== -1;

    if (!hasHeader) {
      return dataRows.map(row => ({
        name: row[0]?.trim() || 'Test Case',
        preconditions: [],
        steps: row[1] ? this.splitSteps(row[1]) : [],
        expectedResults: row[2] ? this.splitSteps(row[2]) : [],
      }));
    }

    return dataRows.map(row => ({
      name: nameIdx !== -1 ? (row[nameIdx]?.trim() || 'Test Case') : 'Test Case',
      preconditions: preIdx !== -1 ? this.splitSteps(row[preIdx] || '') : [],
      steps: stepIdx !== -1 ? this.splitSteps(row[stepIdx] || '') : [],
      expectedResults: expIdx !== -1 ? this.splitSteps(row[expIdx] || '') : [],
    })).filter(tc => tc.name || tc.steps.length > 0);
  }

  /**
   * Parse CSV text into rows of string arrays, correctly handling:
   *  - Quoted fields with embedded newlines
   *  - Escaped double-quotes ("" → ")
   *  - Tab/pipe delimiters
   */
  private parseCSVRows(input: string): string[][] {
    const firstLine = input.split('\n')[0] || '';
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : ',';

    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < input.length) {
      const ch = input[i];

      if (inQuotes) {
        if (ch === '"') {
          // Check for escaped quote ""
          if (i + 1 < input.length && input[i + 1] === '"') {
            currentField += '"';
            i += 2;
            continue;
          }
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
        currentField += ch;
        i++;
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
          i++;
        } else if (ch === '\r') {
          // Skip \r, handle \n next
          i++;
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          if (currentRow.some(c => c.trim().length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          i++;
        } else {
          currentField += ch;
          i++;
        }
      }
    }

    // Flush last field/row
    currentRow.push(currentField);
    if (currentRow.some(c => c.trim().length > 0)) {
      rows.push(currentRow);
    }

    return rows;
  }

  private findColIdx(header: string[], candidates: string[]): number {
    for (const c of candidates) {
      const idx = header.findIndex(h => h.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Structured text parser
  // ---------------------------------------------------------------------------
  private parseStructured(input: string): RawTestCase[] {
    const cases: RawTestCase[] = [];

    // Split on test case boundaries
    const testCaseBlocks = input.split(/(?=^(?:test case|test id|tc[\s\-#]|\d+\.\s+test))/im).filter(b => b.trim());
    const blocks = testCaseBlocks.length > 1 ? testCaseBlocks : [input];

    for (const block of blocks) {
      const tc: RawTestCase = { name: '', preconditions: [], steps: [], expectedResults: [] };

      let currentSection: 'name' | 'pre' | 'steps' | 'expected' | 'none' = 'none';

      for (const rawLine of block.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;

        if (/^(test case|test name|title|scenario|tc[\s#:\-])[\s:]*/i.test(line)) {
          tc.name = line.replace(/^(test case|test name|title|scenario|tc[\s#:\-][\d]*)\s*[:\-]?\s*/i, '').trim();
          currentSection = 'name';
          continue;
        }
        if (/^(preconditions?|given|setup|prerequisites?)\s*[:\-]?\s*/i.test(line)) {
          currentSection = 'pre';
          const rest = line.replace(/^(preconditions?|given|setup|prerequisites?)\s*[:\-]?\s*/i, '').trim();
          if (rest) tc.preconditions.push(...this.splitSteps(rest));
          continue;
        }
        if (/^(steps?|actions?|test steps?|when)\s*[:\-]?\s*/i.test(line)) {
          currentSection = 'steps';
          const rest = line.replace(/^(steps?|actions?|test steps?|when)\s*[:\-]?\s*/i, '').trim();
          if (rest) tc.steps.push(...this.splitSteps(rest));
          continue;
        }
        if (/^(expected\s*(results?)?|then|outcome|verification)\s*[:\-]?\s*/i.test(line)) {
          currentSection = 'expected';
          const rest = line.replace(/^(expected\s*(results?)?|then|outcome|verification)\s*[:\-]?\s*/i, '').trim();
          if (rest) tc.expectedResults.push(...this.splitSteps(rest));
          continue;
        }

        // Strip leading step numbers / bullets
        const stripped = line.replace(/^[\d]+[\.\)]\s*|^[-*•]\s*|^step\s+\d+[:\s]+/i, '');
        if (!stripped) continue;

        switch (currentSection) {
          case 'pre':     tc.preconditions.push(stripped); break;
          case 'steps':   tc.steps.push(stripped); break;
          case 'expected': tc.expectedResults.push(stripped); break;
          default:
            if (!tc.name) tc.name = stripped;
            else tc.steps.push(stripped);
        }
      }

      if (tc.name || tc.steps.length > 0) cases.push(tc);
    }

    return cases;
  }

  // ---------------------------------------------------------------------------
  // Plain text / numbered list parser
  // ---------------------------------------------------------------------------
  private parsePlainText(input: string): RawTestCase[] {
    const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Try to detect multiple test cases separated by blank lines or numbering
    const tc: RawTestCase = { name: '', preconditions: [], steps: [], expectedResults: [] };

    for (const line of lines) {
      // Strip step number/bullet
      const stripped = line.replace(/^[\d]+[\.\)]\s*|^[-*•]\s*|^step\s+\d+[:\s]+/i, '').trim();
      if (!stripped) continue;

      if (!tc.name) {
        // First meaningful line → use as name
        tc.name = stripped;
        continue;
      }

      const lower = stripped.toLowerCase();
      if (THEN_KEYWORDS.some(k => lower.startsWith(k) || lower.includes(k))) {
        tc.expectedResults.push(stripped);
      } else {
        tc.steps.push(stripped);
      }
    }

    return tc.name || tc.steps.length > 0 ? [tc] : [];
  }

  // ---------------------------------------------------------------------------
  // Step helpers
  // ---------------------------------------------------------------------------
  private splitSteps(text: string): string[] {
    if (!text) return [];
    // Split on newline, semicolon, numbered patterns (with or without leading period/space)
    // Handles: "1. step", "1) step", ".1. step", "sentence.2. next step"
    return text
      .split(/[\n;]|(?:^|[.\s])\d+[\.\)]\s*(?=[A-Z])|,\s+(?=[A-Z])/)
      .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(s => s.length > 0);
  }

  private cleanStep(step: string): string {
    let cleaned = step
      .replace(/^(given|when|then|and|but)\s+/i, '')
      .replace(/^[\d]+[\.\)]\s*|^[-*•]\s*/i, '')
      .trim();

    // Wrap bare URLs in quotes so Cucumber treats them as {string} parameters
    // (unquoted URLs contain / which Cucumber interprets as alternation syntax)
    cleaned = cleaned.replace(/(?<!")https?:\/\/\S+/g, '"$&"');

    return cleaned;
  }

  private classifyStep(step: string): 'Given' | 'When' | 'Then' | 'And' {
    const lower = step.toLowerCase();

    // Check Given first (state/precondition), then action (When), then assertion (Then)
    if (GIVEN_KEYWORDS.some(k => lower.startsWith(k) || lower.includes(k))) return 'Given';
    if (WHEN_KEYWORDS.some(k => lower.startsWith(k) || lower.includes(k))) return 'When';
    if (THEN_KEYWORDS.some(k => lower.startsWith(k) || lower.includes(k))) return 'Then';

    return 'And';
  }

  private chooseKeyword(classified: 'Given' | 'When' | 'Then' | 'And', lastKeyword: string): string {
    if (classified === 'And') {
      return lastKeyword ? 'And' : 'Given';
    }
    return classified;
  }
}

export const testCaseConverter = new TestCaseConverterService();
