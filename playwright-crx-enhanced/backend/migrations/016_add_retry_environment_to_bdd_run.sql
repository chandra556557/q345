-- Migration: Add retry/flaky tracking and environment profile columns to BDDRun
-- Date: 2026-03-20
-- Purpose: Support retry/flaky test handling and environment profiles

-- Retry tracking columns
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER DEFAULT 0;
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "retryInfo" JSONB DEFAULT '{}';

-- Environment profile used for this run
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "environmentName" VARCHAR(100);
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "environmentProfile" JSONB;

-- Index for filtering by environment
CREATE INDEX IF NOT EXISTS "idx_bdd_run_environment" ON "BDDRun"("environmentName");
