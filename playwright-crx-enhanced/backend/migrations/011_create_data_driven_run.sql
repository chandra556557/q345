-- Migration: Create DataDrivenRun table and extend TestRun for data-driven testing
-- Date: 2026-03-02

-- 1. Create DataDrivenRun table
CREATE TABLE IF NOT EXISTS "DataDrivenRun" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "scriptId" VARCHAR(255) NOT NULL REFERENCES "Script"(id) ON DELETE CASCADE,
  "testSuiteId" VARCHAR(255) REFERENCES "TestSuite"(id) ON DELETE SET NULL,
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" UUID REFERENCES "Organization"(id),
  name VARCHAR(500),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "completedRows" INTEGER NOT NULL DEFAULT 0,
  "passedRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "fieldBindings" JSONB NOT NULL DEFAULT '{}',
  "dataRows" JSONB NOT NULL DEFAULT '[]',
  "executionConfig" JSONB DEFAULT '{}',
  "aggregateReportUrl" VARCHAR(500),
  browser VARCHAR(50) DEFAULT 'chromium',
  "executionMode" VARCHAR(50) DEFAULT 'sequential',
  duration INTEGER,
  "startedAt" TIMESTAMP WITH TIME ZONE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_ddr_script_id" ON "DataDrivenRun"("scriptId");
CREATE INDEX IF NOT EXISTS "idx_ddr_user_id" ON "DataDrivenRun"("userId");
CREATE INDEX IF NOT EXISTS "idx_ddr_status" ON "DataDrivenRun"(status);
CREATE INDEX IF NOT EXISTS "idx_ddr_created_at" ON "DataDrivenRun"("createdAt");

-- 2. Add data-driven columns to TestRun
ALTER TABLE "TestRun" ADD COLUMN IF NOT EXISTS "dataDrivenRunId" VARCHAR(255)
  REFERENCES "DataDrivenRun"(id) ON DELETE SET NULL;
ALTER TABLE "TestRun" ADD COLUMN IF NOT EXISTS "dataRowIndex" INTEGER;
ALTER TABLE "TestRun" ADD COLUMN IF NOT EXISTS "dataRowValues" JSONB;

CREATE INDEX IF NOT EXISTS "idx_testrun_ddr_id" ON "TestRun"("dataDrivenRunId");
