# Protected Creator Agent API

The first API slice resolves a signed-in Auth0 identity to a durable internal creator record. It does not process content, call an AI provider, or incur model-token costs.

## Endpoints

| Method and path | Authentication | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Liveness response with `aiCalls: 0` |
| `GET /v1/me` | Auth0 bearer token with `read:creator` | Upsert and return the caller's internal creator ID |

`/v1/me` accepts no owner identifier. The API derives ownership only after verifying the token signature, exact issuer, API audience, expiration, `RS256` algorithm, subject, and `read:creator` permission against the configured Auth0 tenant's JWKS.

## Configure Auth0

1. In Auth0, create a custom API with identifier `https://api.creator-agent.example` or another unique URI.
2. Use `RS256` signing.
3. Add the permission `read:creator`.
4. Authorize the Single Page Application to request that permission.
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

The `users` table stores only:

- An application-generated opaque UUID
- The verified OIDC issuer and subject
- Creation and last-seen timestamps
- A deletion timestamp when access is revoked

It does not store access tokens, passwords, email addresses, display names, profile images, uploaded content, or AI-provider credentials. A unique `(auth_issuer, auth_subject)` constraint provides stable mapping under concurrent logins. A deleted identity is not automatically reactivated.

## Production boundary

- Keep `DATABASE_URL` in a managed server-side secret store; never expose it as `VITE_*` configuration.
- Use TLS for the deployed API and database connection.
- Set one exact allowed browser origin per environment.
- Keep the Auth0 issuer and JWKS location operator-configured; never select them from unverified token claims.
- Return generic authentication errors and never log bearer tokens.
- Enforce resource ownership in every subsequent agents and sources query using the internal creator ID resolved by this boundary.

The current local simulator still uses its explicit development-only identity and does not call this API. Real `/v1/me` integration requires a configured Auth0 tenant and PostgreSQL database.
