# Building Creator Agent: A Privacy-First, Zero-Cost Path from Idea to Tested MVP

*How we designed a mobile-first agent builder that learns from creator content, protects private uploads, supports many audience members, and never silently spends the developer's AI tokens.*

[![Watch the narrated Creator Agent end-to-end prototype](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-e2e-poster.jpg)](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-demo.mp4)

*▶ [Watch the narrated, captioned 33-second demo video](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-demo.mp4) or [read its transcript](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-transcript.vtt).*

Creators already have the raw material for a useful AI agent: articles, guides, videos, transcripts, courses, and a recognizable way of explaining things. What they often do not have is a safe, understandable way to turn that library into an agent their audience can use.

That was the starting point for **Creator Agent**. The product idea is straightforward: a creator adds content, reviews what the system learned, customizes how the agent communicates, and publishes a mobile experience that answers audience questions using approved knowledge.

The constraints made the work interesting:

- Uploaded content must remain private unless the creator explicitly approves it.
- Multiple audience members must be able to chat without seeing one another's conversations.
- Creators need control over both knowledge and tone.
- The prototype must not silently route requests through the developer's personal AI account or create token charges.
- The architecture should show a credible path to production without pretending the prototype is already production-ready.

We turned those constraints into a test-first, mobile-responsive MVP and an executable system design.

## Prototype preview

![Creator Agent audience preview showing a grounded answer with source citations](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-audience-preview.jpg)

*The mobile audience preview answering from explicitly approved creator knowledge. Each answer links back to the excerpts that support it, while the banner makes the zero-cost deterministic mode visible.*

## What we built

The current Creator Agent repository contains a responsive web simulator, a protected API, durable workspace foundations, background ingestion boundaries, and a deterministic reference agent. Together, they demonstrate the main product journey without requiring a paid AI provider.

### A creator studio built around explicit control

The studio lets a creator add source material, inspect its status, decide whether it can be used in public answers, and remove it. Sources start private and preview-only. Public retrieval includes only sources that are ready and explicitly approved.

This sounds like a small interface choice, but it establishes an important rule: uploading content and publishing knowledge are separate actions. A creator can experiment without accidentally exposing unfinished, sensitive, or incorrectly processed material.

### Grounded answers with visible citations

The audience preview uses deterministic local retrieval. It searches approved excerpts, produces an answer from those excerpts, and links the answer back to its sources. When the available material is insufficient, it abstains instead of inventing an answer.

The deterministic engine is intentionally simple. It is not meant to compete with a production language model. Its job is to make the product contract observable and testable:

1. Only approved content can be retrieved.
2. Answers must be traceable to source material.
3. Deleted or disabled content must disappear immediately.
4. Unsupported questions must receive an honest response.

Because the output is repeatable, the simulator also acts as a regression oracle for future embedding and generation providers.

### Knowledge and voice are separate controls

A creator's agent should reflect both what the creator knows and how the creator communicates. We modeled these as separate layers.

The knowledge layer controls approved sources and citations. The style layer controls voice presets, response depth, signature phrases, greetings, prohibited topics, and behavioral boundaries. Configuration is versioned so changes can be persisted and audited instead of mutating an opaque prompt.

This separation matters. Tone should never override grounding, and a source should never silently redefine safety boundaries. Production generation can eventually combine both layers, but the system keeps their responsibilities distinct.

### Bring Your Own Agent without a hidden fallback

One of the earliest product decisions was that the prototype would not consume a developer-owned AI key. Creator Agent therefore supports two explicit routes:

- A deterministic local reference agent that reports zero AI calls.
- A user-owned HTTPS endpoint that implements a documented request and response contract.

When a creator selects their own endpoint, the interface explains the processing boundary before activation. Only bounded conversation history and approved excerpts are sent. Any model cost belongs to the endpoint owner. There is no silent fallback to a platform key.

That clarity is useful beyond cost control. It makes data movement visible and gives creators a path to use a provider, self-hosted model, or existing agent that matches their requirements.

### Managed authentication and durable tenant boundaries

The managed path uses OIDC Authorization Code with PKCE through Auth0. The protected API validates token signature, issuer, audience, expiration, algorithm, subject, and permission before mapping the external identity to an opaque internal creator ID.

PostgreSQL stores creator identity mappings, agents, versioned configurations, source metadata, lifecycle state, and content-free audit events. Every workspace query includes the verified internal owner ID.

PostgreSQL was selected because the difficult early data is relational: ownership, versions, state transitions, idempotency, leases, deletion, and auditability. Video bytes do not belong in the database; they go to private object storage. PostgreSQL provides the transactional control plane around those objects and leaves a practical path to `pgvector` later.

### A private video-ingestion boundary

Video is not treated as “just another file upload.” The managed flow separates several security-sensitive stages:

1. The API authorizes an exact file key, type, size, and short upload window.
2. The browser uploads the MP4 directly to private S3-compatible storage without receiving storage credentials or forwarding its Auth0 token.
3. A lease-based worker claims the quarantined source.
4. The worker performs bounded MP4 structure checks and streams the complete object to a private ClamAV service.
5. Invalid or infected files are disabled and deleted; scanner outages remain quarantined for bounded retry.
6. A clean video can receive a WebVTT transcript draft.
7. The creator must explicitly approve the transcript before the source becomes ready for retrieval.

