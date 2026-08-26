# Private video upload boundary

The current ingestion slice accepts MP4 files up to 250 MB in configured Auth0 mode. It stores the original privately and truthfully stops at `uploaded`; it does not inspect media content, call transcription or generation services, consume AI tokens, or make the source available to answers.

## Request flow

1. The browser sends title, `.mp4` filename, `video/mp4` type, and exact byte size to the authenticated API.
2. The API verifies the Auth0 bearer token and `write:agent` permission, resolves the internal creator, and applies owner scope to the requested agent.
3. The API generates an opaque storage key and a POST policy that expires after 10 minutes. The policy permits only that key, exact content type, and exact byte size. Production configuration also requires the `AES256` server-side-encryption field.
4. The browser posts a multipart form directly to the signed storage URL. It does not attach the Auth0 access token or receive long-lived storage credentials.
5. The browser calls the authenticated completion route. The API performs a server-side metadata lookup and requires the stored size and type to match the authorization.
6. A match becomes `uploaded` and remains preview-only. A mismatch is deleted and marked `failed`/disabled. Neither state can enter public retrieval.

The storage key contains no filename, creator name, email address, Auth0 subject, agent title, or source title. Owner/source relationships remain in PostgreSQL and every lookup is scoped by the verified internal owner ID.

## Server configuration

The API reads these server-only variables:

```dotenv
OBJECT_STORAGE_BUCKET=creator-agent-private
OBJECT_STORAGE_REGION=us-east-1
# Omit endpoint and credentials when using the deployment's AWS role/default chain.
OBJECT_STORAGE_ENDPOINT=https://storage.example
OBJECT_STORAGE_ACCESS_KEY_ID=server-only-access-key
OBJECT_STORAGE_SECRET_ACCESS_KEY=server-only-secret
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_REQUIRE_SSE_HEADER=true
```

If no storage variables are present, upload routes fail closed with `503`; ordinary local simulation keeps the file in the browser. Partial configuration fails API startup. A custom endpoint must be one exact HTTPS origin. Plain HTTP is accepted only for `localhost` or `127.0.0.1` development. `OBJECT_STORAGE_REQUIRE_SSE_HEADER=false` is only for a disposable local service that lacks SSE-S3; production should keep the default `true`.

The bucket must be private and its browser CORS policy should allow only the exact deployed app origin, `POST`, and the request headers required by the signed form. Block public access. Restrict the API's storage identity to the intended bucket/prefix and only the operations needed to sign, inspect, and delete uploads. Prefer workload identity/roles over static keys, store any remaining secret in a managed secret service, enable encryption at rest, and log opaque IDs rather than signed URLs or filenames.

## Current guarantees

- Auth0 access tokens go only to the Creator Agent API, never object storage.
- The API never accepts or proxies video bytes.
- Policy expiry, key, declared type, and exact size are server-controlled.
- Completion rechecks stored metadata before changing state.
- Stored objects and metadata are not returned by public or preview chat.
- Source deletion tombstones it for serving before deleting its stored object.
- Unit tests cover owner isolation, malformed metadata, unavailable storage, mismatch cleanup, and bearer-token separation.
- Opt-in integration tests prove accepted upload, exact-size rejection, metadata inspection, and deletion against a real S3-compatible service.

## Not yet guaranteed

Do not treat `uploaded` as trusted content. The next worker boundary must independently verify MP4 magic bytes/container structure, detect the real media type, enforce duration and codec limits, run malware scanning in a sandbox, calculate a checksum, and quarantine failures before transcription. It must be idempotent and must never make content `ready` automatically.

The current synchronous delete is safe for serving because it tombstones metadata first, but production still needs an outbox-backed deletion worker, retries, orphan reconciliation, audit events, lifecycle policies, backup expiry, and a visible deletion service-level target. Multipart/resumable upload and abandoned-policy cleanup are also future work.

No transcription provider is configured. A future processor must be explicitly selected by the creator or separately funded by the platform, receive only the minimum required content, publish retention/no-training terms, and never silently fall back to a developer's personal AI account.
