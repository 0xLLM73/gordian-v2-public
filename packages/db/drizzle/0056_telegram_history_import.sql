-- Safe Telegram history import state.
-- This is separate from the legacy env-gated full backfill path so dashboard
-- imports have durable progress, pause/cancel state, and per-chat cursors.

DO $$
BEGIN
  CREATE TYPE telegram_import_run_status AS ENUM (
    'queued',
    'discovering',
    'importing',
    'pausing',
    'paused',
    'cancelling',
    'cancelled',
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE telegram_import_chat_status AS ENUM (
    'queued',
    'importing',
    'paused',
    'completed',
    'skipped',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE telegram_import_scope AS ENUM ('all_private_and_groups');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE chats ADD COLUMN IF NOT EXISTS source_account_id text;
CREATE INDEX IF NOT EXISTS chats_workspace_source_account_idx
  ON chats(workspace_id, source_account_id);
DROP INDEX IF EXISTS chats_workspace_telegram_idx;
CREATE UNIQUE INDEX IF NOT EXISTS chats_workspace_telegram_legacy_idx
  ON chats(workspace_id, telegram_chat_id)
  WHERE source_account_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chats_workspace_source_telegram_idx
  ON chats(workspace_id, source_account_id, telegram_chat_id)
  WHERE source_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_account_id text NOT NULL,
  scope telegram_import_scope NOT NULL DEFAULT 'all_private_and_groups',
  include_private boolean NOT NULL DEFAULT true,
  include_groups boolean NOT NULL DEFAULT true,
  include_channels boolean NOT NULL DEFAULT false,
  ai_processing_enabled boolean NOT NULL DEFAULT false,
  status telegram_import_run_status NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  total_dialogs integer NOT NULL DEFAULT 0,
  eligible_dialogs integer NOT NULL DEFAULT 0,
  skipped_dialogs integer NOT NULL DEFAULT 0,
  chats_queued integer NOT NULL DEFAULT 0,
  chats_completed integer NOT NULL DEFAULT 0,
  chats_failed integer NOT NULL DEFAULT 0,
  messages_seen integer NOT NULL DEFAULT 0,
  messages_inserted integer NOT NULL DEFAULT 0,
  duplicate_messages integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  last_heartbeat_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_import_runs_channels_disabled CHECK (include_channels = false),
  CONSTRAINT telegram_import_runs_ai_disabled CHECK (ai_processing_enabled = false)
);

CREATE INDEX IF NOT EXISTS telegram_import_runs_workspace_status_idx
  ON telegram_import_runs(workspace_id, status);
CREATE INDEX IF NOT EXISTS telegram_import_runs_user_status_idx
  ON telegram_import_runs(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_import_runs_idempotency_idx
  ON telegram_import_runs(workspace_id, user_id, source_account_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_import_runs_active_idx
  ON telegram_import_runs(workspace_id, user_id, source_account_id)
  WHERE status IN ('queued', 'discovering', 'importing', 'pausing', 'paused', 'cancelling');

CREATE TABLE IF NOT EXISTS telegram_import_run_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES telegram_import_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_account_id text NOT NULL,
  chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  telegram_chat_id text NOT NULL,
  chat_type chat_type NOT NULL,
  status telegram_import_chat_status NOT NULL DEFAULT 'queued',
  skip_reason text,
  telegram_top_message_id integer,
  next_offset_message_id integer NOT NULL DEFAULT 0,
  oldest_imported_message_id integer,
  newest_imported_message_id integer,
  pages_fetched integer NOT NULL DEFAULT 0,
  messages_seen integer NOT NULL DEFAULT 0,
  messages_inserted integer NOT NULL DEFAULT 0,
  duplicate_messages integer NOT NULL DEFAULT 0,
  rate_limit_until timestamptz,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_import_run_chats_unique_dialog UNIQUE (import_run_id, telegram_chat_id)
);

CREATE INDEX IF NOT EXISTS telegram_import_run_chats_run_status_idx
  ON telegram_import_run_chats(import_run_id, status);
CREATE INDEX IF NOT EXISTS telegram_import_run_chats_workspace_source_idx
  ON telegram_import_run_chats(workspace_id, source_account_id);

CREATE TABLE IF NOT EXISTS telegram_chat_import_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_account_id text NOT NULL,
  chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  telegram_chat_id text NOT NULL,
  chat_type chat_type NOT NULL,
  history_complete boolean NOT NULL DEFAULT false,
  next_offset_message_id integer NOT NULL DEFAULT 0,
  oldest_imported_message_id integer,
  newest_imported_message_id integer,
  last_import_run_id uuid REFERENCES telegram_import_runs(id) ON DELETE SET NULL,
  last_imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_chat_import_state_workspace_source_idx
  ON telegram_chat_import_state(workspace_id, source_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_chat_import_state_unique_dialog
  ON telegram_chat_import_state(workspace_id, source_account_id, telegram_chat_id);

ALTER TABLE telegram_import_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON telegram_import_runs;
CREATE POLICY workspace_isolation ON telegram_import_runs
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE telegram_import_run_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON telegram_import_run_chats;
CREATE POLICY workspace_isolation ON telegram_import_run_chats
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE telegram_chat_import_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON telegram_chat_import_state;
CREATE POLICY workspace_isolation ON telegram_chat_import_state
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
