# Creator Agent — Product and Technical Design

**Status:** Draft for kickoff  
**Last updated:** 2026-08-24  
**Audience:** Product, design, engineering, AI/evaluation, trust and safety

## 1. Summary

Creator Agent enables a content creator to turn a library of documents, audio, and video into a configurable AI agent. The agent answers audience questions using retrieval-augmented generation (RAG), links its claims to creator-approved sources, and exposes controls for publishing, safety, and deletion.

The MVP tests one central hypothesis:

> Audiences receive useful, trustworthy answers when an AI agent can search a creator's approved content and cite the exact material used to answer.

The MVP should validate this hypothesis before adding voice cloning, avatars, autonomous actions, or monetization.

### Prototype cost boundary

The first interactive simulator is deliberately disconnected from AI providers. It uses deterministic local term matching, in-memory state, and synthetic load calculations. It must not contain model credentials, call generation/embedding/transcription APIs, consume user AI quotas, or incur token charges. Direct video selection stages file metadata locally and leaves the source in `processing`; the simulator does not read, upload, or falsely transcribe the selected bytes. Automated UI tests assert that grounded chat and direct video staging perform no network request. Managed creator login is the exception to the external-service boundary: when explicitly configured, the SPA redirects to Auth0 Universal Login using OIDC Authorization Code with PKCE. See [AUTHENTICATION.md](AUTHENTICATION.md).

Connecting a real AI provider is a separate, explicit production milestone. Before that milestone, the team must approve provider ownership and billing, per-agent budgets, hard spend ceilings, request attribution, usage alerts, retention/no-training settings, and a kill switch. End users' personal API keys or consumer AI subscriptions must never be used implicitly to fund platform traffic.

The first protected API slice validates Auth0 access tokens and stores only an opaque internal user ID, verified OIDC issuer/subject, and lifecycle timestamps. Browser profile data and bearer tokens are not persisted. The API derives creator ownership from the verified identity and never trusts a client-supplied owner ID.

The prototype supports an explicit Bring Your Own Agent (BYOA) route. Creator Agent performs authorization and retrieval, then sends only the current question, bounded history, agent instructions, and approved excerpts to the selected endpoint. The route is disabled by default, requires an ownership/trust acknowledgement, accepts HTTPS for remote endpoints or HTTP only on localhost, and keeps any bearer token in memory. See [AGENT_ROUTING.md](AGENT_ROUTING.md).

## 2. Problem

Creators accumulate valuable knowledge across long videos, podcasts, articles, guides, and private notes. Audiences have difficulty finding a specific answer, while creators repeatedly answer similar questions. Generic chatbots can imitate a tone but often lack source fidelity, provenance, and creator control.

Creator Agent should make a creator's existing library conversational without pretending the AI is the creator or inventing positions the creator has not expressed.

## 3. Users and jobs to be done

### Creator

- Turn an existing content library into an agent without ML expertise.
- See whether each source was processed correctly.
- Control the agent's instructions, boundaries, visibility, and sources.
- Preview representative questions before publishing.
- Correct problems and delete content or derived data.

### Audience member

- Ask a natural-language question instead of searching a large archive.
- Receive a concise answer based on the creator's material.
- Open the supporting document section or video timestamp.
- Understand when the source library does not contain an answer.

### Platform operator

- Control spend, latency, abuse, and data retention.
- Investigate ingestion and answer-quality failures.
- Enforce policy without silently changing a creator's content.

## 4. Scope

### MVP capabilities

1. Email/social sign-in and creator onboarding.
2. One or more agents per creator, with draft and published states.
3. Direct upload of PDF, Markdown, plain text, audio, and common video formats.
4. Asynchronous extraction, transcription, normalization, chunking, and indexing.
5. Source list with queued, processing, ready, failed, and deleting states.
6. Agent configuration: name, description, instructions, tone, welcome message, refusal topics, and suggested questions.
7. Creator preview chat.
8. Published mobile chat with streaming responses.
9. Citations that resolve to document passages or media timestamps.
10. Source removal, account deletion, abuse reporting, and basic moderation.

Customization is versioned independently from source content. Voice preset, response depth, signature language, prohibited topics, greeting, and behavioral boundaries shape delivery, while retrieval continues to determine factual content. See [CUSTOMIZATION.md](CUSTOMIZATION.md).

