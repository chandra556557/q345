-- Migration: BDD Enhancements
-- Date: 2026-03-06
-- Features: Step Library, Scheduled Runs, Screenshot artifacts

-- 1. Reusable Step Library (organization-scoped shared step definitions)
CREATE TABLE IF NOT EXISTS "BDDStepLibrary" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" VARCHAR(255),
  pattern VARCHAR(1000) NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  keyword VARCHAR(20) NOT NULL DEFAULT 'Given',
  tags JSONB DEFAULT '[]',
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bdd_step_lib_user" ON "BDDStepLibrary"("userId");
CREATE INDEX IF NOT EXISTS "idx_bdd_step_lib_org" ON "BDDStepLibrary"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bdd_step_lib_pattern_org" ON "BDDStepLibrary"(pattern, COALESCE("organizationId", ''));

-- 2. Scheduled BDD Runs (cron-based execution)
CREATE TABLE IF NOT EXISTS "BDDSchedule" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "featureId" VARCHAR(255) NOT NULL REFERENCES "BDDFeature"(id) ON DELETE CASCADE,
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" VARCHAR(255),
  "cronExpression" VARCHAR(100) NOT NULL,
  tags VARCHAR(500),
  browser VARCHAR(50) DEFAULT 'chromium',
  "executionMode" VARCHAR(50) DEFAULT 'headless',
  enabled BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" TIMESTAMP WITH TIME ZONE,
  "nextRunAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bdd_schedule_feature" ON "BDDSchedule"("featureId");
CREATE INDEX IF NOT EXISTS "idx_bdd_schedule_user" ON "BDDSchedule"("userId");
CREATE INDEX IF NOT EXISTS "idx_bdd_schedule_enabled" ON "BDDSchedule"(enabled);

-- 3. Add screenshot/artifact columns to BDDRun
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "screenshotUrls" JSONB DEFAULT '[]';
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS tags VARCHAR(500);
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "parallelWorkers" INTEGER DEFAULT 1;
