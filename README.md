# Creator Agent

Creator Agent is a mobile-first platform that lets content creators build an AI agent grounded in their own documents, audio, and video. Creators upload or connect content, review what the system learned, configure the agent's voice and boundaries, and publish a shareable agent that audiences can chat with.

## Project status

The repository contains a test-first, responsive web MVP simulator. It demonstrates the product, privacy, routing, and concurrency behavior before introducing paid AI providers or production infrastructure.

The default simulator is intentionally deterministic and local. **It makes no AI-provider calls, consumes no AI tokens, and cannot create model charges.** Managed Auth0 mode explicitly connects to Auth0 and the protected Creator Agent API, but neither path invokes an AI provider.

### Available now

| Capability | Current implementation |
| --- | --- |
| Managed creator authentication | Auth0 Universal Login uses OIDC Authorization Code with PKCE, in-memory token caching, stable `sub` identity, and login/logout/error states. Tenant configuration is required to exercise real login. |
| Protected creator API | `GET /v1/me` validates Auth0 JWT signature, issuer, audience, expiration, `RS256`, subject, and `read:creator` permission before returning an internal creator ID. |
| Durable creator identity | PostgreSQL maps verified `(issuer, sub)` values to an opaque internal UUID without storing profile data or access tokens. |
| Owner-scoped workspace API | Authenticated routes create, list, read, and version agents plus private-by-default source metadata. Every database path includes the verified internal owner ID. |
| Durable studio synchronization | Auth0 mode loads or bootstraps the creator's agent, restores customization, and persists configuration plus new source metadata updates. Local mode remains network-free. |
| Creator studio | A seeded creator can manage an agent and its knowledge sources in a responsive web interface. |
| Text ingestion | Document or audio-transcript text can be pasted, chunked, and indexed in browser memory. Local video can also use a creator-provided WebVTT sidecar to create timestamped chunks without an AI call. |
| Private MP4 upload | In managed Auth0 mode, an MP4 up to 250 MB uploads directly to private S3-compatible storage through a 10-minute, exact-key/type/size policy. The Auth0 token is sent only to the API, never to storage. Local mode still stages the file without a network request. |
| Quarantine scan boundary | A zero-AI one-shot worker safely claims uploaded sources with PostgreSQL leases, reads at most 4 KB, checks the ISO BMFF `ftyp` box/brand, and moves valid files to **Awaiting transcription** or deletes/disables invalid signatures. |
| Honest video status | A video without captions remains **Awaiting transcription**, and a durable upload stops at **Uploaded**. In local mode only, a valid creator-provided WebVTT sidecar makes timestamped caption chunks ready for preview or explicit public approval. |
| Source privacy | Sources are preview-only by default and require explicit approval for public answers. Processing, disabled, preview-only, and deleted sources are excluded from public retrieval. |
| Grounded chat | A deterministic local retrieval engine answers from approved text and returns source citations or says that it lacks enough information. |
| Multi-user conversations | Maya, Theo, and Jules have isolated histories; one audience member cannot read another's conversation. |
| Agent customization | Creators can version voice presets, response depth, signature phrases, prohibited topics, greeting, tone, and behavioral boundaries. |
| Zero-cost preview | Style and grounded-answer previews run locally without network requests or AI usage. |
| Bring Your Own Agent | A creator can explicitly route generation to a trusted endpoint using the documented contract. Only approved excerpts and bounded history are sent. |
| Local agent endpoint | A deterministic HTTP reference agent supports real browser-to-endpoint testing and reports `aiCalls: 0`. |
| Load lab | Adjustable traffic, concurrency, and queue limits demonstrate tenant-aware capacity and graceful overload. |
| Deletion | Deleting a source immediately removes its chunks from retrieval in the simulator. |
| Durable storage cleanup | API deletion tombstones durable metadata before removing the object and records physical completion. A zero-AI lease-based reconciler retries tombstoned objects after transient storage failures. |
| Immutable ingestion audit | PostgreSQL records content-free creator/system events for source authorization, upload completion/failure, scan claims/results, tombstoning, and physical storage deletion. Database triggers reject event updates and deletes. |
| Automated validation | Core, UI, routing, privacy, idempotency, upload-validation, and load tests run through `npm test`; `npm run check` also typechecks and builds every workspace. |
| Continuous integration | A read-only, secret-free GitHub Actions workflow runs locked installation, typecheck, tests, production build, and production dependency audit on `main` and pull requests. |

