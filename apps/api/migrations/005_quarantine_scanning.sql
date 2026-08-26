ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS scan_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scan_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS scan_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scan_lease_id uuid,
  ADD COLUMN IF NOT EXISTS detected_media_type text,
  ADD COLUMN IF NOT EXISTS failure_code text;

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_status_valid,
  ADD CONSTRAINT sources_status_valid CHECK (
    status IN ('awaiting_upload', 'uploaded', 'scanning', 'processing', 'ready', 'failed', 'deleting')
  ),
  DROP CONSTRAINT IF EXISTS sources_scan_attempts_valid,
  ADD CONSTRAINT sources_scan_attempts_valid CHECK (scan_attempts BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS sources_scan_lease_valid,
  ADD CONSTRAINT sources_scan_lease_valid CHECK (
    (status = 'scanning' AND scan_lease_id IS NOT NULL AND scan_started_at IS NOT NULL)
    OR
    (status <> 'scanning' AND scan_lease_id IS NULL)
  ),
  DROP CONSTRAINT IF EXISTS sources_detected_media_type_length,
  ADD CONSTRAINT sources_detected_media_type_length CHECK (
    detected_media_type IS NULL OR length(detected_media_type) <= 80
  ),
  DROP CONSTRAINT IF EXISTS sources_failure_code_length,
  ADD CONSTRAINT sources_failure_code_length CHECK (
    failure_code IS NULL OR length(failure_code) <= 80
  );

CREATE INDEX IF NOT EXISTS sources_scan_queue_idx
  ON sources (updated_at, id)
  WHERE deleted_at IS NULL AND status IN ('uploaded', 'scanning');
