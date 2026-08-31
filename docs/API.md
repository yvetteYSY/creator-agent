# Protected Creator Agent API

The API resolves a signed-in Auth0 identity to a durable internal creator record and owner-scoped workspace. Its optional upload slice authorizes direct private MP4 storage without processing content, calling an AI provider, or incurring model-token costs.

## Endpoints

| Method and path | Authentication | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Liveness response with `aiCalls: 0` |
| `GET /v1/me` | Auth0 bearer token with `read:creator` | Upsert and return the caller's internal creator ID |
| `POST /v1/github/connect` | `write:agent` | Start a creator-bound, expiring GitHub App installation flow |
| `GET /v1/github/callback` | One-time state plus GitHub OAuth code | Verify the GitHub administrator and bind the installation |
| `POST /v1/github/webhooks` | GitHub HMAC signature | Apply installation suspend/uninstall/repository lifecycle state |
| `GET /v1/github/installations` | `read:creator` | List only the caller's GitHub installations |
| `GET /v1/github/installations/:installationId/repositories` | `read:creator` | List repositories granted to one caller-owned active installation |
| `GET /v1/agents` | `read:creator` | List only the caller's agents |
| `POST /v1/agents` | `write:agent` | Create a draft agent and configuration version 1 |
| `GET /v1/agents/:agentId` | `read:creator` | Read one caller-owned agent |
| `PATCH /v1/agents/:agentId` | `write:agent` | Create a new immutable configuration snapshot |
| `GET /v1/agents/:agentId/sources` | `read:creator` | List caller-owned source metadata |
| `POST /v1/agents/:agentId/sources` | `write:agent` | Create private, awaiting-upload source metadata |
| `POST /v1/agents/:agentId/sources/github` | `write:agent` | Import one selected Markdown/MDX/text file as preview-only knowledge |
| `POST /v1/agents/:agentId/sources/uploads` | `write:agent` | Authorize one private direct MP4 upload |
| `POST /v1/agents/:agentId/sources/:sourceId/complete` | `write:agent` | Verify stored size/type and mark the source uploaded |
| `GET /v1/agents/:agentId/sources/:sourceId/transcript` | `read:creator` | Read the caller-owned transcript draft or reviewed version |
| `PUT /v1/agents/:agentId/sources/:sourceId/transcript` | `write:agent` | Validate and save/version a creator-provided WebVTT draft after clean scanning |
| `PATCH /v1/agents/:agentId/sources/:sourceId/transcript` | `write:agent` | Approve or reject a draft; approval moves the preview-only source to ready |
| `PATCH /v1/agents/:agentId/sources/:sourceId` | `write:agent` | Change source visibility; public requires ready status |
| `DELETE /v1/agents/:agentId/sources/:sourceId` | `write:agent` | Tombstone immediately; return `200` after object deletion or `202` when durable cleanup remains pending |

No route accepts an owner identifier. The API derives ownership only after verifying the token signature, exact issuer, API audience, expiration, `RS256` algorithm, subject, and required permission against the configured Auth0 tenant's JWKS. Agent and source SQL queries include the resulting internal owner UUID; another creator receives the same generic `404` as a nonexistent resource.

Agent writes accept only the documented name, description, instruction, voice, response-depth, greeting, phrase, topic, and boundary fields. Lists and strings have explicit limits and unknown fields are rejected. Every update creates a complete configuration version so active and historical behavior can be distinguished.

Generic source creation accepts only a display `title` and `type` (`document`, `audio`, or `video`). It stores metadata with `status: awaiting_upload` and `visibility: preview`. It does not accept file bytes, transcript text, storage locations, checksums, or public visibility.

Private upload authorization accepts a title, `.mp4` filename, exact `video/mp4` content type, and integer size from 1 byte through 250 MB. It returns a 10-minute S3-compatible POST policy pinned to one server-generated opaque key, exact content type, and exact byte size. The browser posts the file directly to object storage without an API bearer token, then calls the authenticated completion route. Completion performs a server-side `HEAD`, compares stored metadata to the authorization, deletes mismatches, and moves a valid source only to `uploaded`/`preview`. It does not mark content ready or public. See [PRIVATE_UPLOADS.md](PRIVATE_UPLOADS.md).

The visibility route rejects an attempt to make any source public until a future ingestion worker has placed it in `ready` state.

Transcript upload accepts only `{ "format": "text/vtt", "content": "..." }`. The shared deterministic parser enforces a 2 MB content limit, at most 10,000 chronological cues, a maximum four-hour duration, and timestamps no more than five seconds beyond the inspected video. Draft replacement increments a version and forces the source back to `processing`/preview. `PATCH` accepts only `approved` or `rejected`; approval makes the source `ready` but still preview-only until the creator separately changes visibility. No transcript route calls an AI provider.

## Configure Auth0

1. In Auth0, create a custom API with identifier `https://api.creator-agent.example` or another unique URI.
2. Use `RS256` signing.
3. Add the permissions `read:creator` and `write:agent`.
4. Authorize the Single Page Application to request both permissions.
5. Use the same identifier for `AUTH0_AUDIENCE` on the API and `VITE_AUTH0_AUDIENCE` in the simulator.

## Run locally

Start local PostgreSQL and the private ClamAV service if needed:

```bash
docker compose up -d database malware-scanner
```

Copy `apps/api/.env.example` to `apps/api/.env.local` and set the Auth0 values. Environment files are not loaded implicitly by the server; either load the file with your preferred secret tool or export the variables in the current shell. For the bundled Compose database, the local connection string is:

