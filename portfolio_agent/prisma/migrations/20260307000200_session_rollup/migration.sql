CREATE TABLE IF NOT EXISTS "agent_observability_sessions" (
  "session_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "room_name" TEXT,
  "source" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "ended_at" TIMESTAMPTZ(6),
  "status" TEXT,
  "event_count" INTEGER NOT NULL DEFAULT 0,
  "tool_calls" INTEGER NOT NULL DEFAULT 0,
  "tool_errors" INTEGER NOT NULL DEFAULT 0,
  "metrics_count" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER,
  "summary" JSONB NOT NULL,
  "turns" JSONB NOT NULL,
  CONSTRAINT "agent_observability_sessions_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX IF NOT EXISTS "idx_agent_obs_sessions_updated_at"
  ON "agent_observability_sessions"("updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_agent_obs_sessions_room_status"
  ON "agent_observability_sessions"("room_name", "status");
