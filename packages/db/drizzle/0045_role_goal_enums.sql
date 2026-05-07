-- Delta 1: Role + Goal enums for onboarding What Matters page
CREATE TYPE "public"."user_role" AS ENUM('vc_investor', 'founder', 'bd', 'community', 'developer', 'other');
CREATE TYPE "public"."primary_goal" AS ENUM('commitments', 'reconnect', 'network', 'deal_flow');

ALTER TABLE "user_calibrations" ADD COLUMN "user_role" "public"."user_role";
ALTER TABLE "user_calibrations" ADD COLUMN "primary_goal" "public"."primary_goal";
