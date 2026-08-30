# Production readiness roadmap

This roadmap turns the current zero-cost MVP into a closed beta and then a public production service. Work should continue in small vertical slices that each preserve tenant isolation, creator approval, truthful processing states, deletion, and the rule that Creator Agent never silently uses a developer or creator AI key.

## Cost rule

Development and automated tests must remain deterministic and free of paid AI calls. A production feature may use a paid provider only after the product has an explicit funding and billing model, the creator sees the processing boundary, and usage is attributable to the correct payer.

Free paths remain first-class:

- creator-provided WebVTT transcripts;
- deterministic local retrieval and answer generation;
- creator-owned agent or transcription endpoints;
- local PostgreSQL, S3-compatible storage, and worker containers for development;
- synthetic media fixtures and provider fakes in CI.

No test, preview, health check, retry, or fallback may invoke a paid AI provider.

## Phase 1 — Secure, reviewable ingestion

Build one complete path from private upload to creator-approved timestamped knowledge.

1. Inspect the bounded MP4 container structure, duration, audio/video tracks, and allowlisted codecs.
2. Run malware scanning and media parsing in an isolated worker with CPU, memory, file-size, and time limits.
3. Add a durable queue with exclusive leases, retries, timeouts, and dead-letter handling.
4. Accept either creator-provided WebVTT or an explicitly selected creator-owned/self-hosted transcription route.
5. Persist transcript versions separately from originals and keep them preview-only.
6. Let the creator edit, approve, reject, replace, or delete the transcript.
7. Delete originals, transcripts, chunks, and queued jobs through the existing reconciliation model.

Exit criteria:

- invalid or malicious media never reaches a transcription worker;
- a successful upload produces a reviewable timestamped transcript without entering public retrieval;
- only the creator's explicit approval makes transcript chunks eligible for answers;
- deletion removes active derivatives and produces content-free audit events;
- all CI and local preview paths report zero paid AI calls.

## Phase 2 — Production grounded answers

1. Chunk approved documents and transcripts with stable source/timestamp references.
2. Add tenant-filtered embeddings and `pgvector` retrieval behind a provider interface.
3. Keep deterministic local and bring-your-own-agent modes available.
4. Validate every returned citation against the exact supplied context.
5. Stream responses while enforcing prohibited topics, answerability, and maximum context size.
6. Add evaluation suites for abstention, citation accuracy, prompt injection, private-source exclusion, and style consistency.

Exit criteria:

- every supported answer has a resolvable approved citation;
- unsupported questions reliably abstain;
- preview-only, failed, deleting, or cross-tenant content never enters retrieval or routed payloads;
- provider errors never trigger an undisclosed fallback or charge.

## Phase 3 — Mobile closed beta

1. Build the Expo/React Native creator and audience shells against the authenticated API.
2. Use Authorization Code with PKCE and platform-protected token storage.
3. Add resumable upload progress, transcript review, customization, publishing, and audience chat.
4. Add durable audience sessions and creator-controlled conversation retention.
5. Add quotas, per-agent concurrency limits, moderation, reporting, and blocking.
6. Complete App Store and Play Store privacy disclosures for the beta.

Exit criteria:

- mobile authentication, upload interruption, offline recovery, and account switching pass device tests;
- multiple creators and audience members remain isolated under concurrent load;
- the beta exposes usage and cost per creator without using a personal developer quota.

## Phase 4 — Public operations

1. Create separate development, staging, and production environments with automated rollback.
2. Add content-free structured logs, metrics, traces, alerting, and incident response.
3. Automate encrypted backups and prove restoration with recurring drills.
4. Publish privacy, retention, deletion, acceptable-use, subprocessors, and AI-use policies.
5. Add account export/deletion and verify removal across originals, transcripts, chunks, embeddings, caches, and expiring backups.
6. Complete an independent security review and remediate findings before public launch.

Exit criteria:

- tenant-isolation and authorization tests cover every resource route;
- load and failure tests meet documented latency, availability, and recovery targets;
- backup restoration and incident-response exercises succeed;
- abuse controls and cost ceilings fail closed;
- legal and privacy disclosures match actual data flows.

## Immediate execution order

The next free increments are:

1. **Available:** stronger bounded MP4 duration/codec inspection;
2. **Available:** containerized private ClamAV adapter with a deterministic fake and loopback protocol tests for CI;
3. durable creator-provided WebVTT storage and review states;
4. transcript approval and deletion propagation;
5. tenant-filtered deterministic retrieval from approved durable chunks;
6. Expo mobile shell against the same protected API.

Each increment starts with acceptance and privacy tests, ends with `npm run check`, and is merged to `main` only after the full suite passes.
