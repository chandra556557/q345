-- Migration: Make BDDRun.featureId nullable for cucumber-runner-initiated runs
-- Date: 2026-04-09
-- Reason: cucumberTestRunner creates BDDRun records without a featureId (runs all features)

ALTER TABLE "BDDRun" ALTER COLUMN "featureId" DROP NOT NULL;
