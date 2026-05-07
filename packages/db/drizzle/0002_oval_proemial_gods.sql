DROP INDEX "messages_telegram_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "chats_workspace_telegram_idx" ON "chats" USING btree ("workspace_id","telegram_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_dedup_idx" ON "messages" USING btree ("workspace_id","chat_id","telegram_message_id");