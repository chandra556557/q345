-- Screenplay Pattern Tables (Serenity BDD-inspired)
-- Tasks, Actions, and Questions for composable test abstractions

-- Actions: Low-level Playwright interactions (click, fill, navigate, etc.)
CREATE TABLE IF NOT EXISTS "ScreenplayAction" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT,
  name TEXT NOT NULL,
  description TEXT,
  "actionType" TEXT NOT NULL DEFAULT 'custom',  -- interaction, navigation, input, wait, custom
  target TEXT,         -- selector, role, label
  value TEXT,          -- value for fill, select, etc.
  code TEXT NOT NULL,  -- Playwright code snippet
  tags JSONB DEFAULT '[]',
  "usageCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Questions: Assertions/verifications (visibility, text, url, etc.)
CREATE TABLE IF NOT EXISTS "ScreenplayQuestion" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT,
  name TEXT NOT NULL,
  description TEXT,
  "questionType" TEXT NOT NULL DEFAULT 'custom',  -- visibility, text, url, title, attribute, count, custom
  target TEXT,
  expected TEXT,
  code TEXT NOT NULL,
  tags JSONB DEFAULT '[]',
  "usageCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Tasks: High-level business actions composed of Actions + Questions
CREATE TABLE IF NOT EXISTS "ScreenplayTask" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT,
  name TEXT NOT NULL,
  description TEXT,
  "actorType" TEXT NOT NULL DEFAULT 'User',  -- User, Admin, API Client, etc.
  actions JSONB DEFAULT '[]',     -- ordered list of action IDs
  questions JSONB DEFAULT '[]',   -- ordered list of question IDs
  tags JSONB DEFAULT '[]',
  "generatedCode" TEXT,           -- auto-generated Cucumber step definition code
  "usageCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_screenplay_action_user ON "ScreenplayAction" ("userId");
CREATE INDEX IF NOT EXISTS idx_screenplay_action_org ON "ScreenplayAction" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_screenplay_question_user ON "ScreenplayQuestion" ("userId");
CREATE INDEX IF NOT EXISTS idx_screenplay_question_org ON "ScreenplayQuestion" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_screenplay_task_user ON "ScreenplayTask" ("userId");
CREATE INDEX IF NOT EXISTS idx_screenplay_task_org ON "ScreenplayTask" ("organizationId");
