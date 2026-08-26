import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { LockKeyhole, LogIn, ShieldAlert, ShieldCheck } from "lucide-react";

export type AuthMode = "local" | "auth0";

export interface CreatorIdentity {
  id: string;
  name: string;
  email?: string;
  picture?: string;
  initials: string;
}

export interface AuthConfiguration {
  mode: AuthMode;
  domain?: string;
  clientId?: string;
  audience?: string;
  error?: string;
}

interface AuthEnvironment {
  VITE_AUTH_MODE?: string;
  VITE_AUTH0_DOMAIN?: string;
  VITE_AUTH0_CLIENT_ID?: string;
  VITE_AUTH0_AUDIENCE?: string;
}

interface CreatorAuthSession {
  mode: AuthMode;
  isLoading: boolean;
  isAuthenticated: boolean;
  user?: CreatorIdentity;
  error?: string;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const LOCAL_SESSION_KEY = "creator-agent.local-auth";
const LOCAL_IDENTITY: CreatorIdentity = {
  id: "local|creator-demo",
  name: "Ari Creator",
  email: "ari@example.test",
  initials: "AC",
};

const CreatorAuthContext = createContext<CreatorAuthSession | undefined>(undefined);

function clean(value?: string) {
  return value?.trim() || undefined;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CA";
}

export function resolveAuthConfiguration(
  environment: AuthEnvironment,
  isDevelopment: boolean,
): AuthConfiguration {
  const requestedMode = clean(environment.VITE_AUTH_MODE);
  if (requestedMode && requestedMode !== "local" && requestedMode !== "auth0") {
    return { mode: "auth0", error: "VITE_AUTH_MODE must be either auth0 or local." };
  }

  const mode = (requestedMode ?? (isDevelopment ? "local" : "auth0")) as AuthMode;
  if (mode === "local") {
    return isDevelopment
      ? { mode }
      : { mode, error: "Local authentication is disabled in production builds." };
  }

  const domain = clean(environment.VITE_AUTH0_DOMAIN);
  const clientId = clean(environment.VITE_AUTH0_CLIENT_ID);
  const audience = clean(environment.VITE_AUTH0_AUDIENCE);
  if (!domain || !clientId || !audience) {
    return {
      mode,
      error: "Auth0 is enabled but its domain, client ID, or API audience is missing.",
    };
  }

  return {
    mode,
    domain,
    clientId,
    audience,
  };
}

export function useCreatorAuth() {
  const session = useContext(CreatorAuthContext);
  if (!session) throw new Error("useCreatorAuth must be used inside CreatorAuthProvider.");
  return session;
}

export function LocalAuthProvider({
  children,
  initialAuthenticated,
}: {
  children: ReactNode;
  initialAuthenticated?: boolean;
}) {
  const [isAuthenticated, setAuthenticated] = useState(() => {
    if (initialAuthenticated !== undefined) return initialAuthenticated;
    if (typeof sessionStorage === "undefined") return true;
    return sessionStorage.getItem(LOCAL_SESSION_KEY) !== "signed-out";
  });

  const value = useMemo<CreatorAuthSession>(() => ({
    mode: "local",
    isLoading: false,
    isAuthenticated,
    user: isAuthenticated ? LOCAL_IDENTITY : undefined,
    login: async () => {
      sessionStorage.setItem(LOCAL_SESSION_KEY, "signed-in");
      setAuthenticated(true);
    },
    logout: async () => {
      sessionStorage.setItem(LOCAL_SESSION_KEY, "signed-out");
      setAuthenticated(false);
    },
    getAccessToken: async () => null,
  }), [isAuthenticated]);

  return <CreatorAuthContext.Provider value={value}>{children}</CreatorAuthContext.Provider>;
}

function Auth0SessionProvider({ children }: { children: ReactNode }) {
  const auth0 = useAuth0();
  const value = useMemo<CreatorAuthSession>(() => {
    const subject = auth0.user?.sub;
    const displayName = auth0.user?.name || auth0.user?.nickname || auth0.user?.email || "Creator";
    const user = subject ? {
      id: subject,
      name: displayName,
      email: auth0.user?.email,
      picture: auth0.user?.picture,
      initials: initials(displayName),
    } : undefined;

    return {
      mode: "auth0",
      isLoading: auth0.isLoading,
      isAuthenticated: auth0.isAuthenticated && Boolean(subject),
      user,
      error: auth0.error?.message,
      login: async () => auth0.loginWithRedirect({
        appState: { returnTo: window.location.pathname },
      }),
      logout: async () => {
        await auth0.logout({ logoutParams: { returnTo: window.location.origin } });
      },
      getAccessToken: async () => auth0.getAccessTokenSilently(),
    };
  }, [auth0]);

  return <CreatorAuthContext.Provider value={value}>{children}</CreatorAuthContext.Provider>;
}

export function CreatorAuthProvider({
  children,
  configuration,
}: {
  children: ReactNode;
  configuration: AuthConfiguration;
}) {
  if (configuration.error) {
    return <AuthState icon={<ShieldAlert />} title="Authentication configuration required" detail={configuration.error} />;
  }

  if (configuration.mode === "local") {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }

  return (
    <Auth0Provider
      domain={configuration.domain!}
      clientId={configuration.clientId!}
      cacheLocation="memory"
      useRefreshTokens={false}
      authorizationParams={{
        redirect_uri: window.location.origin,
        scope: "openid profile email read:creator write:agent",
        ...(configuration.audience ? { audience: configuration.audience } : {}),
      }}
    >
      <Auth0SessionProvider>{children}</Auth0SessionProvider>
    </Auth0Provider>
  );
}

function AuthState({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-mark">{icon}</div>
        <div className="eyebrow"><LockKeyhole /> Protected creator workspace</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {action}
        <div className="auth-assurance"><ShieldCheck /> OIDC Authorization Code with PKCE · tokens held in memory</div>
      </section>
    </main>
  );
}

export function RequireAuthentication({ children }: { children: ReactNode }) {
  const session = useCreatorAuth();
  if (session.isLoading) {
    return <AuthState icon={<ShieldCheck />} title="Verifying your session" detail="Checking the identity provider before opening the creator workspace." />;
  }
  if (session.error) {
    return <AuthState icon={<ShieldAlert />} title="Authentication could not be completed" detail={session.error} />;
  }
  if (!session.isAuthenticated || !session.user) {
    return (
      <AuthState
        icon={<LockKeyhole />}
        title="Sign in to Creator Agent"
        detail={session.mode === "local" ? "Start an explicit local developer session. This mode is unavailable in production." : "Continue through the managed Auth0 Universal Login page."}
        action={<button className="button primary auth-action" type="button" onClick={() => void session.login()}><LogIn /> {session.mode === "local" ? "Start local session" : "Continue with Auth0"}</button>}
      />
    );
  }
  return children;
}