### Deferred capabilities

- URL and social-platform imports that require third-party permissions
- Live synchronization when an external source changes
- Voice conversations, cloned voices, and generated avatars
- Agent-to-agent or tool-using autonomous workflows
- Fine-tuning per creator
- Payments and revenue sharing
- Web embed and public developer API

## 5. Experience design

### Creator flow

```text
Sign in → Create agent → Add sources → Wait/review → Configure
        → Preview questions → Resolve warnings → Publish → Monitor
```

The ingestion screen must show progress at the source level. A source is never implied to be usable until its status is `ready`. Failures include an understandable reason and a retry action.

Before publishing, the creator sees a readiness checklist:

- At least one ready source
- Successful answers for a small default evaluation set
- AI disclosure present
- Safety and prohibited-topic settings reviewed
- Ownership/usage-rights attestation accepted

### Audience flow

```text
Open agent → See AI disclosure → Ask question → Receive answer
           → Inspect citations → Continue conversation or report
```

An answer should visually separate generated prose from citations. When evidence is weak, the agent should say that the available library does not contain enough information and may offer related sources.

## 6. System architecture

```text
┌─────────────────┐       ┌──────────────────────────────┐
│ Expo mobile app │──────▶│ API: auth, agents, chat,     │
└─────────────────┘       │ sources, publishing          │
                          └──────┬───────────┬───────────┘
                                 │           │
                         ┌───────▼──────┐  ┌─▼─────────────────┐
                         │ PostgreSQL + │  │ Object storage     │
                         │ pgvector     │  │ original/derived   │
                         └───────▲──────┘  └─▲─────────────────┘
                                 │           │
                          ┌──────┴───────────┴───────────┐
                          │ Queue + ingestion workers    │
                          │ parse/transcribe/chunk/embed │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │ AI provider adapters         │
                          │ transcription/embed/generate │
                          └──────────────────────────────┘
```

### Architectural boundaries

- The mobile app never receives model-provider credentials or direct database access.
- The API owns authorization, quotas, conversation orchestration, and publish state.
- Workers own expensive asynchronous ingestion tasks.
- Original uploads and derived artifacts use distinct storage prefixes and retention rules.
- Provider-specific payloads are isolated behind transcription, embedding, generation, and moderation interfaces.
- Every query is scoped by `agent_id`; vector retrieval must never cross tenant boundaries.

### Concurrent audience interaction

Many audience members may interact with the same published agent at once. The chat path must therefore be horizontally scalable and must not keep authoritative conversation state in an API process.

```text
Mobile clients
     │ HTTPS + streaming responses
     ▼
CDN / WAF / load balancer
     │
     ├──────────▶ Stateless chat API replicas
     │                    │
     │                    ├──▶ Auth, moderation, and quota service
     │                    ├──▶ PostgreSQL read/write path
     │                    ├──▶ Retrieval service / pgvector
     │                    └──▶ Model gateway with concurrency controls
     │
     └──────────▶ Connection-aware rate limits and abuse protection
```

Each request carries `agent_id`, `conversation_id`, an authenticated user or anonymous-session identifier, and a client-generated idempotency key. The server verifies that the conversation belongs to the requested agent and session before reading history or appending a message. One user must never be able to address another user's conversation by guessing an identifier.

Chat API replicas remain stateless between requests. Durable messages live in PostgreSQL; short-lived streaming and rate-limit coordination may use Redis or an equivalent managed store. A dropped streaming connection does not cancel an already committed user message, and a client retry with the same idempotency key must not generate a second model response.

### Request lifecycle under load

1. The edge layer applies IP/session limits, request-size limits, and basic abuse filtering.
2. The API authenticates the caller, verifies agent publication state, and resolves the conversation.
3. A transaction appends the user message or returns the result of an existing idempotent request.
4. Per-user, per-agent, and platform-wide quotas reserve capacity before an expensive model call begins.
5. Retrieval executes with an `agent_id` filter and a bounded candidate count.
6. The model gateway enforces provider concurrency, timeouts, token budgets, and circuit breakers.
7. The API streams structured events such as `response.started`, `response.delta`, `citation`, `response.completed`, and `response.failed`.
8. The completed assistant message, citations, usage, and terminal status are stored atomically or reconciled by a recovery job.

