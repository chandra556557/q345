import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import pool from '../db';
import { randomUUID } from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import { generateTestDataWithChatGPT, extractScriptContext } from '../services/chatgpt.service';

dotenv.config();

/**
 * Get all test suites for a user
 */
export const getTestSuites = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const { rows } = await pool.query(
      `SELECT * FROM "TestSuite" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
      [userId]
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to get test suites' });
  }
};

/**
 * Create a test suite
 */
export const createTestSuite = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { name, description } = req.body;

    if (!name) throw new AppError('Suite name is required', 400);

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "TestSuite" (id, name, description, "userId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, now(), now())
       RETURNING *`,
      [id, name, description || null, userId]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to create test suite' });
    }
  }
};

/**
 * Update a test suite
 */
export const updateTestSuite = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { name, description } = req.body;

    const existing = await pool.query(
      `SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) throw new AppError('Test suite not found', 404);

    const { rows } = await pool.query(
      `UPDATE "TestSuite"
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [id, name || null, description || null]
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to update test suite' });
    }
  }
};

/**
 * Delete a test suite
 */
export const deleteTestSuite = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    const existing = await pool.query(
      `SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) throw new AppError('Test suite not found', 404);

    await pool.query(`DELETE FROM "TestSuite" WHERE id = $1`, [id]);

    res.status(200).json({ success: true, message: 'Test suite deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to delete test suite' });
    }
  }
};

/**
 * Get all test data (optionally filtered by suite)
 */
export const getTestData = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { suiteId, environment, type } = req.query;

    let query = `SELECT td.*, ts.name as "suiteName"
                 FROM "TestData" td
                 JOIN "TestSuite" ts ON ts.id = td."suiteId"
                 WHERE ts."userId" = $1`;
    const params: any[] = [userId];
    let paramCount = 1;

    if (suiteId) {
      paramCount++;
      query += ` AND td."suiteId" = $${paramCount}`;
      params.push(suiteId);
    }

    if (environment) {
      paramCount++;
      query += ` AND td.environment = $${paramCount}`;
      params.push(environment);
    }

    if (type) {
      paramCount++;
      query += ` AND td.type = $${paramCount}`;
      params.push(type);
    }

    query += ` ORDER BY td."createdAt" DESC`;

    const { rows } = await pool.query(query, params);

    res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to get test data' });
  }
};

/**
 * Create test data
 */
export const createTestData = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { suiteId, name, environment, type, data } = req.body;

    if (!suiteId || !name || !data) {
      throw new AppError('suiteId, name, and data are required', 400);
    }

    // Verify suite belongs to user
    const suiteCheck = await pool.query(
      `SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`,
      [suiteId, userId]
    );

    if (!suiteCheck.rowCount) throw new AppError('Test suite not found', 404);

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "TestData" (id, "suiteId", name, environment, type, data, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       RETURNING *`,
      [id, suiteId, name, environment || 'dev', type || 'user', JSON.stringify(data)]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to create test data' });
    }
  }
};

/**
 * Update test data
 */
export const updateTestData = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { name, environment, type, data } = req.body;

    // Verify ownership through suite
    const existing = await pool.query(
      `SELECT td.id FROM "TestData" td
       JOIN "TestSuite" ts ON ts.id = td."suiteId"
       WHERE td.id = $1 AND ts."userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) throw new AppError('Test data not found', 404);

    const { rows } = await pool.query(
      `UPDATE "TestData"
       SET name = COALESCE($2, name),
           environment = COALESCE($3, environment),
           type = COALESCE($4, type),
           data = COALESCE($5, data),
           "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [id, name || null, environment || null, type || null, data ? JSON.stringify(data) : null]
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to update test data' });
    }
  }
};

/**
 * Delete test data
 */
