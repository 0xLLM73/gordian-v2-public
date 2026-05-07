-- Migration 0033: Fix golden_dataset feature_domain mismatch
-- The code was seeding examples with 'seed_commitment_extraction' but
-- runtime queries used 'commitment_extraction', so golden examples
-- never appeared in extraction prompts.

UPDATE golden_dataset
SET feature_domain = 'commitment_extraction'
WHERE feature_domain = 'seed_commitment_extraction';