```dotenv
DATABASE_URL=postgres://creator_agent:local-development-only@127.0.0.1:5432/creator_agent
```

Apply the schema and start the API:

```bash
npm run db:migrate
npm run dev:api
```

To claim and preliminarily scan one completed upload without any AI call:

```bash
npm run scan:once
npm run cleanup:once
```

Both one-shot commands use server-only configuration, print only opaque job metadata plus `aiCalls: 0`, and exit after one source or an idle result. Apply migrations through 011 for the current API. `scan:once` requires private storage and `MALWARE_SCANNER_HOST`; it fails closed when ClamAV is unavailable. `cleanup:once` reconciles physical deletion for already tombstoned sources. Run them from a controlled scheduler. Neither invokes an AI provider.

The API listens on `http://127.0.0.1:4320`. Set `VITE_CREATOR_API_URL=http://127.0.0.1:4320` in the simulator's `.env.local`, restart the simulator, and complete Auth0 login.

## Persisted identity data

The identity and workspace tables store:

- An application-generated opaque UUID
- The verified OIDC issuer and subject
- Creation and last-seen timestamps
- A deletion timestamp when access is revoked
- Agent name, description, draft/publication state, and immutable configuration versions
- Source title, media type, processing status, private/public/disabled visibility, opaque storage key, expected content type/size, upload-policy expiry, bounded scan state, detected duration/video/audio codecs, malware verdict/scanner/time, creator-provided WebVTT/version/review metadata, and storage-deletion completion/lease/attempt state
- GitHub installation/account/lifecycle metadata and the explicitly selected imported text, repository path/ref/blob SHA, and GitHub file URL

PostgreSQL does not store Auth0/GitHub access tokens, passwords, email addresses, display names, profile images, uploaded video bytes, storage credentials, GitHub App secrets, or AI-provider credentials. Creator-provided WebVTT and selected GitHub file content are stored in owner-scoped tables and must use encrypted database storage in production; neither is copied into audit events or logs. Source deletion overwrites transcript content before tombstoning or cascades deletion of its GitHub-import row. Uploaded video bytes live only in the configured private object store. A unique `(auth_issuer, auth_subject)` constraint provides stable mapping under concurrent logins. A deleted identity is not automatically reactivated.

Ingestion lifecycle changes also append immutable `audit_events` rows containing only actor class/opaque creator ID, action, source UUID, bounded state metadata, and timestamp. Filenames, titles, Auth0 subjects, storage keys, signed URLs, transcripts, and bytes are forbidden by the writer contract and regression tests. PostgreSQL triggers reject application-level `UPDATE` and `DELETE` against these events. Retention/export policy and broader agent/publishing coverage remain future work.

Agent configuration history is append-only. Source rows redundantly carry the owner UUID and use a composite `(agent_id, owner_id)` foreign key, preventing a source from being attached to another creator's agent even if application code is incorrect. Migration names are recorded and pending migrations run in one transaction. Migration replay is idempotent and verified against PostgreSQL 17 in the local integration check.

## Production boundary

- Keep `DATABASE_URL` in a managed server-side secret store; never expose it as `VITE_*` configuration.
- Keep storage credentials server-side, restrict them to the private bucket/prefix, and never expose them as `VITE_*` configuration.
- Use TLS for the deployed API and database connection.
- Require HTTPS for production object storage, encryption at rest, block-public-access controls, version/lifecycle policy review, and a CORS allowlist containing only the exact simulator/app web origin.
- Set one exact allowed browser origin per environment.
- Keep the Auth0 issuer and JWKS location operator-configured; never select them from unverified token claims.
- Return generic authentication errors and never log bearer tokens.
- Enforce resource ownership in every subsequent agents and sources query using the internal creator ID resolved by this boundary.
- Keep titles and configuration values out of logs and traces because creators may place sensitive information in either field.

The default local simulator still uses its explicit development-only identity and does not call this API. Auth0 mode resolves `/v1/me`, loads or bootstraps the durable agent, restores its configuration, persists later customization, and can privately upload MP4 files when storage is configured. Pasted source text remains browser-only. Real protected integration requires a configured Auth0 tenant, PostgreSQL database, and private S3-compatible bucket.

## PostgreSQL integration check

Normal tests require no database. To run the real repository SQL suite against a dedicated disposable database:

```bash
TEST_DATABASE_URL=postgres://creator_agent:password@127.0.0.1:5432/creator_agent \
  npm test -- --run apps/api/tests/postgres.integration.test.ts
```

The integration suite creates test identity, agent, configuration, and source rows. Use only an empty disposable database; never point it at development, staging, or production data.

## Object-storage integration check

Normal tests require no object store. To validate signed POST, metadata inspection, exact-size rejection, and deletion against a dedicated local S3-compatible endpoint:

```bash
TEST_OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 \
TEST_OBJECT_STORAGE_ACCESS_KEY_ID=creator-agent-local \
TEST_OBJECT_STORAGE_SECRET_ACCESS_KEY=creator-agent-local-secret \
  npm test -- --run apps/api/tests/object-storage.integration.test.ts
```

The test creates the `creator-agent-private` bucket if missing, uses only synthetic bytes under randomized keys, deletes every accepted test object, and is skipped unless `TEST_OBJECT_STORAGE_ENDPOINT` is set. Use a disposable development service only.