export const deleteTestData = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    // Verify ownership through suite
    const existing = await pool.query(
      `SELECT td.id FROM "TestData" td
       JOIN "TestSuite" ts ON ts.id = td."suiteId"
       WHERE td.id = $1 AND ts."userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) throw new AppError('Test data not found', 404);

    await pool.query(`DELETE FROM "TestData" WHERE id = $1`, [id]);

    res.status(200).json({ success: true, message: 'Test data deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to delete test data' });
    }
  }
};

/**
 * Generate local test data when external API returns only metadata
 */
const generateLocalTestData = (fields: string[], testDataType: string, count: number): any[] => {
  const testData: any[] = [];
  
  // Define test data generators by type
  const generators: Record<string, (field: string, index: number) => any> = {
    boundary: (field: string, index: number) => {
      const boundaryValues: Record<string, any[]> = {
        email: ['', 'a@b.c', 'test@example.com', 'very.long.email.address.with.many.characters@example.com'],
        password: ['', '123', 'Pass123!', 'VeryLongPassword123!@#$%^&*()'],
        username: ['', 'a', 'user123', 'verylongusername12345678901234567890'],
        age: ['0', '1', '25', '150'],
        phone: ['', '123', '1234567890', '12345678901234567890'],
        default: ['', 'a', 'test', 'very long value with many characters']
      };
      
      const values = boundaryValues[field] || boundaryValues.default;
      return values[index % values.length];
    },
    positive: (field: string) => {
      const positiveValues: Record<string, string> = {
        email: 'test@example.com',
        password: 'Password123!',
        username: 'testuser',
        age: '25',
        phone: '1234567890',
        default: 'valid_value'
      };
      return positiveValues[field] || positiveValues.default;
    },
    negative: (field: string, index: number) => {
      const negativeValues: Record<string, any[]> = {
        email: ['invalid', 'missing@', '@missing.com', 'spaces in email@test.com'],
        password: ['short', '12345', 'nospecialchar123', 'NOLOWERCASE123!'],
        username: ['', '  ', '123', 'user@#$'],
        age: ['-1', 'abc', '999', '0.5'],
        phone: ['abc', '123', '12345678901234567890123'],
        default: ['invalid', '', '  ', '@#$%']
      };
      
      const values = negativeValues[field] || negativeValues.default;
      return values[index % values.length];
    },
    security: (_field: string, index: number) => {
      const securityPayloads = [
        "'; DROP TABLE users; --",
        '<script>alert("XSS")</script>',
        '../../../etc/passwd',
        '${7*7}',
        '%00',
        'admin\' OR \'1\'=\'1',
        '<img src=x onerror=alert(1)>',
        '{{7*7}}'
      ];
      return securityPayloads[index % securityPayloads.length];
    },
    equivalence: (field: string, index: number) => {
      const equivalenceClasses: Record<string, any[]> = {
        email: ['valid@example.com', 'test.user@domain.co.uk', 'user+tag@test.com'],
        password: ['Pass123!', 'Another456#', 'Secure789$'],
        username: ['user1', 'user2', 'user3'],
        age: ['18', '35', '65'],
        phone: ['1234567890', '9876543210', '5555555555'],
        default: ['value1', 'value2', 'value3']
      };
      
      const values = equivalenceClasses[field] || equivalenceClasses.default;
      return values[index % values.length];
    }
  };
  
  const generator = generators[testDataType] || generators.positive;
  
  for (let i = 0; i < count; i++) {
    const record: any = {
      _testDataType: testDataType,
      _index: i
    };
    
    // Add field data
    fields.forEach(field => {
      record[field] = generator(field, i);
    });
    
    testData.push(record);
  }
  
  return testData;
};

/**
 * Forward request to external API for test data generation
 * Reads token from .env file and forwards to external Genie API
 */
const forwardToExternalAPI = async (testDataType: string, req: Request, res: Response): Promise<void> => {
  const { script_code, scriptCode, template, count, options } = req.body;
  const actualScriptCode = scriptCode || script_code;
  const requestedCount = count || 10;

  if (!actualScriptCode) {
    res.status(400).json({ success: false, error: 'scriptCode is required' });
    return;
  }

  // ========================================
  // PRIORITY 1: ChatGPT 4o (if API key configured)
  // ========================================
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log(`🤖 ChatGPT: Generating ${requestedCount} ${testDataType} test data rows...`);
      const result = await generateTestDataWithChatGPT(actualScriptCode, testDataType, requestedCount);

      console.log(`✅ ChatGPT: Generated ${result.data.length} rows (${result.source})`);
      console.log(`📋 Context: ${result.context.appType} form, ${result.context.fields.length} fields, URL: ${result.context.url}`);

      res.status(200).json({
        success: true,
        data: result.data,
        metadata: {
          count: result.data.length,
          testDataType,
          generated_at: new Date().toISOString(),
          source: result.source,
          context: {
            appType: result.context.appType,
            url: result.context.url,
            fields: result.context.fields.map(f => ({ name: f.name, type: f.type })),
            assertions: result.context.assertions,
          }
        }
      });
      return;
    } catch (chatgptError: any) {
      console.warn(`⚠️ ChatGPT failed (falling back): ${chatgptError.message}`);
    }
  }

  // ========================================
  // PRIORITY 2: External Genie API
  // ========================================
  try {
    const apiUrlMap: Record<string, string | undefined> = {
      'security': process.env.EXTERNAL_SECURITY_API_URL,
      'boundary': process.env.EXTERNAL_BOUNDARY_API_URL,
      'equivalence': process.env.EXTERNAL_EQUIVALENCE_API_URL,
      'positive': process.env.EXTERNAL_POSITIVE_API_URL,
      'negative': process.env.EXTERNAL_NEGATIVE_API_URL
    };

    const externalApiUrl = apiUrlMap[testDataType];
    const externalToken = process.env.EXTERNAL_API_TOKEN;

    if (externalApiUrl && externalToken) {
      console.log(`📤 Forwarding to external API: ${externalApiUrl}`);

      const response = await axios.post(externalApiUrl, {
        scriptCode: actualScriptCode,
        template: template || {},
        count: requestedCount,
        testDataType,
        options: options || {}
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${externalToken}`
        },
        timeout: 30000,
      });

      const dataArray = Array.isArray(response.data?.data) ? response.data.data : [];
      const hasOnlyMetadata = dataArray.length > 0 && dataArray.every((record: any) => {
        return Object.keys(record).every(key => key.startsWith('_'));
      });

      if (!hasOnlyMetadata && dataArray.length > 0) {
        console.log(`✅ External API: ${dataArray.length} rows`);
        res.status(200).json({
          success: true,
          data: response.data,
          metadata: { test_data_type: testDataType, source: 'external_api' }
        });
        return;
      }
      console.warn(`⚠️ External API returned only metadata — falling back to local`);
    }
  } catch (extError: any) {
    console.warn(`⚠️ External API failed (falling back): ${extError.message}`);
  }

  // ========================================
  // PRIORITY 3: Local rule-based generation
  // ========================================
  try {
    console.log(`🔧 Local: Generating ${requestedCount} ${testDataType} test data rows...`);

    // Use ChatGPT service's field extraction (smarter than regex-only)
    const context = extractScriptContext(actualScriptCode);
    const fieldNames = context.fields.map(f => f.name);

    if (fieldNames.length === 0) {
      // Fallback regex extraction
      const fieldPattern = /getByLabel\(['"]([^'"]+)['"]\)|fill\(['"]([^'"]+)['"],|placeholder:\s*['"]([^'"]+)['"]|name:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = fieldPattern.exec(actualScriptCode)) !== null) {
        const name = (match[1] || match[2] || match[3] || match[4] || '').replace(/[#.\[\]>~+]/g, '').trim();
        if (name && !fieldNames.includes(name.toLowerCase())) fieldNames.push(name.toLowerCase());
      }
    }

    const enrichedData = generateLocalTestData(fieldNames, testDataType, requestedCount);

    console.log(`✅ Local: Generated ${enrichedData.length} rows (${fieldNames.length} fields: ${fieldNames.join(', ')})`);

    res.status(200).json({
      success: true,
      data: enrichedData,
      metadata: {
        count: enrichedData.length,
        testDataType,
        generated_at: new Date().toISOString(),
        source: 'local_fallback',
        fields_detected: fieldNames,
      }
    });
  } catch (localError: any) {
    console.error(`❌ All generation methods failed:`, localError.message);
    res.status(500).json({
      success: false,
      error: 'All test data generation methods failed',
      details: localError.message,
    });
  }
};

// Generate test data - Security
export const generateSecurityTestData = async (req: Request, res: Response) => {
  await forwardToExternalAPI('security', req, res);
};

// Generate test data - Boundary
export const generateBoundaryTestData = async (req: Request, res: Response) => {
  await forwardToExternalAPI('boundary', req, res);
};

// Generate test data - Equivalence
export const generateEquivalenceTestData = async (req: Request, res: Response) => {
  await forwardToExternalAPI('equivalence', req, res);
};

// Generate test data - Positive
export const generatePositiveTestData = async (req: Request, res: Response) => {
  await forwardToExternalAPI('positive', req, res);
};

// Generate test data - Negative
export const generateNegativeTestData = async (req: Request, res: Response) => {
  await forwardToExternalAPI('negative', req, res);
};

/**
 * Extract fields from Playwright script using regex heuristics
 */
