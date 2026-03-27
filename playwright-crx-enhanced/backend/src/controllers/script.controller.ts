import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import pool from '../db';
import { randomUUID } from 'crypto';
import { testRunnerService } from '../services/testRuns/testRunner.service';


/**
 * Get all scripts for a user
 */
export const getScripts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId } = req.query;

    let query = `SELECT s.id, s.name, s.description, s.language, s."browserType" as "browserType",
              s."createdAt" as "createdAt", s."updatedAt" as "updatedAt", s."projectId" as "projectId",
              p.name AS "projectName", u.name AS "userName", u.email AS "userEmail"
       FROM "Script" s
       LEFT JOIN "Project" p ON p.id = s."projectId"
       LEFT JOIN "User" u ON u.id = s."userId"
       WHERE s."userId" = $1`;
    
    const params = [userId];
    
    if (projectId) {
      query += ` AND s."projectId" = $2`;
      params.push(projectId as string);
    }
    
    query += ` ORDER BY s."createdAt" DESC`;

    const { rows } = await pool.query(query, params);

    const scripts = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      language: r.language,
      browserType: r.browserType,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      projectId: r.projectId,
      project: r.projectName ? { name: r.projectName } : null,
      user: { name: r.userName || 'Unknown User', email: r.userEmail || '' }
    }));

    res.status(200).json({
      success: true,
      data: scripts
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get scripts'
    });
  }
};

/**
 * Get a specific script
 */
export const getScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.description, s.language, s.code, s."browserType" as "browserType",
              s.viewport, s."testIdAttribute" as "testIdAttribute", s."workflowStatus" as "workflowStatus",
              s."createdAt" as "createdAt", s."updatedAt" as "updatedAt", s."projectId" as "projectId",
              p.name AS "projectName"
       FROM "Script" s
       LEFT JOIN "Project" p ON p.id = s."projectId"
       WHERE s.id = $1 AND s."userId" = $2`,
      [id, userId]
    );

    const script = rows[0];
    if (!script) {
      throw new AppError('Script not found', 404);
    }

    res.status(200).json({
      success: true,
      data: {
        id: script.id,
        name: script.name,
        description: script.description,
        language: script.language,
        code: script.code,
        browserType: script.browserType,
        viewport: script.viewport,
        testIdAttribute: script.testIdAttribute,
        workflowStatus: script.workflowStatus || 'draft',
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
        projectId: script.projectId,
        project: script.projectName ? { name: script.projectName } : null
      }
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get script'
      });
    }
  }
};

/**
 * Create a new script
 */
export const createScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { name, description, language, code, projectId } = req.body;

    // Validate required fields
    if (!name || !code) {
      throw new AppError('Name and code are required', 400);
    }

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO "Script" (id, name, description, language, code, "userId", "projectId",
                              "browserType", "workflowStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, COALESCE($4, 'typescript'), $5, $6, $7, 'chromium', 'draft', now(), now())
       RETURNING id, name, description, language, code, "browserType", viewport, "testIdAttribute",
                 "workflowStatus", "createdAt", "updatedAt", "projectId"`,
      [id, name, description ?? null, language, code, userId, projectId ?? null]
    );
    const script = rows[0];

    res.status(201).json({
      success: true,
      data: script
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create script'
      });
    }
  }
};

/**
 * Update a script
 */
export const updateScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { name, description, language, code, browserType, viewport, testIdAttribute } = req.body;

    // Check if script exists and belongs to user
    const existing = await pool.query(
      `SELECT id FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) {
      throw new AppError('Script not found', 404);
    }

    const { rows } = await pool.query(
      `UPDATE "Script"
       SET name = COALESCE($2, name),
           description = $3,
           language = $4,
           code = $5,
           "browserType" = $6,
           viewport = $7,
           "testIdAttribute" = $8,
           "updatedAt" = now()
       WHERE id = $1
       RETURNING id, name, description, language, code, "browserType", viewport, "testIdAttribute",
                 "workflowStatus", "createdAt", "updatedAt", "projectId"`,
      [id, name ?? null, description ?? null, language ?? null, code ?? null, browserType ?? null, viewport ?? null, testIdAttribute ?? null]
    );
    const script = rows[0];

    res.status(200).json({
      success: true,
      data: script
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update script'
      });
    }
  }
};

/**
 * Delete a script
 */
export const deleteScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    const existing = await pool.query(
      `SELECT id FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) {
      throw new AppError('Script not found', 404);
    }

    await pool.query(
      `DELETE FROM "Script" WHERE id = $1`,
      [id]
    );

    res.status(200).json({
      success: true,
      message: 'Script deleted successfully'
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete script'
      });
    }
  }
};

/**
 * Enhance a script with AI suggestions (Phase I: Selector, Wait, Assertion improvements)
 */
