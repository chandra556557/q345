-- Migration: Link BDD Features to Scripts
-- Date: 2026-04-09
-- Purpose: Allow generated Playwright code from BDD features to be saved as Scripts

ALTER TABLE "Script" ADD COLUMN IF NOT EXISTS "bddFeatureId" TEXT;
ALTER TABLE "Script" ADD COLUMN IF NOT EXISTS "generatedFrom" VARCHAR(50);

CREATE INDEX IF NOT EXISTS "idx_script_bdd_feature_id" ON "Script"("bddFeatureId");