const extractFieldsFromScript = (scriptCode: string): Array<{ selector?: string; fieldName?: string; fieldType: string; action: string }> => {
  const fields: Array<{ selector?: string; fieldName?: string; fieldType: string; action: string }> = [];

  const pushField = (f: { selector?: string; fieldName?: string; fieldType?: string; action: string }) => {
    const fieldType = f.fieldType || inferFieldType(f.fieldName || f.selector || '');
    fields.push({ selector: f.selector, fieldName: f.fieldName, fieldType, action: f.action });
  };

  let m: RegExpExecArray | null;

  // getByLabel / getByPlaceholder / getByTestId — single, double, or backtick quotes
  // Group 1: quote char, Group 2: field name
  const byLabelRegex = /getByLabel\(\s*(['"`])(.*?)\1\s*\)/g;
  const byPlaceholderRegex = /getByPlaceholder\(\s*(['"`])(.*?)\1\s*\)/g;
  const byTestIdRegex = /getByTestId\(\s*(['"`])(.*?)\1\s*\)/g;

  while ((m = byLabelRegex.exec(scriptCode))) pushField({ fieldName: m[2], action: 'fill' });
  while ((m = byPlaceholderRegex.exec(scriptCode))) pushField({ fieldName: m[2], action: 'fill' });
  while ((m = byTestIdRegex.exec(scriptCode))) pushField({ fieldName: m[2], action: 'fill' });

  // getByRole with name option — Group 2: role, Group 4: field name
  // Text-input roles: textbox, searchbox, spinbutton
  // Select roles: combobox
  // Checkbox roles: checkbox, radio, switch
  const byRoleRegex = /getByRole\(\s*(['"`])(textbox|combobox|searchbox|spinbutton|checkbox|radio|switch)\1\s*,\s*\{[^}]*name:\s*(['"`])([^'"`]*)\3[^}]*\}\s*\)/g;
  while ((m = byRoleRegex.exec(scriptCode))) {
    const role = m[2];
    const name = m[4];
    if (role === 'combobox') {
      pushField({ fieldName: name, fieldType: 'select', action: 'selectOption' });
    } else if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      pushField({ fieldName: name, fieldType: 'checkbox', action: 'check' });
    } else {
      // textbox, searchbox, spinbutton
      pushField({ fieldName: name, fieldType: role === 'spinbutton' ? 'number' : undefined, action: 'fill' });
    }
  }

  // page.fill / page.type / page.pressSequentially — Group 1: quote, Group 2: selector
  // Uses .*? (lazy) instead of [^)]+? to correctly handle selectors containing ")"
  const pageFillRegex = /page\.(?:fill|type|pressSequentially)\(\s*(['"`])\s*(.*?)\s*\1\s*,/g;
  while ((m = pageFillRegex.exec(scriptCode))) pushField({ selector: m[2], action: 'fill' });

  // locator('...').fill/type/pressSequentially — Group 1: quote, Group 2: selector
  const locatorFillRegex = /locator\(\s*(['"`])\s*(.*?)\s*\1\s*\)\.(?:fill|type|pressSequentially)\(/g;
  while ((m = locatorFillRegex.exec(scriptCode))) pushField({ selector: m[2], action: 'fill' });

  // locator('...').selectOption — Group 1: quote, Group 2: selector
  const locatorSelectRegex = /locator\(\s*(['"`])\s*(.*?)\s*\1\s*\)\.selectOption\(/g;
  while ((m = locatorSelectRegex.exec(scriptCode))) fields.push({ selector: m[2], fieldName: undefined, fieldType: 'select', action: 'selectOption' });

  // locator('...').check / .uncheck — Group 1: quote, Group 2: selector
  const locatorCheckRegex = /locator\(\s*(['"`])\s*(.*?)\s*\1\s*\)\.(?:check|uncheck)\(/g;
  while ((m = locatorCheckRegex.exec(scriptCode))) fields.push({ selector: m[2], fieldName: undefined, fieldType: 'checkbox', action: 'check' });

  // page.selectOption('selector', ...) — Group 1: quote, Group 2: selector
  const pageSelectRegex = /page\.selectOption\(\s*(['"`])\s*(.*?)\s*\1\s*,/g;
  while ((m = pageSelectRegex.exec(scriptCode))) fields.push({ selector: m[2], fieldName: undefined, fieldType: 'select', action: 'selectOption' });

  // page.check / page.uncheck('selector') — Group 1: quote, Group 2: selector
  const pageCheckRegex = /page\.(?:check|uncheck)\(\s*(['"`])\s*(.*?)\s*\1\s*\)/g;
  while ((m = pageCheckRegex.exec(scriptCode))) fields.push({ selector: m[2], fieldName: undefined, fieldType: 'checkbox', action: 'check' });

  // Deduplicate by selector/fieldName
  const seen = new Set<string>();
  return fields.filter(f => {
    const key = `${f.selector || ''}|${f.fieldName || ''}|${f.fieldType}|${f.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const inferFieldType = (nameOrSelector: string): string => {
  const s = (nameOrSelector || '').toLowerCase();
  if (/email/.test(s)) return 'email';
  if (/pass|password/.test(s)) return 'password';
  if (/phone|mobile|tel/.test(s)) return 'tel';
  if (/url|website/.test(s)) return 'url';
  if (/date|dob/.test(s)) return 'date';
  if (/amount|age|price|count|number|qty|quantity/.test(s)) return 'number';
  return 'text';
};

/**
 * Generate test data bundles for a detected field
 */
const generateDataForField = (field: { selector?: string; fieldName?: string; fieldType: string }) => {
  const name = field.fieldName || field.selector || 'field';
  const type = field.fieldType;

  const positiveSamples: Record<string, any> = {
    email: 'user@example.com',
    password: 'Password123!',
    tel: '1234567890',
    url: 'https://example.com',
    date: '2025-01-01',
    number: 100,
    text: 'valid_value'
  };

  const negativeSamples: Record<string, any[]> = {
    email: ['not-an-email', '@example.com', 'user@', 'user@.com'],
    password: ['123', 'password', ''],
    tel: ['abc', '123', ''],
    url: ['htp://bad', 'example', ''],
    date: ['2025-13-01', 'not-a-date', ''],
    number: ['NaN', -9999999999, 'abc'],
    text: ['', '   ', '\u0000']
  };

  const boundarySamples: Record<string, any[]> = {
    number: [Number.MIN_SAFE_INTEGER, -1, 0, 1, 100, 9999999999],
    text: ['', 'a', 'a'.repeat(254), 'a'.repeat(255)],
    password: ['a', 'Pass123!', 'a'.repeat(128)],
    email: ['a@b.c', 'x@y.z'.repeat(30)],
    tel: ['0', '1'.repeat(20)],
    select: ['', 'option1', 'last_option'],
    checkbox: [true, false]
  };

  const equivalenceSamples: Record<string, any[]> = {
    email: ['valid@example.com', 'invalid-email'],
    tel: ['9876543210', 'phone-number'],
    number: [10, -5],
    text: ['normal', ''],
    select: ['option1', 'option2', '', 'invalid_option'],
    checkbox: [true, false]
  };

  const securityPayloads = [
    "' OR '1'='1",
    "admin'--",
    "<script>alert('xss')</script>",
    "'; DROP TABLE users--",
    "${7*7}",
    "../../../etc/passwd"
  ];

  const securitySelectPayloads = [
    "' OR '1'='1",
    "<script>alert(1)</script>",
    "option1; DROP TABLE--"
  ];

  let security: Array<Record<string, any>>;
  if (type === 'select') {
    security = securitySelectPayloads.map(p => ({ [name]: p }));
  } else if (type === 'checkbox') {
    security = [{ [name]: "' OR '1'='1" }, { [name]: true }, { [name]: false }];
  } else {
    security = securityPayloads.map(p => ({ [name]: p }));
  }

  return {
    field: name,
    fieldType: type,
    positive: [{ [name]: positiveSamples[type] ?? positiveSamples.text }],
    negative: (negativeSamples[type] ?? negativeSamples.text).map(v => ({ [name]: v })),
    boundary: (boundarySamples[type] ?? []).map(v => ({ [name]: v })),
    equivalence: (equivalenceSamples[type] ?? []).map(v => ({ [name]: v })),
    security
  };
};

/**
 * Generate test data from script fields (Python first, Node fallback)
 */
export const generateFromScriptTestData = async (req: Request, res: Response) => {
  try {
    const {
      scriptId,
      scriptCode: rawScriptCode,
      testTypes = ['positive', 'negative', 'boundary', 'equivalence', 'security'],
      count = 10,
      counts,
      fieldHints,
      schema,
      seed,
      locales,
      domainRules,
      fkChains,
      save = false,
      suiteId
    } = req.body || {};

    let scriptCode = rawScriptCode;

    if (!scriptCode && scriptId) {
      const userId = (req as any).user?.userId;
      const { rows } = await pool.query(
        `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }
      scriptCode = rows[0].code;
    }

    if (!scriptCode || typeof scriptCode !== 'string') {
      return res.status(400).json({ success: false, error: 'Either scriptCode or scriptId is required' });
    }

    const pythonUrl = (process.env.PYTHON_API_URL || 'http://localhost:8000').replace(/\/+$/, '') + '/api/ai-analysis/generate-tests-from-script';
    let usedSource: 'python_ai_local' | 'node_fallback' = 'node_fallback';
    let fields: Array<{ selector?: string; fieldName?: string; fieldType: string; action: string }> = [];

    const bundles: Record<string, any> = { positive: [], negative: [], boundary: {}, equivalence: {}, security: {} };

    // Try Python analyzer if available
    try {
      const response = await axios.post(
        pythonUrl,
        {
          script_code: scriptCode,
          test_types: testTypes,
          count_per_type: count,
          counts,
          field_hints: fieldHints,
          schema,
          seed,
          locales,
          domain_rules: domainRules,
          fk_chains: fkChains
        },
        { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
      );
      usedSource = 'python_ai_local';
      const data = response.data?.data || response.data || {};
      const analysisFields = (data.analysis?.input_fields || []).map((f: any) => ({ selector: f.selector, fieldName: f.field_name || f.fieldName, fieldType: (f.field_type || 'text').toString(), action: f.action || 'fill' }));
      fields = analysisFields;

      // Map python generated tests into our bundles if present
      const boundaryTests = data.boundary_tests || [];
      const equivalenceTests = data.equivalence_tests || [];
      const securityTests = data.security_tests || [];
      const positiveTests = data.positive_tests || [];
      const negativeTests = data.negative_tests || [];

      for (const bt of boundaryTests) {
        const key = bt.field || bt.field_name || bt.selector || 'field';
        if (!bundles.boundary[key]) bundles.boundary[key] = [];
        (bt.test_cases || bt.values || []).forEach((v: any) => bundles.boundary[key].push(v));
      }
      for (const et of equivalenceTests) {
        const key = et.field || et.field_name || et.selector || 'field';
        if (!bundles.equivalence[key]) bundles.equivalence[key] = [];
        (et.valid_partitions || et.test_cases || et.values || []).forEach((v: any) => bundles.equivalence[key].push(v));
      }
      for (const st of securityTests) {
        const key = st.field || st.field_name || st.selector || 'field';
        if (!bundles.security[key]) bundles.security[key] = [];
        (st.payloads || []).forEach((p: any) => bundles.security[key].push(p));
      }
      if (positiveTests.length > 0) bundles.positive.push(...positiveTests);
      if (negativeTests.length > 0) bundles.negative.push(...negativeTests);
    } catch (_err) {
      // Fallback to Node extractor/generator
      const extracted = extractFieldsFromScript(scriptCode);
      const hints: Array<{ selector?: string; fieldName?: string; fieldType?: string; min?: number; max?: number; maxlength?: number; pattern?: string }> = Array.isArray(fieldHints) ? fieldHints : [];
      const applyHint = (f: { selector?: string; fieldName?: string; fieldType: string }) => {
        const name = f.fieldName || f.selector || '';
        const hint = hints.find(h => (h.fieldName && name.includes(String(h.fieldName))) || (h.selector && String(h.selector) === f.selector));
        if (hint) {
          return {
            selector: f.selector,
            fieldName: f.fieldName,
            fieldType: (hint.fieldType || f.fieldType) as string,
            min: hint.min,
            max: hint.max,
            maxlength: hint.maxlength,
            pattern: hint.pattern
          } as any;
        }
        return { ...f } as any;
      };
      fields = extracted.map(applyHint as any);
      for (const field of fields) {
        const bundle = generateDataForField(field as any);
        if (testTypes.includes('positive')) bundles.positive.push(...bundle.positive);
        if (testTypes.includes('negative')) bundles.negative.push(...bundle.negative);
        if (testTypes.includes('boundary')) bundles.boundary[bundle.field] = bundle.boundary;
        if (testTypes.includes('equivalence')) bundles.equivalence[bundle.field] = bundle.equivalence;
        if (testTypes.includes('security')) bundles.security[bundle.field] = bundle.security;
      }
    }

    const limits = (counts && typeof counts === 'object') ? counts : undefined;
    const limitArray = (arr: any[], key: string) => {
      if (!Array.isArray(arr)) return arr;
      const n = (limits && limits[key] && Number.isFinite(Number(limits[key]))) ? Number(limits[key]) : undefined;
      return n ? arr.slice(0, Math.max(0, n)) : arr;
    };
    bundles.positive = limitArray(bundles.positive, 'positive');
    bundles.negative = limitArray(bundles.negative, 'negative');
    for (const k of Object.keys(bundles.boundary)) bundles.boundary[k] = limitArray(bundles.boundary[k], 'boundary');
    for (const k of Object.keys(bundles.equivalence)) bundles.equivalence[k] = limitArray(bundles.equivalence[k], 'equivalence');
    for (const k of Object.keys(bundles.security)) bundles.security[k] = limitArray(bundles.security[k], 'security');

    // Optional persistence per type
    if (save && suiteId) {
      const userId = (req as any).user?.userId;
      const suiteCheck = await pool.query(`SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`, [suiteId, userId]);
      if (suiteCheck.rowCount) {
        const persist = async (type: string, records: any[]) => {
          if (!records || records.length === 0) return;
          const tdId = randomUUID();
          await pool.query(
            `INSERT INTO "TestData" (id, "suiteId", name, environment, type, data, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
            [tdId, suiteId, `Generated from script (${type})`, 'dev', type, JSON.stringify(records)]
          );
        };
        await persist('positive', bundles.positive);
        await persist('negative', bundles.negative);
        for (const [k, v] of Object.entries(bundles.boundary)) await persist(`boundary:${k}`, v as any[]);
        for (const [k, v] of Object.entries(bundles.equivalence)) await persist(`equivalence:${k}`, v as any[]);
        for (const [k, v] of Object.entries(bundles.security)) await persist(`security:${k}`, v as any[]);
      }
    }

    return res.status(200).json({
      success: true,
      fields,
      data: bundles,
      metadata: {
        source: usedSource,
        counts: {
          fields: fields.length,
          positive: Array.isArray(bundles.positive) ? bundles.positive.length : 0,
          negative: Array.isArray(bundles.negative) ? bundles.negative.length : 0
        },
        schemaProvided: Boolean(schema),
        locales,
        seed,
        domainRulesProvided: Boolean(domainRules),
        fkChainsProvided: Boolean(fkChains)
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'Failed to generate test data from script' });
  }
};

// ============================================
// FIELD BINDING (integrated from data-driven module)
// ============================================

/**
 * Extract {{placeholder}} patterns from a script
 * POST /api/testdata/field-bindings/extract-placeholders
 */
export const extractPlaceholders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { scriptId, scriptCode, makeDynamic = false } = req.body;

    let code: string;

    if (scriptId) {
      const { rows } = await pool.query(
        `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }
      code = rows[0].code;
    } else if (scriptCode) {
      code = scriptCode;
    } else {
      return res.status(400).json({ success: false, error: 'Either scriptId or scriptCode is required' });
    }

    // If makeDynamic=true: rewrite script replacing all hardcoded values with {{tokens}}
    if (makeDynamic) {
      const { dynamicScript, placeholders: detected } = makeDynamicScript(code);
      const finalPlaceholders = extractPlaceholdersFromCode(dynamicScript);
      return res.json({
        success: true,
        dynamicScript,
        placeholders: finalPlaceholders,
        detected,
        totalReplaced: detected.length
      });
    }

    const placeholders = extractPlaceholdersFromCode(code);

    // If no {{placeholder}} tokens exist, auto-detect parameterizable values
    // from click/navigation actions and return them as suggestions
    if (placeholders.length === 0) {
      const suggested = extractSuggestedPlaceholders(code);
      return res.json({
        success: true,
        placeholders: [],
        suggested,
        hint: suggested.length > 0
          ? 'No {{placeholder}} tokens found. The suggested list shows values that could be parameterized.'
          : 'No parameterizable values detected. Add {{placeholder}} tokens to your script or include fill() / type() actions.'
      });
    }

    return res.json({ success: true, placeholders });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to extract placeholders' });
  }
};

/**
 * Analyze script and auto-generate field bindings
 * POST /api/testdata/field-bindings/analyze
 */
export const analyzeFieldBindings = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { scriptId, scriptCode } = req.body;

    let code: string;
    let scriptName = 'unknown';

    if (scriptId) {
      const { rows } = await pool.query(
        `SELECT code, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }
      code = rows[0].code;
      scriptName = rows[0].name;
    } else if (scriptCode) {
      code = scriptCode;
    } else {
      return res.status(400).json({ success: false, error: 'Either scriptId or scriptCode is required' });
    }

    // Extract {{placeholder}} patterns
    const placeholders = extractPlaceholdersFromCode(code);

    // Extract fields from Playwright locators
    const detectedFields = extractFieldsFromScript(code);

    // Auto-generate field bindings: map placeholder -> best matching field
    const fieldBindings: Record<string, string> = {};
    const suggestions: Array<{
      placeholder: string;
      suggestedField: string;
      confidence: 'exact' | 'fuzzy' | 'none';
      fieldType: string;
    }> = [];

    for (const ph of placeholders) {
      const phLower = ph.name.toLowerCase();

      let bestMatch: { field: string; confidence: 'exact' | 'fuzzy' | 'none' } = { field: ph.name, confidence: 'none' };

      for (const df of detectedFields) {
        const fieldName = (df.fieldName || df.selector || '').toLowerCase();
        if (fieldName === phLower || fieldName.replace(/[\s_-]/g, '') === phLower.replace(/[\s_-]/g, '')) {
          bestMatch = { field: df.fieldName || df.selector || ph.name, confidence: 'exact' };
          break;
        }
        if (bestMatch.confidence === 'none' && (fieldName.includes(phLower) || phLower.includes(fieldName))) {
          bestMatch = { field: df.fieldName || df.selector || ph.name, confidence: 'fuzzy' };
        }
      }

      fieldBindings[ph.name] = bestMatch.field;
      suggestions.push({
        placeholder: ph.name,
        suggestedField: bestMatch.field,
        confidence: bestMatch.confidence,
        fieldType: inferFieldType(ph.name)
      });
    }

    return res.json({
      success: true,
      scriptName,
      placeholders,
      detectedFields,
      fieldBindings,
      suggestions
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to analyze field bindings' });
  }
};

/**
 * Preview field binding substitution on script code
 * POST /api/testdata/field-bindings/preview
 */
export const previewFieldBindingSubstitution = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { scriptId, scriptCode, fieldBindings, dataRow } = req.body;

    if (!fieldBindings || Object.keys(fieldBindings).length === 0) {
      return res.status(400).json({ success: false, error: 'fieldBindings is required' });
    }
    if (!dataRow || Object.keys(dataRow).length === 0) {
      return res.status(400).json({ success: false, error: 'dataRow is required' });
    }

    let code: string;

    if (scriptId) {
      const { rows } = await pool.query(
        `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }
      code = rows[0].code;
    } else if (scriptCode) {
      code = scriptCode;
    } else {
      return res.status(400).json({ success: false, error: 'Either scriptId or scriptCode is required' });
    }

    let result = code;
    const substitutions: Array<{ placeholder: string; dataField: string; value: string }> = [];

    for (const [placeholder, dataField] of Object.entries(fieldBindings)) {
      const value = dataRow[dataField as string];
      if (value === undefined || value === null) continue;

      const stringValue = String(value);
      const pattern = new RegExp(`\\{\\{${escapeRegex(placeholder)}\\}\\}`, 'g');
      result = result.replace(pattern, stringValue);

      substitutions.push({ placeholder, dataField: dataField as string, value: stringValue });
    }

    return res.json({
      success: true,
      originalCode: code,
      substitutedCode: result,
      substitutions
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to preview substitution' });
  }
};

/**
 * Generate test data with field bindings from a script
 * POST /api/testdata/field-bindings/generate
 */
export const generateWithFieldBindings = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { scriptId, scriptCode: inlineCode, strategies = ['positive'], countPerStrategy = 5, suiteId, save = false } = req.body;

    if (!scriptId && !inlineCode) {
      return res.status(400).json({ success: false, error: 'Either scriptId or scriptCode is required' });
    }

    let code: string;
    let scriptName = 'unknown';

    if (scriptId) {
      const { rows: scriptRows } = await pool.query(
        `SELECT code, name FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      if (scriptRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }
      code = scriptRows[0].code;
      scriptName = scriptRows[0].name;
    } else {
      code = inlineCode;
    }

    const placeholders = extractPlaceholdersFromCode(code);
    const detectedFields = extractFieldsFromScript(code);

    // Auto-generate field bindings
    const fieldBindings: Record<string, string> = {};
    for (const ph of placeholders) {
      const phLower = ph.name.toLowerCase();
      let matched = ph.name;
      let foundFuzzy = false;

      for (const df of detectedFields) {
        const fieldName = (df.fieldName || df.selector || '').toLowerCase();
        if (fieldName === phLower || fieldName.replace(/[\s_-]/g, '') === phLower.replace(/[\s_-]/g, '')) {
          matched = df.fieldName || df.selector || ph.name;
          foundFuzzy = false;
          break;
        }
        if (!foundFuzzy && (fieldName.includes(phLower) || phLower.includes(fieldName))) {
          matched = df.fieldName || df.selector || ph.name;
          foundFuzzy = true;
        }
      }
      fieldBindings[ph.name] = matched;
    }

    // Generate data rows per strategy
    const dataRows: Array<{ strategy: string; row: Record<string, any> }> = [];

    for (const strategy of strategies) {
      for (let i = 0; i < countPerStrategy; i++) {
        const row: Record<string, any> = {};
        for (const ph of placeholders) {
          const fieldType = inferFieldType(ph.name);
          row[fieldBindings[ph.name]] = generateValueForStrategy(fieldType, strategy, i);
        }
        dataRows.push({ strategy, row });
      }
    }

    // Optionally save to test suite
    if (save && suiteId) {
      const suiteCheck = await pool.query(`SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`, [suiteId, userId]);
      if (suiteCheck.rowCount) {
        for (const strategy of strategies) {
          const rows = dataRows.filter(r => r.strategy === strategy).map(r => r.row);
          if (rows.length > 0) {
            const tdId = randomUUID();
            await pool.query(
              `INSERT INTO "TestData" (id, "suiteId", name, environment, type, data, "createdAt", "updatedAt")
               VALUES ($1, $2, $3, 'dev', $4, $5, now(), now())`,
              [tdId, suiteId, `${scriptName} - ${strategy} (field-bound)`, strategy, JSON.stringify(rows)]
            );
          }
        }
      }
    }

    return res.json({
      success: true,
      scriptName,
      placeholders,
      detectedFields,
      fieldBindings,
      strategies,
      dataRows,
      totalRows: dataRows.length
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to generate with field bindings' });
  }
};

// ============================================
// FIELD BINDING HELPERS
// ============================================

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract {{placeholder}} patterns from script code
 */
const extractPlaceholdersFromCode = (scriptCode: string): { name: string; line: number; context: string }[] => {
  const placeholders: { name: string; line: number; context: string }[] = [];
  const seen = new Set<string>();
  const lines = scriptCode.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const matches = lineText.matchAll(/\{\{(\w+)\}\}/g);

    for (const match of matches) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        placeholders.push({
          name,
          line: i + 1,
          context: lineText.trim().substring(0, 80)
        });
      }
    }
  }

  return placeholders;
};

/**
 * Convert a human-readable string to a snake_case placeholder name.
 * Guarantees the result starts with a letter (never a digit).
 */
const toPlaceholderName = (text: string): string => {
  let name = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 40);
  // Ensure starts with letter
  if (/^\d/.test(name)) name = 'field_' + name;
  return name || 'value';
};

/**
 * Detect parameterizable string values from a Playwright script.
 *
 * Strategy (priority order):
 *  1. Chained locator+fill patterns — use locator NAME as placeholder name, not fill value.
 *     e.g. getByRole('textbox',{name:'Username'}).fill('pulse') → {{username}}
 *     This handles identical fill values for different fields correctly.
 *  2. Standalone action values (goto URL, filter hasText, getByText, etc.)
 *  3. Remaining bare .fill/.type/.selectOption values not covered above.
 *
 * Works on the full script string to handle multiline locators.
 */
const extractSuggestedPlaceholders = (
  scriptCode: string
): { name: string; value: string; type: string; line: number; context: string; locatorName?: string }[] => {
  type Entry = { name: string; value: string; type: string; line: number; context: string; locatorName?: string };
  const results: Entry[] = [];

  // Track which character ranges (fill value positions) have already been claimed
  // by a chained detection so we don't double-count them in the bare fill scan.
  const claimedRanges: Array<[number, number]> = [];
  // Deduplicate standalone values by value string
  const seenValues = new Set<string>();
  // Deduplicate chained fills by locator name (so Username & Password are both kept even with same value)
  const seenLocatorNames = new Set<string>();

  const lines = scriptCode.split('\n');
  const getLineCtx = (idx: number) => {
    const lineIdx = scriptCode.substring(0, idx).split('\n').length - 1;
    return { line: lineIdx + 1, context: lines[lineIdx]?.trim().substring(0, 100) || '' };
  };

  let m: RegExpExecArray | null;

  // ── 1. Chained locator + fill/type/pressSequentially/selectOption ────────────
  // Pattern: getByRole('role', { name: 'LocatorName' }).fill('value')
  // Also handles multiline options objects and intermediate .click() chains
  const chainedRoleRe = /getByRole\(\s*(['"`])(\w+)\1\s*,\s*\{[\s\S]*?name:\s*(['"`])(.*?)\3[\s\S]*?\}\s*\)\s*\.(?:fill|type|pressSequentially|selectOption)\(\s*(['"`])(.*?)\5/g;
  while ((m = chainedRoleRe.exec(scriptCode))) {
    const locatorName = m[4];   // e.g. "Username"
    const fillValue   = m[6];   // e.g. "pulse"
    if (!locatorName || fillValue.startsWith('{{')) continue;
    const key = locatorName.toLowerCase();
    if (seenLocatorNames.has(key)) continue;
    seenLocatorNames.add(key);
    claimedRanges.push([m.index, m.index + m[0].length]);
    const { line, context } = getLineCtx(m.index);
    results.push({ name: toPlaceholderName(locatorName), value: fillValue, type: 'chained_role_fill', line, context, locatorName });
  }

  // Pattern: getByLabel('LabelName').fill('value')
  const chainedLabelRe = /getByLabel\(\s*(['"`])(.*?)\1\s*\)\s*\.(?:fill|type|pressSequentially|selectOption)\(\s*(['"`])(.*?)\3/g;
  while ((m = chainedLabelRe.exec(scriptCode))) {
    const locatorName = m[2];
    const fillValue   = m[4];
    if (!locatorName || fillValue.startsWith('{{')) continue;
    const key = locatorName.toLowerCase();
    if (seenLocatorNames.has(key)) continue;
    seenLocatorNames.add(key);
    claimedRanges.push([m.index, m.index + m[0].length]);
    const { line, context } = getLineCtx(m.index);
    results.push({ name: toPlaceholderName(locatorName), value: fillValue, type: 'chained_label_fill', line, context, locatorName });
  }

  // Pattern: getByPlaceholder('PlaceholderText').fill('value')
  const chainedPlaceholderRe = /getByPlaceholder\(\s*(['"`])(.*?)\1\s*\)\s*\.(?:fill|type|pressSequentially|selectOption)\(\s*(['"`])(.*?)\3/g;
  while ((m = chainedPlaceholderRe.exec(scriptCode))) {
    const locatorName = m[2];
    const fillValue   = m[4];
    if (!locatorName || fillValue.startsWith('{{')) continue;
    const key = `ph_${locatorName.toLowerCase()}`;
    if (seenLocatorNames.has(key)) continue;
    seenLocatorNames.add(key);
    claimedRanges.push([m.index, m.index + m[0].length]);
    const { line, context } = getLineCtx(m.index);
    results.push({ name: toPlaceholderName(locatorName), value: fillValue, type: 'chained_placeholder_fill', line, context, locatorName });
  }

  // Pattern: getByTestId('testId').fill('value')
  const chainedTestIdRe = /getByTestId\(\s*(['"`])(.*?)\1\s*\)\s*\.(?:fill|type|pressSequentially|selectOption)\(\s*(['"`])(.*?)\3/g;
  while ((m = chainedTestIdRe.exec(scriptCode))) {
    const locatorName = m[2];
    const fillValue   = m[4];
    if (!locatorName || fillValue.startsWith('{{')) continue;
    const key = `tid_${locatorName.toLowerCase()}`;
    if (seenLocatorNames.has(key)) continue;
    seenLocatorNames.add(key);
    claimedRanges.push([m.index, m.index + m[0].length]);
    const { line, context } = getLineCtx(m.index);
    results.push({ name: toPlaceholderName(`testid_${locatorName}`), value: fillValue, type: 'chained_testid_fill', line, context, locatorName });
  }

  // ── 2. Standalone parameterizable values ─────────────────────────────────────
  const addStandalone = (name: string, value: string, type: string, idx: number) => {
    if (!value || seenValues.has(value)) return;
    seenValues.add(value);
    const { line, context } = getLineCtx(idx);
    results.push({ name, value, type, line, context });
  };

  // ANY_VAR.goto('URL') — handles page.goto, page1.goto, frame.goto, etc.
  const gotoRe = /\b\w+\.goto\(\s*(['"`])(.*?)\1/g;
  while ((m = gotoRe.exec(scriptCode))) addStandalone('url', m[2], 'url', m.index);

  // getByRole('role', { name: 'VALUE' }) — standalone click targets (no fill chained)
  const byRoleClickRe = /getByRole\(\s*(['"`])(\w+)\1\s*,\s*\{[\s\S]*?name:\s*(['"`])(.*?)\3/g;
  while ((m = byRoleClickRe.exec(scriptCode))) {
    const role  = m[2];
    const value = m[4];
    // Skip if this position was claimed by chained detection
    const isClaimed = claimedRanges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (isClaimed) continue;
    addStandalone(toPlaceholderName(`${role}_${value}`), value, 'click_target', m.index);
  }

  // filter({ hasText: 'VALUE' })
  const filterStrRe = /filter\(\s*\{[\s\S]*?hasText:\s*(['"`])(.*?)\1/g;
  while ((m = filterStrRe.exec(scriptCode))) addStandalone(toPlaceholderName(m[2]), m[2], 'text_filter', m.index);

  // filter({ hasText: /^VALUE$/ })
  const filterReRe = /filter\(\s*\{[\s\S]*?hasText:\s*\/\^?(.*?)\$?\//g;
  while ((m = filterReRe.exec(scriptCode))) addStandalone(toPlaceholderName(m[1]), m[1], 'text_filter', m.index);

  // getByText('VALUE')
  const byTextRe = /getByText\(\s*(['"`])(.*?)\1/g;
  while ((m = byTextRe.exec(scriptCode))) addStandalone(toPlaceholderName(m[2]), m[2], 'text', m.index);

  // getByAltText('VALUE')
  const byAltRe = /getByAltText\(\s*(['"`])(.*?)\1/g;
  while ((m = byAltRe.exec(scriptCode))) addStandalone(toPlaceholderName(`alt_${m[2]}`), m[2], 'alt_text', m.index);

  // getByTitle('VALUE')
  const byTitleRe = /getByTitle\(\s*(['"`])(.*?)\1/g;
  while ((m = byTitleRe.exec(scriptCode))) addStandalone(toPlaceholderName(`title_${m[2]}`), m[2], 'title', m.index);

  // ANY_VAR.selectOption('selector', 'VALUE') — 2nd arg
  const pageSelectRe = /\b\w+\.selectOption\(\s*(['"`]).*?\1\s*,\s*(['"`])(.*?)\2/g;
  while ((m = pageSelectRe.exec(scriptCode))) addStandalone(toPlaceholderName(m[3]), m[3], 'select_value', m.index);

  // ── 3. Bare .fill/.type/.pressSequentially values NOT already claimed ─────────
  const fillRe = /\.(?:fill|type|pressSequentially|selectOption)\(\s*(['"`])(.*?)\1/g;
  while ((m = fillRe.exec(scriptCode))) {
    const value = m[2];
    if (!value || value.startsWith('{{')) continue;
    const isClaimed = claimedRanges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (isClaimed) continue;
    if (seenValues.has(value)) continue;
    seenValues.add(value);
    const { line, context } = getLineCtx(m.index);
    results.push({ name: toPlaceholderName(value) || 'input_value', value, type: 'fill_value', line, context });
  }

  return results;
};

/**
 * Rewrite a Playwright script replacing all detected hardcoded values with {{placeholder}} tokens.
 */
const makeDynamicScript = (
  scriptCode: string
): { dynamicScript: string; placeholders: { name: string; value: string; type: string; line: number; context: string }[] } => {
  const allSuggestions = extractSuggestedPlaceholders(scriptCode);

  if (allSuggestions.length === 0) {
    return { dynamicScript: scriptCode, placeholders: [] };
  }

  // Ensure unique placeholder names across all suggestions
  const uniqueSuggestions: typeof allSuggestions = [];
  const usedNames = new Set<string>();
  for (const s of allSuggestions) {
    let finalName = s.name;
    let counter = 2;
    while (usedNames.has(finalName)) finalName = `${s.name}_${counter++}`;
    usedNames.add(finalName);
    uniqueSuggestions.push({ ...s, name: finalName });
  }

  let dynamic = scriptCode;

  for (const s of uniqueSuggestions) {
    const token = `{{${s.name}}}`;
    const val   = escapeRegex(s.value);
    const ln    = s.locatorName ? escapeRegex(s.locatorName) : '';

    switch (s.type) {
      // ── Chained locator+fill: anchor replacement to locator name so identical
      //    fill values for different fields (e.g. 'pulse') are replaced correctly.
      case 'chained_role_fill':
        dynamic = dynamic.replace(
          new RegExp(
            `(getByRole\\(\\s*(['"\`])\\w+\\2\\s*,\\s*\\{[\\s\\S]*?name:\\s*(['"\`])${ln}\\3[\\s\\S]*?\\}\\s*\\)\\.(?:fill|type|pressSequentially|selectOption)\\(\\s*(['"\`]))${val}\\4`,
            'g'
          ),
          `$1${token}$4`
        );
        break;

      case 'chained_label_fill':
        dynamic = dynamic.replace(
          new RegExp(
            `(getByLabel\\(\\s*(['"\`])${ln}\\2\\s*\\)\\.(?:fill|type|pressSequentially|selectOption)\\(\\s*(['"\`]))${val}\\3`,
            'g'
          ),
          `$1${token}$3`
        );
        break;

      case 'chained_placeholder_fill':
        dynamic = dynamic.replace(
          new RegExp(
            `(getByPlaceholder\\(\\s*(['"\`])${ln}\\2\\s*\\)\\.(?:fill|type|pressSequentially|selectOption)\\(\\s*(['"\`]))${val}\\3`,
            'g'
          ),
          `$1${token}$3`
        );
        break;

      case 'chained_testid_fill':
        dynamic = dynamic.replace(
          new RegExp(
            `(getByTestId\\(\\s*(['"\`])${ln}\\2\\s*\\)\\.(?:fill|type|pressSequentially|selectOption)\\(\\s*(['"\`]))${val}\\3`,
            'g'
          ),
          `$1${token}$3`
        );
        break;

      case 'fill_value':
        dynamic = dynamic.replace(
          new RegExp(`(\\.(?:fill|type|pressSequentially|selectOption)\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'select_value':
        dynamic = dynamic.replace(
          new RegExp(`(\\b\\w+\\.selectOption\\(\\s*['"\`].*?['"\`]\\s*,\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'url':
        dynamic = dynamic.replace(
          new RegExp(`(\\b\\w+\\.goto\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'click_target':
        dynamic = dynamic.replace(
          new RegExp(`(getByRole\\([\\s\\S]*?name:\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'text_filter':
        dynamic = dynamic.replace(
          new RegExp(`(filter\\([\\s\\S]*?hasText:\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        dynamic = dynamic.replace(
          new RegExp(`(filter\\([\\s\\S]*?hasText:\\s*\\/\\^?)${val}(\\$?\\/)`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'text':
        dynamic = dynamic.replace(
          new RegExp(`(getByText\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'alt_text':
        dynamic = dynamic.replace(
          new RegExp(`(getByAltText\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'title':
        dynamic = dynamic.replace(
          new RegExp(`(getByTitle\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'label':
        dynamic = dynamic.replace(
          new RegExp(`(getByLabel\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'placeholder_attr':
        dynamic = dynamic.replace(
          new RegExp(`(getByPlaceholder\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;

      case 'test_id':
        dynamic = dynamic.replace(
          new RegExp(`(getByTestId\\(\\s*(['"\`]))${val}\\2`, 'g'),
          `$1${token}$2`
        );
        break;
    }
  }

  return { dynamicScript: dynamic, placeholders: uniqueSuggestions };
};

/**
 * Generate a value for a given field type and test strategy
 */
const generateValueForStrategy = (fieldType: string, strategy: string, index: number): any => {
  const positiveValues: Record<string, any[]> = {
    email: ['user@example.com', 'admin@company.org', 'test.user@domain.co', 'john.doe@mail.com', 'info@site.net'],
    password: ['Password123!', 'Str0ng@Pass', 'MyP@ss2025', 'Secure#456', 'Test!ng789'],
    tel: ['1234567890', '9876543210', '5551234567', '4445556666', '8007771234'],
    url: ['https://example.com', 'https://test.org', 'https://app.domain.com', 'https://site.net', 'https://portal.io'],
    date: ['2025-01-15', '2025-06-30', '2025-12-01', '2024-03-20', '2026-01-01'],
    number: [10, 25, 50, 100, 999],
    text: ['valid_input', 'test_value', 'sample_text', 'hello_world', 'user_data'],
    select: ['option1', 'option2', 'option3', 'default', 'custom']
  };

  const negativeValues: Record<string, any[]> = {
    email: ['not-an-email', '@missing.com', 'user@', '', '   '],
    password: ['123', '', 'a', 'password', '   '],
    tel: ['abc', '', '12', 'phone-number', '+++'],
    url: ['htp://bad', 'not-a-url', '', 'ftp://', '://missing'],
    date: ['2025-13-01', 'not-a-date', '', '00-00-0000', 'abc'],
    number: ['NaN', -9999999999, 'abc', '', null],
    text: ['', '   ', '\x00', null, undefined],
    select: ['', 'invalid_option', null, '   ', 'undefined']
  };

  const boundaryValues: Record<string, any[]> = {
    email: ['a@b.c', 'x'.repeat(64) + '@example.com', 'a@b.co', 'user@' + 'x'.repeat(253) + '.com', 'a@b.c'],
    password: ['a', 'ab', 'a'.repeat(128), 'a'.repeat(255), 'P@1'],
    tel: ['0', '1'.repeat(15), '1'.repeat(20), '00000', '99999999999999'],
    url: ['https://a.b', 'https://' + 'x'.repeat(200) + '.com', 'http://1.2.3.4', 'https://a.co', 'https://test.c'],
    date: ['1970-01-01', '2099-12-31', '2000-02-29', '1900-01-01', '2025-02-28'],
    number: [0, -1, 1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
    text: ['', 'a', 'a'.repeat(255), 'a'.repeat(256), '  a  '],
    select: ['', 'a', 'option_1', 'last_option', 'default']
  };

  const securityValues: Record<string, any[]> = {
    email: ["admin'--@test.com", '<script>alert(1)</script>@x.com', '${7*7}@test.com', 'user@test.com\nBcc: evil@hack.com', '"; DROP TABLE users;--@x.com'],
    password: ["' OR '1'='1", '<script>alert(1)</script>', '${7*7}', '../../../etc/passwd', 'admin\x00'],
    tel: ["' OR 1=1--", '$(whoami)', '{{7*7}}', '; ls -la', '<img src=x onerror=alert(1)>'],
    url: ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'https://evil.com/redirect', '//evil.com'],
    date: ["' OR '1'='1", '<script>alert(1)</script>', '2025-01-01; DROP TABLE--', '{{constructor.constructor("return this")()}}', '../../../etc/passwd'],
    number: ["' OR 1=1--", '0; DROP TABLE--', '${7*7}', 'NaN', '1e308'],
    text: ["' OR '1'='1", "admin'--", '<script>alert(document.cookie)</script>', '{{7*7}}', '../../../etc/passwd'],
    select: ["' OR '1'='1", '<script>alert(1)</script>', '${7*7}', 'option1; DROP TABLE--', '../option']
  };

  const equivalenceValues: Record<string, any[]> = {
    email: ['valid@example.com', 'UPPER@CASE.COM', 'with+tag@test.com', 'invalid-email', ''],
    password: ['ValidPass123!', 'short', 'nouppercase123!', 'NOLOWER123!', ''],
    tel: ['5551234567', '18005551234', '123', 'abcdefghij', ''],
    url: ['https://valid.com', 'http://also-valid.org', 'ftp://different-scheme.com', 'not-a-url', ''],
    date: ['2025-06-15', '2000-01-01', '2099-12-31', 'invalid-date', ''],
    number: [50, 0, -10, 999999, ''],
    text: ['normal_text', 'UPPERCASE', '  spaced  ', 'with-special!@#', ''],
    select: ['option1', 'option2', 'default', '', 'invalid']
  };

  const strategyMap: Record<string, Record<string, any[]>> = {
    positive: positiveValues,
    negative: negativeValues,
    boundary: boundaryValues,
    security: securityValues,
    equivalence: equivalenceValues
  };

  const values = strategyMap[strategy]?.[fieldType] || strategyMap[strategy]?.['text'] || ['test_value'];
  return values[index % values.length];
};
