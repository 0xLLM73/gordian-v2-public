-- Migration 0028: Add 'relationship_health' to outcome_type enum
-- Required for Phase 35 evaluateRelationship() evaluator.
-- IF NOT EXISTS prevents errors if migration is applied more than once.
ALTER TYPE "outcome_type" ADD VALUE IF NOT EXISTS 'relationship_health';
