-- SEC-004: Add workspace_id to golden_dataset and correction_diffs for tenant isolation.
-- Nullable to preserve existing seed data; application code enforces NOT NULL on new inserts.

ALTER TABLE golden_dataset ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE correction_diffs ADD COLUMN workspace_id UUID REFERENCES workspaces(id);

CREATE INDEX idx_golden_dataset_workspace ON golden_dataset(workspace_id);
CREATE INDEX idx_correction_diffs_workspace ON correction_diffs(workspace_id);