### Current prototype boundaries

- Default local-simulator state is held in memory and resets on refresh; configured Auth0 mode persists the creator workspace through the API.
- The interface is a mobile-responsive web simulator, not yet an Expo/React Native app.
- The protected API persists creator identity, agents, versioned configuration, source privacy metadata, and private-upload lifecycle metadata. Auth0 mode can upload MP4 bytes when S3-compatible storage is explicitly configured; local mode and pasted text remain browser-only.
- Uploaded video is not automatically scanned. The opt-in one-shot worker performs only a preliminary bounded MP4 signature check; full container parsing, duration/codec validation, malware scanning, decoding, automatic transcription, and embedding are not implemented. A local video becomes available to deterministic retrieval only when its creator supplies a valid WebVTT sidecar; that transcript is not yet persisted in managed mode.
- Pasted text uses deterministic term matching rather than model-based embeddings or generation.
- A real user-owned endpoint may create costs for its owner; Creator Agent never silently uses a platform or developer AI key.

## Run the simulator

Requirements: Node.js 22 or later.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

Development defaults to an explicit local session. To exercise managed OIDC, configure an Auth0 Single Page Application, custom API, and PostgreSQL identity store using the [authentication setup guide](docs/AUTHENTICATION.md) and [API guide](docs/API.md). Production builds reject local authentication and fail closed when Auth0 or API configuration is missing.

Useful checks:

```bash
npm test       # Core privacy, retrieval, idempotency, load, and UI tests
npm run check  # Typecheck, test, and production build
npm run scan:once # Claim and preliminarily validate at most one durable upload; requires API DB/storage env
npm run cleanup:once # Reconcile at most one tombstoned stored object; requires API DB/storage env
```

### What to try

1. Add a pasted source, or choose **Video file**. Local mode can pair MP4, WebM, or QuickTime with an optional WebVTT transcript; configured Auth0 mode privately uploads MP4 only.
2. Open the audience preview and ask one of the suggested questions.
3. Open **Customize** and change voice preset, response depth, signature phrases, or boundaries.
4. Switch between Maya, Theo, and Jules to see isolated conversations.
5. Open **Load lab** and change traffic, concurrency, and queue limits.
6. Observe bounded rejection when a popular agent exceeds safe capacity.

In default local mode, simulator state resets on refresh and pasted content, selected video bytes, and WebVTT captions never leave the browser. A valid sidecar creates timestamped local knowledge immediately without calling an AI provider. In configured Auth0 mode, agent/source metadata persists and MP4 bytes upload directly to private object storage; the browser never receives storage credentials and never sends its Auth0 bearer token to storage. Managed video stays unavailable to retrieval until future scanning and transcription stages complete. See [local WebVTT ingestion](docs/LOCAL_VIDEO_TRANSCRIPTS.md) and [private video uploads](docs/PRIVATE_UPLOADS.md).

### Zero-cost end-to-end routing

To exercise a real browser-to-agent HTTP request without calling an AI provider:

```bash
npm run dev:e2e
```

This starts:

- The simulator at `http://127.0.0.1:4173`
- A deterministic reference agent at `http://127.0.0.1:4310/v1/respond`

Open **Route**, select **User-owned agent endpoint**, confirm the processing boundary, and activate the prefilled local endpoint. The reference endpoint returns cited answers using approved excerpts and its health response reports `aiCalls: 0`.

To connect a real user-owned agent, replace the local URL with an HTTPS endpoint that implements the [Bring Your Own Agent contract](docs/AGENT_ROUTING.md). Any model usage then belongs to that endpoint's owner; Creator Agent never silently falls back to a platform or developer AI key.

## Not yet implemented

- Audience authentication
- Durable conversation persistence
- Upload retries, resumable/multipart upload, audit retention/export controls, and retention-policy verification
- Full media/container validation, duration/codec limits, malware scanning, and parser sandboxing
- PDF, Markdown, and plain-text file extraction
- Automatic audio/video transcription and durable transcript review/persistence
- Embeddings, vector retrieval, model generation, and streaming responses
- Native Expo/React Native application
- Broader agent/publishing audit events, rate limits, moderation, and account-deletion jobs
- Hosting, CI/CD, monitoring, backups, and operational runbooks

