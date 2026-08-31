# Deploy the free beta

This is a no-AI-cost deployment path for demonstrating the managed Creator Agent and its GitHub App. It is a beta/demo configuration, not a production architecture.

The repository includes a Render Blueprint for two free services:

- `creator-agent-yvetteysy`: static creator studio
- `creator-agent-yvetteysy-api`: Node.js API

PostgreSQL uses a separate Neon Free project because Render's Free PostgreSQL instances expire after 30 days. Auth0 supplies managed OIDC. None of these services requires an AI key.

## Free-tier limitations

- Render Free web services sleep after 15 minutes without inbound traffic and can take about one minute to wake. They receive 750 free instance-hours per workspace each month and may be suspended at usage limits.
- Neon Free currently supplies 0.5 GB storage, 100 CU-hours per project each month, and 5 GB monthly public network transfer; compute scales to zero when idle.
- Auth0 Free currently supports up to 25,000 external active users. Production readiness still requires monitoring, incident response, backups/restore tests, concrete retention periods, and a funded always-on service.

Review the current official [Render free-service limits](https://render.com/docs/free), [Neon pricing](https://neon.com/pricing), and [Auth0 pricing](https://auth0.com/pricing) before each deployment because free tiers change.

## 1. Create free PostgreSQL

1. Create a Neon account and Free project.
2. Copy the pooled PostgreSQL connection string. Treat it as a server secret.
3. Do not place it in a `VITE_*` variable or commit it to Git.

The API startup command applies all migrations, including the GitHub integration schema, before listening for traffic.

## 2. Configure Auth0 Free

Follow [AUTHENTICATION.md](AUTHENTICATION.md) to create one Single Page Application and one custom API. Use these deployment values:

```text
Studio origin: https://creator-agent-yvetteysy.onrender.com
API origin: https://creator-agent-yvetteysy-api.onrender.com
```

Add the studio origin to Auth0's exact Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins. Use one custom API audience URI consistently for `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE`; the URI is an identifier and does not need to resolve.

## 3. Deploy the Blueprint

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yvetteYSY/creator-agent)

Connect `yvetteYSY/creator-agent`, review `render.yaml`, keep both services on Free, and supply:

| Blueprint variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH0_ISSUER_BASE_URL` | Exact Auth0 tenant issuer ending in `/` |
| `AUTH0_AUDIENCE` | Auth0 custom API identifier |
| `VITE_AUTH0_DOMAIN` | Auth0 tenant domain, no scheme |
| `VITE_AUTH0_CLIENT_ID` | Public SPA client ID |
| `VITE_AUTH0_AUDIENCE` | Same custom API identifier |

No Auth0 client secret belongs in the static site. If Render reports that either requested service hostname is unavailable, choose new names and update the API allowed origin, client API URL, Auth0 URL allowlists, and GitHub URLs together before redeploying.

Validate:

```text
GET https://creator-agent-yvetteysy-api.onrender.com/health
→ {"ok":true,"service":"creator-agent-api","aiCalls":0}
```

Then open the studio, sign in through Auth0, and verify that a durable agent loads.

## 4. Register and connect the GitHub App

Use [GITHUB_APP.md](GITHUB_APP.md) with:

```text
Homepage: https://creator-agent-yvetteysy.onrender.com
Callback: https://creator-agent-yvetteysy-api.onrender.com/v1/github/callback
Webhook:  https://creator-agent-yvetteysy-api.onrender.com/v1/github/webhooks
Privacy:  https://github.com/yvetteYSY/creator-agent/blob/main/docs/PRIVACY.md
Support:  https://github.com/yvetteYSY/creator-agent/blob/main/docs/SUPPORT.md
```

After GitHub creates the app, add all six `GITHUB_APP_*` variables from `apps/api/.env.example` to the API service in Render and redeploy. Keep the private key, client secret, and webhook secret server-only. Test installation on **Only select repositories** before allowing any account to install it.

## 5. Beta acceptance test

1. Sign in as creator A and install the GitHub App on one selected repository.
2. Import one non-sensitive Markdown file; confirm it begins preview-only.
3. Sign in as creator B; confirm A's installation, repository, and source are not visible.
4. Suspend or uninstall the GitHub App; confirm repository listing/import fails.
5. Reinstall, import a disposable file, delete its Creator Agent source, and verify its imported-content row is erased.
6. Confirm `/health` still reports `aiCalls: 0` and that no AI-provider request appears in service logs.

Do not use real confidential content during beta verification. Free service sleeping and absence of a formal backup/SLA make this unsuitable for production user data.