Use Server-Sent Events initially because chat is primarily server-to-client streaming and SSE has a simple reconnection model. WebSockets can be introduced if later features require bidirectional realtime presence, voice frames, or collaborative sessions.

### Fairness, backpressure, and hot agents

A popular creator may produce a sudden traffic spike. Capacity controls must prevent that agent from exhausting resources needed by every other creator.

- Apply token-bucket limits per anonymous session/user, per agent, and per account tier.
- Maintain bounded concurrent model generations per agent and across the platform.
- Queue briefly when capacity is expected soon; otherwise return a retryable overload response with `Retry-After` rather than allowing unbounded queues.
- Reserve separate worker pools and quotas for ingestion and interactive chat so a large upload cannot block conversations.
- Cap conversation context, retrieval candidates, output tokens, and end-to-end deadlines.
- Propagate client disconnects and deadlines to retrieval and model providers when cancellation is safe.
- Use exponential backoff with jitter for retryable provider failures; never retry non-idempotent work blindly.
- Shed optional work such as summaries, analytics enrichment, and suggested follow-ups before degrading the core cited answer.

Agent configuration and ready-source metadata may be cached by immutable version. Never cache authorization decisions or cross-user conversation history globally. Retrieval-result or answer caching is permitted only when the cache key includes the agent configuration version, source-index version, normalized question, policy version, and visibility scope. User-specific or sensitive answers should not enter shared caches.

### Consistency and ordering

Messages receive a server-assigned monotonically increasing sequence number within a conversation. The API uses optimistic concurrency or row-level locking when appending messages so two simultaneous sends cannot silently overwrite or reorder history. The client displays provisional state while waiting, then reconciles using server message IDs and sequence numbers.

Publishing creates an immutable agent configuration version and references a completed source-index version. Existing requests finish on the version they started with; new requests use the newly published version. Disabling or deleting a source is an exception: it immediately adds the source to a deny list checked at retrieval and citation access, even before a replacement index is built.

### Scaling path

Start with a managed load balancer, multiple stateless API replicas, PostgreSQL/pgvector, Redis, and a model gateway. Scale based on measured bottlenecks:

1. Add read replicas and connection pooling while keeping authoritative writes in one PostgreSQL primary.
2. Separate retrieval into its own service and vector store only when pgvector latency or index size justifies the operational cost.
3. Partition high-volume messages and conversations by stable tenant/agent keys when a single database can no longer meet write targets.
4. Add multi-region routing only after defining data residency, consistency, failover, and deletion behavior. Avoid active-active complexity in the MVP.

Autoscaling signals should include active streams, requests per second, model concurrency, queue delay, retrieval latency, database saturation, and error rate—not CPU alone.

## 7. Ingestion pipeline

1. API creates a `source` record and a short-lived upload target.
2. Client uploads directly to object storage.
3. API verifies completion, file type, size, and ownership, then enqueues ingestion.
4. Worker scans and normalizes the file.
5. Text documents are parsed; audio/video is transcribed into timestamped segments.
6. Extracted text is normalized while preserving headings, pages, speakers, and time ranges.
7. Content is split into overlapping semantic chunks.
8. Embeddings are generated in batches and stored with metadata in PostgreSQL/pgvector.
9. A source-level summary and quality warnings are created for creator review.
10. The source becomes `ready`, or `failed` with a retryable/non-retryable reason.

Jobs must be idempotent. Each stage records its input version, output version, attempt count, timing, and provider usage. Deleting a source tombstones it immediately for retrieval, then asynchronously removes original files, transcripts, chunks, embeddings, and cached answers.

## 8. Retrieval and answer generation

For each user message:

1. Authenticate or assign an anonymous session and enforce rate limits.
2. Moderate the input and apply creator-defined boundaries.
3. Rewrite follow-up questions into a standalone retrieval query when needed.
4. Retrieve candidate chunks filtered by `agent_id` and source readiness.
5. Optionally combine semantic and keyword scores, then rerank.
6. Reject low-confidence evidence instead of forcing an answer.
7. Generate a response using only approved instructions and retrieved context.
8. Validate that citations reference chunks included in the prompt.
9. Stream the answer and structured citations to the client.
10. Record privacy-safe telemetry and feedback.

