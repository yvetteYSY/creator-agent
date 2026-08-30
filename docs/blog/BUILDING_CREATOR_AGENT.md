# Turn Your Content Into an AI Agent—Without Giving Up Control

*What if your audience could ask your best work a question and get a cited answer in your voice? Here is how we built a privacy-first Creator Agent MVP without burning a developer AI key.*

[![Abstract streams of documents, audio, and video converging into one agent and branching to an audience](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-cover-abstract.png)](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-demo.mp4)

*▶ [Watch the narrated, captioned 33-second demo video](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-demo.mp4) or [read its transcript](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-transcript.vtt).*

Imagine someone discovering your work at midnight. They do not want to search through hours of video or dozens of posts. They want to ask one question—and get an answer grounded in something you actually published, delivered in a style that still feels like you.

That is the experience we set out to build with **Creator Agent**: add the content you already have, review what the system learned, shape the agent's voice and boundaries, and publish a mobile experience your audience can trust.

The exciting part is the conversational experience. The important part is everything underneath it:

- Uploaded content must remain private unless the creator explicitly approves it.
- Multiple audience members must be able to chat without seeing one another's conversations.
- Creators need control over both knowledge and tone.
- The prototype must not silently route requests through the developer's personal AI account or create token charges.
- The architecture should show a credible path to production without pretending the prototype is already production-ready.

Those promises became a test-first, mobile-responsive MVP—and a system design honest enough to show what works today and what still belongs on the road to production.

## See it in action

![Creator Agent audience preview showing a grounded answer with source citations](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-audience-preview.jpg)

*The mobile audience preview answering from explicitly approved creator knowledge. Each answer links back to the excerpts that support it, while the banner makes the zero-cost deterministic mode visible.*

## From content library to audience-ready agent

What emerged is more than a clickable mockup. The repository combines a responsive simulator, protected API, durable workspace foundation, background ingestion boundaries, and deterministic reference agent. Together, they let the full product journey run without a paid AI provider.

### Start with the content you already have

The studio lets a creator add source material, inspect its status, decide whether it can be used in public answers, and remove it. Sources start private and preview-only. Public retrieval includes only sources that are ready and explicitly approved.

![Creator Agent studio showing approved and preview-only knowledge sources](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-studio.jpg)

*The creator studio keeps source status and publication scope visible. Ready content can still remain preview-only.*

This one interface choice carries a major promise: uploading content and publishing knowledge are separate actions. A creator can experiment freely without accidentally exposing unfinished, sensitive, or incorrectly processed material.

![Creator Agent add-source form with preview-only selected by default](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-add-source.jpg)

*New material begins preview-only, and the local simulator states clearly that pasted content remains in the browser.*

### Give your audience answers they can trust

For an audience member, a fluent answer is useful; a fluent answer with evidence is trustworthy. The preview searches approved excerpts, answers from them, and links every response back to its sources. When the material is not enough, it says so instead of making something up.

The deterministic engine is intentionally simple. It is not meant to compete with a production language model. Its job is to make the product contract observable and testable:

1. Only approved content can be retrieved.
2. Answers must be traceable to source material.
3. Deleted or disabled content must disappear immediately.
4. Unsupported questions must receive an honest response.

Because the output is repeatable, the simulator also acts as a regression oracle for future embedding and generation providers.

### Make it sound like you—without weakening the facts

A creator's agent should capture both what the creator knows and how the creator communicates. The safest way to do that is to keep those concerns separate.

The knowledge layer controls approved sources and citations. The style layer controls voice presets, response depth, signature phrases, greetings, prohibited topics, and behavioral boundaries. Configuration is versioned so changes can be persisted and audited instead of mutating an opaque prompt.

This separation matters. Tone should never override grounding, and a source should never silently redefine safety boundaries. Production generation can eventually combine both layers, but the system keeps their responsibilities distinct.

![Creator Agent customization screen showing depth, signature phrases, prohibited topics, and behavioral boundaries](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-customization.jpg)

*Structured controls make response depth, signature language, prohibited topics, and behavioral boundaries independently reviewable.*

### Choose the engine. Keep control of the bill.

One decision was non-negotiable: the prototype would never quietly consume a developer-owned AI key. Creator Agent therefore offers two explicit routes:

- A deterministic local reference agent that reports zero AI calls.
- A user-owned HTTPS endpoint that implements a documented request and response contract.

When a creator selects their own endpoint, the interface explains the processing boundary before activation. Only bounded conversation history and approved excerpts are sent. Any model cost belongs to the endpoint owner. There is no silent fallback to a platform key.

That clarity is useful beyond cost control. It makes data movement visible and gives creators a path to use a provider, self-hosted model, or existing agent that matches their requirements.

![Creator Agent routing screen showing deterministic local and user-owned endpoint options](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-routing.jpg)

*Routing is an explicit creator choice: deterministic local execution or a user-owned endpoint with a visible processing boundary.*

### Secure from the first sign-in

The managed path uses OIDC Authorization Code with PKCE through Auth0. The protected API validates token signature, issuer, audience, expiration, algorithm, subject, and permission before mapping the external identity to an opaque internal creator ID.

PostgreSQL stores creator identity mappings, agents, versioned configurations, source metadata, lifecycle state, and content-free audit events. Every workspace query includes the verified internal owner ID.

PostgreSQL was selected because the difficult early data is relational: ownership, versions, state transitions, idempotency, leases, deletion, and auditability. Video bytes do not belong in the database; they go to private object storage. PostgreSQL provides the transactional control plane around those objects and leaves a practical path to `pgvector` later.

### Treat every upload like it matters

Video is where simple demos often hide the hardest risks. Creator Agent refuses to treat it as “just another file upload.” The managed flow separates each security-sensitive stage:

