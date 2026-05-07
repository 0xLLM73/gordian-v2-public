-- G8a: Goal Progress History
-- Records every goal increment with source attribution.
-- Unblocks Product Squad G8b (progress timeline UI).

CREATE TYPE goal_progress_source AS ENUM ('manual', 'network', 'relationship', 'habit', 'business');

CREATE TABLE goal_progress_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  delta INTEGER NOT NULL,
  source goal_progress_source NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX gpe_goal_idx ON goal_progress_events(goal_id);
CREATE INDEX gpe_workspace_idx ON goal_progress_events(workspace_id);
