CREATE TABLE IF NOT EXISTS github_connection_sessions (
  state_digest text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT github_connection_state_digest_valid CHECK (state_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT github_connection_expiry_valid CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS github_connection_sessions_expiry_idx
  ON github_connection_sessions (expires_at);

CREATE TABLE IF NOT EXISTS github_installations (
  id bigint PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_login text NOT NULL,
  account_type text NOT NULL,
  repository_selection text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT github_installations_owner_identity_unique UNIQUE (id, owner_id),
  CONSTRAINT github_installations_id_positive CHECK (id > 0),
  CONSTRAINT github_installations_account_login_valid CHECK (
    length(account_login) BETWEEN 1 AND 100 AND account_login ~ '^[A-Za-z0-9_.-]+$'
  ),
  CONSTRAINT github_installations_account_type_valid CHECK (account_type IN ('User', 'Organization')),
  CONSTRAINT github_installations_repository_selection_valid CHECK (repository_selection IN ('all', 'selected')),
  CONSTRAINT github_installations_status_valid CHECK (status IN ('active', 'suspended', 'revoked'))
);

CREATE INDEX IF NOT EXISTS github_installations_owner_updated_idx
  ON github_installations (owner_id, updated_at DESC);

DO $$
BEGIN
  ALTER TABLE sources
    ADD CONSTRAINT sources_identity_owner_agent_unique UNIQUE (id, owner_id, agent_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS github_source_imports (
  source_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  installation_id bigint NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  path text NOT NULL,
  git_ref text,
  blob_sha text NOT NULL,
  html_url text NOT NULL,
  content text NOT NULL,
  byte_size integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT github_source_imports_source_fk
    FOREIGN KEY (source_id, owner_id, agent_id) REFERENCES sources(id, owner_id, agent_id) ON DELETE CASCADE,
  CONSTRAINT github_source_imports_installation_fk
    FOREIGN KEY (installation_id, owner_id) REFERENCES github_installations(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT github_source_imports_repository_owner_valid CHECK (
    length(repository_owner) BETWEEN 1 AND 100 AND repository_owner ~ '^[A-Za-z0-9_.-]+$'
  ),
  CONSTRAINT github_source_imports_repository_name_valid CHECK (
    length(repository_name) BETWEEN 1 AND 100 AND repository_name ~ '^[A-Za-z0-9_.-]+$'
  ),
  CONSTRAINT github_source_imports_path_length CHECK (length(path) BETWEEN 1 AND 1024),
  CONSTRAINT github_source_imports_ref_length CHECK (git_ref IS NULL OR length(git_ref) BETWEEN 1 AND 255),
  CONSTRAINT github_source_imports_sha_length CHECK (length(blob_sha) BETWEEN 1 AND 100),
  CONSTRAINT github_source_imports_url_length CHECK (length(html_url) BETWEEN 1 AND 2048),
  CONSTRAINT github_source_imports_content_size CHECK (octet_length(content) BETWEEN 1 AND 1048576),
  CONSTRAINT github_source_imports_byte_size_valid CHECK (byte_size BETWEEN 1 AND 1048576)
);

CREATE INDEX IF NOT EXISTS github_source_imports_owner_agent_idx
  ON github_source_imports (owner_id, agent_id, imported_at DESC);
