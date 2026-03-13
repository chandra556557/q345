-- Migration: Create BDD/Cucumber tables
-- Date: 2026-03-05

-- 1. Create BDDFeature table (Gherkin feature files)
CREATE TABLE IF NOT EXISTS "BDDFeature" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" VARCHAR(255),
  "projectId" VARCHAR(255) REFERENCES "Project"(id) ON DELETE SET NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  "featureContent" TEXT NOT NULL,
  tags JSONB DEFAULT '[]',
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bdd_feature_user_id" ON "BDDFeature"("userId");
CREATE INDEX IF NOT EXISTS "idx_bdd_feature_org_id" ON "BDDFeature"("organizationId");
CREATE INDEX IF NOT EXISTS "idx_bdd_feature_project_id" ON "BDDFeature"("projectId");
CREATE INDEX IF NOT EXISTS "idx_bdd_feature_status" ON "BDDFeature"(status);
CREATE INDEX IF NOT EXISTS "idx_bdd_feature_created_at" ON "BDDFeature"("createdAt");

-- 2. Create BDDScenario table (scenarios within features)
CREATE TABLE IF NOT EXISTS "BDDScenario" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "featureId" VARCHAR(255) NOT NULL REFERENCES "BDDFeature"(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  "scenarioType" VARCHAR(50) NOT NULL DEFAULT 'Scenario',
  tags JSONB DEFAULT '[]',
  "examplesData" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bdd_scenario_feature_id" ON "BDDScenario"("featureId");
CREATE INDEX IF NOT EXISTS "idx_bdd_scenario_type" ON "BDDScenario"("scenarioType");

-- 3. Create BDDStep table (Given/When/Then steps)
CREATE TABLE IF NOT EXISTS "BDDStep" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "scenarioId" VARCHAR(255) NOT NULL REFERENCES "BDDScenario"(id) ON DELETE CASCADE,
  keyword VARCHAR(20) NOT NULL,
  text TEXT NOT NULL,
  "dataTable" JSONB,
  "docString" TEXT,
  "stepDefinition" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bdd_step_scenario_id" ON "BDDStep"("scenarioId");
CREATE INDEX IF NOT EXISTS "idx_bdd_step_keyword" ON "BDDStep"(keyword);

-- 4. Create BDDRun table (execution records)
CREATE TABLE IF NOT EXISTS "BDDRun" (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "featureId" VARCHAR(255) NOT NULL REFERENCES "BDDFeature"(id) ON DELETE CASCADE,
  "scenarioId" VARCHAR(255) REFERENCES "BDDScenario"(id) ON DELETE SET NULL,
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  duration INTEGER,
  "totalSteps" INTEGER NOT NULL DEFAULT 0,
  "passedSteps" INTEGER NOT NULL DEFAULT 0,
  "failedSteps" INTEGER NOT NULL DEFAULT 0,
  "skippedSteps" INTEGER NOT NULL DEFAULT 0,
  "errorMsg" TEXT,
  "stepResults" JSONB DEFAULT '[]',
  browser VARCHAR(50) DEFAULT 'chromium',
  "executionMode" VARCHAR(50) DEFAULT 'headless',
  "reportUrl" TEXT,
  "startedAt" TIMESTAMP WITH TIME ZONE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bdd_run_feature_id" ON "BDDRun"("featureId");
CREATE INDEX IF NOT EXISTS "idx_bdd_run_scenario_id" ON "BDDRun"("scenarioId");
CREATE INDEX IF NOT EXISTS "idx_bdd_run_user_id" ON "BDDRun"("userId");
CREATE INDEX IF NOT EXISTS "idx_bdd_run_status" ON "BDDRun"(status);
CREATE INDEX IF NOT EXISTS "idx_bdd_run_created_at" ON "BDDRun"("createdAt");
