# Protected Creator Agent API

The first API slice resolves a signed-in Auth0 identity to a durable internal creator record. It does not process content, call an AI provider, or incur model-token costs.

## Endpoints

| Method and path | Authentication | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Liveness response with `aiCalls: 0` |
| `GET /v1/me` | Auth0 bearer token with `read:creator` | Upsert and return the caller's internal creator ID |
| `GET /v1/agents` | `read:creator` | List only the caller's agents |
| `POST /v1/agents` | `write:agent` | Create a draft agent and configuration version 1 |
| `GET /v1/agents/:agentId` | `read:creator` | Read one caller-owned agent |
| `PATCH /v1/agents/:agentId` | `write:agent` | Create a new immutable configuration snapshot |
| `GET /v1/agents/:agentId/sources` | `read:creator` | List caller-owned source metadata |
| `POST /v1/agents/:agentId/sources` | `write:agent` | Create private, awaiting-upload source metadata |
| `PATCH /v1/agents/:agentId/sources/:sourceId` | `write:agent` | Change source visibility; public requires ready status |
| `DELETE /v1/agents/:agentId/sources/:sourceId` | `write:agent` | Tombstone metadata and disable serving immediately |

No route accepts an owner identifier. The API derives ownership only after verifying the token signature, exact issuer, API audience, expiration, `RS256` algorithm, subject, and required permission against the configured Auth0 tenant's JWKS. Agent and source SQL queries include the resulting internal owner UUID; another creator receives the same generic `404` as a nonexistent resource.

Agent writes accept only the documented name, description, instruction, voice, response-depth, greeting, phrase, topic, and boundary fields. Lists and strings have explicit limits and unknown fields are rejected. Every update creates a complete configuration version so active and historical behavior can be distinguished.

Source creation accepts only a display `title` and `type` (`document`, `audio`, or `video`). It stores metadata with `status: awaiting_upload` and `visibility: preview`. This endpoint does not accept file bytes, transcript text, storage locations, checksums, or public visibility; private upload authorization is a later slice. The visibility route rejects an attempt to make a source public until ingestion has placed it in `ready` state.

## Configure Auth0

1. In Auth0, create a custom API with identifier `https://api.creator-agent.example` or another unique URI.
2. Use `RS256` signing.
3. Add the permissions `read:creator` and `write:agent`.
4. Authorize the Single Page Application to request both permissions.
5. Use the same identifier for `AUTH0_AUDIENCE` on the API and `VITE_AUTH0_AUDIENCE` in the simulator.

## Run locally

Start a local PostgreSQL instance if needed:

```bash
docker compose up -d database
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

The API listens on `http://127.0.0.1:4320`. Set `VITE_CREATOR_API_URL=http://127.0.0.1:4320` in the simulator's `.env.local`, restart the simulator, and complete Auth0 login.

## Persisted identity data

The identity and workspace tables store:

- An application-generated opaque UUID
- The verified OIDC issuer and subject
- Creation and last-seen timestamps
- A deletion timestamp when access is revoked
- Agent name, description, draft/publication state, and immutable configuration versions
- Source title, media type, processing status, and private/public/disabled visibility

They do not store access tokens, passwords, email addresses, display names, profile images, uploaded bytes, transcripts, extracted text, storage credentials, or AI-provider credentials. A unique `(auth_issuer, auth_subject)` constraint provides stable mapping under concurrent logins. A deleted identity is not automatically reactivated.

Agent configuration history is append-only. Source rows redundantly carry the owner UUID and use a composite `(agent_id, owner_id)` foreign key, preventing a source from being attached to another creator's agent even if application code is incorrect. Migration names are recorded and pending migrations run in one transaction. Migration replay is idempotent and verified against PostgreSQL 17 in the local integration check.

## Production boundary

- Keep `DATABASE_URL` in a managed server-side secret store; never expose it as `VITE_*` configuration.
- Use TLS for the deployed API and database connection.
- Set one exact allowed browser origin per environment.
- Keep the Auth0 issuer and JWKS location operator-configured; never select them from unverified token claims.
- Return generic authentication errors and never log bearer tokens.
- Enforce resource ownership in every subsequent agents and sources query using the internal creator ID resolved by this boundary.
- Keep titles and configuration values out of logs and traces because creators may place sensitive information in either field.

The current local simulator still uses its explicit development-only identity and does not call this API. Auth0 mode resolves `/v1/me`, loads or bootstraps the durable agent, restores its configuration, and persists later customization and source-metadata changes. Source content remains browser-only until the private upload slice. Real protected integration requires a configured Auth0 tenant and PostgreSQL database.

## PostgreSQL integration check

Normal tests require no database. To run the real repository SQL suite against a dedicated disposable database:

```bash
TEST_DATABASE_URL=postgres://creator_agent:password@127.0.0.1:5432/creator_agent \
  npm test -- --run apps/api/tests/postgres.integration.test.ts
```

The integration suite creates test identity, agent, configuration, and source rows. Use only an empty disposable database; never point it at development, staging, or production data.
