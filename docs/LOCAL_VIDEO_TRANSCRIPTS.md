# Local video transcripts

The MVP can turn a video into timestamped, searchable knowledge without calling a transcription or AI provider when the creator already has a matching WebVTT (`.vtt`) caption file.

This path is intentionally local-only. It is useful for end-to-end product testing, creator review, and zero-cost demos while the private managed transcription pipeline is still being designed.

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

This is caption ingestion, not speech recognition. The MVP does not claim that the transcript matches the audio, identify speakers, inspect the full media container, scan for malware, or verify that the creator owns the content.

## Privacy and cost boundary

In local authentication mode:

- the video and caption bytes stay in browser memory;
- no request is sent to Creator Agent storage, an AI provider, or a transcription service;
- derived timestamped chunks disappear on refresh;
- preview-only chunks are never sent to public chat or a user-owned agent endpoint;
- deleting or disabling the source immediately excludes its chunks from retrieval.

Managed Auth0 mode does not expose the sidecar control yet. It continues to upload MP4 bytes privately and holds them outside retrieval until the durable scanning, transcription, review, and approval stages exist.

## Production follow-up

The managed path should store transcripts separately from originals, encrypt both, preserve tenant ownership on every row and object key, record the processor and consent basis without logging content, and require creator review before a transcript can become public. Deletion must cover originals, captions, chunks, embeddings, caches, and retained backups according to the published retention policy.