The model prompt must distinguish platform policy, creator instructions, source content, conversation history, and user input. Source text is untrusted data and must not be allowed to override system or creator instructions.

### Citation contract

Each citation returned to the client contains:

- `source_id` and display title
- Source type
- Stable chunk identifier
- Short supporting excerpt
- Page/section for documents, when available
- Start/end timestamps for audio or video
- A signed or authorized link to open the source

## 9. Initial data model

| Entity | Important fields |
| --- | --- |
| `users` | id, auth_subject, role, created_at, deleted_at |
| `agents` | id, owner_id, slug, name, description, status, configuration_version |
| `agent_configs` | agent_id, version, instructions, tone, boundaries, model settings |
| `sources` | id, agent_id, type, title, status, storage_key, checksum, error_code |
| `transcripts` | source_id, version, language, segments, provider metadata |
| `chunks` | id, source_id, agent_id, text, location, token_count, embedding |
| `conversations` | id, agent_id, visitor/user id, created_at, retention class |
| `messages` | id, conversation_id, role, content, citations, model usage |
| `message_requests` | idempotency_key, conversation_id, status, response_message_id, lease/expiry |
| `evaluation_cases` | id, agent_id, question, expected sources, rubric |
| `audit_events` | actor, action, target, metadata, timestamp |

Use UUIDs, explicit tenant keys, UTC timestamps, and soft deletion where immediate retrieval exclusion is required. Sensitive provider payloads should not be copied into general logs.

## 10. API surface (draft)

```text
GET    /health
GET    /v1/me

POST   /v1/agents
GET    /v1/agents/:agentId
PATCH  /v1/agents/:agentId
POST   /v1/agents/:agentId/publish
POST   /v1/agents/:agentId/unpublish

POST   /v1/agents/:agentId/sources/uploads
POST   /v1/agents/:agentId/sources/:sourceId/complete
GET    /v1/agents/:agentId/sources
POST   /v1/agents/:agentId/sources/:sourceId/retry
DELETE /v1/agents/:agentId/sources/:sourceId

POST   /v1/agents/:agentId/preview/messages
POST   /v1/public/agents/:slug/conversations
POST   /v1/public/conversations/:conversationId/messages
POST   /v1/public/messages/:messageId/feedback
POST   /v1/public/agents/:slug/reports
```

Define request and response bodies in a shared schema package and generate client types. Mutating requests should accept idempotency keys where retries could duplicate work.

## 11. Security, privacy, and trust

### Required controls

- Encrypt data in transit and at rest.
- Use short-lived signed upload/download URLs.
- Validate MIME type and file signature; scan uploads before parsing.
- Apply file-size, duration, token, request, and spend limits.
- Enforce resource-level authorization on every creator route.
- Filter retrieval by agent and source status in the database query itself.
- Treat extracted content as untrusted to reduce prompt-injection risk.
- Keep secrets in a managed secret store and rotate them.
- Maintain audit events for publishing, configuration, source, and deletion changes.
- Provide report, unpublish, suspension, and emergency-disable paths.

### Uploaded-data protection model

User-uploaded content is private by default, even when an agent is published. Publishing permits the agent to retrieve approved material to answer questions; it does not make original files, full transcripts, storage URLs, or the creator's source library publicly browsable.

Apply the following rules throughout the system:

- **Collect the minimum:** request only the files and metadata required for ingestion. Do not collect contacts, device media libraries, or unrelated account data.
- **Separate tenants:** scope storage paths, database rows, vector queries, queues, caches, and authorization checks by owner and agent. Never rely on an identifier supplied by the client without verifying ownership server-side.
- **Limit internal access:** production content is unavailable to staff by default. Time-limited support access requires an approved reason, least-privilege role, creator consent when appropriate, and an immutable audit event.
- **Encrypt and isolate:** encrypt uploads, transcripts, chunks, embeddings, backups, and message history at rest. Use TLS in transit and separate encryption keys or equivalent isolation between production environments.
- **Use short-lived links:** clients upload and open files through narrowly scoped, expiring signed URLs. Never expose permanent object-storage URLs or storage credentials.
- **Control derivatives:** transcripts, thumbnails, summaries, chunks, embeddings, caches, and evaluation copies receive the same sensitivity classification and deletion policy as their source.
- **Restrict AI providers:** send providers only the content needed for the current operation. Select contractual/API settings that prohibit training on customer data and define retention. Record the provider and policy version used for each job.
- **Keep content out of telemetry:** do not place source text, prompts, transcripts, filenames, signed URLs, or message bodies in general logs, traces, crash reports, or analytics. Use opaque IDs and redacted error details.
- **Prevent accidental publication:** require explicit creator action to publish an agent and explicit source inclusion. Draft, failed, quarantined, disabled, and deleted sources are never retrievable by public chat.
- **Validate uploads safely:** enforce allowlisted file types, signature checks, size and duration limits, malware scanning, parser sandboxing, decompression limits, and timeouts before content enters the indexing pipeline.
- **Design for deletion:** maintain a deletion manifest covering originals and every derivative. Tombstone data immediately for serving, complete physical deletion within the published service target, and verify completion.