export const enhanceScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT id, name, code, language, "testIdAttribute" FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!rows.length) throw new AppError('Script not found', 404);

    const script = rows[0];
    const code: string = script.code || '';
    const lines = code.split('\n');

    type Suggestion = {
      lineNumber: number;
      originalCode: string;
      suggestedCode: string;
      reason: string;
      confidence: number;
      category: 'selector' | 'wait' | 'assertion' | 'page-object' | 'parameterization' | 'error-handling' | 'logging' | 'retry' | 'best-practice';
      aiPowered?: boolean;
      xpathAnalysis?: any;
      aiMetadata?: any;
    };

    const suggestions: Suggestion[] = [];

    // ============ NEW: NODE.JS AI SERVICE (NO PYTHON) ============
    try {
      console.log('🤖 Calling Node.js AI service for enhanced script analysis...');
      
      const { scriptAnalysisService } = await import('../services/script-analysis.service');
      const aiResponse = await scriptAnalysisService.analyzeScript(code, true);
      
      if (aiResponse.success) {
        const aiAnalysis = aiResponse.data;
        console.log(`✅ Node.js AI Analysis: Quality ${aiAnalysis.quality_score}/100, ${aiAnalysis.recommendations?.length || 0} recommendations`);
        
        // Convert AI recommendations to suggestions
        if (aiAnalysis.recommendations && Array.isArray(aiAnalysis.recommendations)) {
          aiAnalysis.recommendations.forEach((rec: any) => {
            suggestions.push({
              lineNumber: rec.line_number || 0,
              originalCode: lines[rec.line_number] || '',
              suggestedCode: rec.suggested_code || rec.suggestion || '',
              reason: rec.description || rec.title || 'AI-recommended improvement',
              confidence: rec.priority === 'high' ? 0.95 : rec.priority === 'medium' ? 0.85 : 0.75,
              category: rec.category || 'best-practice',
              aiPowered: true,
              aiMetadata: {
                quality_score: aiAnalysis.quality_score,
                test_pattern: aiAnalysis.test_pattern,
                analysis_method: aiAnalysis.metadata.analysis_method
              }
            });
          });
        }

        // Add XPath-specific suggestions
        if (aiAnalysis.xpath_analysis && Array.isArray(aiAnalysis.xpath_analysis)) {
          aiAnalysis.xpath_analysis.forEach((xpath: any) => {
            if (xpath.stability_score < 60 || xpath.complexity_score > 70) {
              suggestions.push({
                lineNumber: xpath.line_number,
                originalCode: lines[xpath.line_number] || '',
                suggestedCode: xpath.playwright_suggestion || xpath.recommended_alternative || `// ${xpath.recommended_alternative}`,
                reason: `XPath stability: ${xpath.stability_score}/100, complexity: ${xpath.complexity_score}/100. Issues: ${xpath.issues.join(', ')}`,
                confidence: 0.92,
                category: 'selector',
                aiPowered: true,
                xpathAnalysis: {
                  type: xpath.type,
                  stability_score: xpath.stability_score,
                  complexity_score: xpath.complexity_score,
                  issues: xpath.issues
                }
              });
            }
          });
        }
        
        console.log(`✅ Added ${suggestions.length} AI-powered suggestions (Node.js)`);
      }
    } catch (aiError: any) {
      console.warn('⚠️ Node.js AI service unavailable, using regex patterns:', aiError.message);
    }
    // ============ END NODE.JS AI SERVICE INTEGRATION ============

    // Heuristic patterns for Phase I enhancements
    const textSelectorRegex = /(page\.(click|locator)\s*\(\s*['"]text=([^'"]+)['"]\s*\))/;
    const classSelectorRegex = /(page\.(click|fill|locator)\s*\(\s*['"]\.[a-zA-Z][\w-]*['"]\s*\))/;
    const waitTimeoutRegex = /(await\s+page\.waitForTimeout\s*\(\s*\d+\s*\))/;
    const truthyLocatorRegex = /(expect\s*\(\s*page\.locator\([^)]+\)\s*\)\.toBeTruthy\s*\(\s*\))/;
    const truthyRegex = /(expect\s*\(\s*([a-zA-Z_][\w]*)\s*\)\.toBeTruthy\s*\(\s*\))/;

    // Phase II: Additional heuristic patterns
    const hardcodedStringRegex = /(await\s+page\.(fill|type)\s*\([^,]+,\s*['"]([^'"]{3,})['"]\s*\))/;
    const hardcodedUrlRegex = /(await\s+page\.goto\s*\(\s*['"](https?:\/\/[^'"]+)['"]\s*\))/;
    const repeatedSelectorRegex = /(['"][#.][a-zA-Z][\w-]*['"])/g;
    const clickWithoutTryCatchRegex = /(^\s*await\s+page\.(click|fill|press|type)\([^)]+\);?\s*$)/;

    // Phase III: New enhancement patterns (logging, retry, best practices)
    const missingConsoleLogRegex = /(await\s+page\.(goto|click|fill)\s*\([^)]+\))/;
    const noRetryOnFailRegex = /(await\s+page\.waitForSelector\s*\([^)]+\)(?!.*\{.*timeout))/;
    const magicNumberRegex = /(timeout:\s*(\d{4,}))/;
    const noPageObjectRegex = /(page\.locator\s*\(\s*['"][^'"]{15,}['"]\s*\))/;
    
    // XPath patterns
    const xpathLocatorRegex = /(page\.locator\s*\(\s*['"](\/\/[^'"]+)['"]\s*\))/;
    const xpathClickRegex = /(page\.click\s*\(\s*['"](\/\/[^'"]+)['"]\s*\))/;
    const xpathFillRegex = /(page\.fill\s*\(\s*['"](\/\/[^'"]+)['"])/;
    
    // Phase IV: Advanced Selector & Accessibility patterns
    const buttonClickRegex = /(page\.(click|locator)\s*\(\s*['"][^'"]*button[^'"]*['"]\s*\))/i;
    const inputFillRegex = /(page\.(fill|locator)\s*\(\s*['"][^'"]*input[^'"]*['"]\s*\))/i;
    const imgLocatorRegex = /(page\.locator\s*\(\s*['"][^'"]*img[^'"]*['"]\s*\))/i;
    // const labelForRegex = /(page\.locator\s*\(\s*['"]label\[for=['"]([^'"]+)['"]\]['"]\s*\))/; // Unused
    const titleAttrRegex = /(page\.locator\s*\(\s*['"]\[title=['"]([^'"]+)['"]\]['"]\s*\))/;
    const ariaLabelRegex = /(page\.locator\s*\(\s*['"]\[aria-label=['"]([^'"]+)['"]\]['"]\s*\))/;
    const chainedLocatorRegex = /(page\.locator\([^)]+\)\.locator\([^)]+\)\.locator\([^)]+\))/;
    const pressEnterRegex = /(page\.keyboard\.press\s*\(\s*['"]Enter['"]\s*\))/;
    
    // Phase V: Test Data Management patterns
    const hardcodedEmailRegex = /(await\s+page\.fill\([^,]+,\s*['"]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['"]\s*\))/;
    const hardcodedPhoneRegex = /(await\s+page\.fill\([^,]+,\s*['"]([0-9]{10,}|\+[0-9\s-]+)['"]\s*\))/;
    const hardcodedNameRegex = /(await\s+page\.fill\([^,]+,\s*['"]([A-Z][a-z]+\s+[A-Z][a-z]+)['"]\s*\))/;
    const envUrlMissingRegex = /(const\s+\w+\s*=\s*['"]https?:\/\/[^'"]+['"]);?(?!.*process\.env)/;
    const fixtureOpportunityRegex = /(const\s+(\w+Data)\s*=\s*\{[^}]+\})/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      // 1. Selector: text= → getByText
      const m1 = line.match(textSelectorRegex);
      if (m1) {
        const method = m1[2];
        const textVal = m1[3];
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = method === 'click'
          ? `${indent}await page.getByText('${textVal}').click()`
          : `${indent}page.getByText('${textVal}')`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use getByText() for robust text-based selection (Playwright recommended pattern)',
          confidence: 0.92,
          category: 'selector'
        });
        continue;
      }

      // 2. Selector: class selector → data-testid or role-based
      const m2 = line.match(classSelectorRegex);
      if (m2 && !suggestions.find(s => s.lineNumber === i)) {
        const method = m2[2];
        const className = m2[0].match(/\.[a-zA-Z][\w-]*/)?.[0];
        const indent = line.match(/^\s*/)?.[0] || '';
        const testId = className?.replace('.', '').replace(/-/g, '-');
        const suggested = method === 'click'
          ? `${indent}await page.getByTestId('${testId}').click()`
          : method === 'fill'
          ? `${indent}await page.getByTestId('${testId}').fill(value)`
          : `${indent}page.getByTestId('${testId}')`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Upgrade class selector to data-testid for better stability and specificity',
          confidence: 0.88,
          category: 'selector'
        });
        continue;
      }

      // 2a. Selector: XPath → Playwright locators (Phase I enhancement)
      const mXpath1 = line.match(xpathLocatorRegex);
      if (mXpath1 && !suggestions.find(s => s.lineNumber === i)) {
        const xpath = mXpath1[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        let suggested = line;
        let reason = 'Convert XPath to Playwright locator for better readability and maintainability';
        
        // Try to convert common XPath patterns to Playwright locators
        if (xpath.includes('@id=')) {
          const idMatch = xpath.match(/@id=['"]([^'"]+)['"]/);
          if (idMatch) {
            suggested = line.replace(mXpath1[0], `page.locator('#${idMatch[1]}')`)
            reason = 'Convert XPath with @id to CSS ID selector for better performance';
          }
        } else if (xpath.includes('@class=')) {
          const classMatch = xpath.match(/@class=['"]([^'"]+)['"]/);
          if (classMatch) {
            suggested = line.replace(mXpath1[0], `page.locator('.${classMatch[1].split(' ')[0]}')`)
            reason = 'Convert XPath with @class to CSS class selector';
          }
        } else if (xpath.includes('text()=')) {
          const textMatch = xpath.match(/text\(\)=['"]([^'"]+)['"]/);
          if (textMatch) {
            suggested = line.replace(mXpath1[0], `page.getByText('${textMatch[1]}')`)
            reason = 'Convert XPath text() to Playwright getByText() for better readability';
          }
        } else if (xpath.includes('@data-testid=')) {
          const testIdMatch = xpath.match(/@data-testid=['"]([^'"]+)['"]/);
          if (testIdMatch) {
            suggested = line.replace(mXpath1[0], `page.getByTestId('${testIdMatch[1]}')`)
            reason = 'Convert XPath with data-testid to Playwright getByTestId()';
          }
        } else if (xpath.includes('@placeholder=')) {
          const placeholderMatch = xpath.match(/@placeholder=['"]([^'"]+)['"]/);
          if (placeholderMatch) {
            suggested = line.replace(mXpath1[0], `page.getByPlaceholder('${placeholderMatch[1]}')`)
            reason = 'Convert XPath with placeholder to Playwright getByPlaceholder()';
          }
        } else {
          // Generic conversion - keep xpath but suggest alternatives
          suggested = `${indent}// TODO: Consider converting XPath to Playwright locator for better maintainability\n${line}`;
          reason = 'XPath detected - consider using Playwright locators (getByRole, getByText, getByTestId) for better resilience';
        }

        if (suggested !== line) {
          suggestions.push({
            lineNumber: i,
            originalCode: line,
            suggestedCode: suggested,
            reason,
            confidence: 0.87,
            category: 'selector'
          });
          continue;
        }
      }

      // 2b. Selector: XPath in click/fill → convert
      const mXpath2 = line.match(xpathClickRegex);
      if (mXpath2 && !suggestions.find(s => s.lineNumber === i)) {
        const xpath = mXpath2[2];
        // const indent = line.match(/^\s*/)?.[0] || ''; // Unused here
        let suggested = line;
        let reason = 'Convert XPath click to Playwright locator';
        
        if (xpath.includes('@id=')) {
          const idMatch = xpath.match(/@id=['"]([^'"]+)['"]/);
          if (idMatch) {
            suggested = line.replace(mXpath2[0], `page.locator('#${idMatch[1]}').click()`)
            reason = 'Convert XPath click to CSS ID selector';
          }
        } else if (xpath.includes('text()=')) {
          const textMatch = xpath.match(/text\(\)=['"]([^'"]+)['"]/);
          if (textMatch) {
            suggested = line.replace(mXpath2[0], `page.getByText('${textMatch[1]}').click()`)
            reason = 'Convert XPath text-based click to getByText().click()';
          }
        } else if (xpath.includes('@data-testid=')) {
          const testIdMatch = xpath.match(/@data-testid=['"]([^'"]+)['"]/);
          if (testIdMatch) {
            suggested = line.replace(mXpath2[0], `page.getByTestId('${testIdMatch[1]}').click()`)
            reason = 'Convert XPath click to getByTestId().click()';
          }
        }

        if (suggested !== line) {
          suggestions.push({
            lineNumber: i,
            originalCode: line,
            suggestedCode: suggested,
            reason,
            confidence: 0.89,
            category: 'selector'
          });
          continue;
        }
      }

      // 2c. Selector: XPath in fill → convert
      const mXpath3 = line.match(xpathFillRegex);
      if (mXpath3 && !suggestions.find(s => s.lineNumber === i)) {
        const xpath = mXpath3[2];
        // const indent = line.match(/^\s*/)?.[0] || ''; // Unused here
        let suggested = line;
        let reason = 'Convert XPath fill to Playwright locator';
        
        if (xpath.includes('@placeholder=')) {
          const placeholderMatch = xpath.match(/@placeholder=['"]([^'"]+)['"]/);
          if (placeholderMatch) {
            const fullMatch = line.match(/page\.fill\s*\([^,]+,\s*['"]([^'"]+)['"]/);
            const fillValue = fullMatch ? fullMatch[1] : 'value';
            suggested = line.replace(/page\.fill\s*\([^)]+\)/, `page.getByPlaceholder('${placeholderMatch[1]}').fill('${fillValue}')`)
            reason = 'Convert XPath placeholder-based fill to getByPlaceholder().fill()';
          }
        } else if (xpath.includes('@id=')) {
          const idMatch = xpath.match(/@id=['"]([^'"]+)['"]/);
          if (idMatch) {
            suggested = line.replace(mXpath3[0], `page.locator('#${idMatch[1]}').fill(`)
            reason = 'Convert XPath fill to CSS ID selector';
          }
        }

        if (suggested !== line) {
          suggestions.push({
            lineNumber: i,
            originalCode: line,
            suggestedCode: suggested,
            reason,
            confidence: 0.86,
            category: 'selector'
          });
          continue;
        }
      }

      // 3. Wait: waitForTimeout → explicit wait
      const m3 = line.match(waitTimeoutRegex);
      if (m3 && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}await page.waitForLoadState('networkidle')`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: "Replace arbitrary timeout with explicit load state wait (networkidle)",
          confidence: 0.88,
          category: 'wait'
        });
        continue;
      }

      // 4. Assertion: toBeTruthy on locator → toBeVisible
      const m4 = line.match(truthyLocatorRegex);
      if (m4 && !suggestions.find(s => s.lineNumber === i)) {
        const suggested = line.replace(/toBeTruthy\s*\(\s*\)/, 'toBeVisible()');

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use semantic assertion (toBeVisible) on locator instead of truthiness',
          confidence: 0.86,
          category: 'assertion'
        });
        continue;
      }

      // 5. Assertion: generic toBeTruthy → specific assertion
      const m5 = line.match(truthyRegex);
      if (m5 && !m4 && !suggestions.find(s => s.lineNumber === i)) {
        // const varName = m5[2]; // Unused
        const suggested = line.replace(/toBeTruthy\s*\(\s*\)/, `toBeDefined()`);

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use specific assertion (toBeDefined) instead of truthiness check',
          confidence: 0.82,
          category: 'assertion'
        });
        continue;
      }

      // PHASE II ENHANCEMENTS

      // 6. Parameterization: hard-coded strings in fill/type → constants
      const m6 = line.match(hardcodedStringRegex);
      if (m6 && !suggestions.find(s => s.lineNumber === i)) {
        // const method = m6[2]; // Unused
        const value = m6[3];
        const indent = line.match(/^\s*/)?.[0] || '';
        const varName = value.length > 20 ? 'TEST_DATA' : value.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const suggested = `${indent}const ${varName} = '${value}';\n${line.replace(`'${value}'`, varName)}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: `Extract hard-coded test data '${value.substring(0, 20)}...' to a named constant for reusability`,
          confidence: 0.78,
          category: 'parameterization'
        });
        continue;
      }

      // 7. Parameterization: hard-coded URLs → environment variables
      const m7 = line.match(hardcodedUrlRegex);
      if (m7 && !suggestions.find(s => s.lineNumber === i)) {
        const url = m7[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}const BASE_URL = process.env.BASE_URL || '${url}';\n${line.replace(`'${url}'`, 'BASE_URL')}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Move base URL to environment variable for flexible deployment across environments',
          confidence: 0.85,
          category: 'parameterization'
        });
        continue;
      }

      // 8. Error Handling: wrap brittle actions in try-catch with screenshot
      const m8 = line.match(clickWithoutTryCatchRegex);
      if (m8 && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const action = m8[0].trim();
        const suggested = `${indent}try {
${indent}  ${action}
${indent}} catch (error) {
${indent}  await page.screenshot({ path: 'error-screenshot.png' });
${indent}  throw error;
${indent}}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Add error handling with screenshot capture for easier debugging when action fails',
          confidence: 0.75,
          category: 'error-handling'
        });
        continue;
      }

      // PHASE III ENHANCEMENTS

      // 9. Logging: Add console logs for critical actions
      const m9 = line.match(missingConsoleLogRegex);
      if (m9 && i > 0 && !lines[i-1].includes('console.log') && !suggestions.find(s => s.lineNumber === i)) {
        const action = m9[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const logMessage = action === 'goto' ? 'Navigating to page' : 
                          action === 'click' ? 'Clicking element' : 'Filling input';
        const suggested = `${indent}console.log('[Test] ${logMessage}');
${line}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Add logging for critical test actions to improve debugging and test reporting',
          confidence: 0.72,
          category: 'logging'
        });
        continue;
      }

      // 10. Retry: Add retry logic for flaky selectors
      const m10 = line.match(noRetryOnFailRegex);
      if (m10 && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const selectorMatch = line.match(/waitForSelector\s*\(\s*([^,)]+)/);
        const selector = selectorMatch ? selectorMatch[1] : '"selector"';
        const suggested = `${indent}await page.waitForSelector(${selector}, { state: 'visible', timeout: 10000 })`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Add explicit timeout and state options for more resilient waiting strategy',
          confidence: 0.83,
          category: 'retry'
        });
        continue;
      }

      // 11. Best Practice: Extract magic numbers to constants
      const m11 = line.match(magicNumberRegex);
      if (m11 && !suggestions.find(s => s.lineNumber === i)) {
        const timeout = m11[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const constantName = 'DEFAULT_TIMEOUT';
        const suggested = `${indent}const ${constantName} = ${timeout};
${line.replace(timeout, constantName)}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: `Extract magic number ${timeout} to a named constant for better maintainability`,
          confidence: 0.77,
          category: 'best-practice'
        });
        continue;
      }

      // 12. Best Practice: Complex selectors should use page object pattern
      const m12 = line.match(noPageObjectRegex);
      if (m12 && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}// TODO: Extract complex selector to page object class
${line}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Complex selector detected - consider using page object pattern for better maintainability',
          confidence: 0.70,
          category: 'best-practice'
        });
        continue;
      }

      // PHASE IV: ADVANCED SELECTOR & ACCESSIBILITY ENHANCEMENTS

      // 13. Accessibility: Button selector → getByRole
      const m13 = line.match(buttonClickRegex);
      if (m13 && !line.includes('getByRole') && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const isClick = m13[2] === 'click';
        // Try to extract button text/label from surrounding context
        const textMatch = line.match(/['"]([^'"]+button[^'"]*|[^'"]*submit[^'"]*)['"]/);
        const buttonName = textMatch ? textMatch[1] : 'Submit';
        const suggested = isClick 
          ? `${indent}await page.getByRole('button', { name: '${buttonName}' }).click()`
          : `${indent}page.getByRole('button', { name: '${buttonName}' })`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use getByRole(\'button\') for accessible, semantic button selection - improves accessibility testing',
          confidence: 0.84,
          category: 'selector'
        });
        continue;
      }

      // 14. Accessibility: Input selector → getByLabel or getByPlaceholder
      const m14 = line.match(inputFillRegex);
      if (m14 && !line.includes('getByLabel') && !line.includes('getByPlaceholder') && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const labelName = 'Email'; // Heuristic - could be improved with context analysis
        const suggested = `${indent}await page.getByLabel('${labelName}').fill(value)`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use getByLabel() for form inputs - ensures accessibility and better test resilience',
          confidence: 0.80,
          category: 'selector'
        });
        continue;
      }

      // 15. Accessibility: Image selector → getByAltText
      const m15 = line.match(imgLocatorRegex);
      if (m15 && !line.includes('getByAltText') && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}page.getByAltText('image description')`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use getByAltText() for images - validates alt text presence and improves accessibility',
          confidence: 0.82,
          category: 'selector'
        });
        continue;
      }

      // 16. Accessibility: Title attribute → getByTitle
      const m16 = line.match(titleAttrRegex);
      if (m16 && !suggestions.find(s => s.lineNumber === i)) {
        const title = m16[2];
        // const indent = line.match(/^\s*/)?.[0] || ''; // Unused
        const suggested = line.replace(m16[0], `page.getByTitle('${title}')`);

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use getByTitle() for title-based selection - more readable than attribute selector',
          confidence: 0.90,
          category: 'selector'
        });
        continue;
      }

      // 17. Accessibility: ARIA label → getByRole with name
      const m17 = line.match(ariaLabelRegex);
      if (m17 && !suggestions.find(s => s.lineNumber === i)) {
        const ariaLabel = m17[2];
        // const indent = line.match(/^\s*/)?.[0] || ''; // Unused
        const suggested = line.replace(m17[0], `page.getByRole('region', { name: '${ariaLabel}' })`);

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Use getByRole() with aria-label - ensures ARIA compliance and screen reader compatibility',
          confidence: 0.85,
          category: 'selector'
        });
        continue;
      }

      // 18. Selector optimization: Chained locators → filter or single locator
      const m18 = line.match(chainedLocatorRegex);
      if (m18 && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}// TODO: Simplify chained locator - consider using .filter() or single specific selector
${line}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Multiple chained locators detected - consider optimizing with filter() or a more specific single selector',
          confidence: 0.73,
          category: 'best-practice'
        });
        continue;
      }

      // 19. Accessibility: Keyboard navigation - detect Enter press after input
      const m19 = line.match(pressEnterRegex);
      if (m19 && i > 0 && lines[i-1].includes('.fill(') && !suggestions.find(s => s.lineNumber === i)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}await page.locator('input').press('Enter'); // Keyboard navigation test`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Keyboard navigation detected - ensure form is accessible via keyboard (good for accessibility testing)',
          confidence: 0.76,
          category: 'best-practice'
        });
        continue;
      }

      // PHASE V: TEST DATA MANAGEMENT ENHANCEMENTS

      // 20. Test Data: Hardcoded email → Faker.js
      const m20 = line.match(hardcodedEmailRegex);
      if (m20 && !suggestions.find(s => s.lineNumber === i)) {
        const email = m20[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}import { faker } from '@faker-js/faker';
${indent}const testEmail = faker.internet.email();
${line.replace(email, '${testEmail}')}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Replace hardcoded email with Faker.js for dynamic, unique test data generation',
          confidence: 0.88,
          category: 'parameterization'
        });
        continue;
      }

      // 21. Test Data: Hardcoded phone → Faker.js
      const m21 = line.match(hardcodedPhoneRegex);
      if (m21 && !suggestions.find(s => s.lineNumber === i)) {
        const phone = m21[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}import { faker } from '@faker-js/faker';
${indent}const testPhone = faker.phone.number();
${line.replace(phone, '${testPhone}')}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Replace hardcoded phone with Faker.js for realistic test data',
          confidence: 0.86,
          category: 'parameterization'
        });
        continue;
      }

      // 22. Test Data: Hardcoded name → Faker.js
      const m22 = line.match(hardcodedNameRegex);
      if (m22 && !suggestions.find(s => s.lineNumber === i)) {
        const name = m22[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}import { faker } from '@faker-js/faker';
${indent}const testName = faker.person.fullName();
${line.replace(name, '${testName}')}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Replace hardcoded name with Faker.js for dynamic test data generation',
          confidence: 0.84,
          category: 'parameterization'
        });
        continue;
      }

      // 23. Environment Config: URL without env variable
      const m23 = line.match(envUrlMissingRegex);
      if (m23 && !suggestions.find(s => s.lineNumber === i)) {
        // indent not used here
        const suggested = line.replace(/(['"](https?:\/\/[^'"]+)['"])/, "process.env.BASE_URL || $1");

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: 'Extract URL to environment variable for multi-environment testing (dev, staging, prod)',
          confidence: 0.79,
          category: 'parameterization'
        });
        continue;
      }

      // 24. Test Fixtures: Inline data object → fixture file
      const m24 = line.match(fixtureOpportunityRegex);
      if (m24 && !suggestions.find(s => s.lineNumber === i)) {
        const varName = m24[2];
        const indent = line.match(/^\s*/)?.[0] || '';
        const suggested = `${indent}// TODO: Move '${varName}' to fixtures file for reusability across tests
${indent}import { ${varName} } from './fixtures/${varName}';
${line}`;

        suggestions.push({
          lineNumber: i,
          originalCode: line,
          suggestedCode: suggested,
          reason: `Move test data object to fixture file for better organization and reusability`,
          confidence: 0.74,
          category: 'parameterization'
        });
        continue;
      }
    }

    // Phase II: Detect repeated selectors for page object extraction
    const selectorCounts = new Map<string, number[]>();
    lines.forEach((line, idx) => {
      const matches = line.matchAll(repeatedSelectorRegex);
      for (const match of matches) {
        const selector = match[1];
        if (!selectorCounts.has(selector)) {
          selectorCounts.set(selector, []);
        }
        selectorCounts.get(selector)!.push(idx);
      }
    });

    // Suggest page object for selectors used 3+ times
    for (const [selector, lineNumbers] of selectorCounts.entries()) {
      if (lineNumbers.length >= 3 && !suggestions.find(s => lineNumbers.includes(s.lineNumber))) {
        const firstLine = lineNumbers[0];
        const indent = lines[firstLine].match(/^\s*/)?.[0] || '';
        const selectorName = selector.replace(/['".#-]/g, '').toUpperCase() + '_SELECTOR';
        const suggested = `${indent}// Extract to Page Object:\n${indent}const ${selectorName} = ${selector};\n${indent}// Then use: page.locator(${selectorName})`;

        suggestions.push({
          lineNumber: firstLine,
          originalCode: lines[firstLine],
          suggestedCode: suggested,
          reason: `Selector ${selector} is used ${lineNumbers.length} times - extract to page object for maintainability`,
          confidence: 0.80,
          category: 'page-object'
        });
      }
    }

    // Build enhanced code by applying all suggestions
    const updatedLines = [...lines];
    suggestions.forEach(s => {
      if (s.lineNumber >= 0 && s.lineNumber < updatedLines.length) {
        updatedLines[s.lineNumber] = s.suggestedCode;
      }
    });
    const enhancedCode = updatedLines.join('\n');

    // Build diff
    const diff = suggestions.flatMap(s => ([
      { line: s.lineNumber, type: 'removed', content: s.originalCode },
      { line: s.lineNumber, type: 'added', content: s.suggestedCode }
    ]));

    // Summary by category (Phase I + II + III)
    const byCategory: Record<string, number> = { 
      selector: 0, 
      wait: 0, 
      assertion: 0,
      'page-object': 0,
      parameterization: 0,
      'error-handling': 0,
      logging: 0,
      retry: 0,
      'best-practice': 0
    };
    suggestions.forEach(s => { byCategory[s.category] = (byCategory[s.category] || 0) + 1; });

    res.status(200).json({
      success: true,
      data: {
        scriptId: id,
        scriptName: script.name,
        language: script.language,
        originalCode: code,
        enhancedCode,
        suggestions,
        diff,
        summary: {
          totalSuggestions: suggestions.length,
          byCategory,
          estimatedImprovement: Math.min(95, 60 + suggestions.length * 5)
        }
      }
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to enhance script' });
    }
  }
};

/**
 * Apply enhancement to a script
 */
export const applyEnhancement = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { enhancedCode } = req.body;

    if (!enhancedCode) {
      throw new AppError('Enhanced code is required', 400);
    }

    // Check if script exists and belongs to user
    const existing = await pool.query(
      `SELECT id FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) {
      throw new AppError('Script not found', 404);
    }

    // Update the script with enhanced code
    const { rows } = await pool.query(
      `UPDATE "Script"
       SET code = $2,
           "workflowStatus" = 'ai_enhanced',
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, name, "workflowStatus", "updatedAt"`,
      [id, enhancedCode]
    );

    res.status(200).json({
      success: true,
      message: 'Script enhanced successfully',
      data: rows[0]
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to apply enhancement'
      });
    }
  }
};

/**
 * Get enhancement for validation
 */
export const getEnhancementForValidation = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    // Check if script exists and belongs to user
    const { rows } = await pool.query(
      `SELECT id, name, code, language FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!rows.length) {
      throw new AppError('Script not found', 404);
    }

    const script = rows[0];

    // Mock AI enhancement suggestions (same as enhance endpoint)
    const suggestions = [
      {
        lineNumber: 10,
        originalCode: 'page.click(".submit-button")',
        suggestedCode: 'page.click("[data-testid=\"submit-btn\"]")',
        reason: 'Use data-testid for more stable selectors',
        confidence: 0.95,
        category: 'best-practice'
      },
      {
        lineNumber: 15,
        originalCode: 'await page.waitForTimeout(2000)',
        suggestedCode: 'await page.waitForSelector("[data-testid=\"result\"]", { state: \'visible\' })',
        reason: 'Replace arbitrary timeout with explicit wait',
        confidence: 0.90,
        category: 'wait'
      },
      {
        lineNumber: 20,
        originalCode: 'expect(text).toBeTruthy()',
        suggestedCode: 'expect(text).toContain("Success")',
        reason: 'Use specific assertion for clearer test intent',
        confidence: 0.85,
        category: 'best-practice'
      }
    ];

    // Build enhanced code with all suggestions applied
    const lines = script.code.split('\n');
    suggestions.forEach(suggestion => {
      if (suggestion.lineNumber < lines.length) {
        lines[suggestion.lineNumber] = suggestion.suggestedCode;
      }
    });
    const enhancedCode = lines.join('\n');

    // Build diff array
    const diff = suggestions.map(s => ([
      { line: s.lineNumber, type: 'removed', content: s.originalCode },
      { line: s.lineNumber, type: 'added', content: s.suggestedCode }
    ])).flat();

    // Return the script for validation view
    res.status(200).json({
      success: true,
      data: {
        scriptId: id,
        scriptName: script.name,
        language: script.language,
        originalCode: script.code,
        enhancedCode,
        suggestions,
        diff,
        summary: {
          totalSuggestions: suggestions.length,
          byCategory: {
            'best-practice': 2,
            'wait': 1
          },
          estimatedImprovement: 85
        }
      }
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get enhancement for validation'
      });
    }
  }
};

