-- ============================================
-- Worker Node Table for Distributed Execution
-- ============================================

-- Create WorkerNode table for managing distributed worker nodes
CREATE TABLE IF NOT EXISTS "WorkerNode" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  "ipAddress" VARCHAR(45) NOT NULL,
  port INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'idle',
  capabilities JSONB NOT NULL DEFAULT '{}',
  "maxConcurrency" INTEGER NOT NULL DEFAULT 5,
  "currentLoad" INTEGER NOT NULL DEFAULT 0,
  "lastHeartbeat" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Unique constraint on hostname and port combination
  CONSTRAINT "WorkerNode_hostname_port_key" UNIQUE (hostname, port)
);

-- Create index on status for faster queries
CREATE INDEX IF NOT EXISTS "WorkerNode_status_idx" ON "WorkerNode" (status);

-- Create index on lastHeartbeat for monitoring
CREATE INDEX IF NOT EXISTS "WorkerNode_lastHeartbeat_idx" ON "WorkerNode" ("lastHeartbeat");

-- Create trigger to update updatedAt automatically
CREATE OR REPLACE FUNCTION update_worker_node_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER worker_node_updated_at_trigger
  BEFORE UPDATE ON "WorkerNode"
  FOR EACH ROW
  EXECUTE FUNCTION update_worker_node_updated_at();

-- Add comments for documentation
COMMENT ON TABLE "WorkerNode" IS 'Distributed worker nodes for parallel test execution';
COMMENT ON COLUMN "WorkerNode".id IS 'Unique identifier for the worker node';
COMMENT ON COLUMN "WorkerNode".name IS 'Human-readable name for the worker node';
COMMENT ON COLUMN "WorkerNode".hostname IS 'Hostname of the worker machine';
COMMENT ON COLUMN "WorkerNode"."ipAddress" IS 'IP address of the worker machine';
COMMENT ON COLUMN "WorkerNode".port IS 'Port number for worker communication';
COMMENT ON COLUMN "WorkerNode".status IS 'Current status: idle, busy, offline';
COMMENT ON COLUMN "WorkerNode".capabilities IS 'Worker capabilities (browsers, app types, etc.)';
COMMENT ON COLUMN "WorkerNode"."maxConcurrency" IS 'Maximum concurrent jobs this worker can handle';
COMMENT ON COLUMN "WorkerNode"."currentLoad" IS 'Current number of jobs being processed';
COMMENT ON COLUMN "WorkerNode"."lastHeartbeat" IS 'Last heartbeat timestamp for health monitoring';
