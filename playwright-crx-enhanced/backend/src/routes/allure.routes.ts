import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  generateReport,
  getReportUrl,
  getAllReports,
  cleanupOldReports,
  generateBDDReport,
} from '../controllers/allure.controller';

const router = Router();

router.post('/generate/:testRunId', authMiddleware, generateReport);

router.get('/report/:testRunId', authMiddleware, getReportUrl);

router.get('/reports', authMiddleware, getAllReports);

router.post('/cleanup', authMiddleware, cleanupOldReports);

// BDD-specific Allure report generation
router.post('/bdd-report/:runId', authMiddleware, generateBDDReport);
router.get('/bdd-report/:runId', authMiddleware, generateBDDReport);

export default router;
