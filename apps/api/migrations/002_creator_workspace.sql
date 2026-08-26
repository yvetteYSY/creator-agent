CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  configuration_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT agents_owner_identity_unique UNIQUE (id, owner_id),
  CONSTRAINT agents_name_length CHECK (length(name) BETWEEN 1 AND 80),
  CONSTRAINT agents_description_length CHECK (length(description) <= 500),
  CONSTRAINT agents_status_valid CHECK (status IN ('draft', 'published', 'unpublished')),
  CONSTRAINT agents_configuration_version_positive CHECK (configuration_version > 0)
);

CREATE INDEX IF NOT EXISTS agents_owner_updated_idx
  ON agents (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_configs (
  agent_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  version integer NOT NULL,
  instructions text NOT NULL DEFAULT '',
  tone text NOT NULL DEFAULT '',
  boundaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, version),
  CONSTRAINT agent_configs_owner_fk
    FOREIGN KEY (agent_id, owner_id) REFERENCES agents(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT agent_configs_version_positive CHECK (version > 0),
  CONSTRAINT agent_configs_instructions_length CHECK (length(instructions) <= 4000),
  CONSTRAINT agent_configs_tone_length CHECK (length(tone) <= 500),
  CONSTRAINT agent_configs_boundaries_array CHECK (jsonb_typeof(boundaries) = 'array')
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  title text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_upload',
  visibility text NOT NULL DEFAULT 'preview',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT sources_agent_owner_fk
    FOREIGN KEY (agent_id, owner_id) REFERENCES agents(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT sources_title_length CHECK (length(title) BETWEEN 1 AND 160),
  CONSTRAINT sources_type_valid CHECK (type IN ('document', 'audio', 'video')),
  CONSTRAINT sources_status_valid CHECK (status IN ('awaiting_upload', 'uploaded', 'processing', 'ready', 'failed', 'deleting')),
  CONSTRAINT sources_visibility_valid CHECK (visibility IN ('preview', 'public', 'disabled'))
);

CREATE INDEX IF NOT EXISTS sources_owner_agent_updated_idx
  ON sources (owner_id, agent_id, updated_at DESC)
  WHERE deleted_at IS NULL;
