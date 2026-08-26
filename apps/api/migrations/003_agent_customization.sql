ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS style_preset text NOT NULL DEFAULT 'warm'
    CHECK (style_preset IN ('warm', 'direct', 'curious', 'custom')),
  ADD COLUMN IF NOT EXISTS response_length text NOT NULL DEFAULT 'balanced'
    CHECK (response_length IN ('short', 'balanced', 'deep')),
  ADD COLUMN IF NOT EXISTS signature_phrases jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(signature_phrases) = 'array'),
  ADD COLUMN IF NOT EXISTS prohibited_topics jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(prohibited_topics) = 'array'),
  ADD COLUMN IF NOT EXISTS greeting text NOT NULL DEFAULT ''
    CHECK (length(greeting) <= 500);
