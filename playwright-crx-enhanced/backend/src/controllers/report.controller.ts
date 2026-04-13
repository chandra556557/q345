import { Request, Response } from 'express';
import { bddReportService } from '../services/bdd-report.service';
import { logger } from '../utils/logger';
import pool from '../db';


export const generateReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testRunId } = req.params;

    if (!testRunId) {
      res.status(400).json({ success: false, error: 'Test run ID is required' });
      return;
    }

    logger.info(`Generating report for test run: ${testRunId}`);

    // Check if report already exists
    let reportUrl = bddReportService.getReportUrl(testRunId);
    if (!reportUrl) {
      // Try to generate from report-data.json if it exists
      reportUrl = await bddReportService.generateTestRunReport(testRunId, 'Test Run', [], 'passed');
    }

    logger.info(`Report URL: ${reportUrl}`);

    // Update the TestRun with the report URL (try both tables)
    const trResult = await pool.query(
      'UPDATE "TestRun" SET "executionReportUrl" = $1 WHERE id = $2 RETURNING id',
      [reportUrl, testRunId]
    );

    // If not found in TestRun, try BDDRun
    if (trResult.rowCount === 0) {
      await pool.query(
        'UPDATE "BDDRun" SET "reportUrl" = COALESCE("reportUrl", $1) WHERE id = $2',
        [reportUrl, testRunId]
      ).catch(() => { /* BDDRun may not have this column */ });
    }

    res.json({
      success: true,
      reportUrl,
      message: 'Report generated successfully',
    });
  } catch (error: any) {
    logger.error('Error generating report:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate report',
    });
  }
};

export const getReportUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testRunId } = req.params;

    const reportUrl = bddReportService.getReportUrl(testRunId);

    if (!reportUrl) {
      res.status(404).json({ success: false, error: 'Report not found' });
      return;
    }

    res.json({ success: true, reportUrl });
  } catch (error: any) {
    logger.error('Error getting report URL:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get report URL' });
  }
};

export const getAllReports = async (_req: Request, res: Response) => {
  try {
    const reports = bddReportService.getAllReports();
    res.json({ success: true, reports });
  } catch (error: any) {
    logger.error('Error getting all reports:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get reports' });
  }
};

export const cleanupOldReports = async (req: Request, res: Response) => {
  try {
    const { days } = req.body;
    const daysToKeep = days || 7;

    await bddReportService.cleanupOldReports(daysToKeep);

    res.json({ success: true, message: `Cleaned up reports older than ${daysToKeep} days` });
  } catch (error: any) {
    logger.error('Error cleaning up reports:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to cleanup reports' });
  }
};

export const generateBDDReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { runId } = req.params;

    if (!runId) {
      res.status(400).json({ success: false, error: 'Run ID is required' });
      return;
    }

    // Check if report already exists
    const reportUrl = bddReportService.getReportUrl(runId);

    if (reportUrl) {
      res.json({ success: true, reportUrl, message: 'BDD report already available' });
      return;
    }

    res.status(404).json({ success: false, error: 'No results found for this BDD run' });
  } catch (error: any) {
    logger.error('Error generating BDD report:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate BDD report' });
  }
};

export const getTrends = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.query;
    const limit = parseInt(req.query.limit as string) || 20;

    if (type === 'testrun') {
      const trends = await bddReportService.getTestRunTrends(limit);
      res.json({ success: true, trends });
    } else {
      const trends = await bddReportService.getBDDTrends(limit);
      res.json({ success: true, trends });
    }
  } catch (error: any) {
    logger.error('Error fetching trends:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch trends' });
  }
};
