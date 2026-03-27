-- Migration: Add errorMsg column to DataDrivenRun table
-- Date: 2026-03-23

ALTER TABLE "DataDrivenRun" ADD COLUMN IF NOT EXISTS "errorMsg" TEXT;
