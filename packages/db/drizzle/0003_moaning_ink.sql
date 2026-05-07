CREATE TYPE "public"."contact_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."contact_relationship" AS ENUM('friend', 'colleague', 'prospect', 'client', 'investor', 'family', 'mentor', 'mentee', 'partner', 'vendor', 'other');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'nurturing', 'dormant', 'new');--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"relationship" "contact_relationship",
	"priority" "contact_priority" DEFAULT 'medium',
	"status" "contact_status" DEFAULT 'new',
	"custom_tags" text[],
	"goal" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tags_contact_id_unique" UNIQUE("contact_id")
);
