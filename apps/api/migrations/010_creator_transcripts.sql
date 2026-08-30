ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_owner_agent_identity_unique,
  ADD CONSTRAINT sources_owner_agent_identity_unique UNIQUE (id, owner_id, agent_id);

CREATE TABLE IF NOT EXISTS source_transcripts (
  source_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  format text NOT NULL DEFAULT 'text/vtt',
  webvtt text NOT NULL,
  cue_count integer NOT NULL,
  duration_ms bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT source_transcripts_source_owner_fk
    FOREIGN KEY (source_id, owner_id, agent_id)
    REFERENCES sources(id, owner_id, agent_id) ON DELETE CASCADE,
  CONSTRAINT source_transcripts_version_positive CHECK (version > 0),
  CONSTRAINT source_transcripts_status_valid CHECK (status IN ('draft', 'approved', 'rejected')),
  CONSTRAINT source_transcripts_review_state_valid CHECK (
    (status = 'draft' AND approved_at IS NULL AND rejected_at IS NULL)
    OR (status = 'approved' AND approved_at IS NOT NULL AND rejected_at IS NULL)
    OR (status = 'rejected' AND approved_at IS NULL AND rejected_at IS NOT NULL)
  ),
  CONSTRAINT source_transcripts_format_valid CHECK (format = 'text/vtt'),
  CONSTRAINT source_transcripts_webvtt_size CHECK (octet_length(webvtt) <= 2000000),
  CONSTRAINT source_transcripts_cue_count_valid CHECK (cue_count BETWEEN 0 AND 10000),
  CONSTRAINT source_transcripts_duration_valid CHECK (duration_ms BETWEEN 0 AND 14400000),
  CONSTRAINT source_transcripts_content_lifecycle_valid CHECK (
    (deleted_at IS NULL AND octet_length(webvtt) > 0 AND cue_count > 0 AND duration_ms > 0)
    OR (deleted_at IS NOT NULL AND webvtt = '' AND cue_count = 0 AND duration_ms = 0)
  )
);

CREATE INDEX IF NOT EXISTS source_transcripts_owner_agent_idx
  ON source_transcripts (owner_id, agent_id, updated_at DESC)
  WHERE deleted_at IS NULL;
