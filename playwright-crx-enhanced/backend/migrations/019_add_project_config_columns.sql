-- Migration: Add dynamic project configuration columns
-- Date: 2026-04-08
-- Purpose: Enable dynamic project URL management from the BDD UI

-- Add project configuration columns to Project table
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "baseUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "apiBaseUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "environment" VARCHAR(50) DEFAULT 'development';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "dbHost" VARCHAR(255);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "dbPort" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "dbName" VARCHAR(255);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "dbUser" VARCHAR(255);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "dbPassword" VARCHAR(255);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "tags" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "envVars" JSONB DEFAULT '{}';

-- Add project tracking columns to BDDRun table
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "projectId" VARCHAR(255);
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "projectName" VARCHAR(255);
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "projectBaseUrl" TEXT;

-- Index for project-based run queries
CREATE INDEX IF NOT EXISTS "idx_bdd_run_project_id" ON "BDDRun"("projectId");
CREATE INDEX IF NOT EXISTS "idx_project_environment" ON "Project"("environment");
