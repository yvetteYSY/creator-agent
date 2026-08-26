ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS expected_content_type text,
  ADD COLUMN IF NOT EXISTS expected_size bigint,
  ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS sources_storage_key_unique
  ON sources (storage_key)
  WHERE storage_key IS NOT NULL;

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_expected_size_valid,
  ADD CONSTRAINT sources_expected_size_valid
    CHECK (expected_size IS NULL OR expected_size BETWEEN 1 AND 250000000),
  DROP CONSTRAINT IF EXISTS sources_upload_metadata_complete,
  ADD CONSTRAINT sources_upload_metadata_complete CHECK (
    (storage_key IS NULL AND expected_content_type IS NULL AND expected_size IS NULL AND upload_expires_at IS NULL)
    OR
    (storage_key IS NOT NULL AND expected_content_type IS NOT NULL AND expected_size IS NOT NULL AND upload_expires_at IS NOT NULL)
  );
