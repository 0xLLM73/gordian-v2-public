-- Phase 1: Decision Provenance Graph schema extensions

-- 1.1: Extend knowledge_node_type enum
ALTER TYPE knowledge_node_type ADD VALUE IF NOT EXISTS 'rationale';
ALTER TYPE knowledge_node_type ADD VALUE IF NOT EXISTS 'decision';
ALTER TYPE knowledge_node_type ADD VALUE IF NOT EXISTS 'outcome';

-- 1.2: Extend knowledge_link_type enum
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'cites';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'led_to';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'preceded_by';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'contradicts';

-- 1.3: Extend knowledge_contact_rel_type enum
ALTER TYPE knowledge_contact_rel_type ADD VALUE IF NOT EXISTS 'decided';
ALTER TYPE knowledge_contact_rel_type ADD VALUE IF NOT EXISTS 'experienced_outcome';

-- 1.4: Add metadata column for provenance data
ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 1.5: Index for inbound edge traversal (provenance CTE)
CREATE INDEX IF NOT EXISTS knowledge_links_target_ws_idx
  ON knowledge_links(target_node_id, workspace_id);

-- 1.6: GIN index for metadata JSONB lookups on decision nodes (SEC-PROV-013)
CREATE INDEX IF NOT EXISTS knowledge_nodes_metadata_gin_idx
  ON knowledge_nodes USING GIN (metadata jsonb_path_ops)
  WHERE type = 'decision';
