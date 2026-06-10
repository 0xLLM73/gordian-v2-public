ALTER TYPE "public"."cadence_step_status" ADD VALUE IF NOT EXISTS 'pending_review' AFTER 'ready';
