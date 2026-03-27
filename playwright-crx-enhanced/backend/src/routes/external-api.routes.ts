/**
 * External API Integration Routes
 */

import { Router, Request, Response } from 'express';
import {
  createAPIConfig,
  getAPIConfigs,
  getAPIConfig,
  updateAPIConfig,
  deleteAPIConfig,
  executeAPICall,
  getAPICallLogs,
  testAPIConfig
} from '../controllers/external-api.controller';
import { authMiddleware } from '../middleware/auth.middleware';
// import { TestDataService } from '../services/testdata.service';
import { logger } from '../utils/logger';

const router = Router();

// All endpoints require authentication
router.use(authMiddleware);

// API Configuration Management
router.post('/configs', createAPIConfig);
router.get('/configs', getAPIConfigs);
router.get('/configs/:id', getAPIConfig);
router.put('/configs/:id', updateAPIConfig);
router.delete('/configs/:id', deleteAPIConfig);

// API Call Execution
router.post('/execute', executeAPICall);
router.post('/test', testAPIConfig);

// Call Logs
router.get('/logs', getAPICallLogs);

// ---------------------------------------------------------------------------
// Test Data Generation sub-routes (used by DataDrivenTesting frontend)
// ---------------------------------------------------------------------------

// TestDataService available for advanced generation if needed
// const testDataService = new TestDataService();

/**
 * Extract field names from Playwright script code using common selector patterns.
 */
