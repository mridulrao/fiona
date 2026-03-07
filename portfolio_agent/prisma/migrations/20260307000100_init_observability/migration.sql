-- Create observability events table
CREATE TABLE IF NOT EXISTS "agent_observability_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "tool_name" TEXT,
  "status" TEXT,
  "session_id" TEXT,
  "room_name" TEXT,
  "duration_ms" INTEGER,
  "payload" JSONB NOT NULL,
  CONSTRAINT "agent_observability_events_pkey" PRIMARY KEY ("id")
);

-- Indexes for dashboard query patterns
CREATE INDEX IF NOT EXISTS "idx_agent_obs_created_at"
  ON "agent_observability_events"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_obs_source_event_type"
  ON "agent_observability_events"("source", "event_type");

CREATE INDEX IF NOT EXISTS "idx_agent_obs_tool_status"
  ON "agent_observability_events"("tool_name", "status");
