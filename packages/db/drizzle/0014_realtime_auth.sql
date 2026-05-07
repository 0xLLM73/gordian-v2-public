-- Sprint 7: Supabase Realtime Authorization (LOW-001)
-- Restricts broadcast channels so only authenticated users with matching
-- workspace_id in their JWT can receive messages on workspace:{uuid} topics.

-- Enable RLS on realtime.messages (may already be enabled)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to receive broadcasts only for their workspace
CREATE POLICY "workspace_broadcast_read"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  (select auth.jwt() ->> 'workspace_id') =
    SUBSTRING(realtime.topic() FROM 'workspace:(.+)')
  AND extension = 'broadcast'
);