Access to an original upload or full transcript must use a dedicated authorization path. A public answer may return only the minimum excerpt needed to support its citation. Citation endpoints must prevent enumeration and must not reveal text from sources that the creator has disabled or removed.

### Privacy choices and user expectations

Before upload, show what will be stored, how it will be processed, which third-party processors are involved, how long it will be retained, and how to delete it. Creators must be able to:

- Choose whether a source is used in public answers or preview only.
- Inspect the extracted text and citations generated from their content.
- Disable a source immediately without waiting for deletion to finish.
- Export a list of stored sources and relevant configuration.
- Delete individual sources, conversations where applicable, or the account.
- Understand whether audience conversations are visible to the creator.

Do not use uploaded content, transcripts, embeddings, or conversations to train shared models unless the user gives separate, specific, revocable opt-in consent. Product access must not depend on granting that consent.

### Security operations

- Maintain separate development, staging, and production environments; never copy production uploads into lower environments.
- Use synthetic or explicitly consented test corpora in development and automated tests.
- Scan dependencies and container images, patch critical vulnerabilities, and rotate secrets on a defined schedule.
- Alert on unusual downloads, cross-tenant authorization failures, bulk exports, repeated signed-URL failures, and anomalous provider usage.
- Maintain an incident-response plan covering containment, credential rotation, evidence preservation, processor coordination, user notification, and post-incident review.
- Review third-party processors for security, privacy, retention, data location, subprocessors, and deletion guarantees before production use.
- Perform threat modeling and an independent security review before opening the beta beyond a small invited cohort.

### Consent and identity

- A creator must attest that they own or have permission to process uploaded material.
- Published experiences must state that the agent is AI-generated.
- The agent must not claim to be the creator, communicate privately on their behalf, or imply live creator participation.
- Voice or likeness features require a separate consent and verification design before implementation.

### Data lifecycle

Define and publish retention periods for uploads, transcripts, chunks, embeddings, conversations, logs, support exports, backups, and deleted data before beta. Default to the shortest duration that supports the product. Source deletion immediately excludes content from retrieval and invalidates active access links. Account deletion must trigger a traceable workflow across primary storage, vector data, caches, analytics identifiers, provider-side artifacts, and backups according to the published retention policy.

Deletion jobs must be idempotent, observable, and auditable without retaining the deleted content itself. Backups may age out on a documented schedule, but deleted records must not be restored into active service during disaster recovery. Any legal-hold exception requires a defined authority, restricted access, and user notice where legally permitted.

## 12. Reliability and observability

Track:

- Ingestion success rate and time by source type and duration
- Queue depth, retries, dead-letter jobs, and provider errors
- Retrieval hit rate, evidence score, and citation validity
- Time to first token and end-to-end response latency
- Active streams, requests per second, queue delay, overload responses, and cancellation rate
- Per-agent concurrency and traffic concentration to identify hot agents
- Tokens, transcription minutes, storage, and cost per active agent
- Refusal, moderation, report, and deletion rates

Every request and job receives a correlation ID. Logs should be structured and redact content and credentials by default. Provider calls need timeouts, bounded retries with jitter, and circuit-breaking or fallback behavior where justified.

## 13. Evaluation plan

Quality is a release requirement, not a post-launch metric. Build a small evaluation set for each beta creator containing:

