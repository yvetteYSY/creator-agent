# Local video transcripts

The MVP can turn a video into timestamped, searchable knowledge without calling a transcription or AI provider when the creator already has a matching WebVTT (`.vtt`) caption file.

The simulator path is intentionally browser-local. The protected API now also supports a separate durable creator-provided WebVTT workflow after a managed video passes quarantine scanning; the managed UI is still pending.

## Try it

1. Run `npm run dev` and open `http://127.0.0.1:4173`.
2. In **Studio**, select **Add source** and choose **Video file**.
3. Choose an MP4, WebM, or QuickTime file up to 250 MB.
4. Choose its matching `.vtt` file under **WebVTT transcript (optional)**.
5. Keep the source **Preview only** while reviewing it, then select **Process video + transcript**.
6. The source becomes **Ready** with one timestamped section per caption cue. Public chat can use it only after the creator explicitly changes its visibility to **Public answers**.

If no sidecar is selected, the simulator truthfully leaves the video in **Awaiting transcription** and excludes it from retrieval.

## Validation boundary

The local parser requires:

- a `WEBVTT` header;
- at least one non-empty caption cue;
- chronological `HH:MM:SS.mmm` or `MM:SS.mmm` cue ranges with each end after its start;
- at most 2 MB of caption text and 10,000 cues.

Basic WebVTT markup is removed before indexing. Each resulting citation uses the cue's start and end time, such as `02:57–03:02`.

This is caption ingestion, not speech recognition. The local path does not claim that the transcript matches the audio, identify speakers, inspect the full media container, scan for malware, or verify that the creator owns the content. The managed API additionally requires a clean structural/ClamAV scan and rejects cues that extend materially beyond the inspected video duration, but still cannot prove semantic correspondence or ownership.

## Privacy and cost boundary

In local authentication mode:

- the video and caption bytes stay in browser memory;
- no request is sent to Creator Agent storage, an AI provider, or a transcription service;
- derived timestamped chunks disappear on refresh;
- preview-only chunks are never sent to public chat or a user-owned agent endpoint;
- deleting or disabling the source immediately excludes its chunks from retrieval.

Managed Auth0 mode does not expose the sidecar control in the simulator yet. After a video reaches `processing`, an authenticated client can `PUT` a WebVTT draft to `/v1/agents/:agentId/sources/:sourceId/transcript`, read it with `GET`, and `PATCH` it to `approved` or `rejected`. Every operation derives the owner from the verified token. Approval moves the source to `ready`/preview; it does not publish automatically. Replacing captions returns the source to `processing`/preview.

Managed captions are stored separately from video bytes in PostgreSQL and must be encrypted at rest in production. Full caption text is returned only to the owning creator, never written to audit metadata, and immediately overwritten when the source is deleted. Backups still require a documented expiry policy before production.

## Production follow-up

Next, approved cues must be materialized into tenant-filtered durable chunks without copying unapproved content into retrieval. Future automatic processors must record processor and consent basis without logging content. Deletion must expand from the implemented original/caption removal to chunks, embeddings, caches, and retained backups according to the published retention policy.
