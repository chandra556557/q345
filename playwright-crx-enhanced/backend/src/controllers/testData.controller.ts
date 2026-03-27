import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import pool from '../db';
import { randomUUID } from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

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
  try {
    const { script_code, scriptCode, template, count, options } = req.body;
    
    // Support both script_code and scriptCode (prioritize scriptCode)
    const actualScriptCode = scriptCode || script_code;

    // Get external API URL and token from .env
    const apiUrlMap: Record<string, string | undefined> = {
      'security': process.env.EXTERNAL_SECURITY_API_URL,
      'boundary': process.env.EXTERNAL_BOUNDARY_API_URL,
      'equivalence': process.env.EXTERNAL_EQUIVALENCE_API_URL,
      'positive': process.env.EXTERNAL_POSITIVE_API_URL,
      'negative': process.env.EXTERNAL_NEGATIVE_API_URL
    };

    const externalApiUrl = apiUrlMap[testDataType];
    const externalToken = process.env.EXTERNAL_API_TOKEN;

    if (!externalApiUrl) {
      res.status(400).json({
        success: false,
        error: `External API URL for ${testDataType} not configured in .env file`
      });
      return;
    }

    if (!externalToken) {
      res.status(400).json({
        success: false,
        error: 'EXTERNAL_API_TOKEN not configured in .env file'
      });
      return;
    }

    console.log(`📤 Forwarding to external API: ${externalApiUrl}`);
    console.log(`🔑 Using token from .env`);
    console.log(`📝 Script length: ${actualScriptCode?.length || 0} characters`);
    console.log(`📋 Template:`, JSON.stringify(template || {}));
    console.log(`🔢 Count: ${count || 10}`);
    console.log(`⚙️ Options:`, JSON.stringify(options || {}));
    
    // Debug: Log first 200 chars of script to verify what's being sent
    if (actualScriptCode) {
      console.log(`📜 Script preview:`, actualScriptCode.substring(0, 200) + '...');
    } else {
      console.warn(`⚠️ WARNING: No scriptCode provided!`);
    }

    // Forward request to external API using Swagger format
    const response = await axios.post(externalApiUrl, {
      scriptCode: actualScriptCode,  // Use camelCase as per Swagger docs
      template: template || {},
      count: count || 10,
      testDataType: testDataType,
      options: options || {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${externalToken}`
      }
    });

    console.log(`✅ External API response received`);
    console.log(`📦 Response structure:`, JSON.stringify(response.data, null, 2).substring(0, 500) + '...');
    console.log(`📊 Data array length:`, Array.isArray(response.data?.data) ? response.data.data.length : 'not an array');
    
    // Log first record to see structure
    if (response.data?.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      console.log(`🔍 First record:`, JSON.stringify(response.data.data[0], null, 2));
    }
    
    // Check if external API returned only metadata (no actual field data)
    const dataArray = Array.isArray(response.data?.data) ? response.data.data : [];
    const hasOnlyMetadata = dataArray.length > 0 && dataArray.every((record: any) => {
      const keys = Object.keys(record);
      return keys.every(key => key.startsWith('_'));
    });
    
    if (hasOnlyMetadata) {
      console.warn(`⚠️ External API returned only metadata - generating local fallback data`);
      
      // Extract field names from script using regex
      const fieldPattern = /getByLabel\(['"]([^'"]+)['"]\)|fill\(['"]|placeholder:\s*['"]([^'"]+)['"]|name:\s*['"]([^'"]+)['"]/g;
      const fields: Set<string> = new Set();
      let match;
      
      while ((match = fieldPattern.exec(actualScriptCode || '')) !== null) {
        const fieldName = match[1] || match[2] || match[3];
        if (fieldName) {
          fields.add(fieldName.toLowerCase());
        }
      }
      
      console.log(`📋 Detected fields from script:`, Array.from(fields));
      
      // Generate boundary test data based on detected fields and type
      const enrichedData = generateLocalTestData(Array.from(fields), testDataType, count || 10);
      
      console.log(`✅ Generated ${enrichedData.length} local test data records`);
      console.log(`🔍 First enriched record:`, JSON.stringify(enrichedData[0], null, 2));
      
      res.status(200).json({
        success: true,
        data: {
          success: true,
          data: enrichedData,
          metadata: {
            count: enrichedData.length,
            testDataType: testDataType,
            template: template || {},
            generated_at: new Date().toISOString(),
            source: 'local_fallback',
            fields_detected: Array.from(fields)
          }
        },
        metadata: {
          external_endpoint: externalApiUrl,
          test_data_type: testDataType,
          source: 'local_fallback'
        }
      });
      return;
    }

    // Return external API response
    res.status(200).json({
      success: true,
      data: response.data,
      metadata: {
        external_endpoint: externalApiUrl,
        test_data_type: testDataType,
        source: 'external_api'
      }
    });
  } catch (error: any) {
    console.error(`❌ External API Error:`, error.message);
    if (error.response) {
      console.error(`👉 Status:`, error.response.status);
      console.error(`👉 Response:`, error.response.data);
    }

    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message,
      metadata: {
        external_endpoint: error.config?.url,
        test_data_type: testDataType,
        source: 'external_api_error'
      }
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
    const fieldType = inferFieldType(f.fieldName || f.selector || '');
    fields.push({ selector: f.selector, fieldName: f.fieldName, fieldType, action: f.action });
  };

  const byLabelRegex = /getByLabel\((['"])\s*([^)]+?)\s*\1\)/g;
  const byPlaceholderRegex = /getByPlaceholder\((['"])\s*([^)]+?)\s*\1\)/g;
  const byRoleTextboxRegex = /getByRole\(\s*['"]textbox['"]\s*,\s*\{[^}]*name:\s*(['"])\s*([^'"}]+)\s*\1[^}]*\}\s*\)/g;
  const fillRegex = /page\.(?:fill|type)\(\s*(['"])\s*([^)]+?)\s*\1\s*,/g;
  const locatorFillRegex = /locator\(\s*(['"])\s*([^)]+?)\s*\1\s*\)\.(?:fill|type)\(/g;
  const selectOptionRegex = /selectOption\(\s*(['"])\s*([^)]+?)\s*\1\s*,/g;
  const checkRegex = /check\(\s*(['"])\s*([^)]+?)\s*\1\s*\)/g;

  let m: RegExpExecArray | null;
  while ((m = byLabelRegex.exec(scriptCode))) pushField({ fieldName: m[2], action: 'fill' });
  while ((m = byPlaceholderRegex.exec(scriptCode))) pushField({ fieldName: m[2], action: 'fill' });
  while ((m = byRoleTextboxRegex.exec(scriptCode))) pushField({ fieldName: m[2], action: 'fill' });
  while ((m = fillRegex.exec(scriptCode))) pushField({ selector: m[2], action: 'fill' });
  while ((m = locatorFillRegex.exec(scriptCode))) pushField({ selector: m[2], action: 'fill' });
  while ((m = selectOptionRegex.exec(scriptCode))) fields.push({ selector: m[2], fieldName: undefined, fieldType: 'select', action: 'selectOption' });
  while ((m = checkRegex.exec(scriptCode))) fields.push({ selector: m[2], fieldName: undefined, fieldType: 'checkbox', action: 'check' });

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
    tel: ['0', '1'.repeat(20)]
  };

  const equivalenceSamples: Record<string, any[]> = {
    email: ['valid@example.com', 'invalid-email'],
    tel: ['9876543210', 'phone-number'],
    number: [10, -5],
    text: ['normal', '']
  };

  const securityPayloads = [
    "' OR '1'='1",
    "admin'--",
    "<script>alert('xss')</script>",
    "'; DROP TABLE users--"
  ];

  return {
    field: name,
    fieldType: type,
    positive: [{ [name]: positiveSamples[type] ?? positiveSamples.text }],
    negative: (negativeSamples[type] ?? negativeSamples.text).map(v => ({ [name]: v })),
    boundary: (boundarySamples[type] ?? []).map(v => ({ [name]: v })),
    equivalence: (equivalenceSamples[type] ?? []).map(v => ({ [name]: v })),
    security: ['text', 'password', 'textarea'].includes(type) ? securityPayloads.map(p => ({ [name]: p })) : []
  };
};

/**
 * Generate test data from script fields (Python first, Node fallback)
 */
export const generateFromScriptTestData = async (req: Request, res: Response) => {
  try {
    const {
      scriptCode,
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
    if (!scriptCode || typeof scriptCode !== 'string') {
      return res.status(400).json({ success: false, error: 'scriptCode is required' });
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

      for (const bt of boundaryTests) {
        const key = bt.field || bt.field_name || bt.selector || 'field';
        if (!bundles.boundary[key]) bundles.boundary[key] = [];
        (bt.test_cases || bt.values || []).forEach((v: any) => bundles.boundary[key].push(v));
      }
      for (const et of equivalenceTests) {
        const key = et.field || et.field_name || et.selector || 'field';
        if (!bundles.equivalence[key]) bundles.equivalence[key] = [];
        (et.test_cases || et.values || []).forEach((v: any) => bundles.equivalence[key].push(v));
      }
      for (const st of securityTests) {
        const key = st.field || st.field_name || st.selector || 'field';
        if (!bundles.security[key]) bundles.security[key] = [];
        (st.payloads || []).forEach((p: any) => bundles.security[key].push(p));
      }
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
