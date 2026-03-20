-- Migration: Add reportHtml column to BDDRun table
-- Date: 2026-03-20
-- Purpose: Store HTML report content directly in database instead of relying on filesystem

ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "reportHtml" TEXT;

-- Add screenshotUrls column if not present (was missing from original migration)
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS "screenshotUrls" JSONB DEFAULT '[]';

-- Add tags column for tag-based filtering
ALTER TABLE "BDDRun" ADD COLUMN IF NOT EXISTS tags TEXT;
