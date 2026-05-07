-- Add rich AI analysis columns to voice_profiles
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS rich_summary TEXT;
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS rich_tone TEXT;
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS rich_structure TEXT;
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS code_switching_summary TEXT;
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS config_recommendations JSONB;