## Recommended MVP iteration

Keep the current deterministic simulator as a zero-cost product demo and regression suite. Add production capability through thin vertical slices that can each be tested end to end.

### Iteration 1 — Durable creator workspace

1. **Available:** connect the managed OIDC client to a protected API and durable user record.
2. **Available:** PostgreSQL migrations for agents, agent versions, sources, and source visibility.
3. **Available for current routes:** resource-level authorization and tenant isolation in every workspace query.
4. **Available:** persist creator configuration and new source metadata while leaving deterministic chat in place.

**Exit test:** two signed-in creators cannot access or mutate each other's agents or sources.

### Iteration 2 — Private video ingestion

1. **Available:** issue a 10-minute signed POST policy for one allowlisted format, starting with MP4.
2. **Available:** upload directly to private object storage without proxying large video bytes or forwarding the Auth0 token.
3. **Partially available:** pin declared MIME type and exact byte size, verify stored metadata, then read at most 4 KB to check a supported ISO BMFF `ftyp` signature. Full parsing, duration limits, and malware scanning remain next.
4. **Partially available:** lease-based, concurrency-safe one-shot worker with `uploaded → scanning → processing/failed`; continuous scheduling and `transcribing → ready` remain next.
5. **Available in local simulation:** accept a creator-provided WebVTT sidecar and build timestamped deterministic chunks without an AI call. Next, route automatic transcription to either a self-hosted worker or a creator-owned endpoint and record the selected processor and usage without logging content.
6. Let the creator review the timestamped transcript before approving it for public answers.

**Exit test:** an uploaded video becomes a reviewable, timestamped source; failed, unapproved, or deleted content never appears in chat.

### Iteration 3 — Production grounded chat

1. Chunk approved transcripts and build a tenant-filtered vector index.
2. Retrieve only ready, explicitly approved sources.
3. Keep generation provider-neutral: local deterministic mode, creator-owned endpoint, or a future separately funded platform route.
4. Validate citations against supplied context and stream responses to the client.
5. Add evaluation cases for answerability, source accuracy, prompt injection, and prohibited topics.

**Exit test:** expected questions return supported answers with correct timestamps, and unsupported questions reliably abstain.

### Iteration 4 — Mobile beta and operations

1. Build the Expo/React Native shell against the same authenticated API.
2. Add quotas, per-agent concurrency limits, moderation, abuse reporting, and audit events.
3. Add deletion workflows for originals, transcripts, chunks, embeddings, caches, and backups.
4. Add observability that uses opaque IDs and never logs uploaded content or conversations.
5. Run a small creator beta and prioritize changes from measured retrieval quality, latency, safety, and onboarding completion.

**Exit test:** the beta survives concurrent traffic, honors privacy and deletion controls, and exposes cost per active agent without using a developer's personal AI quota.

For each iteration: write the acceptance test first, implement the smallest end-to-end path, run `npm run check`, perform responsive browser QA, and merge a passing increment to `main`.

## Non-goals for the first release

- Voice cloning or photorealistic avatars
- Autonomous posting or messaging on a creator's behalf
- Training a dedicated foundation model per creator
- Open-ended crawling of an entire social media presence
- Payments, subscriptions, marketplaces, or advertising
- Enterprise multi-team administration

## Proposed stack

| Area | Choice |
| --- | --- |
| Mobile app | Expo + React Native + TypeScript |
| API | Node.js + TypeScript (Fastify or NestJS) |
| Background jobs | Redis-backed worker queue |
| Primary database | PostgreSQL |
| Vector search | `pgvector` |
| File storage | S3-compatible object storage |
| AI providers | Provider adapters for transcription, embeddings, and generation |
| Authentication | Managed OIDC-compatible authentication |
| Observability | Structured logs, traces, error tracking, and product analytics |

The architecture is intentionally provider-neutral. AI and storage services should sit behind small interfaces so cost, quality, and data-residency requirements can be revisited without rewriting product logic.