function extractFieldsFromScript(scriptCode: string): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /getByLabel\(['"]([^'"]+)['"]/g,
    /getByPlaceholder\(['"]([^'"]+)['"]/g,
    /fill\(['"]([^'"]+)['"],/g,
    /locator\(['"]([^'"]+)['"]\)/g,
    /getByRole\([^,]+,\s*\{\s*name:\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of scriptCode.matchAll(pattern)) {
      const name = match[1].replace(/[#.\[\]>~+]/g, '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        fields.push(name);
      }
    }
  }
  return fields;
}

function inferFieldType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('email')) return 'email';
  if (n.includes('password') || n.includes('pass')) return 'password';
  if (n.includes('phone') || n.includes('mobile') || n.includes('tel')) return 'phone';
  if (n.includes('age') || n.includes('amount') || n.includes('price') || n.includes('quantity')) return 'number';
  if (n.includes('date') || n.includes('dob') || n.includes('birth')) return 'date';
  if (n.includes('url') || n.includes('website') || n.includes('link')) return 'url';
  if (n.includes('name') || n.includes('first') || n.includes('last')) return 'name';
  return 'text';
}

/**
 * Generate field-level test data for a specific testing type.
 */
function generateFieldData(
  fieldName: string,
  fieldType: string,
  testType: string,
  count: number
): any[] {
  const records: any[] = [];
  for (let i = 0; i < count; i++) {
    const record: Record<string, any> = { _testDataType: testType, _index: i + 1 };

    switch (testType) {
      case 'boundary':
        record[fieldName] = generateBoundaryValue(fieldType, i);
        break;
      case 'positive':
        record[fieldName] = generatePositiveValue(fieldType, i);
        break;
      case 'negative':
        record[fieldName] = generateNegativeValue(fieldType, i);
        break;
      case 'security':
        record[fieldName] = generateSecurityValue(fieldType, i);
        break;
      case 'equivalence':
        record[fieldName] = generateEquivalenceValue(fieldType, i);
        break;
      default:
        record[fieldName] = generatePositiveValue(fieldType, i);
    }
    records.push(record);
  }
  return records;
}

function generateBoundaryValue(type: string, idx: number): any {
  const boundaryValues: Record<string, any[]> = {
    email: ['', 'a@b.c', 'x'.repeat(64) + '@example.com', 'user@' + 'x'.repeat(253), 'valid@email.com', 'a@b.co', 'test@test.test'],
    password: ['', 'a', 'ab', 'abc1234', 'A'.repeat(128), 'Pa$$w0rd!', 'short', 'x'.repeat(256)],
    phone: ['', '1', '1234567890', '+1-234-567-8900', '0'.repeat(15), '+' + '9'.repeat(14), '123'],
    number: [0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0.01, 999999999, -999999999],
    name: ['', 'A', 'Ab', 'x'.repeat(100), 'x'.repeat(255), 'John Doe', "O'Brien", 'José García'],
    text: ['', ' ', 'a', 'x'.repeat(255), 'x'.repeat(1000), 'Normal text', 'Text with\nnewline', '   spaces   '],
    date: ['2000-01-01', '1900-01-01', '2099-12-31', '1970-01-01', new Date().toISOString().split('T')[0], '0001-01-01'],
    url: ['', 'http://a.b', 'https://' + 'x'.repeat(2000) + '.com', 'https://valid.example.com', 'ftp://files.example.com'],
  };
  const values = boundaryValues[type] || boundaryValues.text;
  return values[idx % values.length];
}

function generatePositiveValue(type: string, idx: number): any {
  const positiveValues: Record<string, any[]> = {
    email: ['user@example.com', 'john.doe@gmail.com', 'admin@company.org', 'test+tag@mail.com', 'firstname.lastname@domain.co.uk'],
    password: ['SecureP@ss1', 'MyStr0ng!Pass', 'C0mpl3x#Pwd', 'Val1d_Pass!', 'T3st@User99'],
    phone: ['+1-234-567-8901', '(555) 123-4567', '+44 20 7946 0958', '1234567890', '+91-9876543210'],
    number: [1, 10, 100, 500, 1000, 42, 99, 255, 1024, 7777],
    name: ['John Doe', 'Jane Smith', 'Alice Johnson', 'Bob Williams', 'Carlos García', 'Yuki Tanaka', 'Priya Patel'],
    text: ['Hello World', 'Test input value', 'Sample text data', 'Valid content here', 'Normal text entry'],
    date: ['2024-01-15', '2025-06-30', '2023-12-25', '2024-07-04', '2025-03-15'],
    url: ['https://example.com', 'https://www.google.com', 'https://github.com/user/repo', 'https://app.example.com/dashboard'],
  };
  const values = positiveValues[type] || positiveValues.text;
  return values[idx % values.length];
}

function generateNegativeValue(type: string, idx: number): any {
  const negativeValues: Record<string, any[]> = {
    email: ['notanemail', '@missing-local.com', 'missing-at.com', 'user@@double.com', 'user@.invalid', '.leading@dot.com', 'spaces in@email.com', '<script>@xss.com'],
    password: ['', '123', 'no-uppercase', 'NO-LOWERCASE-1', 'NoSpecialChar1', '   ', 'null', 'undefined'],
    phone: ['abc', '12345', '++1234567890', 'phone-number', '000-000-0000', '1'.repeat(50), '!@#$%^'],
    number: ['abc', '', null, undefined, NaN, Infinity, -Infinity, '12.34.56'],
    name: ['', '   ', '12345', '<script>alert(1)</script>', 'x'.repeat(500), null, '!@#$%^&*'],
    text: [null, undefined, '', '   ', '<script>alert("xss")</script>', 'x'.repeat(10000), '\0\0\0'],
    date: ['not-a-date', '2024-13-01', '2024-02-30', '0000-00-00', '9999-99-99', '', 'yesterday'],
    url: ['not-a-url', 'htp://typo.com', '://missing-protocol.com', 'javascript:alert(1)', 'file:///etc/passwd'],
  };
  const values = negativeValues[type] || negativeValues.text;
  return values[idx % values.length];
}

function generateSecurityValue(_type: string, idx: number): any {
  const securityPayloads = [
    "' OR '1'='1", "'; DROP TABLE users; --", "<script>alert('xss')</script>",
    "<img src=x onerror=alert(1)>", "{{7*7}}", "${7*7}", "../../../etc/passwd",
    "admin'--", "1; SELECT * FROM users", "<svg onload=alert(1)>",
    "' UNION SELECT null,null,null--", "javascript:alert(document.cookie)",
    '{"$gt":""}', "' AND 1=1--", "<iframe src='javascript:alert(1)'>",
    "%00", "%0d%0aInjected-Header: true", "() { :; }; echo vulnerable",
    "<!--", "]]>", "&lt;script&gt;", "\\x3cscript\\x3e",
  ];
  return securityPayloads[idx % securityPayloads.length];
}

function generateEquivalenceValue(type: string, idx: number): any {
  const equivalenceValues: Record<string, any[]> = {
    email: ['short@a.co', 'medium.length@example.com', 'very.long.address.name@subdomain.example.co.uk', 'UPPER@CASE.COM', 'mixed.Case@Example.Com'],
    password: ['Aa1!aaaa', 'Bb2@bbbbbbbbbbbbb', 'Cc3#' + 'c'.repeat(50), 'Dd4$ddd', 'Ee5%eeeeeeeee'],
    phone: ['1234567', '1234567890', '+12345678901234', '(123) 456-7890', '123.456.7890'],
    number: [-1000, -1, 0, 1, 50, 500, 5000, 100000],
    name: ['Al', 'Bob Smith', 'Alexander Hamilton the Third', "Mary-Jane O'Brien", 'José María García López'],
    text: ['a', 'short text', 'A medium length text value for testing', 'A much longer text value that contains multiple words and extends beyond typical field lengths for thorough testing'],
    date: ['1950-01-01', '2000-06-15', '2024-03-23', '2050-12-31'],
    url: ['https://a.co', 'https://www.example.com/path', 'https://sub.domain.example.com/very/long/path?query=value&other=param#fragment'],
  };
  const values = equivalenceValues[type] || equivalenceValues.text;
  return values[idx % values.length];
}

/**
 * Build multi-field test data records from script analysis.
 */
function generateTestDataFromScript(
  scriptCode: string,
  testType: string,
  count: number
): any[] {
  const fields = extractFieldsFromScript(scriptCode);
  if (fields.length === 0) {
    // Fallback: generate generic user-like data
    return generateGenericTestData(testType, count);
  }

  const records: any[] = [];
  for (let i = 0; i < count; i++) {
    const record: Record<string, any> = { _testDataType: testType, _index: i + 1 };
    for (const field of fields) {
      const fieldType = inferFieldType(field);
      const fieldData = generateFieldData(field, fieldType, testType, count);
      record[field] = fieldData[i % fieldData.length][field];
    }
    records.push(record);
  }
  return records;
}

function generateGenericTestData(testType: string, count: number): any[] {
  const genericFields = ['username', 'email', 'password'];
  const records: any[] = [];
  for (let i = 0; i < count; i++) {
    const record: Record<string, any> = { _testDataType: testType, _index: i + 1 };
    for (const field of genericFields) {
      const type = inferFieldType(field);
      const fieldData = generateFieldData(field, type, testType, count);
      record[field] = fieldData[i % fieldData.length][field];
    }
    records.push(record);
  }
  return records;
}

/**
 * Handler for POST /testdata/:type
 * Generates test data based on script code and requested testing type.
 */
async function handleTestDataGeneration(req: Request, res: Response) {
  try {
    const { scriptCode, count = 10, testDataType } = req.body;
    const type = req.params.type || testDataType || 'all';

    if (!scriptCode) {
      return res.status(400).json({ error: 'scriptCode is required' });
    }

    const recordCount = Math.min(Math.max(1, Number(count)), 50);

    let data: any[] = [];

    if (type === 'all') {
      // Generate a mix of all types
      const types = ['boundary', 'positive', 'negative', 'security', 'equivalence'];
      const perType = Math.max(1, Math.ceil(recordCount / types.length));
      for (const t of types) {
        const batch = generateTestDataFromScript(scriptCode, t, perType);
        data.push(...batch);
      }
      data = data.slice(0, recordCount);
    } else {
      data = generateTestDataFromScript(scriptCode, type, recordCount);
    }

    // Re-index
    data.forEach((rec, i) => { rec._index = i + 1; });

    return res.json({ success: true, data, count: data.length, testDataType: type });
  } catch (error: any) {
    logger.error('Test data generation error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to generate test data' });
  }
}

router.post('/testdata/all', handleTestDataGeneration);
router.post('/testdata/boundary', handleTestDataGeneration);
router.post('/testdata/positive', handleTestDataGeneration);
router.post('/testdata/negative', handleTestDataGeneration);
router.post('/testdata/security', handleTestDataGeneration);
router.post('/testdata/equivalence', handleTestDataGeneration);
router.post('/testdata/:type', handleTestDataGeneration);

export default router;