For the zero-cost local path, a creator can pair a video with a WebVTT sidecar. Timestamped chunks are built in the browser without uploading the media or calling a transcription model.

Automatic transcription is deliberately not simulated as completed. A durable video without captions remains “Awaiting transcription.” Honest state is more valuable than a polished progress indicator that overstates what the system has done.

### Multi-user behavior before production traffic

Audience conversations are isolated in the simulator: Maya, Theo, and Jules each have separate histories. The load lab then makes concurrency visible through adjustable audience traffic, popular-agent concentration, platform capacity, per-agent concurrency, and bounded queue size.

The model demonstrates two fairness rules. One popular creator should not consume the entire platform, and overload should produce a retriable response instead of unbounded waiting or process failure.

This is not a substitute for production load testing, but it turns concurrency from an abstract architecture note into a product behavior the team can inspect and test.

## The architecture in one view

The system separates identity, metadata, media, processing, retrieval, and generation:

```text
Mobile-first client
  ├── Managed OIDC login → Auth0
  ├── Creator workspace → protected API → PostgreSQL
  ├── Private MP4 bytes → S3-compatible object storage
  └── Audience chat → approved retrieval context
                         ├── deterministic local agent ($0)
                         └── creator-owned endpoint (explicit opt-in)

Quarantine worker
  └── lease claim → MP4 inspection → ClamAV → transcript review state
```

The important boundary is not a particular vendor. It is that identity is verified once, ownership is applied to every durable operation, raw media stays private, public retrieval uses only approved material, and generation routing is explicit.

## How we validated it

The project was built in small increments, with each increment checked before it reached `main`. The repository now validates authentication, authorization, tenant isolation, source privacy, retrieval, citations, deletion, upload constraints, worker idempotency, malware-scan behavior, routing, conversation isolation, and load shedding.

The standard local check currently passes **84 tests**, along with TypeScript validation and production builds for every workspace. Two infrastructure-dependent integration suites remain opt-in because they require external services. A secret-free GitHub Actions workflow runs locked installation, typechecking, tests, builds, and a production dependency audit.

We also recorded a narrated and captioned [33-second end-to-end prototype](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-demo.mp4). The simulated product flow is deterministic and does not use a developer AI key.

## Key lessons

### 1. A useful prototype should encode invariants, not imitate magic

The local retrieval engine is intentionally modest, but it proves the rules that must survive a future model integration. A prototype becomes more valuable when it can catch privacy and product regressions instead of merely producing an impressive response once.

### 2. Privacy is a state machine

“We protect uploads” is too vague to implement. Privacy became concrete only after defining states and allowed transitions: quarantined, scanning, processing, awaiting transcription, preview-only, approved, disabled, tombstoned, and physically deleted. Retrieval can then fail closed based on state.

### 3. Tenant isolation belongs in every query

Authentication identifies a caller; it does not prove ownership of a requested agent or source. Mapping the verified external identity to an internal ID and including that ID in every resource query is the core multi-tenant rule.

### 4. Zero-cost mode improves the product

Avoiding a hidden AI bill led to a clearer routing design. The UI identifies who owns the endpoint, what data leaves the platform, and when cost can occur. Deterministic mode is now useful for onboarding, demos, CI, privacy testing, and offline development—not just as a temporary workaround.

### 5. Video processing needs explicit trust boundaries

Upload, validation, malware scanning, transcription, transcript review, and publication are different operations with different failure modes. Combining them into one “processing” step would make retries, deletion, audit, and user consent harder to reason about.

### 6. Customization needs structure

A creator's “tone” should not be one large prompt field. Structured, versioned controls are easier to preview, validate, migrate, audit, and eventually evaluate. Keeping style separate from evidence also reduces the chance that personality settings weaken grounding.

### 7. Concurrency is part of the user experience

Queues and limits determine whether an audience sees a fast answer, a long spinner, or a clear retry message. Modeling per-agent fairness early exposed product decisions that would otherwise surface only during an incident.

### 8. Production readiness is mostly operational truth

The MVP demonstrates secure boundaries, but production still requires native mobile delivery, durable audience conversations, automatic transcription or a creator-owned transcription route, tenant-filtered vector retrieval, moderation, quotas, observability, backup and restore drills, retention enforcement, and account deletion workflows.

Calling those gaps out is not a weakness. It makes the next milestones measurable.

## What comes next

The best next vertical slice is to connect approved durable transcript cues to tenant-filtered retrieval. That preserves the current privacy contract while replacing browser-only knowledge with durable, timestamped evidence. From there, the team can add provider-neutral embeddings and generation, evaluate answerability and citation quality, and build the Expo/React Native shell against the same authenticated API.

Creator Agent began as a question—can any content creator build an agent from their own documents and video? The MVP shows that the answer is yes, but the real product is not simply a chatbot. It is a controlled publishing system for knowledge, voice, privacy, routing, and audience access.

That is the foundation worth carrying into production.

---

**Project:** [github.com/yvetteYSY/creator-agent](https://github.com/yvetteYSY/creator-agent)

**Suggested Medium tags:** Artificial Intelligence, Content Creators, Privacy, RAG, Mobile Development
