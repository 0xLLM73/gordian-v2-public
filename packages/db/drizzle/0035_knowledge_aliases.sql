-- Add aliases array to knowledge_nodes for HITL merge tracking.
-- When nodes are merged, the deleted node's name is added to the
-- survivor's aliases array. The extraction pipeline checks aliases
-- during dedup to prevent re-creating merged nodes.
ALTER TABLE "knowledge_nodes" ADD COLUMN "aliases" text[] DEFAULT '{}';
