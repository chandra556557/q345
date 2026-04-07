import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import Papa from 'papaparse';
import pool from '../db';
import { logger } from '../utils/logger';

// ============================================
// Helper: Extract {{placeholder}} patterns
// ============================================
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

// ============================================
// Helper: Field binding matching (exact + fuzzy)
// ============================================
const matchFieldBindings = (
  csvHeaders: string[],
  placeholders: { name: string }[]
): Array<{
  csvHeader: string;
  placeholder: string;
  confidence: 'exact' | 'fuzzy' | 'none';
}> => {
  const fieldBindings: Array<{
    csvHeader: string;
    placeholder: string;
    confidence: 'exact' | 'fuzzy' | 'none';
  }> = [];

  for (const header of csvHeaders) {
    const headerLower = header.toLowerCase().replace(/[\s_-]/g, '');

    let bestMatch: { placeholder: string; confidence: 'exact' | 'fuzzy' | 'none' } | null = null;

    // Try exact match first
    for (const ph of placeholders) {
      const phLower = ph.name.toLowerCase().replace(/[\s_-]/g, '');
      if (headerLower === phLower) {
        bestMatch = { placeholder: ph.name, confidence: 'exact' };
        break;
      }
    }

    // Try fuzzy match (contains)
    if (!bestMatch) {
      for (const ph of placeholders) {
        const phLower = ph.name.toLowerCase();
        if (headerLower.includes(phLower) || phLower.includes(headerLower)) {
          bestMatch = { placeholder: ph.name, confidence: 'fuzzy' };
          break;
        }
      }
    }

    fieldBindings.push({
      csvHeader: header,
      placeholder: bestMatch?.placeholder || header,
      confidence: bestMatch?.confidence || 'none'
    });
  }

  return fieldBindings;
};

