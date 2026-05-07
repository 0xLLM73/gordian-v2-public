-- Add workspace_id to chat_participants for tenant isolation.
-- Backfill from the parent chats table, then enforce NOT NULL + FK.

ALTER TABLE "chat_participants" ADD COLUMN "workspace_id" uuid;

UPDATE "chat_participants"
SET "workspace_id" = (
    SELECT "workspace_id" FROM "chats" WHERE "chats"."id" = "chat_participants"."chat_id"
);

ALTER TABLE "chat_participants" ALTER COLUMN "workspace_id" SET NOT NULL;

ALTER TABLE "chat_participants"
    ADD CONSTRAINT "chat_participants_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id");

CREATE INDEX "chat_participants_workspace_id_idx" ON "chat_participants" ("workspace_id");
