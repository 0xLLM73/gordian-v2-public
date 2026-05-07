-- Voice Profile: Schema for style extraction and per-contact overrides
-- Part of Voice Profile sprint (Batch 1)
-- Risk: LOW — new tables + new enum + one nullable column on existing table

-- 1. Create dominant_tone enum
CREATE TYPE dominant_tone AS ENUM ('casual', 'professional', 'warm', 'terse');

-- 2. Create voice_profiles table
CREATE TABLE voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),

  -- Structure
  avg_message_length REAL NOT NULL DEFAULT 0,
  median_message_length REAL NOT NULL DEFAULT 0,
  avg_word_count REAL NOT NULL DEFAULT 0,
  avg_sentence_count REAL NOT NULL DEFAULT 0,

  -- Punctuation
  exclamation_rate REAL NOT NULL DEFAULT 0,
  question_rate REAL NOT NULL DEFAULT 0,
  ellipsis_rate REAL NOT NULL DEFAULT 0,
  all_caps_rate REAL NOT NULL DEFAULT 0,

  -- Expression
  emoji_rate REAL NOT NULL DEFAULT 0,
  emoji_top_n JSONB DEFAULT '[]',

  -- Formality
  contraction_rate REAL NOT NULL DEFAULT 0,
  slang_rate REAL NOT NULL DEFAULT 0,
  greeting_rate REAL NOT NULL DEFAULT 0,
  signoff_rate REAL NOT NULL DEFAULT 0,

  -- Conversational
  question_ask_rate REAL NOT NULL DEFAULT 0,
  initiation_rate REAL NOT NULL DEFAULT 0,

  -- Vocabulary
  avg_unique_word_ratio REAL NOT NULL DEFAULT 0,
  filler_word_rate REAL NOT NULL DEFAULT 0,

  -- Meta
  sample_size INTEGER NOT NULL DEFAULT 0,
  profile_version INTEGER NOT NULL DEFAULT 1,
  calibration_complete BOOLEAN NOT NULL DEFAULT false,
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX voice_profiles_user_workspace_uniq ON voice_profiles (user_id, workspace_id);

-- 3. Create contact_style_overrides table
CREATE TABLE contact_style_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),

  -- Absolute features
  avg_message_length REAL NOT NULL DEFAULT 0,
  emoji_rate REAL NOT NULL DEFAULT 0,
  contraction_rate REAL NOT NULL DEFAULT 0,
  exclamation_rate REAL NOT NULL DEFAULT 0,
  question_ask_rate REAL NOT NULL DEFAULT 0,
  greeting_rate REAL NOT NULL DEFAULT 0,
  signoff_rate REAL NOT NULL DEFAULT 0,
  slang_rate REAL NOT NULL DEFAULT 0,
  avg_word_count REAL NOT NULL DEFAULT 0,
  filler_word_rate REAL NOT NULL DEFAULT 0,
  avg_unique_word_ratio REAL NOT NULL DEFAULT 0,
  emoji_top_n JSONB DEFAULT '[]',

  -- Deviation signals
  length_multiplier REAL NOT NULL DEFAULT 1,
  formality_shift REAL NOT NULL DEFAULT 0,
  emoji_multiplier REAL NOT NULL DEFAULT 1,
  dominant_tone dominant_tone NOT NULL DEFAULT 'casual',

  -- Meta
  sample_size INTEGER NOT NULL DEFAULT 0,
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contact_style_overrides_uniq ON contact_style_overrides (workspace_id, contact_id);

-- 4. Add style_profile_version to draft_logs (nullable — null = pre-voice-profile era)
ALTER TABLE draft_logs ADD COLUMN style_profile_version INTEGER;
