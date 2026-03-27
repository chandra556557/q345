/**
 * AI Enhancement Controller
 * Provides endpoints for Visual AI, Context-Aware Locators, and XPath Analysis
 */

import { Request, Response } from 'express';
import { visualAIService } from '../services/visual-ai.service';
import { contextAwareLocatorService } from '../services/context-aware-locator.service';
import { xpathAnalysisService } from '../services/xpath-analysis.service';

/**
 * POST /api/ai-enhancement/visual-fingerprint
 * Create visual fingerprint for element
 */
export const createVisualFingerprint = async (req: Request, res: Response) => {
  try {
    const { id, position, size, styles, text, screenshot } = req.body;

    if (!id || !position || !size) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, position, size'
      });
    }

    const fingerprint = visualAIService.createVisualFingerprint({
      id,
      position,
      size,
      styles: styles || {},
      text: text || '',
      screenshot
    });

    return res.json({
      success: true,
      data: fingerprint
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/visual-compare
 * Compare two visual fingerprints
 */
export const compareVisualFingerprints = async (req: Request, res: Response) => {
  try {
    const { fingerprint1, fingerprint2 } = req.body;

    if (!fingerprint1 || !fingerprint2) {
      return res.status(400).json({
        success: false,
        error: 'Missing fingerprint1 or fingerprint2'
      });
    }

    const comparison = visualAIService.compareVisualFingerprints(
      fingerprint1,
      fingerprint2
    );

    return res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/screenshot-analyze
 * Analyze screenshot to detect elements
 */
export const analyzeScreenshot = async (req: Request, res: Response) => {
  try {
    const { screenshot } = req.body;

    if (!screenshot) {
      return res.status(400).json({
        success: false,
        error: 'Missing screenshot (base64 encoded)'
      });
    }

    const analysis = await visualAIService.analyzeScreenshot(screenshot);

    return res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/visual-similarity
 * Find element by visual similarity
 */
export const findByVisualSimilarity = async (req: Request, res: Response) => {
  try {
    const { targetFingerprint, candidateFingerprints } = req.body;

    if (!targetFingerprint || !candidateFingerprints) {
      return res.status(400).json({
        success: false,
        error: 'Missing targetFingerprint or candidateFingerprints'
      });
    }

    const match = await visualAIService.findByVisualSimilarity(
      targetFingerprint,
      candidateFingerprints
    );

    return res.json({
      success: true,
      data: match
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/layout-changes
 * Detect layout changes between screenshots
 */
export const detectLayoutChanges = async (req: Request, res: Response) => {
  try {
    const { beforeScreenshot, afterScreenshot } = req.body;

    if (!beforeScreenshot || !afterScreenshot) {
      return res.status(400).json({
        success: false,
        error: 'Missing beforeScreenshot or afterScreenshot'
      });
    }

    const changes = visualAIService.detectLayoutChanges(
      beforeScreenshot,
      afterScreenshot
    );

    return res.json({
      success: true,
      data: changes
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/context-aware-locators
 * Generate context-aware locators for element
 */
export const generateContextAwareLocators = async (req: Request, res: Response) => {
  try {
    const elementContext = req.body;

    if (!elementContext.tag || !elementContext.attributes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tag, attributes'
      });
    }

    const suggestions = contextAwareLocatorService.generateLocators(elementContext);

    return res.json({
      success: true,
      data: {
        suggestions,
        count: suggestions.length,
        bestSuggestion: suggestions[0] || null
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/xpath-analyze
 * Analyze XPath expression
 */
export const analyzeXPath = async (req: Request, res: Response) => {
  try {
    const { xpath } = req.body;

    if (!xpath) {
      return res.status(400).json({
        success: false,
        error: 'Missing xpath expression'
      });
    }

    const analysis = xpathAnalysisService.analyzeXPath(xpath);

    return res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/xpath-batch-analyze
 * Batch analyze multiple XPath expressions
 */
export const batchAnalyzeXPath = async (req: Request, res: Response) => {
  try {
    const { xpaths } = req.body;

    if (!xpaths || !Array.isArray(xpaths)) {
      return res.status(400).json({
        success: false,
        error: 'Missing xpaths array'
      });
    }

    const results = xpaths.map(xpath => ({
      xpath,
      analysis: xpathAnalysisService.analyzeXPath(xpath)
    }));

    // Summary statistics
    const absoluteCount = results.filter(r => r.analysis.type === 'absolute').length;
    const relativeCount = results.filter(r => r.analysis.type === 'relative').length;
    const avgComplexity = results.reduce((sum, r) => sum + r.analysis.complexity, 0) / results.length;
    const highIssueCount = results.filter(r => 
      r.analysis.issues.some(i => i.severity === 'high')
    ).length;

    return res.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          absoluteCount,
          relativeCount,
          avgComplexity: Math.round(avgComplexity),
          highIssueCount
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/comprehensive-analyze
 * Comprehensive analysis using all AI features
 */
export const comprehensiveAnalyze = async (req: Request, res: Response) => {
  try {
    const { 
      selector,
      elementContext,
      screenshot,
      fingerprint
    } = req.body;

    const results: any = {
      selector: selector || 'Not provided',
      timestamp: new Date()
    };

    // XPath Analysis
    if (selector && xpathAnalysisService.isXPathExpression(selector)) {
      results.xpathAnalysis = xpathAnalysisService.analyzeXPath(selector);
    }

    // Context-Aware Locators
    if (elementContext) {
      results.contextAwareLocators = contextAwareLocatorService.generateLocators(elementContext);
    }

    // Visual Analysis
    if (screenshot) {
      results.visualAnalysis = await visualAIService.analyzeScreenshot(screenshot);
    }

    // Visual Fingerprint
    if (fingerprint) {
      results.visualFingerprint = fingerprint;
    }

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (results.xpathAnalysis && results.xpathAnalysis.isXPath) {
      if (results.xpathAnalysis.type === 'absolute') {
        recommendations.push('Convert absolute XPath to relative for better stability');
      }
      if (results.xpathAnalysis.complexity > 60) {
        recommendations.push('Simplify complex XPath expression');
      }
      if (results.xpathAnalysis.suggestions.length > 0) {
        recommendations.push(`Use ${results.xpathAnalysis.suggestions[0].type} selector instead`);
      }
    }

    if (results.contextAwareLocators && results.contextAwareLocators.length > 0) {
      const bestLocator = results.contextAwareLocators[0];
      recommendations.push(`Best locator: ${bestLocator.locator} (${bestLocator.confidence}% confidence)`);
    }

    results.recommendations = recommendations;

    return res.json({
      success: true,
      data: results
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * GET /api/ai-enhancement/stats
 * Get AI enhancement service statistics
 */
export const getEnhancementStats = async (_req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: {
        services: {
          visualAI: {
            name: 'Visual AI & Screenshot Analysis',
            status: 'active',
            features: [
              'Visual fingerprinting',
              'Screenshot comparison',
              'Layout change detection',
              'Element visual similarity'
            ]
          },
          contextAware: {
            name: 'Context-Aware Locator Generation',
            status: 'active',
            features: [
              'Form context locators',
              'Table context locators',
              'Modal/dialog isolation',
              'Semantic/ARIA locators',
              'Shadow DOM support',
              'Relative positioning'
            ]
          },
          xpathAnalysis: {
            name: 'XPath Analysis & Conversion',
            status: 'active',
            features: [
              'Absolute vs Relative detection',
              'Complexity scoring',
              'Stability assessment',
              'Auto-conversion to Playwright',
              'Issue identification'
            ]
          }
        },
        version: '1.0.0',
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};

/**
 * POST /api/ai-enhancement/upload-script-xpath-analysis
 * Upload a script file and analyze all XPath expressions in it
 */
export const uploadScriptXPathAnalysis = async (req: Request, res: Response) => {
  try {
    let scriptCode = '';

    // Handle multipart file upload
    if (req.file) {
      scriptCode = req.file.buffer.toString('utf-8');
    } else if (req.body?.code) {
      scriptCode = req.body.code;
    } else {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded or code provided'
      });
    }

    // Extract XPath expressions from the script
    const xpathMatches = scriptCode.match(/['"]xpath=([^'"]+)['"]/g) || [];
    const absoluteXPaths = scriptCode.match(/locator\(['"](\/[^'"]+)['"]\)/g) || [];
    const relativeXPaths = scriptCode.match(/locator\(['"](\/\/[^'"]+)['"]\)/g) || [];

    const allXPaths = [
      ...xpathMatches.map(m => m.replace(/['"]xpath=/g, '').replace(/['"]/g, '')),
      ...absoluteXPaths.map(m => { const match = m.match(/locator\(['"]([^'"]+)['"]\)/); return match ? match[1] : ''; }),
      ...relativeXPaths.map(m => { const match = m.match(/locator\(['"]([^'"]+)['"]\)/); return match ? match[1] : ''; })
    ].filter(x => x && (x.startsWith('/') || x.startsWith('./')));

    if (allXPaths.length === 0) {
      return res.json({
        success: true,
        data: {
          found: false,
          message: 'No XPath expressions found in the uploaded script',
          total_lines: scriptCode.split('\n').length
        }
      });
    }

    // Analyze each XPath
    const analyses = allXPaths.map(xpath => ({
      xpath,
      analysis: xpathAnalysisService.analyzeXPath(xpath)
    }));

    const absoluteCount = analyses.filter(a => a.analysis.type === 'absolute').length;
    const highIssueCount = analyses.filter(a =>
      a.analysis.issues.some(i => i.severity === 'high')
    ).length;

    return res.json({
      success: true,
      data: {
        found: true,
        count: allXPaths.length,
        analyses,
        summary: {
          total: analyses.length,
          absoluteCount,
          relativeCount: analyses.length - absoluteCount,
          highIssueCount,
          avgComplexity: Math.round(analyses.reduce((s, a) => s + a.analysis.complexity, 0) / analyses.length)
        },
        total_lines: scriptCode.split('\n').length
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
};
