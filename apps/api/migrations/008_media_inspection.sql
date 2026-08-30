ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS detected_duration_ms bigint,
  ADD COLUMN IF NOT EXISTS detected_video_codec text,
  ADD COLUMN IF NOT EXISTS detected_audio_codec text;

ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_detected_duration_valid,
  ADD CONSTRAINT sources_detected_duration_valid CHECK (
    detected_duration_ms IS NULL OR detected_duration_ms BETWEEN 1000 AND 14400000
  ),
  DROP CONSTRAINT IF EXISTS sources_detected_video_codec_length,
  ADD CONSTRAINT sources_detected_video_codec_length CHECK (
    detected_video_codec IS NULL OR length(detected_video_codec) BETWEEN 1 AND 20
  ),
  DROP CONSTRAINT IF EXISTS sources_detected_audio_codec_length,
  ADD CONSTRAINT sources_detected_audio_codec_length CHECK (
    detected_audio_codec IS NULL OR length(detected_audio_codec) BETWEEN 1 AND 20
  );
