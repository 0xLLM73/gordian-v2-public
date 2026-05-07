-- SH4: Row-Level Security — workspace isolation
-- Defense-in-depth: DAL already enforces workspace_id on every query,
-- but RLS adds a database-level safety net.
-- Requires: transaction-local app.workspace_id via withWorkspaceRLS()
-- in packages/db/src/client.ts before querying workspace-scoped tables.
--
-- SEC-S9-002-B TODO: Phase 2 should cover remaining workspace-scoped tables:
-- recommendations, introductions, deal_participants, deal_artifacts,
-- connections, health_scores, behaviors, goal_progress_events,
-- summaries, digests, briefs, semantic_cache, contact_tags,
-- contact_relationships, contact_shares, contact_style_overrides,
-- voice_profiles, follow_up_plan_steps, knowledge_contacts,
-- knowledge_extraction_log, knowledge_links, investor_profiles,
-- correction_diffs, semantic_patterns, golden_dataset, bandit_ledger,
-- causal_edges, calendar_connections, calendar_events, draft_logs.

-- contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON contacts
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON messages
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- chats
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON chats
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- memories (partitioned — policy propagates to all partitions)
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON memories
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- commitments
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON commitments
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- deals
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON deals
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- deal_candidates
ALTER TABLE deal_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON deal_candidates
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- goals
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON goals
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- goal_actions
ALTER TABLE goal_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON goal_actions
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- knowledge_nodes
ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON knowledge_nodes
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- knowledge_links
ALTER TABLE knowledge_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON knowledge_links
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- cadences (follow-up plans)
ALTER TABLE cadences ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON cadences
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- outcomes
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON outcomes
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- user_decisions
ALTER TABLE user_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON user_decisions
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
