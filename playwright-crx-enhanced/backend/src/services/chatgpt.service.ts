/**
 * ChatGPT-Powered Test Data Generation Service
 *
 * Scans Playwright script code, understands context (app type, form fields,
 * assertions, URL), and generates intelligent, context-aware test data
 * using OpenAI GPT-4o.
 *
 * Fallback chain: ChatGPT → External Genie API → Local rule-based
 */

import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedField {
  name: string;
  type: string;
  selector: string;
  selectorType: 'css' | 'placeholder' | 'label' | 'role' | 'text' | 'testid';
  action: 'fill' | 'click' | 'select' | 'check' | 'assert';
  context: string; // the line of code
}

export interface ScriptContext {
  url: string;
  appType: string; // login, signup, checkout, search, form, etc.
  fields: ExtractedField[];
  assertions: string[];
  flowDescription: string;
}

export interface GeneratedTestDataRow {
  _testDataType: string;
  _index: number;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Script Context Extraction
// ---------------------------------------------------------------------------

/**
 * Deep-scan a Playwright script to extract context: URL, fields, assertions, app type.
 */
export function extractScriptContext(scriptCode: string): ScriptContext {
  const lines = scriptCode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('import'));
  const fields: ExtractedField[] = [];
  const assertions: string[] = [];
  const seen = new Set<string>();
  let url = '';

