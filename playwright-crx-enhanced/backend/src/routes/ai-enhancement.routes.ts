/**
 * AI Enhancement Routes
 * Routes for Visual AI, Context-Aware Locators, and XPath Analysis
 */

import { Router } from 'express';
import multer from 'multer';
import * as aiEnhancementController from '../controllers/ai-enhancement.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// Visual AI Endpoints
router.post('/visual-fingerprint', aiEnhancementController.createVisualFingerprint);
router.post('/visual-compare', aiEnhancementController.compareVisualFingerprints);
router.post('/screenshot-analyze', aiEnhancementController.analyzeScreenshot);
router.post('/visual-similarity', aiEnhancementController.findByVisualSimilarity);
router.post('/layout-changes', aiEnhancementController.detectLayoutChanges);

// Context-Aware Locator Endpoints
router.post('/context-aware-locators', aiEnhancementController.generateContextAwareLocators);

// XPath Analysis Endpoints
router.post('/xpath-analyze', aiEnhancementController.analyzeXPath);
router.post('/xpath-batch-analyze', aiEnhancementController.batchAnalyzeXPath);
router.post('/upload-script-xpath-analysis', upload.single('file'), aiEnhancementController.uploadScriptXPathAnalysis);

// Comprehensive Analysis
router.post('/comprehensive-analyze', aiEnhancementController.comprehensiveAnalyze);

// Stats
router.get('/stats', aiEnhancementController.getEnhancementStats);

export default router;
