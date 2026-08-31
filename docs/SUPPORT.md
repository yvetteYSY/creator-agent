# Creator Agent support and security

Creator Agent is currently an open-source prototype and free beta integration. It has no uptime SLA, paid support, or guarantee of data recovery.

## Product support

Use [GitHub Issues](https://github.com/yvetteYSY/creator-agent/issues) for reproducible bugs, feature requests, documentation questions, and GitHub App installation problems. Include expected/actual behavior and sanitized logs, but never include creator content, private repository names, credentials, private keys, OAuth codes, access tokens, webhook secrets, or full webhook payloads.

## Security reports

Do not disclose a suspected vulnerability in a public issue. Use GitHub's private vulnerability reporting for the repository when enabled: **Security → Report a vulnerability**. If private reporting is unavailable, open a public issue containing only a request for a private contact channel and no vulnerability details.

Reports are most useful when they include the affected commit/version, safe reproduction steps, impact, and suggested mitigation. Never test against another user's account, installation, repository, or content.

## Current service boundaries

- Local mode is a simulator and resets in-browser state on refresh.
- Managed mode requires separately configured Auth0, PostgreSQL, and public API hosting.
- The GitHub integration is read-only and imports only a creator-selected text file.
- The deterministic preview makes no AI-provider calls and incurs no AI token cost.
- Production monitoring, backup recovery, formal incident response, and a public service-level objective remain launch prerequisites.
