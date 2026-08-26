# Managed authentication

Creator Agent uses Auth0 as its first managed OpenID Connect provider. The responsive simulator integrates the official Auth0 React SDK, which uses Universal Login and the Authorization Code flow with PKCE.

## What is implemented

- Login redirect through Auth0 Universal Login
- Logout with an allowlisted return URL
- Loading, unauthenticated, authenticated, provider-error, and configuration-error states
- Stable creator identity derived from the OIDC `sub` claim
- Protected `/v1/me` API with signature, issuer, audience, expiration, algorithm, subject, and scope validation
- Durable internal creator identity keyed by `(issuer, sub)`
- Display name, email, and profile image used only for presentation
- SDK token cache held in memory rather than browser local storage
- Production failure when Auth0 settings are absent or local authentication is requested
- Explicit local developer session for the zero-cost simulator

The local session is a development convenience, not an identity provider. It returns no access token and is rejected by production builds.

## Create the Auth0 application

1. Create or open an Auth0 tenant.
2. Create an application with type **Single Page Application**.
3. Confirm OIDC conformance and `RS256` signing in the application settings.
4. Add the exact local origin to all three application URL settings:
   - Allowed Callback URLs: `http://127.0.0.1:4173`
   - Allowed Logout URLs: `http://127.0.0.1:4173`
   - Allowed Web Origins: `http://127.0.0.1:4173`
5. For each deployed environment, add its exact HTTPS origin. Do not use wildcard production callback URLs.
6. Create a custom API, add a `read:creator` permission, and authorize the SPA to request it.

Auth0 documents these settings in its [React SPA quickstart](https://auth0.com/docs/quickstart/spa/react) and [application settings reference](https://auth0.com/docs/get-started/applications/application-settings).

## Configure the simulator

Copy `apps/simulator/.env.example` to `apps/simulator/.env.local`, then set:

```dotenv
VITE_AUTH_MODE=auth0
VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=your_spa_client_id
VITE_AUTH0_AUDIENCE=https://api.creator-agent.example
VITE_CREATOR_API_URL=http://127.0.0.1:4320
```

Restart `npm run dev`, open `http://127.0.0.1:4173`, and choose **Continue with Auth0**.

The domain and SPA client ID are public client configuration. Never put an Auth0 client secret, Management API token, user access token, or signing key in a `VITE_*` variable; Vite embeds those values into browser code.

## Local development mode

With no authentication environment variables, `npm run dev` uses an explicit local session so contributors can run the simulator without an Auth0 account:

```dotenv
VITE_AUTH_MODE=local
```

The header labels this as **Local session**. Signing out shows the local authentication gate. Production builds fail closed if `local` is configured.

## Protected API configuration

The Creator Agent API is implemented as the first server-side slice:

1. Register the API in Auth0 and choose a unique identifier, such as `https://api.creator-agent.example`.
2. Set that identifier as `VITE_AUTH0_AUDIENCE` in the SPA.
3. Add the Auth0 permission `read:creator` and authorize the SPA to request it.
4. Configure `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, `DATABASE_URL`, and the exact browser origin on the API.
5. Apply the identity migration and start the API as described in [API.md](API.md).

The SPA sends the access token in the `Authorization: Bearer` header. The API validates signature, issuer, audience, expiration, `RS256`, subject, and scope using the operator-configured tenant JWKS. It then resolves an internal user by `(issuer, sub)`; the browser never supplies the owner ID.

The client-side route guard improves user experience but is not an authorization boundary. Every API and object-storage operation must enforce authorization server-side. Email addresses, display names, and client-supplied owner IDs must never be used as proof of ownership.

## Security decisions

- Authorization Code with PKCE; no implicit flow
- Universal Login; the app never handles passwords
- In-memory token cache; no application-managed token persistence
- Stable `(issuer, sub)` identity; email is mutable profile data
- Dedicated `read:creator` API permission
- Server-derived opaque creator UUID; no client-supplied owner identity
- Exact callback, logout, and web-origin allowlists
- Local authentication unavailable in production
- No client secret in the SPA
- No authentication tokens in logs, analytics, crash reports, URLs, or application state

## Acceptance checks

```bash
npm run check
```

The suite verifies configuration fail-closed behavior, local session gating, valid and invalid JWT claims, insufficient scope, stable ownership mapping, cross-creator access rejection, and all existing privacy and routing behavior.

Before production launch, add integration tests against a dedicated non-production Auth0 tenant. Unit tests already cover valid, expired, wrong-issuer, wrong-audience, malformed, and insufficient-scope tokens without contacting Auth0.
