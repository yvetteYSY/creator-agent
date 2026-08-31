# Creator Agent privacy notice

Last updated: August 30, 2026

This notice describes the current open-source Creator Agent prototype and its optional GitHub App integration. A production operator must review this notice against its actual deployment, subprocessors, region, retention schedule, and legal obligations before accepting public users.

## Data the service processes

- Account identity: the Auth0 issuer and subject needed to create an opaque internal creator ID. Display name, email, and profile image may be shown by the client but are not stored by the Creator Agent identity table.
- Creator configuration: agent name, description, tone, response settings, phrases, topic boundaries, greeting, versions, and visibility state.
- Creator content: text intentionally pasted or uploaded; private video objects when storage is configured; creator-provided transcripts; and files explicitly imported from GitHub.
- GitHub connection data: installation ID, account login/type, repository-selection mode, lifecycle status, and repository metadata returned for repositories granted to the app.
- Operational metadata: content-free audit events, opaque resource IDs, timestamps, processing states, and security/availability telemetry configured by the operator.

## GitHub permissions and use

The GitHub App requests read-only Repository contents and Metadata permissions. It lists only repositories granted to its installation and reads only a Markdown, MDX, or text file selected by the creator. Imported content begins preview-only. The app does not write to repositories, create issues or pull requests, access Actions secrets, or crawl repository history.

GitHub user access tokens, installation tokens, the GitHub App private key, OAuth client secret, and webhook secret are not stored in the browser or application database. Server-side access tokens are used transiently for the requested operation and discarded.

## How data is used

Data is used to authenticate creators, maintain their agent workspace, process creator-authorized sources, return grounded preview answers, enforce privacy state, and secure/operate the service. The current deterministic path does not call an AI provider. Creator Agent does not sell personal data or train a shared model on creator content.

If an operator later enables a creator-owned response endpoint or another processor, the product must disclose the processing boundary and obtain the creator's explicit activation first. That endpoint's operator controls its own retention, billing, and model behavior.

## Sharing

Data is sent only to infrastructure configured by the service operator, GitHub for creator-requested repository operations, Auth0 for managed authentication, and an endpoint explicitly activated by the creator. Public agent answers may use only sources the creator separately approves for public answers. Preview-only sources are excluded.

## Retention and deletion

Deleting a source removes it from retrieval immediately. Durable deletion removes the source metadata and cascades removal of a GitHub-imported file copy; private object deletion is tombstoned and retried by the cleanup worker. GitHub uninstall or suspension disables future repository access. A production operator must publish concrete account, backup, audit, and security-log retention periods and verify backup expiry before launch.

## Security

The implementation uses owner-scoped database queries, private-by-default sources, short-lived connection state, server-side secrets, short-lived GitHub credentials, signed webhook validation, bounded file imports, HTTPS requirements outside localhost, and content-free audits. No service can guarantee absolute security; report suspected vulnerabilities privately using the process in [SUPPORT.md](SUPPORT.md).

## Creator choices

Creators choose which repositories to grant, which file to import, whether a source may inform public answers, and when to delete a source or uninstall the GitHub App. Creators should import only content they have permission to use and should not import secrets or unnecessary personal data.

## Contact

For privacy questions, open a privacy-labeled issue in the [Creator Agent repository](https://github.com/yvetteYSY/creator-agent/issues). Do not include private content, credentials, access tokens, or security vulnerability details in a public issue.