- Answerable questions with expected source passages
- Questions whose answer is absent from the library
- Ambiguous and multi-source questions
- Prompt-injection attempts embedded in sources and user messages
- Prohibited-topic and identity-boundary cases

Measure retrieval recall, citation correctness, groundedness, refusal correctness, response usefulness, latency, and cost. Run deterministic checks in CI where possible and scheduled model-based evaluations against versioned prompts and corpora.

## 14. MVP acceptance criteria

The MVP is ready for a closed beta when:

- A creator can upload each supported type and see accurate processing state.
- A one-hour video is processed asynchronously without blocking the app.
- Ready sources become searchable; failed or deleted sources never appear in answers.
- A creator can preview, publish, and unpublish an agent.
- Audience chat streams responses and opens valid citations.
- The agent declines unsupported questions in the agreed evaluation set.
- Cross-agent retrieval tests show no content leakage.
- Deletion and abuse-report workflows are tested end to end.
- Anonymous users cannot access original uploads, full transcripts, draft sources, or expired signed URLs.
- Security tests cover tenant isolation across API routes, vector retrieval, object storage, queues, caches, and citation endpoints.
- Logs, traces, analytics, and error reports are verified not to contain uploaded content or signed URLs.
- Every configured AI provider has documented retention and no-training controls suitable for user-uploaded data.
- A restore test confirms that deleted content does not return to active service from backup.
- Concurrent requests cannot read or append to another audience member's conversation.
- Retrying the same message request does not create duplicate user messages, model calls, or charges.
- Load tests demonstrate graceful backpressure at the agreed concurrent-stream target without cross-agent starvation.
- Publishing a new configuration during active chats produces version-consistent answers.
- Operational dashboards expose latency, failures, and estimated unit cost.

Numeric quality, latency, cost, and retention thresholds must be set using a representative prototype corpus before beta approval.

## 15. Major risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Hallucinated creator views | Evidence threshold, grounded prompt, citations, abstention, evaluation |
| Cross-creator data leakage | Tenant keys everywhere, database-level filters, adversarial tests |
| Exposure of original uploads or derivatives | Private-by-default storage, short-lived authorized links, encryption, derivative inventory |
| Prompt injection in content | Treat sources as data, isolate instructions, output/citation validation |
| High video-processing cost | Quotas, duration limits, batching, resumable jobs, visible estimates |
| Copyright or consent disputes | Rights attestation, takedown process, audit trail, rapid unpublish |
| Impersonation | Persistent AI disclosure and limits on first-person identity claims |
| Provider retention or model training | Approved processor list, no-training terms/settings, minimal payloads, recorded policy versions |
| Sensitive content in logs or support tools | Content-free telemetry, redaction tests, audited time-limited support access |
| Traffic spike from a popular agent | Per-agent fairness limits, bounded queues, autoscaling, graceful overload responses |
| Duplicate or reordered chat messages | Idempotency keys, sequence numbers, transactions, client reconciliation |
| Shared-cache data leakage | Versioned tenant-aware keys, visibility scope, no shared caching of sensitive answers |
| Vendor dependency | Narrow provider adapters and portable original/derived data formats |
| Poor creator onboarding | Sample agent, clear progress, actionable errors, guided evaluation questions |

## 16. Decisions needed before implementation

1. Which creator niche and content profile will define the first beta cohort?
2. What upload limits and monthly usage quota fit the target unit economics?
3. Are audience conversations anonymous, account-based, or both?
4. Should creators see conversation transcripts, aggregates only, or an opt-in subset?
5. Which regions and data-residency requirements are in scope?
6. What are the exact deletion and backup-retention commitments?
7. What evaluation thresholds are required to publish an agent?
8. Which AI, authentication, storage, and hosting providers will be used initially?

## 17. Recommended first sprint

- Confirm the first beta persona and collect a representative, rights-cleared corpus.
- Prototype extraction/transcription for one PDF and one long video.
- Compare chunking and retrieval strategies using 30–50 evaluation questions.
- Set preliminary latency and cost budgets from measured results.
- Finalize the data lifecycle and AI disclosure language.
- Scaffold the monorepo, local services, CI, database schema, and provider interfaces.

The first sprint should end with a thin vertical demo: upload one source, process it, ask one question, receive one cited answer, and delete the source so it can no longer be retrieved.
