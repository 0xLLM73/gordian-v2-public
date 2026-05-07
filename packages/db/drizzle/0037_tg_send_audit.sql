-- Add 'send' action and 'message' resource type for Telegram send audit trail
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'send';
ALTER TYPE audit_resource_type ADD VALUE IF NOT EXISTS 'message';
