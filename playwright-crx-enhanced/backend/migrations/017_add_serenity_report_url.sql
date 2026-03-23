-- Migration: Add serenityReportUrl column to BDDRun table
-- Date: 2026-03-23
-- Purpose: Store URL to actual Serenity BDD CLI generated report (requires Java)

ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "serenityReportUrl" TEXT;
