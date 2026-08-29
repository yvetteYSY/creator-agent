CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_valid CHECK (
    (actor_type = 'creator' AND actor_id IS NOT NULL)
    OR (actor_type = 'system' AND actor_id IS NULL)
  ),
  CONSTRAINT audit_events_action_valid CHECK (
    length(action) BETWEEN 1 AND 80 AND action ~ '^[a-z0-9_.]+$'
  ),
  CONSTRAINT audit_events_target_type_valid CHECK (
    target_type IN ('source')
  ),
  CONSTRAINT audit_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_metadata_size CHECK (octet_length(metadata::text) <= 2048)
);

CREATE INDEX IF NOT EXISTS audit_events_actor_time_idx
  ON audit_events (actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_target_time_idx
  ON audit_events (target_type, target_id, occurred_at);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
