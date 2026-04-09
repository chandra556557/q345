-- Migration: Add baseUrl to Script for project URL tracking
-- Date: 2026-04-09
-- Purpose: Scripts generated from BDD features carry the project URL for runtime config

ALTER TABLE "Script" ADD COLUMN IF NOT EXISTS "baseUrl" TEXT;
