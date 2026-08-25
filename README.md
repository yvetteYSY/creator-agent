# Creator Agent

Creator Agent is a mobile-first platform that lets content creators build an AI agent grounded in their own documents, audio, and video. Creators upload or connect content, review what the system learned, configure the agent's voice and boundaries, and publish a shareable agent that audiences can chat with.

## Project status

The repository now contains a test-first, local MVP simulator. It demonstrates the core product loop: configure a creator agent, process sources, control which sources may be used publicly, chat with citations, isolate multiple audience conversations, delete source data, and simulate load/backpressure for a popular agent.

The simulator is intentionally deterministic and local. **It makes no AI-provider or external API calls, consumes no AI tokens, and cannot create model charges.** It is a product and system-behavior prototype, not a production RAG implementation.

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

1. Add a source and choose **Preview only** or **Public answers**.
2. Open the audience preview and ask one of the suggested questions.
3. Switch between Maya, Theo, and Jules to see isolated conversations.
4. Open **Load lab** and change traffic, concurrency, and queue limits.
5. Observe bounded rejection when a popular agent exceeds safe capacity.

All simulator state is held in memory and resets on refresh. Pasted content remains in the browser process and is not uploaded.

## MVP goals

- Create and manage a creator profile and agent.
- Upload PDF, Markdown, plain-text, audio, and video files.
- Transcribe and extract text asynchronously.
- Split, embed, and index content for semantic retrieval.
- Let the creator review sources, processing status, and failures.
- Configure agent instructions, tone, welcome message, and prohibited topics.
- Preview the agent before publishing.
- Chat with the published agent from a mobile app.
- Ground answers in creator content and cite documents or video timestamps.
- Delete sources and derived data.
- Clearly disclose that users are interacting with AI.

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

## Core user journey

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
│   └── simulator/       # Responsive React MVP and UI tests
├── packages/
│   └── core/            # Deterministic domain engine and load simulator
├── docs/
│   └── DESIGN.md
├── package.json         # npm workspace scripts
└── README.md
```

The next production increment will add the actual mobile/API/worker packages after provider, hosting, privacy, and beta-cohort decisions are made. The deterministic core remains useful for product demos and fast policy regression tests.

## Delivery milestones

### Milestone 0 — Foundation

- Monorepo, CI, local development environment, database migrations, and authentication
- Agent and source CRUD APIs
- Baseline telemetry and audit events

### Milestone 1 — Ingestion

- Direct file upload
- PDF/text extraction and audio/video transcription
- Chunking, embeddings, indexing, progress reporting, retry, and deletion

### Milestone 2 — Grounded chat

- Retrieval pipeline and prompt assembly
- Streaming text chat
- Source citations and video timestamps
- Creator preview and lightweight evaluation suite

### Milestone 3 — Publishing beta

- Public agent profiles and publish/unpublish controls
- Abuse reporting, rate limits, moderation, and usage quotas
- Closed beta with a small group of creators

## Product principles

- **Grounded by default:** prefer “I don't know” over unsupported answers.
- **Creator-controlled:** creators can inspect, disable, or delete every source.
- **Transparent:** clearly identify the agent as AI and show supporting sources.
- **Consent-first:** do not impersonate a creator or ingest content without rights.
- **Measurable:** evaluate answer quality, retrieval quality, latency, and cost continuously.

## Key documentation

- [Product and technical design](docs/DESIGN.md)

## Contributing

The project is pre-alpha. Before implementation, review the open questions and acceptance criteria in the design document. Use short-lived branches and require passing automated checks before merging to `main`.

## License

No open-source license has been selected. Until one is added, all rights are reserved.
