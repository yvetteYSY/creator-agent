CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  auth_issuer text NOT NULL,
  auth_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_auth_identity_unique UNIQUE (auth_issuer, auth_subject),
  CONSTRAINT users_auth_issuer_nonempty CHECK (length(auth_issuer) > 0),
  CONSTRAINT users_auth_subject_nonempty CHECK (length(auth_subject) > 0)
);
