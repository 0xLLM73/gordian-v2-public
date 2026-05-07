CREATE TYPE "public"."chat_type" AS ENUM('private', 'group', 'supergroup', 'channel');--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"type" "chat_type" DEFAULT 'private' NOT NULL,
	"title" text,
	"username" text,
	"participant_count" integer,
	"is_archived" boolean DEFAULT false,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"contact_id" uuid,
	"telegram_message_id" text NOT NULL,
	"text" text,
	"is_outgoing" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"chat_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "chat_participants_chat_id_contact_id_pk" PRIMARY KEY("chat_id","contact_id")
);
--> statement-breakpoint
CREATE INDEX "messages_workspace_chat_idx" ON "messages" USING btree ("workspace_id","chat_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_contact_idx" ON "messages" USING btree ("workspace_id","contact_id");--> statement-breakpoint
CREATE INDEX "messages_sent_at_idx" ON "messages" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "messages_telegram_id_idx" ON "messages" USING btree ("workspace_id","chat_id","telegram_message_id");