  // Extract URL
  for (const line of lines) {
    const gotoMatch = line.match(/page\.goto\(['"]([^'"]+)['"]/);
    if (gotoMatch) { url = gotoMatch[1]; break; }
    const baseUrlMatch = line.match(/(?:const|let|var)\s+BASE_URL\s*=\s*.*?['"]([^'"]+)['"]/);
    if (baseUrlMatch && !url) url = baseUrlMatch[1];
  }

  // Extract fields from all Playwright locator patterns
  const patterns: Array<{ regex: RegExp; selectorType: ExtractedField['selectorType']; nameGroup: number }> = [
    { regex: /page\.fill\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/g, selectorType: 'css', nameGroup: 1 },
    { regex: /page\.click\(['"]([^'"]+)['"]\)/g, selectorType: 'css', nameGroup: 1 },
    { regex: /getByPlaceholder\(['"]([^'"]+)['"]\)/g, selectorType: 'placeholder', nameGroup: 1 },
    { regex: /getByLabel\(['"]([^'"]+)['"]\)/g, selectorType: 'label', nameGroup: 1 },
    { regex: /getByRole\(['"][^'"]+['"],\s*\{\s*name:\s*['"]([^'"]+)['"]/g, selectorType: 'role', nameGroup: 1 },
    { regex: /getByTestId\(['"]([^'"]+)['"]\)/g, selectorType: 'testid', nameGroup: 1 },
    { regex: /getByText\(['"]([^'"]+)['"]\)/g, selectorType: 'text', nameGroup: 1 },
    { regex: /locator\(['"]([^'"]+)['"]\)/g, selectorType: 'css', nameGroup: 1 },
  ];

  for (const line of lines) {
    for (const { regex, selectorType, nameGroup } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        const rawName = match[nameGroup];
        const cleanName = rawName.replace(/[#.\[\]>~+:]/g, '').replace(/-/g, '_').trim();
        if (!cleanName || seen.has(cleanName.toLowerCase())) continue;
        seen.add(cleanName.toLowerCase());

        // Determine action
        let action: ExtractedField['action'] = 'fill';
        if (line.includes('.click(')) action = 'click';
        else if (line.includes('.selectOption(')) action = 'select';
        else if (line.includes('.check(')) action = 'check';
        else if (line.includes('expect(') || line.includes('waitForSelector') || line.includes('toBeVisible')) action = 'assert';

        // Skip assertion-only fields and click-only buttons
        if (action === 'assert') {
          assertions.push(rawName);
          continue;
        }
        if (action === 'click') continue; // buttons aren't test data

        fields.push({
          name: cleanName,
          type: inferFieldType(cleanName),
          selector: rawName,
          selectorType,
          action,
          context: line.substring(0, 120),
        });
      }
    }

    // Extract assertions
    if (line.includes('expect(') || line.includes('waitForSelector')) {
      const textMatch = line.match(/(?:getByText|text=|toHaveText|toContainText)\(?['"]([^'"]+)['"]/);
      if (textMatch && !assertions.includes(textMatch[1])) assertions.push(textMatch[1]);
    }
  }

  // Also extract {{placeholder}} fields
  for (const line of lines) {
    const placeholderMatches = line.matchAll(/\{\{(\w+)\}\}/g);
    for (const m of placeholderMatches) {
      const name = m[1];
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        fields.push({
          name,
          type: inferFieldType(name),
          selector: `{{${name}}}`,
          selectorType: 'css',
          action: 'fill',
          context: line.substring(0, 120),
        });
      }
    }
  }

  const appType = detectAppType(url, fields, assertions);
  const flowDescription = buildFlowDescription(appType, fields, assertions, url);

  return { url, appType, fields, assertions, flowDescription };
}

function inferFieldType(name: string): string {
  const n = name.toLowerCase().replace(/[_-]/g, '');
  if (n.includes('email') || n.includes('mail')) return 'email';
  if (n.includes('password') || n.includes('passwd') || n.includes('pwd')) return 'password';
  if (n.includes('phone') || n.includes('mobile') || n.includes('tel')) return 'phone';
  if (n.includes('age')) return 'age';
  if (n.includes('amount') || n.includes('price') || n.includes('cost') || n.includes('salary')) return 'currency';
  if (n.includes('date') || n.includes('dob') || n.includes('birthday')) return 'date';
  if (n.includes('url') || n.includes('website') || n.includes('link')) return 'url';
  if (n.includes('zip') || n.includes('postal') || n.includes('pincode')) return 'zipcode';
  if (n.includes('card') || n.includes('credit') || n.includes('ccn')) return 'creditcard';
  if (n.includes('cvv') || n.includes('cvc')) return 'cvv';
  if (n.includes('expir')) return 'expiry';
  if (n.includes('address') || n.includes('street')) return 'address';
  if (n.includes('city')) return 'city';
  if (n.includes('state') || n.includes('province')) return 'state';
  if (n.includes('country')) return 'country';
  if (n.includes('first') && n.includes('name')) return 'firstname';
  if (n.includes('last') && n.includes('name')) return 'lastname';
  if (n.includes('user') || n.includes('login') || n.includes('username')) return 'username';
  if (n.includes('name')) return 'name';
  if (n.includes('search') || n.includes('query') || n.includes('keyword')) return 'search';
  if (n.includes('comment') || n.includes('message') || n.includes('description') || n.includes('note')) return 'text';
  if (n.includes('quantity') || n.includes('qty') || n.includes('count') || n.includes('number')) return 'number';
  return 'text';
}

function detectAppType(_url: string, fields: ExtractedField[], assertions: string[]): string {
  const fieldNames = fields.map(f => f.name.toLowerCase()).join(' ');
  const assertionText = assertions.join(' ').toLowerCase();

  if (fieldNames.includes('user') && fieldNames.includes('password') && !fieldNames.includes('confirm')) return 'login';
  if (fieldNames.includes('email') && fieldNames.includes('password') && (fieldNames.includes('confirm') || fieldNames.includes('register') || fieldNames.includes('signup'))) return 'signup';
  if (fieldNames.includes('card') || fieldNames.includes('cvv') || fieldNames.includes('expir') || assertionText.includes('checkout') || assertionText.includes('payment')) return 'checkout';
  if (fieldNames.includes('search') || fieldNames.includes('query') || fieldNames.includes('keyword')) return 'search';
  if (fieldNames.includes('address') || fieldNames.includes('city') || fieldNames.includes('zip')) return 'address-form';
  if (fields.length >= 3) return 'form';
  return 'generic';
}

function buildFlowDescription(appType: string, fields: ExtractedField[], assertions: string[], url: string): string {
  const fieldList = fields.map(f => `"${f.name}" (${f.type})`).join(', ');
  const assertList = assertions.length > 0 ? `. Expected outcomes: ${assertions.join(', ')}` : '';
  return `This is a ${appType} form${url ? ` at ${url}` : ''} with fields: ${fieldList}${assertList}`;
}

// ---------------------------------------------------------------------------
// ChatGPT API Call
// ---------------------------------------------------------------------------

export async function generateTestDataWithChatGPT(
  scriptCode: string,
  testDataType: string,
  count: number = 10,
): Promise<{ data: GeneratedTestDataRow[]; source: string; context: ScriptContext }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const context = extractScriptContext(scriptCode);

  if (context.fields.length === 0) {
    throw new Error('No fillable fields detected in script');
  }

  const fieldDescriptions = context.fields.map(f =>
    `- "${f.name}" (type: ${f.type}, selector: ${f.selectorType}="${f.selector}")`
  ).join('\n');

  const typeInstructions: Record<string, string> = {
    all: 'Generate a comprehensive mix of valid, invalid, boundary, and security test data.',
    positive: 'Generate valid, realistic data that should make the form submit successfully.',
    negative: 'Generate invalid data that should trigger validation errors (wrong formats, empty required fields, type mismatches).',
    boundary: 'Generate boundary value analysis data: empty strings, single char, max length, min/max numbers, edge dates.',
    security: 'Generate security test payloads: SQL injection (\' OR 1=1--), XSS (<script>alert(1)</script>), path traversal (../../etc/passwd), LDAP injection, command injection.',
    equivalence: 'Generate equivalence class partitioning data: one representative value from each valid/invalid partition.',
  };

  const prompt = `You are a QA test data engineer. Analyze this Playwright test script and generate ${count} rows of ${testDataType} test data.

## Script Context
${context.flowDescription}

## Application URL
${context.url || 'Not specified'}

## Application Type
${context.appType}

## Detected Form Fields
${fieldDescriptions}

## Expected Assertions
${context.assertions.length > 0 ? context.assertions.join(', ') : 'None detected'}

## Full Script Code
\`\`\`
${scriptCode.substring(0, 3000)}
\`\`\`

## Instructions
${typeInstructions[testDataType] || typeInstructions.all}

Generate exactly ${count} test data rows. Each row MUST have these exact keys matching the field names: ${context.fields.map(f => `"${f.name}"`).join(', ')}

Also include "_testDataType" (string: "${testDataType}") and "_index" (number: 1-based) in each row.

${testDataType === 'security' ? 'Include varied attack vectors: SQL injection, XSS (reflected/stored/DOM), path traversal, SSTI, CRLF injection, XXE, command injection.' : ''}
${testDataType === 'boundary' ? 'Include: empty string, null-like values, single character, maximum length (255+ chars), unicode, special characters, leading/trailing spaces.' : ''}
${testDataType === 'negative' ? 'Include: wrong data types, invalid formats, SQL keywords, extremely long values, negative numbers for positive-only fields.' : ''}

Return ONLY a valid JSON array. No explanation, no markdown, no code blocks.`;

  logger.info(`ChatGPT: Generating ${count} ${testDataType} test data rows for ${context.appType} form (${context.fields.length} fields)`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a senior QA test data engineer. You analyze Playwright test scripts to understand the application context and generate intelligent, realistic test data. Return ONLY valid JSON arrays. No markdown, no explanation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`ChatGPT API error: ${response.status} - ${errorBody}`);
    throw new Error(`ChatGPT API error: ${response.status}`);
  }

  const result = await response.json() as { choices: Array<{ message: { content: string } }> };
  const content = result.choices[0]?.message?.content || '';

  // Parse JSON — handle markdown code blocks if GPT wraps it
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let data: GeneratedTestDataRow[];
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    logger.error(`ChatGPT: Failed to parse response as JSON: ${cleaned.substring(0, 200)}`);
    throw new Error('ChatGPT returned invalid JSON');
  }

  if (!Array.isArray(data)) {
    throw new Error('ChatGPT response is not a JSON array');
  }

  // Ensure _testDataType and _index are set
  data = data.map((row, i) => {
    const { _testDataType: _t, _index: _i, ...rest } = row;
    return { _testDataType: testDataType, _index: i + 1, ...rest };
  });

  logger.info(`ChatGPT: Generated ${data.length} rows successfully (source: chatgpt-${process.env.OPENAI_MODEL || 'gpt-4o'})`);

  return {
    data,
    source: `chatgpt-${process.env.OPENAI_MODEL || 'gpt-4o'}`,
    context,
  };
}