// ============================================
// Handler: Upload CSV and auto-bind to script
// ============================================
export const uploadCsvAndBind = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { scriptId, suiteName = 'CSV Import Suite', suiteId, environment = 'dev', save = false } = req.body;

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'CSV file is required' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    if (!csvContent.trim()) {
      return res.status(400).json({ success: false, error: 'CSV file is empty' });
    }

    // Parse CSV with proper delimiter
    let csvData: any;
    try {
      csvData = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false
      });
    } catch (parseErr: any) {
      return res.status(400).json({ success: false, error: `CSV parsing failed: ${parseErr.message}` });
    }

    if (csvData.errors && csvData.errors.length > 0) {
      logger.warn('CSV parsing warnings', csvData.errors);
    }

    let csvHeaders = csvData.meta?.fields || [];
    let csvRows = csvData.data || [];

    // Filter out completely empty rows
    csvRows = csvRows.filter((row: any) => Object.values(row).some((v: any) => v && String(v).trim()));

    if (csvHeaders.length === 0 || csvRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'CSV must have headers and at least one data row'
      });
    }

    // Extract placeholders from script
    let scriptCode = '';
    if (scriptId) {
      const { rows: scriptRows } = await pool.query(
        `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );
      if (scriptRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }
      scriptCode = scriptRows[0].code;
    } else {
      return res.status(400).json({ success: false, error: 'scriptId is required' });
    }

    const placeholders = extractPlaceholdersFromCode(scriptCode);

    // Auto-match CSV headers to placeholders
    const fieldBindings = matchFieldBindings(csvHeaders, placeholders);

    // Identify unmapped headers and placeholders
    const mappedPlaceholders = new Set(fieldBindings.map(fb => fb.placeholder));
    const unmappedPlaceholders = placeholders
      .map(p => p.name)
      .filter(name => !mappedPlaceholders.has(name));

    const mappedHeaders = new Set(
      fieldBindings.filter(fb => fb.confidence !== 'none').map(fb => fb.csvHeader)
    );
    const unmappedHeaders = csvHeaders.filter((h: string) => !mappedHeaders.has(h));

    // Prepare data rows: rekey CSV row values according to fieldBindings
    const dataRows = csvRows.map((row: any, index: number) => {
      const values: Record<string, any> = {};
      for (const binding of fieldBindings) {
        const csvValue = row[binding.csvHeader];
        if (csvValue !== undefined && csvValue !== null) {
          values[binding.placeholder] = csvValue;
        }
      }
      return { index, values };
    });

    // Optional persistence
    let savedSuiteId: string | undefined;
    let savedCount = 0;

    if (save === 'true' || save === true) {
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      let targetSuiteId = suiteId as string | undefined;

      // Create suite if not provided
      if (!targetSuiteId) {
        targetSuiteId = randomUUID();
        const finalSuiteName = suiteName || `CSV Import ${new Date().toISOString().slice(0, 10)}`;
        await pool.query(
          `INSERT INTO "TestSuite" (id, name, description, "userId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, now(), now())`,
          [targetSuiteId, finalSuiteName, `Imported from CSV on ${new Date().toISOString()}`, userId]
        );
      }

      // Validate suite ownership
      const suiteCheck = await pool.query(
        `SELECT id FROM "TestSuite" WHERE id = $1 AND "userId" = $2`,
        [targetSuiteId, userId]
      );
      if (!suiteCheck.rowCount) {
        return res.status(403).json({ success: false, error: 'Test suite not found or unauthorized' });
      }

      // Insert TestData record
      const testDataId = randomUUID();
      await pool.query(
        `INSERT INTO "TestData" (id, "suiteId", name, environment, type, data, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
        [testDataId, targetSuiteId, `CSV Import ${new Date().getTime()}`, environment, 'csv_import', JSON.stringify(dataRows)]
      );

      savedSuiteId = targetSuiteId;
      savedCount = dataRows.length;
    }

    return res.status(200).json({
      success: true,
      status: 'upload_complete',
      message: `Successfully uploaded CSV with ${csvRows.length} rows and ${csvHeaders.length} columns`,
      csv: {
        headers: csvHeaders,
        rowCount: csvRows.length,
        rows: dataRows
      },
      analysis: {
        fieldBindings: {
          mapped: fieldBindings.filter(fb => fb.confidence !== 'none'),
          unmapped: {
            columns: unmappedHeaders,
            placeholders: unmappedPlaceholders
          }
        },
        summary: {
          totalBindings: fieldBindings.length,
          exactMatches: fieldBindings.filter(fb => fb.confidence === 'exact').length,
          fuzzyMatches: fieldBindings.filter(fb => fb.confidence === 'fuzzy').length,
          unmappedCount: unmappedPlaceholders.length
        }
      },
      ...(savedSuiteId && {
        persistence: {
          suiteId: savedSuiteId,
          savedCount: savedCount,
          message: `Successfully persisted ${savedCount} rows to suite`
        }
      })
    });
  } catch (error: any) {
    logger.error('Error in uploadCsvAndBind', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to upload and bind CSV'
    });
  }
};

// ============================================
// Helper: Detect field types from data
// ============================================
const inferFieldTypes = (csvRows: any[], csvHeaders: string[]): Record<string, string> => {
  const fieldTypes: Record<string, string> = {};

  for (const header of csvHeaders) {
    const samples = csvRows
      .map((row: any) => row[header])
      .filter((v: any) => v && String(v).trim());

    if (samples.length === 0) {
      fieldTypes[header] = 'unknown';
      continue;
    }

    // Check field type based on patterns
    const isEmail = samples.every(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s)));
    const isPhone = samples.every(s => /^[\d\s\-\+\(\)]+$/.test(String(s)) && String(s).length >= 10);
    const isUrl = samples.every(s => /^https?:\/\//.test(String(s)));
    const isNumeric = samples.every(s => !isNaN(Number(s)) && s !== '');
    const isBoolean = samples.every(s => ['true', 'false', 'yes', 'no', '0', '1'].includes(String(s).toLowerCase()));
    const isDate = samples.every(s => !isNaN(new Date(String(s)).getTime()));
    const isPassword = header.toLowerCase().includes('password');

    if (isEmail) fieldTypes[header] = 'email_address';
    else if (isPhone) fieldTypes[header] = 'phone_number';
    else if (isUrl) fieldTypes[header] = 'url';
    else if (isPassword) fieldTypes[header] = 'password';
    else if (isBoolean) fieldTypes[header] = 'boolean';
    else if (isNumeric) fieldTypes[header] = 'number';
    else if (isDate) fieldTypes[header] = 'date';
    else fieldTypes[header] = 'text';
  }

  return fieldTypes;
};

// ============================================
// Helper: Validate CSV data
// ============================================
const validateCsvData = (csvRows: any[], csvHeaders: string[], fieldTypes?: Record<string, string>) => {
  const issues: any[] = [];
  const warnings: any[] = [];

  for (let rowIdx = 0; rowIdx < csvRows.length; rowIdx++) {
    const row = csvRows[rowIdx];

    for (const header of csvHeaders) {
      const value = row[header];
      const fieldType = fieldTypes?.[header];

      // Empty cell check
      if (!value || String(value).trim() === '') {
        warnings.push({
          row: rowIdx + 1,
          column: header,
          issue: 'Empty value',
          severity: 'warning'
        });
        continue;
      }

      const stringValue = String(value).trim();

      // Email validation
      if (fieldType === 'email_address') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)) {
          issues.push({
            row: rowIdx + 1,
            column: header,
            issue: 'Invalid email format',
            value: stringValue,
            severity: 'error'
          });
        }
      }

      // URL validation
      if (fieldType === 'url') {
        if (!/^https?:\/\//.test(stringValue)) {
          issues.push({
            row: rowIdx + 1,
            column: header,
            issue: 'Invalid URL format',
            value: stringValue,
            severity: 'error'
          });
        }
      }

      // Number validation
      if (fieldType === 'number') {
        if (isNaN(Number(stringValue))) {
          issues.push({
            row: rowIdx + 1,
            column: header,
            issue: 'Expected numeric value',
            value: stringValue,
            severity: 'error'
          });
        }
      }

      // Phone validation
      if (fieldType === 'phone_number') {
        if (!/^[\d\s\-\+\(\)]+$/.test(stringValue) || stringValue.length < 10) {
          warnings.push({
            row: rowIdx + 1,
            column: header,
            issue: 'Invalid phone format',
            value: stringValue,
            severity: 'warning'
          });
        }
      }

      // Password strength check
      if (fieldType === 'password') {
        if (stringValue.length < 8) {
          warnings.push({
            row: rowIdx + 1,
            column: header,
            issue: 'Weak password (less than 8 characters)',
            severity: 'warning'
          });
        }
      }

      // Special characters in names
      if (['text', 'email_address'].includes(fieldType || '')) {
        if (stringValue.length > 255) {
          warnings.push({
            row: rowIdx + 1,
            column: header,
            issue: 'Value exceeds 255 characters',
            severity: 'warning'
          });
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    errorCount: issues.length,
    warningCount: warnings.length,
    issues: issues,
    warnings: warnings
  };
};

// ============================================
// Handler: Parse CSV inline with optional analysis
// ============================================
export const parseCsvInline = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const {
      csvContent,
      delimiter = ',',
      scriptId,                    // NEW: Optional script for binding analysis
      analyzeBindings = false,     // NEW: Enable field binding analysis
      validateData = false,        // NEW: Enable data validation
      detectFieldTypes = false     // NEW: Enable field type detection
    } = req.body;

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ success: false, error: 'csvContent is required' });
    }

    // Parse CSV
    let csvData: any;
    try {
      csvData = Papa.parse(csvContent, {
        header: true,
        delimiter: delimiter,
        skipEmptyLines: true,
        dynamicTyping: false
      });
    } catch (parseErr: any) {
      return res.status(400).json({ success: false, error: `CSV parsing failed: ${parseErr.message}` });
    }

    let csvHeaders = csvData.meta?.fields || [];
    let csvRows = csvData.data || [];

    // Filter out completely empty rows
    csvRows = csvRows.filter((row: any) => Object.values(row).some((v: any) => v && String(v).trim()));

    const responseData: any = {
      success: true,
      status: 'parse_complete',
      message: `Successfully parsed CSV with ${csvRows.length} rows and ${csvHeaders.length} columns`,
      csv: {
        headers: csvHeaders,
        rowCount: csvRows.length,
        rows: csvRows.map((row: any, idx: number) => ({
          index: idx,
          values: row
        }))
      }
    };

    // NEW: Field binding analysis
    if (analyzeBindings && scriptId) {
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { rows: scriptRows } = await pool.query(
        `SELECT code FROM "Script" WHERE id = $1 AND "userId" = $2`,
        [scriptId, userId]
      );

      if (scriptRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }

      const scriptCode = scriptRows[0].code;
      const placeholders = extractPlaceholdersFromCode(scriptCode);
      const fieldBindings = matchFieldBindings(csvHeaders, placeholders);

      const mappedPlaceholders = new Set(fieldBindings.map(fb => fb.placeholder));
      const unmappedPlaceholders = placeholders
        .map(p => p.name)
        .filter(name => !mappedPlaceholders.has(name));

      const mappedHeaders = new Set(
        fieldBindings.filter(fb => fb.confidence !== 'none').map(fb => fb.csvHeader)
      );
      const unmappedHeaders = csvHeaders.filter((h: string) => !mappedHeaders.has(h));

      responseData.analysis = {
        fieldBindings: {
          mapped: fieldBindings.filter(fb => fb.confidence !== 'none'),
          unmapped: {
            columns: unmappedHeaders,
            placeholders: unmappedPlaceholders
          }
        },
        summary: {
          totalBindings: fieldBindings.length,
          exactMatches: fieldBindings.filter(fb => fb.confidence === 'exact').length,
          fuzzyMatches: fieldBindings.filter(fb => fb.confidence === 'fuzzy').length,
          unmappedCount: unmappedPlaceholders.length
        }
      };
    }

    // NEW: Field type detection
    let detectedTypes: Record<string, string> | undefined;
    if (detectFieldTypes) {
      detectedTypes = inferFieldTypes(csvRows, csvHeaders);
      responseData.fieldTypes = detectedTypes;
    }

    // NEW: Data validation
    if (validateData) {
      const validation = validateCsvData(csvRows, csvHeaders, detectedTypes);
      responseData.validation = validation;
    }

    return res.status(200).json(responseData);
  } catch (error: any) {
    logger.error('Error in parseCsvInline', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to parse CSV'
    });
  }
};

// ============================================
// Handler: Preview CSV binding result
// ============================================
export const previewCsvBinding = async (req: Request, res: Response) => {
  try {
    const { csvContent, csvRows, fieldBindings, scriptCode, previewRowIndex = 0 } = req.body;

    if (!scriptCode) {
      return res.status(400).json({ success: false, error: 'scriptCode is required' });
    }

    if (!fieldBindings || Object.keys(fieldBindings).length === 0) {
      return res.status(400).json({ success: false, error: 'fieldBindings is required' });
    }

    let rowsToUse = csvRows;

    // Parse CSV if csvContent provided
    if (csvContent && !csvRows) {
      let csvData: any;
      try {
        csvData = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
        rowsToUse = csvData.data || [];
      } catch (parseErr: any) {
        return res.status(400).json({ success: false, error: `CSV parsing failed: ${parseErr.message}` });
      }
    }

    if (!rowsToUse || rowsToUse.length === 0) {
      return res.status(400).json({ success: false, error: 'No CSV rows provided' });
    }

    const previewRow = rowsToUse[previewRowIndex];
    if (!previewRow) {
      return res.status(400).json({
        success: false,
        error: `Row index ${previewRowIndex} out of bounds (total rows: ${rowsToUse.length})`
      });
    }

    // Apply substitutions
    let substitutedCode = scriptCode;
    const appliedValues: Record<string, string> = {};

    for (const [placeholder, csvHeader] of Object.entries(fieldBindings)) {
      const value = previewRow[csvHeader as string];
      if (value === undefined || value === null) continue;

      const stringValue = String(value);
      const pattern = new RegExp(`\\{\\{${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g');
      substitutedCode = substitutedCode.replace(pattern, stringValue);
      appliedValues[placeholder] = stringValue;
    }

    return res.status(200).json({
      success: true,
      status: 'preview_generated',
      message: `Preview generated for row ${previewRowIndex + 1} of ${rowsToUse.length}`,
      preview: {
        rowIndex: previewRowIndex,
        totalRows: rowsToUse.length,
        code: {
          original: scriptCode,
          substituted: substitutedCode
        },
        appliedValues: appliedValues,
        substitutionCount: Object.keys(appliedValues).length
      }
    });
  } catch (error: any) {
    logger.error('Error in previewCsvBinding', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to preview CSV binding'
    });
  }
};

// ============================================
// Handler: Export TestSuite as CSV
// ============================================
export const exportSuiteAsCsv = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { suiteId } = req.params;

    if (!suiteId) {
      return res.status(400).json({ success: false, error: 'suiteId is required' });
    }

    // Verify suite ownership
    const suiteCheck = await pool.query(
      `SELECT name FROM "TestSuite" WHERE id = $1 AND "userId" = $2`,
      [suiteId, userId]
    );

    if (!suiteCheck.rowCount) {
      return res.status(403).json({ success: false, error: 'Test suite not found or unauthorized' });
    }

    const suiteName = suiteCheck.rows[0].name;

    // Fetch all TestData for this suite
    const dataRows = await pool.query(
      `SELECT data FROM "TestData" WHERE "suiteId" = $1 ORDER BY "createdAt" ASC`,
      [suiteId]
    );

    if (dataRows.rowCount === 0) {
      return res.status(200).send(''); // Empty CSV
    }

    // Flatten all test data into a single array of records
    const allRecords: any[] = [];
    const allHeaders = new Set<string>();

    for (const row of dataRows.rows) {
      const data = row.data;
      const records = Array.isArray(data) ? data : typeof data === 'object' ? [data] : [];

      for (const record of records) {
        if (typeof record === 'object' && record !== null) {
          const flat = record.values || record; // Handle { values: {...} } or direct {...}
          for (const key of Object.keys(flat)) {
            allHeaders.add(key);
          }
          allRecords.push(flat);
        }
      }
    }

    // Convert to CSV
    const headers = Array.from(allHeaders);
    if (headers.length === 0) {
      return res.status(200).send('');
    }

    const csvContent = Papa.unparse({
      fields: headers,
      data: allRecords.map(record => headers.map(h => record[h] ?? ''))
    });

    const filename = `suite-${suiteName.replace(/\s+/g, '-')}-${suiteId}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Records', allRecords.length.toString());
    res.setHeader('X-Export-Columns', headers.length.toString());
    return res.status(200).send(csvContent);
  } catch (error: any) {
    logger.error('Error in exportSuiteAsCsv', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to export suite as CSV'
    });
  }
};