/**
 * Execute a script and create a test run
 */
export const executeScript = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    // Check if script exists and belongs to user
    const { rows: scriptRows } = await pool.query(
      `SELECT id, name, code, language, "projectId", "browserType" FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!scriptRows.length) {
      throw new AppError('Script not found', 404);
    }

    const script = scriptRows[0];

    // Create a test run record
    const testRunId = randomUUID();
    const startedAt = new Date();
    const { rows: runRows } = await pool.query(
      `INSERT INTO "TestRun" (id, "scriptId", "userId", status, "startedAt")
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, "scriptId", "userId", status, "startedAt"`,
      [testRunId, id, userId, 'running', startedAt]
    );

    const testRun = runRows[0];

    // Execute script using Playwright Test Runner
    setImmediate(async () => {
      try {
        // Pass browser type from request body, then from script, then default to firefox
        const browserType = req.body.browser || script.browserType || 'firefox';
        await testRunnerService.startTestRun(testRunId, id, userId, undefined, browserType);
      } catch (error) {
        console.error('Error executing script with Playwright:', error);
      }
    });

    res.status(200).json({
      success: true,
      message: 'Script execution started',
      data: {
        testRunId: testRun.id,
        scriptId: id,
        scriptName: script.name,
        status: 'running',
        startedAt: testRun.startedAt
      }
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to execute script'
      });
    }
  }
};

/**
 * Batch enhance multiple scripts
 */
export const batchEnhanceScripts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { scriptIds } = req.body;

    if (!scriptIds || !Array.isArray(scriptIds) || scriptIds.length === 0) {
      throw new AppError('scriptIds array is required', 400);
    }

    if (scriptIds.length > 50) {
      throw new AppError('Maximum 50 scripts can be enhanced at once', 400);
    }

    // Fetch all scripts
    const { rows } = await pool.query(
      `SELECT id, name, code, language FROM "Script" WHERE id = ANY($1) AND "userId" = $2`,
      [scriptIds, userId]
    );

    if (rows.length === 0) {
      throw new AppError('No scripts found', 404);
    }

    // Process each script
    const results = [];

    for (const script of rows) {
      try {
        const code = script.code || '';
        const lines = code.split('\n');
        // const suggestions: any[] = []; // Not used in batch preview

        // Count potential enhancements by category
        const byCategory = {
          selector: 0,
          wait: 0,
          assertion: 0,
          'page-object': 0,
          parameterization: 0,
          'error-handling': 0,
          logging: 0,
          retry: 0,
          'best-practice': 0
        };

        // Quick pattern matching for batch preview
        lines.forEach((line: string) => {
          if (line.match(/page\.click\(\s*['"]text=/)) byCategory.selector++;
          if (line.match(/waitForTimeout/)) byCategory.wait++;
          if (line.match(/toBeTruthy/)) byCategory.assertion++;
          if (line.match(/await\s+page\.(fill|type)\s*\([^,]+,\s*['"]([^'"]{3,})['"]\s*\)/)) byCategory.parameterization++;
          if (line.match(/^\s*await\s+page\.(click|fill)/) && !line.includes('try')) byCategory['error-handling']++;
          if (line.match(/await\s+page\.(goto|click)/) && !lines[lines.indexOf(line) - 1]?.includes('console.log')) byCategory.logging++;
        });

        const totalSuggestions = Object.values(byCategory).reduce((a, b) => a + b, 0);

        results.push({
          scriptId: script.id,
          scriptName: script.name,
          status: 'analyzed',
          totalSuggestions,
          byCategory,
          canEnhance: totalSuggestions > 0
        });
      } catch (err: any) {
        results.push({
          scriptId: script.id,
          scriptName: script.name,
          status: 'error',
          error: err.message
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        total: scriptIds.length,
        processed: results.length,
        results
      }
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Failed to batch enhance scripts' });
    }
  }
};

/**
 * Update workflow status (for human validation actions)
 */
export const updateWorkflowStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { workflowStatus, comments } = req.body;

    // Validate workflow status
    const validStatuses = ['draft', 'ai_enhanced', 'testdata_ready', 'human_review', 'finalized', 'archived'];
    if (!validStatuses.includes(workflowStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid workflow status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Check if script exists and belongs to user
    const existing = await pool.query(
      `SELECT id, "workflowStatus" FROM "Script" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!existing.rowCount) {
      return res.status(404).json({
        success: false,
        error: 'Script not found'
      });
    }

    const previousStatus = existing.rows[0].workflowStatus;

    // Update workflow status
    const { rows } = await pool.query(
      `UPDATE "Script"
       SET "workflowStatus" = $2,
           "updatedAt" = now()
       WHERE id = $1
       RETURNING id, name, "workflowStatus", "updatedAt"`,
      [id, workflowStatus]
    );

    const script = rows[0];

    res.status(200).json({
      success: true,
      data: {
        scriptId: script.id,
        scriptName: script.name,
        previousStatus,
        currentStatus: script.workflowStatus,
        comments,
        updatedAt: script.updatedAt
      },
      message: `Workflow status updated from ${previousStatus} to ${workflowStatus}`
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update workflow status'
    });
  }
};
