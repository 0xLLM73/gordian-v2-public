-- Sprint 6: Add per-user KMS session KEK column to accounts table.
-- null = legacy TSK-encrypted session; non-null = per-user KEK encrypted session.
ALTER TABLE accounts ADD COLUMN session_kek_encrypted bytea;