1. The API authorizes an exact file key, type, size, and short upload window.
2. The browser uploads the MP4 directly to private S3-compatible storage without receiving storage credentials or forwarding its Auth0 token.
3. A lease-based worker claims the quarantined source.
4. The worker performs bounded MP4 structure checks and streams the complete object to a private ClamAV service.
5. Invalid or infected files are disabled and deleted; scanner outages remain quarantined for bounded retry.
6. A clean video can receive a WebVTT transcript draft.
7. The creator must explicitly approve the transcript before the source becomes ready for retrieval.

For the zero-cost local path, a creator can pair a video with a WebVTT sidecar. Timestamped chunks are built in the browser without uploading the media or calling a transcription model.

Automatic transcription is deliberately not simulated as completed. A durable video without captions remains “Awaiting transcription.” That honesty is a feature: a truthful state is more valuable than a polished progress indicator that overstates what the system has done.

### Build for an audience, not just a demo

Audience conversations are isolated in the simulator: Maya, Theo, and Jules each have separate histories. The load lab then makes concurrency visible through adjustable audience traffic, popular-agent concentration, platform capacity, per-agent concurrency, and bounded queue size.

The model demonstrates two fairness rules. One popular creator should not consume the entire platform, and overload should produce a retriable response instead of unbounded waiting or process failure.

This is not a substitute for production load testing, but it turns concurrency from an abstract architecture note into a product behavior the team can inspect and test.

![Creator Agent load lab showing traffic, concurrency, queue, and fairness controls](https://raw.githubusercontent.com/yvetteYSY/creator-agent/main/docs/assets/creator-agent-load-lab.jpg)

*The load lab exposes traffic concentration, platform capacity, bounded queues, and per-agent fairness as product behavior.*

## Under the hood: clear boundaries, clear ownership

Underneath the inviting interface, the system keeps identity, metadata, media, processing, retrieval, and generation deliberately separate:

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

## We tested the promises, not just the happy path

A polished demo is easy to applaud. A dependable product needs proof. We built in small increments and checked every one before it reached `main`. The repository now validates authentication, authorization, tenant isolation, source privacy, retrieval, citations, deletion, upload constraints, worker idempotency, malware-scan behavior, routing, conversation isolation, and load shedding.

The standard local check currently passes **84 tests**, along with TypeScript validation and production builds for every workspace. Two infrastructure-dependent integration suites remain opt-in because they require external services. A secret-free GitHub Actions workflow runs locked installation, typechecking, tests, builds, and a production dependency audit.

We also recorded a narrated and captioned [33-second end-to-end prototype](https://github.com/yvetteYSY/creator-agent/blob/main/docs/assets/creator-agent-e2e-demo.mp4). The simulated product flow is deterministic and does not use a developer AI key.

## What surprised us—and what we learned

- **A useful prototype should encode invariants, not imitate magic.** The local retrieval engine is intentionally modest, but it proves the rules that must survive a future model integration. A prototype becomes more valuable when it can catch privacy and product regressions instead of merely producing an impressive response once.

- **Privacy is a state machine.** “We protect uploads” is too vague to implement. Privacy became concrete only after defining states and allowed transitions: quarantined, scanning, processing, awaiting transcription, preview-only, approved, disabled, tombstoned, and physically deleted. Retrieval can then fail closed based on state.

- **Tenant isolation belongs in every query.** Authentication identifies a caller; it does not prove ownership of a requested agent or source. Mapping the verified external identity to an internal ID and including that ID in every resource query is the core multi-tenant rule.

- **Zero-cost mode improves the product.** Avoiding a hidden AI bill led to a clearer routing design. The UI identifies who owns the endpoint, what data leaves the platform, and when cost can occur. Deterministic mode is now useful for onboarding, demos, CI, privacy testing, and offline development—not just as a temporary workaround.

- **Video processing needs explicit trust boundaries.** Upload, validation, malware scanning, transcription, transcript review, and publication are different operations with different failure modes. Combining them into one “processing” step would make retries, deletion, audit, and user consent harder to reason about.

- **Customization needs structure.** A creator's “tone” should not be one large prompt field. Structured, versioned controls are easier to preview, validate, migrate, audit, and eventually evaluate. Keeping style separate from evidence also reduces the chance that personality settings weaken grounding.

- **Concurrency is part of the user experience.** Queues and limits determine whether an audience sees a fast answer, a long spinner, or a clear retry message. Modeling per-agent fairness early exposed product decisions that would otherwise surface only during an incident.

- **Production readiness is mostly operational truth.** The MVP demonstrates secure boundaries, but production still requires native mobile delivery, durable audience conversations, automatic transcription or a creator-owned transcription route, tenant-filtered vector retrieval, moderation, quotas, observability, backup and restore drills, retention enforcement, and account deletion workflows.

Calling those gaps out is not a weakness. It makes the next milestones measurable.

## Where Creator Agent goes next

The best next vertical slice is to connect approved durable transcript cues to tenant-filtered retrieval. That preserves the current privacy contract while replacing browser-only knowledge with durable, timestamped evidence. From there, the team can add provider-neutral embeddings and generation, evaluate answerability and citation quality, and build the Expo/React Native shell against the same authenticated API.

Your content has already earned trust. The opportunity is to make that knowledge conversational without surrendering control of the source, the voice, the audience, or the bill.

Creator Agent began with a simple question: can any creator build an agent from their own documents and video? The MVP shows that the answer is yes—but the product worth carrying into production is not merely a chatbot. It is a creator-owned publishing system for knowledge, voice, privacy, routing, and audience access.

---

**Project:** [github.com/yvetteYSY/creator-agent](https://github.com/yvetteYSY/creator-agent)

**Suggested Medium tags:** Artificial Intelligence, Content Creators, Privacy, RAG, Mobile Development
