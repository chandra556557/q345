import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  generateReport,
  getReportUrl,
  getAllReports,
  cleanupOldReports,
  generateBDDReport,
  getTrends,
} from '../controllers/report.controller';

const router = Router();

router.post('/generate/:testRunId', authMiddleware, generateReport);

router.get('/report/:testRunId', authMiddleware, getReportUrl);

router.get('/reports', authMiddleware, getAllReports);

router.post('/cleanup', authMiddleware, cleanupOldReports);

// BDD-specific report generation
router.post('/bdd-report/:runId', authMiddleware, generateBDDReport);
router.get('/bdd-report/:runId', authMiddleware, generateBDDReport);

// Trend data from DB
router.get('/trends', authMiddleware, getTrends);

export default router;
