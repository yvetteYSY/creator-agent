# Creator Agent

Creator Agent is a mobile-first platform that lets content creators build an AI agent grounded in their own documents, audio, and video. Creators upload or connect content, review what the system learned, configure the agent's voice and boundaries, and publish a shareable agent that audiences can chat with.

## Project status

The repository contains a test-first, responsive web MVP simulator. It demonstrates the product, privacy, routing, and concurrency behavior before introducing paid AI providers or production infrastructure.

The simulator is intentionally deterministic and local. **It makes no AI-provider or external API calls, consumes no AI tokens, and cannot create model charges.** It is a product and system-behavior prototype, not a production RAG implementation.

### Available now

| Capability | Current implementation |
| --- | --- |
| Creator studio | A seeded creator can manage an agent and its knowledge sources in a responsive web interface. |
| Text ingestion | Document or audio-transcript text can be pasted, chunked, and indexed in browser memory. |
| Direct video selection | MP4, WebM, and QuickTime files up to 250 MB can be selected and staged locally. Only metadata is retained; the file is not uploaded. |
| Honest video status | A staged video remains **Awaiting transcription** and cannot be retrieved or cited. The simulator never pretends it understood the video. |
| Source privacy | Sources are preview-only by default and require explicit approval for public answers. Processing, disabled, preview-only, and deleted sources are excluded from public retrieval. |
| Grounded chat | A deterministic local retrieval engine answers from approved text and returns source citations or says that it lacks enough information. |
| Multi-user conversations | Maya, Theo, and Jules have isolated histories; one audience member cannot read another's conversation. |
| Agent customization | Creators can version voice presets, response depth, signature phrases, prohibited topics, greeting, tone, and behavioral boundaries. |
| Zero-cost preview | Style and grounded-answer previews run locally without network requests or AI usage. |
| Bring Your Own Agent | A creator can explicitly route generation to a trusted endpoint using the documented contract. Only approved excerpts and bounded history are sent. |
| Local agent endpoint | A deterministic HTTP reference agent supports real browser-to-endpoint testing and reports `aiCalls: 0`. |
| Load lab | Adjustable traffic, concurrency, and queue limits demonstrate tenant-aware capacity and graceful overload. |
| Deletion | Deleting a source immediately removes its chunks from retrieval in the simulator. |
| Automated validation | Core, UI, routing, privacy, idempotency, upload-validation, and load tests run through `npm test`; `npm run check` also typechecks and builds every workspace. |

### Current prototype boundaries

- State is held in memory and resets when the page refreshes.
- The interface is a mobile-responsive web simulator, not yet an Expo/React Native app.
- There is no production sign-in, database, object storage, job queue, or deployment.
- Direct video bytes are not uploaded, decoded, transcribed, embedded, or stored.
- Pasted text uses deterministic term matching rather than model-based embeddings or generation.
- A real user-owned endpoint may create costs for its owner; Creator Agent never silently uses a platform or developer AI key.

## Run the simulator

Requirements: Node.js 22 or later.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

Useful checks:

```bash
npm test       # Core privacy, retrieval, idempotency, load, and UI tests
npm run check  # Typecheck, test, and production build
```

### What to try

1. Add a pasted source, or choose **Video file** to stage an MP4, WebM, or QuickTime file locally.
2. Open the audience preview and ask one of the suggested questions.
3. Open **Customize** and change voice preset, response depth, signature phrases, or boundaries.
4. Switch between Maya, Theo, and Jules to see isolated conversations.
5. Open **Load lab** and change traffic, concurrency, and queue limits.
6. Observe bounded rejection when a popular agent exceeds safe capacity.

All simulator state is held in memory and resets on refresh. Pasted content and selected video files remain in the browser process and are not uploaded. A selected video is represented only by metadata after staging and stays in **Awaiting transcription**; it cannot be retrieved or cited until a real transcription route is configured. The simulator never pretends it transcribed the file.

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

- Creator and audience authentication
- Durable agent, source, configuration, and conversation persistence
- Signed uploads to private object storage
- File-signature validation, malware scanning, and parser sandboxing
- PDF, Markdown, and plain-text file extraction
- Real audio/video transcription and timestamped transcript review
- Embeddings, vector retrieval, model generation, and streaming responses
- Native Expo/React Native application
- Production authorization, audit events, rate limits, moderation, and deletion jobs
- Hosting, CI/CD, monitoring, backups, and operational runbooks

## Recommended MVP iteration

Keep the current deterministic simulator as a zero-cost product demo and regression suite. Add production capability through thin vertical slices that can each be tested end to end.

### Iteration 1 — Durable creator workspace

1. Add managed OIDC authentication.
2. Add PostgreSQL migrations for users, agents, agent versions, sources, and source visibility.
3. Enforce resource-level authorization and tenant isolation in every API query.
4. Persist creator configuration while leaving deterministic chat in place.

**Exit test:** two signed-in creators cannot access or mutate each other's agents or sources.

### Iteration 2 — Private video ingestion

1. Issue a short-lived signed upload URL for one allowlisted format, starting with MP4.
2. Upload directly to private object storage; do not proxy large video bytes through the API.
3. Validate MIME type and file signature, enforce size and duration limits, and scan before processing.
4. Add an idempotent background job with visible `uploaded → scanning → transcribing → ready/failed` states.
5. Route transcription to either a self-hosted worker or a creator-owned endpoint. Record the selected processor and usage without logging content.
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
│   ├── local-agent/     # Zero-cost HTTP reference endpoint
│   └── simulator/       # Responsive React MVP and UI tests
├── packages/
│   └── core/            # Deterministic domain engine and load simulator
├── docs/
│   ├── AGENT_ROUTING.md # Bring Your Own Agent protocol and data boundary
│   ├── CUSTOMIZATION.md # Knowledge/style separation and evaluation
│   └── DESIGN.md        # Product, architecture, privacy, and scale design
├── package.json         # npm workspace scripts
└── README.md
```

The next production increment will add the actual mobile/API/worker packages after provider, hosting, privacy, and beta-cohort decisions are made. The deterministic core remains useful for product demos and fast policy regression tests.

## Delivery milestones

### Milestone 0 — Foundation

- **Available:** npm workspace, deterministic core, responsive simulator, local reference endpoint, automated checks
- **Next:** CI, database migrations, authentication, persisted agent/source APIs, audit events

### Milestone 1 — Ingestion

- **Available:** local video selection, validation, safe processing state, immediate simulated deletion
- **Next:** signed private upload, scanning, real transcription, transcript review, retry, durable deletion

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
- [Creator customization model](docs/CUSTOMIZATION.md)
- [Bring Your Own Agent routing contract](docs/AGENT_ROUTING.md)

## Contributing

The project is pre-alpha. Review the privacy requirements, open questions, and acceptance criteria in the design document before adding infrastructure or AI providers. Keep changes small, add tests with each increment, and require `npm run check` before merging to `main`.

## License

No open-source license has been selected. Until one is added, all rights are reserved.
