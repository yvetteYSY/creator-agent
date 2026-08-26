import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Database, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCreatorAuth, type AuthMode } from "./auth";

export interface CreatorApiConfiguration {
  mode: AuthMode;
  baseUrl?: string;
  error?: string;
}

interface CreatorApiEnvironment {
  VITE_CREATOR_API_URL?: string;
}

interface CreatorWorkspace {
  creatorId?: string;
  isLoading: boolean;
  error?: string;
}

interface CreatorProfile {
  id: string;
  createdAt: string;
  lastSeenAt: string;
}

const CreatorWorkspaceContext = createContext<CreatorWorkspace | undefined>(undefined);

export function resolveCreatorApiConfiguration(
  environment: CreatorApiEnvironment,
  mode: AuthMode,
  isDevelopment: boolean,
): CreatorApiConfiguration {
  if (mode === "local") return { mode };
  const rawBaseUrl = environment.VITE_CREATOR_API_URL?.trim();
  if (!rawBaseUrl) return { mode, error: "VITE_CREATOR_API_URL is required with Auth0 authentication." };
  try {
    const url = new URL(rawBaseUrl);
    const localHttp = isDevelopment && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.origin !== rawBaseUrl || (url.protocol !== "https:" && !localHttp)) {
      throw new Error();
    }
    return { mode, baseUrl: url.origin };
  } catch {
    return { mode, error: "VITE_CREATOR_API_URL must be an exact HTTPS origin (localhost HTTP is allowed in development)." };
  }
}

export async function fetchCreatorProfile({
  baseUrl,
  getAccessToken,
  fetcher = fetch,
}: {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}): Promise<CreatorProfile> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error("The identity provider did not issue an API access token.");
  const response = await fetcher(`${baseUrl}/v1/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 401 ? "The API rejected this login session." : "The creator API is unavailable.");
  const body = await response.json() as { creator?: Partial<CreatorProfile> };
  if (
    typeof body.creator?.id !== "string" ||
    typeof body.creator.createdAt !== "string" ||
    typeof body.creator.lastSeenAt !== "string"
  ) {
    throw new Error("The creator API returned an invalid profile.");
  }
  return body.creator as CreatorProfile;
}

export function CreatorWorkspaceProvider({
  children,
  configuration,
}: {
  children: ReactNode;
  configuration: CreatorApiConfiguration;
}) {
  const auth = useCreatorAuth();
  const [remote, setRemote] = useState<CreatorWorkspace>({ isLoading: auth.mode === "auth0" });

  useEffect(() => {
    if (auth.mode === "local" || configuration.error || !configuration.baseUrl) return;
    let current = true;
    setRemote({ isLoading: true });
    void fetchCreatorProfile({
      baseUrl: configuration.baseUrl,
      getAccessToken: auth.getAccessToken,
    }).then(
      (profile) => current && setRemote({ creatorId: profile.id, isLoading: false }),
      (error: unknown) => current && setRemote({
        isLoading: false,
        error: error instanceof Error ? error.message : "The creator API is unavailable.",
      }),
    );
    return () => { current = false; };
  }, [auth.getAccessToken, auth.mode, configuration.baseUrl, configuration.error]);

  const value = useMemo<CreatorWorkspace>(() => {
    if (configuration.error) return { isLoading: false, error: configuration.error };
    if (auth.mode === "local") return { creatorId: auth.user?.id, isLoading: false };
    return remote;
  }, [auth.mode, auth.user?.id, configuration.error, remote]);

  return <CreatorWorkspaceContext.Provider value={value}>{children}</CreatorWorkspaceContext.Provider>;
}

export function useCreatorWorkspace() {
  const workspace = useContext(CreatorWorkspaceContext);
  if (!workspace) throw new Error("useCreatorWorkspace must be used inside CreatorWorkspaceProvider.");
  return workspace;
}

export function RequireCreatorWorkspace({ children }: { children: ReactNode }) {
  const workspace = useCreatorWorkspace();
  if (workspace.isLoading) {
    return <WorkspaceState icon={<Database />} title="Opening your creator workspace" detail="Validating API access and resolving your private creator record." />;
  }
  if (workspace.error || !workspace.creatorId) {
    return <WorkspaceState icon={<ShieldAlert />} title="Creator workspace unavailable" detail={workspace.error ?? "No creator identity was returned."} />;
  }
  return children;
}

function WorkspaceState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-mark">{icon}</div>
        <div className="eyebrow"><ShieldCheck /> Server-authorized workspace</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        <div className="auth-assurance"><ShieldCheck /> Ownership comes from a server-verified access token</div>
      </section>
    </main>
  );
}
