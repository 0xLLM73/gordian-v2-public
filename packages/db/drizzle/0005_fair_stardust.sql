ALTER TABLE "commitments" ADD COLUMN "fulfillment_evidence" text;--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "fulfilled_at" timestamp with time zone;