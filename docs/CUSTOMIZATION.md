# Creator customization model

**Status:** MVP implemented  
**Last updated:** 2026-08-24

## Objective

The agent should feel familiar to a creator's audience while remaining grounded, transparent, and clearly identified as AI. Customization changes how an answer is delivered; it does not grant permission to invent facts, opinions, private details, or creator intent.

## Versioned controls

The MVP stores these controls on each agent configuration version:

- Voice preset: warm mentor, direct strategist, curious teacher, or custom
- Free-form tone description
- Response depth: short, balanced, or deep dive
- Optional signature phrases
- Prohibited topics
- Welcome message
- Behavioral boundaries

Saving customization increments the agent version. Production publishing should create an immutable configuration version so active requests finish on the version with which they began.

## Answer pipeline

```text
Audience question
→ authorize agent and conversation
→ retrieve approved source excerpts
→ apply tone, depth, signature language, and boundaries
→ generate locally or through the activated user-owned endpoint
→ validate citations against supplied context
→ return the answer with AI disclosure
```

Knowledge and style remain separate:

- Retrieval determines which claims the agent may make.
- Customization determines structure, vocabulary, depth, and optional recurring language.
- Citations always point to creator-approved knowledge sources.
- No style example becomes a factual source merely because it demonstrates tone.

## Zero-cost preview

The Customization Studio includes a deterministic side-by-side preview. It applies preset lead-ins, response-depth limits, and signature language to fixed approved excerpts. It makes no network or AI call and does not consume tokens.

When a user-owned agent route is active, the same configuration is serialized into the endpoint instructions. The endpoint receives only bounded history and approved excerpts under the [BYOA routing contract](AGENT_ROUTING.md).

## Recommended production style learning

Later versions can let creators select representative passages and edited example answers. A style profiler may summarize observable characteristics such as sentence length, directness, explanation pattern, recurring vocabulary, and formatting preferences.

The creator must review and approve the generated style profile. Raw content should not be treated as blanket permission to imitate sensitive speech, private identity, or opinions.

Fine-tuning is not required for the first production release. Retrieval plus explicit instructions and approved examples is easier to inspect, version, correct, and delete.

## Identity and safety boundaries

- Always disclose that the audience is interacting with AI.
- Do not claim that the creator is live, present, or personally responding.
- Avoid first-person claims about beliefs, memories, relationships, health, or private activity unless the product has a separately reviewed policy and explicit creator approval.
- Prohibited topics supplement platform policy; they cannot weaken it.
- Signature phrases are optional and must not be forced into refusals, safety responses, or every answer.
- Prefer abstention when approved knowledge does not support the answer.

## Evaluation cases

Every configuration version should be tested against:

- Answerable questions with expected sources
- Unsupported questions requiring abstention
- Short, balanced, and deep responses to the same question
- Prohibited-topic questions
- Attempts to make the agent claim it is the creator
- Questions that tempt the agent to reveal preview-only content
- Citation consistency across style changes

The acceptance criterion is not merely “sounds like the creator.” It is “recognizably aligned with the creator's approved style while remaining grounded, cited, and transparent.”