## Target production user journey

1. A creator signs in and creates an agent.
2. They upload documents, audio, or video and confirm they have the right to use it.
3. Background workers extract or transcribe the content and build a searchable index.
4. The creator reviews sources and configures the agent's behavior.
5. They preview and publish the agent.
6. An audience member asks a question in the mobile app.
7. The API retrieves relevant source passages, generates a grounded response, and returns citations.

## Repository layout

```text
creator-agent/
├── apps/
│   ├── api/             # Auth0-protected API and creator identity migration
│   ├── local-agent/     # Zero-cost HTTP reference endpoint
│   └── simulator/       # Responsive React MVP and UI tests
├── packages/
│   └── core/            # Deterministic domain engine and load simulator
├── docs/
│   ├── AGENT_ROUTING.md # Bring Your Own Agent protocol and data boundary
│   ├── API.md           # Protected API setup and identity data boundary
│   ├── AUTHENTICATION.md # Auth0 OIDC setup and security boundary
│   ├── CUSTOMIZATION.md # Knowledge/style separation and evaluation
│   ├── LOCAL_VIDEO_TRANSCRIPTS.md # Zero-cost WebVTT sidecar workflow
│   ├── PRIVATE_UPLOADS.md # Signed MP4 upload and data-protection boundary
│   └── DESIGN.md        # Product, architecture, privacy, and scale design
├── package.json         # npm workspace scripts
└── README.md
```

The next production increment is a sandboxed media-inspection/malware worker that fully parses the MP4 container and validates duration/codecs before any transcription route can see the upload. The actual mobile and transcription-worker packages still wait on provider, hosting, privacy, and beta-cohort decisions. The deterministic core remains useful for product demos and fast policy regression tests.

## Delivery milestones

### Milestone 0 — Foundation

- **Available:** npm workspace, deterministic core, responsive simulator, Auth0 SPA integration, protected creator/workspace API, durable identity and workspace migrations, local reference endpoint, automated checks
- **Available:** private signed MP4 upload authorization and completion verification
- **Available:** preliminary `uploaded → scanning → processing/failed` transitions with exclusive leases
- **Available:** immutable content-free ingestion lifecycle audit events
- **Next:** broader agent/publishing audit coverage and continuous worker scheduling

### Milestone 1 — Ingestion

- **Available:** local video staging plus configured private direct MP4 upload with exact-size/type enforcement and safe non-ready state
- **Available:** preliminary bounded MP4 `ftyp` validation with invalid-object deletion
- **Available:** tombstone-first object deletion with lease-based retry reconciliation
- **Next:** full validation, malware scanning, real transcription, transcript review, upload retry, and audit retention/export controls

### Milestone 2 — Grounded chat

- **Available:** deterministic retrieval, prompt boundaries, citations, creator preview, BYOA routing
- **Next:** embeddings, tenant-filtered vector retrieval, streaming generation, video timestamps, evaluation suite

### Milestone 3 — Publishing beta

- **Available:** simulated publishing and source-level public/preview controls
- **Next:** public profiles, real publish versions, abuse reporting, rate limits, moderation, quotas, closed beta

## Product principles

- **Grounded by default:** prefer “I don't know” over unsupported answers.
- **Creator-controlled:** creators can inspect, disable, or delete every source.
- **Transparent:** clearly identify the agent as AI and show supporting sources.
- **Consent-first:** do not impersonate a creator or ingest content without rights.
- **Measurable:** evaluate answer quality, retrieval quality, latency, and cost continuously.

## Key documentation

- [Product and technical design](docs/DESIGN.md)
- [Managed Auth0 authentication](docs/AUTHENTICATION.md)
- [Protected API and durable identity](docs/API.md)
- [Private video upload boundary](docs/PRIVATE_UPLOADS.md)
- [Creator customization model](docs/CUSTOMIZATION.md)
- [Bring Your Own Agent routing contract](docs/AGENT_ROUTING.md)

## Contributing

The project is pre-alpha. Review the privacy requirements, open questions, and acceptance criteria in the design document before adding infrastructure or AI providers. Keep changes small, add tests with each increment, and require `npm run check` before merging to `main`.

## License

No open-source license has been selected. Until one is added, all rights are reserved.
