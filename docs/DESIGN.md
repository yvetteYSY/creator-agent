# Creator Agent — Product and Technical Design

**Status:** Draft for kickoff  
**Last updated:** 2026-08-24  
**Audience:** Product, design, engineering, AI/evaluation, trust and safety

## 1. Summary

Creator Agent enables a content creator to turn a library of documents, audio, and video into a configurable AI agent. The agent answers audience questions using retrieval-augmented generation (RAG), links its claims to creator-approved sources, and exposes controls for publishing, safety, and deletion.

The MVP tests one central hypothesis:

> Audiences receive useful, trustworthy answers when an AI agent can search a creator's approved content and cite the exact material used to answer.

The MVP should validate this hypothesis before adding voice cloning, avatars, autonomous actions, or monetization.

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
| `evaluation_cases` | id, agent_id, question, expected sources, rubric |
| `audit_events` | actor, action, target, metadata, timestamp |

Use UUIDs, explicit tenant keys, UTC timestamps, and soft deletion where immediate retrieval exclusion is required. Sensitive provider payloads should not be copied into general logs.

## 10. API surface (draft)

```text
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

### Consent and identity

- A creator must attest that they own or have permission to process uploaded material.
- Published experiences must state that the agent is AI-generated.
- The agent must not claim to be the creator, communicate privately on their behalf, or imply live creator participation.
- Voice or likeness features require a separate consent and verification design before implementation.

### Data lifecycle

Define retention periods for uploads, transcripts, conversations, logs, backups, and deleted data before beta. Source deletion immediately excludes content from retrieval. Account deletion must trigger a traceable workflow across primary storage, vector data, caches, analytics identifiers, and backups according to the published retention policy.

## 12. Reliability and observability

Track:

- Ingestion success rate and time by source type and duration
- Queue depth, retries, dead-letter jobs, and provider errors
- Retrieval hit rate, evidence score, and citation validity
- Time to first token and end-to-end response latency
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
- Operational dashboards expose latency, failures, and estimated unit cost.

Numeric quality, latency, cost, and retention thresholds must be set using a representative prototype corpus before beta approval.

## 15. Major risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Hallucinated creator views | Evidence threshold, grounded prompt, citations, abstention, evaluation |
| Cross-creator data leakage | Tenant keys everywhere, database-level filters, adversarial tests |
| Prompt injection in content | Treat sources as data, isolate instructions, output/citation validation |
| High video-processing cost | Quotas, duration limits, batching, resumable jobs, visible estimates |
| Copyright or consent disputes | Rights attestation, takedown process, audit trail, rapid unpublish |
| Impersonation | Persistent AI disclosure and limits on first-person identity claims |
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
