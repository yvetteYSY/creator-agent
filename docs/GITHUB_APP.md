# Free GitHub App integration

Creator Agent can connect to repositories selected by a signed-in creator and import one Markdown, MDX, or plain-text file as private agent knowledge. This integration makes no AI-provider calls and has no token/model cost.

## What is implemented

- GitHub App installation from the authenticated creator studio
- One-time, creator-bound, 10-minute connection state; only its SHA-256 digest is stored
- GitHub user authorization during installation to verify that the completing user can administer the selected installation
- Owner-scoped installation and repository listing
- Read-only import of one `.md`, `.mdx`, or `.txt` file, limited to 1 MB and valid UTF-8
- Preview-only imports that require an explicit later action before public answers may use them
- Short-lived GitHub App JWTs and installation tokens created server-side and never returned to the browser or persisted
- HMAC-SHA-256 webhook verification before installation lifecycle changes are accepted
- Revoked and suspended installations fail closed
- Content-free audit events for successful imports

## Register the GitHub App

The API must already have a public HTTPS origin. The [free beta deployment guide](DEPLOY_FREE_BETA.md) provides a no-AI-cost reference path. In GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App** and use:

| Setting | Value |
| --- | --- |
| GitHub App name | A globally unique name, such as `Creator Agent Content` |
| Homepage URL | The public Creator Agent web URL, or the public repository during development |
| Callback URL | `https://<api-origin>/v1/github/callback` |
| Setup URL | Leave blank; the callback completes the connection |
| Request user authorization (OAuth) during installation | Enabled |
| Webhook | Active |
| Webhook URL | `https://<api-origin>/v1/github/webhooks` |
| Webhook secret | A new high-entropy secret generated for this environment |
| Repository permissions → Contents | Read-only |
| Repository permissions → Metadata | Read-only (GitHub-required) |
| Subscribe to events | Installation and Installation repositories |
| Where can this GitHub App be installed? | Any account for a public launch; only this account during private development |

Do not request Issues, Pull requests, Actions, Administration, or write permissions. Encourage creators to choose **Only select repositories** during installation.

After registration:

1. Generate a private key from the GitHub App settings page.
2. Copy `apps/api/.env.example` to a server-only environment file or secret manager.
3. Configure all GitHub variables together:

```dotenv
GITHUB_APP_CLIENT_ID=Iv1_your_client_id
GITHUB_APP_CLIENT_SECRET=server_only_oauth_secret
GITHUB_APP_CALLBACK_URL=https://api.example.com/v1/github/callback
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=long_random_webhook_secret
GITHUB_APP_SLUG=creator-agent-content
```

4. Apply migrations with `npm run db:migrate` and restart the API.
5. Sign into the managed Creator Agent app, choose **Add source → GitHub repository → Connect GitHub**, select repositories, and import a file.

All six variables are required together. Partial configuration stops API startup. The private key, client secret, and webhook secret must stay in server-side secret storage and must never use a `VITE_*` name.

## Data boundary

Creator Agent receives repository metadata for repositories explicitly granted to the installation and the contents of the one file a creator chooses to import. It stores the selected file content, repository/path reference, blob SHA, and GitHub file URL in the creator's owner-scoped workspace. The copy starts preview-only.

Creator Agent does not crawl a repository, clone Git history, receive repository write permission, persist GitHub access tokens, or send imported content to an AI provider. Installation tokens are requested just in time, scoped to read-only Contents/Metadata, and discarded after the request.

Deleting an imported source cascades deletion of its imported content row. Uninstall and suspension webhooks immediately disable further repository listing and imports. Production backups still need a documented maximum retention period and deletion-expiry test as described in the [production roadmap](PRODUCTION_ROADMAP.md).

## HTTP routes

| Route | Authentication | Purpose |
| --- | --- | --- |
| `POST /v1/github/connect` | Auth0 `write:agent` | Start a creator-bound installation flow |
| `GET /v1/github/callback` | One-time state + GitHub OAuth code | Verify the GitHub administrator and bind the installation |
| `POST /v1/github/webhooks` | GitHub HMAC signature | Process installation lifecycle events |
| `GET /v1/github/installations` | Auth0 `read:creator` | List the creator's connections |
| `GET /v1/github/installations/:id/repositories` | Auth0 `read:creator` | List repositories granted to that creator-owned installation |
| `POST /v1/agents/:id/sources/github` | Auth0 `write:agent` | Import one selected text file as preview-only knowledge |

The browser never supplies an owner ID. The API derives ownership from the verified Auth0 access token and checks the installation, agent, and imported source against that owner.

## Free launch versus GitHub Marketplace

A public GitHub App can be installed for free without a Marketplace listing. That is the recommended first launch: validate installation, privacy, support, revocation, and deletion with a small beta.

GitHub Marketplace is a separate review and distribution step. Before applying, deploy stable public HTTPS endpoints, publish the [privacy notice](PRIVACY.md) and [support policy](SUPPORT.md), add production monitoring and incident handling, and implement any Marketplace-specific purchase/cancellation events required by GitHub even for a free listing.

## Acceptance checks

```bash
npm run check
```

The automated suite covers configuration failure, short-lived signing, user/installation verification, tenant isolation, bounded file import, preview-only defaults, token non-exposure, signature verification, lifecycle state changes, malformed signed payloads, and the existing zero-AI behavior.
