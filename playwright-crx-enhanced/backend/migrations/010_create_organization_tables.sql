-- Migration: Create Multi-Tenant Organization Tables
-- Date: 2026-01-30
-- Description: Creates Organization, UserOrganization, Environment, and OrganizationMember tables

-- Organization Table
CREATE TABLE IF NOT EXISTS "Organization" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  domain VARCHAR(255),
  subscription VARCHAR(50) NOT NULL DEFAULT 'free',
  "maxConcurrentRuns" INTEGER NOT NULL DEFAULT 5,
  "maxUsers" INTEGER NOT NULL DEFAULT 10,
  settings JSONB DEFAULT '{}',
  "logoUrl" VARCHAR(500),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- UserOrganization Table (for many-to-many relationship)
CREATE TABLE IF NOT EXISTS "UserOrganization" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  permissions JSONB DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE("userId", "organizationId")
);

-- OrganizationMember Table (alternative/alias table for UserOrganization)
CREATE TABLE IF NOT EXISTS "OrganizationMember" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" VARCHAR(255) NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  permissions JSONB DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE("userId", "organizationId")
);

-- Environment Table
CREATE TABLE IF NOT EXISTS "Environment" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(255),
  type VARCHAR(50),
  description TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  variables JSONB DEFAULT '{}',
  "baseUrl" VARCHAR(500),
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE("organizationId", name)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_organization_slug" ON "Organization"(slug);
CREATE INDEX IF NOT EXISTS "idx_organization_status" ON "Organization"(status);

CREATE INDEX IF NOT EXISTS "idx_user_organization_user_id" ON "UserOrganization"("userId");
CREATE INDEX IF NOT EXISTS "idx_user_organization_org_id" ON "UserOrganization"("organizationId");
CREATE INDEX IF NOT EXISTS "idx_user_organization_role" ON "UserOrganization"(role);

CREATE INDEX IF NOT EXISTS "idx_org_member_user_id" ON "OrganizationMember"("userId");
CREATE INDEX IF NOT EXISTS "idx_org_member_org_id" ON "OrganizationMember"("organizationId");
CREATE INDEX IF NOT EXISTS "idx_org_member_role" ON "OrganizationMember"(role);

CREATE INDEX IF NOT EXISTS "idx_environment_org_id" ON "Environment"("organizationId");
CREATE INDEX IF NOT EXISTS "idx_environment_default" ON "Environment"("isDefault");

-- Update trigger for Organization updatedAt
CREATE OR REPLACE FUNCTION update_organization_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organization_updated_at
BEFORE UPDATE ON "Organization"
FOR EACH ROW
EXECUTE FUNCTION update_organization_updated_at();

-- Update trigger for Environment updatedAt
CREATE OR REPLACE FUNCTION update_environment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_environment_updated_at
BEFORE UPDATE ON "Environment"
FOR EACH ROW
EXECUTE FUNCTION update_environment_updated_at();

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Multi-tenant organization tables created successfully!';
END $$;
