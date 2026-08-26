ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS storage_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_lease_id uuid,
  ADD COLUMN IF NOT EXISTS deletion_failure_code text;

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_deletion_attempts_valid,
  ADD CONSTRAINT sources_deletion_attempts_valid CHECK (deletion_attempts BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS sources_deletion_lease_valid,
  ADD CONSTRAINT sources_deletion_lease_valid CHECK (
    deletion_lease_id IS NULL
    OR (deleted_at IS NOT NULL AND deletion_started_at IS NOT NULL AND storage_deleted_at IS NULL)
  ),
  DROP CONSTRAINT IF EXISTS sources_deletion_failure_code_length,
  ADD CONSTRAINT sources_deletion_failure_code_length CHECK (
    deletion_failure_code IS NULL OR length(deletion_failure_code) <= 80
  );

CREATE INDEX IF NOT EXISTS sources_storage_deletion_queue_idx
  ON sources (updated_at, id)
  WHERE deleted_at IS NOT NULL AND storage_key IS NOT NULL AND storage_deleted_at IS NULL;
