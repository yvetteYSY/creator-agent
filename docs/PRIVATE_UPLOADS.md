# Private video upload boundary

The current ingestion slice accepts MP4 files up to 250 MB in configured Auth0 mode. The request path stores the original privately and truthfully stops at `uploaded`. A separately scheduled, zero-AI quarantine worker can perform structural inspection and private ClamAV scanning; neither path calls transcription or generation services, consumes AI tokens, or makes the source available to answers.

## Request flow

1. The browser sends title, `.mp4` filename, `video/mp4` type, and exact byte size to the authenticated API.
2. The API verifies the Auth0 bearer token and `write:agent` permission, resolves the internal creator, and applies owner scope to the requested agent.
3. The API generates an opaque storage key and a POST policy that expires after 10 minutes. The policy permits only that key, exact content type, and exact byte size. Production configuration also requires the `AES256` server-side-encryption field.
4. The browser posts a multipart form directly to the signed storage URL. It does not attach the Auth0 access token or receive long-lived storage credentials.
5. The browser calls the authenticated completion route. The API performs a server-side metadata lookup and requires the stored size and type to match the authorization.
6. A match becomes `uploaded` and remains preview-only. A mismatch is deleted and marked `failed`/disabled. Neither state can enter public retrieval.
7. When an operator schedules `npm run scan:once`, the worker exclusively leases at most one uploaded source and reads at most two 512 KB ranges. It requires a supported ISO BMFF brand, complete movie metadata, a duration from 1 second through 4 hours, H.264 video (`avc1`/`avc3`), and AAC audio (`mp4a`).
8. Structurally valid media is streamed from private storage in exact 1 MB-or-smaller chunks to a private ClamAV `INSTREAM` endpoint. A clean verdict persists detected metadata plus scan status and becomes `processing` (awaiting transcription). Invalid or infected objects are deleted and marked `failed`/disabled. Storage or scanner failures remain quarantined for at most three attempts.

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
MALWARE_SCANNER_HOST=127.0.0.1
MALWARE_SCANNER_PORT=3310
MALWARE_SCANNER_TIMEOUT_MS=120000
```

If no storage variables are present, upload routes fail closed with `503`; ordinary local simulation keeps the file in the browser. Partial configuration fails API startup. A custom endpoint must be one exact HTTPS origin. Plain HTTP is accepted only for `localhost` or `127.0.0.1` development. `OBJECT_STORAGE_REQUIRE_SSE_HEADER=false` is only for a disposable local service that lacks SSE-S3; production should keep the default `true`.

The bucket must be private and its browser CORS policy should allow only the exact deployed app origin, `POST`, and the request headers required by the signed form. Block public access. Restrict the API's storage identity to the intended bucket/prefix and only the operations needed to sign, inspect, and delete uploads. Prefer workload identity/roles over static keys, store any remaining secret in a managed secret service, enable encryption at rest, and log opaque IDs rather than signed URLs or filenames.

The repository's optional `malware-scanner` Compose service uses the official free ClamAV 1.4 image, persists signature databases, binds TCP only to host loopback, and sets stream/file/scan/time plus container CPU, memory, and process limits. ClamAV TCP is neither encrypted nor authenticated, so production must keep it on a private worker network and must not publish port 3310 publicly. The worker refuses to start without explicit malware-scanner configuration.

## Current guarantees

- Auth0 access tokens go only to the Creator Agent API, never object storage.
- The API never accepts or proxies video bytes.
- Policy expiry, key, declared type, and exact size are server-controlled.
- Completion rechecks stored metadata before changing state.
- The metadata scanner uses `FOR UPDATE SKIP LOCKED`, an opaque lease UUID, a 15-minute stale-lease threshold, and at most three read attempts so concurrent workers cannot complete the same claim.
- Structural reads request and enforce at most one 512 KB head range and, for larger files, one 512 KB tail range. A provider that returns more than a requested range fails closed.
- Structurally valid objects are streamed completely to ClamAV in exact 1 MB-or-smaller reads. A short, oversized, interrupted, timed-out, infected, or malformed scan fails closed and cannot reach transcription.
- Only `clean` or `infected`, scanner name, and scan time are persisted; daemon threat-signature text and uploaded bytes are not written to PostgreSQL or audit events.
- Stored objects and metadata are not returned by public or preview chat.
- Source deletion tombstones it for serving before deleting its stored object.
- Successful synchronous deletion records `storage_deleted_at`; a failed storage call returns `202` with `pendingCleanup: true`, remains tombstoned, and is eligible for the exclusive `npm run cleanup:once` reconciler.
- Unit tests cover owner isolation, malformed metadata, bounded ClamAV framing/verdicts, scanner outage, truncated storage, infected-object deletion, mismatch cleanup, and bearer-token separation.
- Opt-in integration tests prove accepted upload, exact-size rejection, metadata inspection, and deletion against a real S3-compatible service.

## Not yet guaranteed

Do not treat `uploaded` or `processing` as trusted/ready content. The current inspection establishes that available metadata declares an allowlisted brand, duration, H.264 video track, and AAC audio track and that ClamAV returned a clean signature verdict for the streamed bytes. No malware scanner guarantees safety, and this slice does not fully decode every sample or persist a cryptographic checksum. The next sandboxed boundary must add decoder validation and checksum verification. It must be idempotent and must never make content `ready` automatically.

The current delete path is safe for serving because it tombstones metadata first, and its one-shot reconciler provides retryable physical object removal with stale-lease recovery. Immutable content-free events now cover authorization, upload results, scan transitions, tombstoning, and physical deletion without storing filenames, titles, storage keys, URLs, or content. Production still needs continuous scheduling, alerting after the 100-attempt ceiling, audit retention/export policy, lifecycle-policy/orphan verification, backup expiry, and a visible deletion service-level target. Multipart/resumable upload and abandoned-policy cleanup are also future work.

No transcription provider is configured. A future processor must be explicitly selected by the creator or separately funded by the platform, receive only the minimum required content, publish retention/no-training terms, and never silently fall back to a developer's personal AI account.
