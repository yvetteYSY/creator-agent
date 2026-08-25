# Bring Your Own Agent routing contract

**Status:** MVP contract  
**Version:** `2026-08-24`

## Recommendation

Creator Agent should support a user-owned agent endpoint rather than asking users to paste a raw model-provider key into the mobile application.

The endpoint approach creates a clean responsibility boundary:

- Creator Agent owns authentication, source authorization, retrieval, context limits, conversation isolation, and citation validation.
- The user-owned endpoint owns generation behavior, model selection, provider credentials, retention, and model charges.
- The mobile client never receives platform model credentials.
- The platform never silently routes traffic to the developer's personal AI subscription or API key.

The included local reference endpoint provides the recommended zero-cost E2E prototype. It uses HTTP on localhost, deterministic text assembly, and no AI provider.

## Activation requirements

A remote route is used only after the creator:

1. Selects **User-owned agent endpoint**.
2. Supplies an endpoint URL.
3. Confirms they own or trust the endpoint and understand its processing and cost boundary.
4. Activates the route.

The default remains the deterministic local engine. There is no automatic fallback from a failed user endpoint to a paid platform model.

Remote endpoints require HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1` during local development. URL-embedded credentials are rejected.

## Request

Creator Agent sends `POST` with `Content-Type: application/json`. If configured, the user's bearer token is sent only in the `Authorization` header and is not copied into the payload, URL, logs, or persistent browser storage.

```json
{
  "version": "2026-08-24",
  "agent": {
    "id": "agent_0001",
    "name": "Ari's Creative Coach",
    "instructions": "Warm, concise, and grounded.\nStay within approved sources."
  },
  "conversation": {
    "id": "conversation_0001",
    "history": []
  },
  "message": {
    "content": "How often should I publish?"
  },
  "context": [
    {
      "sourceId": "source_0002",
      "title": "The Sustainable Content System",
      "excerpt": "Publish one durable idea each week.",
      "location": "Section 1"
    }
  ]
}
```

Limits in the MVP contract:

- At most 10 previous messages
- At most 4 retrieved excerpts
- Only `ready` sources explicitly approved for public answers
- No original files, storage URLs, full transcripts, preview-only sources, or unrelated conversations

Production should add explicit byte/token ceilings to the contract and enforce them before sending a request.

## Response

The endpoint returns JSON:

```json
{
  "answer": "A useful cadence is one durable idea each week.",
  "citations": ["source_0002"],
  "provider": "user-owned-agent"
}
```

- `answer` is required and must be a non-empty string.
- `citations` is optional and contains source IDs from the supplied context.
- `provider` is optional diagnostic metadata.

Creator Agent ignores citation IDs that were not present in the request context. A remote endpoint cannot use its response to expose or cite an unapproved source.

## Failure behavior

- Time out after a bounded deadline; the MVP default is 20 seconds.
- Return a visible route error to the creator or audience member.
- Do not silently retry non-idempotent requests.
- Deduplicate concurrent requests with the same conversation and idempotency key.
- Do not fall back to a paid model route.
- Do not append a failed remote response to conversation history.

## Credential handling

The browser prototype keeps the optional bearer token only in React memory and clears it on refresh. It does not use local storage, session storage, IndexedDB, analytics, or logs.

For production mobile clients, do not call arbitrary user endpoints directly from the device. Store user-owned endpoint credentials in a managed secret store, use a server-side routing gateway, encrypt secrets with a tenant-scoped key, restrict staff access, support rotation/revocation, and audit every use without recording the secret or content.

## Zero-cost local reference agent

Run:

```bash
npm run dev:e2e
```

Health check:

```bash
curl http://127.0.0.1:4310/health
```

Expected result:

```json
{"ok":true,"provider":"local-reference-agent","aiCalls":0}
```

The reference endpoint is a contract and privacy test double. It is not presented as an intelligent production model.
