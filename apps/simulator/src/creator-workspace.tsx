import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Database, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCreatorAuth, type AuthMode } from "./auth";

export type DurableSourceVisibility = "preview" | "public" | "disabled";
export type DurableSourceType = "document" | "audio" | "video";
export type DurableStylePreset = "warm" | "direct" | "curious" | "custom";
export type DurableResponseLength = "short" | "balanced" | "deep";

export interface DurableAgentConfiguration {
  instructions: string;
  tone: string;
  boundaries: string[];
  stylePreset: DurableStylePreset;
  responseLength: DurableResponseLength;
  signaturePhrases: string[];
  prohibitedTopics: string[];
  greeting: string;
}

export interface DurableAgent {
  id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "unpublished";
  configurationVersion: number;
  configuration: DurableAgentConfiguration;
  createdAt: string;
  updatedAt: string;
}

export interface DurableSource {
  id: string;
  agentId: string;
  title: string;
  type: DurableSourceType;
  status: "awaiting_upload" | "uploaded" | "scanning" | "processing" | "ready" | "failed" | "deleting";
  visibility: DurableSourceVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface DurableGitHubInstallation {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  suspended: boolean;
  status: "active" | "suspended" | "revoked";
  createdAt: string;
  updatedAt: string;
}

export interface DurableGitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface CreatorApiConfiguration {
  mode: AuthMode;
  baseUrl?: string;
  error?: string;
}

interface CreatorApiEnvironment {
  VITE_CREATOR_API_URL?: string;
}

interface CreatorProfile {
  id: string;
  createdAt: string;
  lastSeenAt: string;
}

interface CreatorWorkspace {
  creatorId?: string;
  agent?: DurableAgent;
  sources: DurableSource[];
  githubInstallations: DurableGitHubInstallation[];
  isPersistent: boolean;
  isLoading: boolean;
  error?: string;
  saveAgent: (patch: Partial<DurableAgentConfiguration>) => Promise<DurableAgent | null>;
  createSource: (input: { title: string; type: DurableSourceType }) => Promise<DurableSource | null>;
  uploadVideo: (input: { title: string; file: File }) => Promise<DurableSource | null>;
  setSourceVisibility: (sourceId: string, visibility: DurableSourceVisibility) => Promise<DurableSource | null>;
  deleteSource: (sourceId: string) => Promise<void>;
  connectGitHub: () => Promise<string>;
  listGitHubRepositories: (installationId: number) => Promise<DurableGitHubRepository[]>;
  importGitHubSource: (input: {
    installationId: number;
    title: string;
    repositoryOwner: string;
    repositoryName: string;
    path: string;
    ref?: string;
  }) => Promise<{ source: DurableSource; content: string }>;
}

interface RemoteWorkspaceState {
  creatorId?: string;
  agent?: DurableAgent;
  sources: DurableSource[];
  githubInstallations: DurableGitHubInstallation[];
  isLoading: boolean;
  error?: string;
}

export const DEFAULT_DURABLE_AGENT = {
  name: "Ari's Creative Coach",
  description: "Practical guidance for building an audience and a sustainable creative practice.",
  instructions: "Use only creator-approved sources. Abstain when the approved library does not support an answer.",
  tone: "Warm, concise, encouraging, and specific",
  boundaries: ["Stay within approved sources. Never invent private opinions, personal details, or financial advice."],
  stylePreset: "warm" as const,
  responseLength: "balanced" as const,
  signaturePhrases: ["Make the next step small enough to start."],
  prohibitedTopics: ["Individual financial advice", "Private relationships"],
  greeting: "What are you trying to create this week?",
};

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
    if (url.origin !== rawBaseUrl || (url.protocol !== "https:" && !localHttp)) throw new Error();
    return { mode, baseUrl: url.origin };
  } catch {
    return { mode, error: "VITE_CREATOR_API_URL must be an exact HTTPS origin (localhost HTTP is allowed in development)." };
  }
}

async function creatorApiRequest({
  baseUrl,
  path,
  method = "GET",
  body,
  getAccessToken,
  fetcher = fetch,
}: {
  baseUrl: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error("The identity provider did not issue an API access token.");
  const response = await fetcher(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === "string") detail = payload.error;
    } catch {
      // Authentication and infrastructure failures may not have JSON bodies.
    }
    throw new Error(
      response.status === 401
        ? "The API rejected this login session."
        : detail || "The creator API is unavailable.",
    );
  }
  return response.json() as Promise<unknown>;
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
  const body = await creatorApiRequest({ baseUrl, path: "/v1/me", getAccessToken, fetcher }) as {
    creator?: Partial<CreatorProfile>;
  };
  if (
    typeof body.creator?.id !== "string" ||
    typeof body.creator.createdAt !== "string" ||
    typeof body.creator.lastSeenAt !== "string"
  ) throw new Error("The creator API returned an invalid profile.");
  return body.creator as CreatorProfile;
}

export async function openCreatorWorkspace({
  baseUrl,
  getAccessToken,
  fetcher = fetch,
}: {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}) {
  const profile = await fetchCreatorProfile({ baseUrl, getAccessToken, fetcher });
  const listed = await creatorApiRequest({
    baseUrl,
    path: "/v1/agents",
    getAccessToken,
    fetcher,
  }) as { agents?: unknown };
  if (!Array.isArray(listed.agents)) throw new Error("The creator API returned an invalid agent list.");
  let agent = listed.agents.length > 0 ? durableAgent(listed.agents[0]) : undefined;
  if (!agent) {
    const created = await creatorApiRequest({
      baseUrl,
      path: "/v1/agents",
      method: "POST",
      body: DEFAULT_DURABLE_AGENT,
      getAccessToken,
      fetcher,
    }) as { agent?: unknown };
    agent = durableAgent(created.agent);
  }
  const listedSources = await creatorApiRequest({
    baseUrl,
    path: `/v1/agents/${encodeURIComponent(agent.id)}/sources`,
    getAccessToken,
    fetcher,
  }) as { sources?: unknown };
  if (!Array.isArray(listedSources.sources)) throw new Error("The creator API returned an invalid source list.");
  let githubInstallations: DurableGitHubInstallation[] = [];
  try {
    const github = await creatorApiRequest({
      baseUrl,
      path: "/v1/github/installations",
      getAccessToken,
      fetcher,
    }) as { installations?: unknown };
    if (Array.isArray(github.installations)) githubInstallations = github.installations.map(durableGitHubInstallation);
  } catch {
    // GitHub is an optional integration and must not prevent the creator workspace from opening.
  }
  return {
    profile,
    agent,
    sources: listedSources.sources.map(durableSource),
    githubInstallations,
  };
}

interface CreatorApiCallOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

export async function saveDurableAgent(
  options: CreatorApiCallOptions & { agentId: string; patch: Partial<DurableAgentConfiguration> },
) {
  const result = await creatorApiRequest({
    ...options,
    path: `/v1/agents/${encodeURIComponent(options.agentId)}`,
    method: "PATCH",
    body: options.patch,
  }) as { agent?: unknown };
  return durableAgent(result.agent);
}

export async function createDurableSource(
  options: CreatorApiCallOptions & { agentId: string; input: { title: string; type: DurableSourceType } },
) {
  const result = await creatorApiRequest({
    ...options,
    path: `/v1/agents/${encodeURIComponent(options.agentId)}/sources`,
    method: "POST",
    body: options.input,
  }) as { source?: unknown };
  return durableSource(result.source);
}

export async function saveDurableSourceVisibility(
  options: CreatorApiCallOptions & { agentId: string; sourceId: string; visibility: DurableSourceVisibility },
) {
  const result = await creatorApiRequest({
    ...options,
    path: `/v1/agents/${encodeURIComponent(options.agentId)}/sources/${encodeURIComponent(options.sourceId)}`,
    method: "PATCH",
    body: { visibility: options.visibility },
  }) as { source?: unknown };
  return durableSource(result.source);
}

export async function deleteDurableSource(
  options: CreatorApiCallOptions & { agentId: string; sourceId: string },
) {
  await creatorApiRequest({
    ...options,
    path: `/v1/agents/${encodeURIComponent(options.agentId)}/sources/${encodeURIComponent(options.sourceId)}`,
    method: "DELETE",
  });
}

export async function uploadDurableVideo(
  options: CreatorApiCallOptions & { agentId: string; title: string; file: File },
) {
  const authorized = await creatorApiRequest({
    ...options,
    path: `/v1/agents/${encodeURIComponent(options.agentId)}/sources/uploads`,
    method: "POST",
    body: {
      title: options.title,
      fileName: options.file.name,
      contentType: options.file.type,
      size: options.file.size,
    },
  }) as { source?: unknown; upload?: unknown };
  const source = durableSource(authorized.source);
  try {
    const upload = uploadPolicy(authorized.upload);
    const form = new FormData();
    for (const [field, value] of Object.entries(upload.fields)) form.append(field, value);
    form.append("file", options.file);
    const uploaded = await (options.fetcher ?? fetch)(upload.url, { method: "POST", body: form });
    if (!uploaded.ok) throw new Error("Private object storage rejected the video upload.");
    const completed = await creatorApiRequest({
      ...options,
      path: `/v1/agents/${encodeURIComponent(options.agentId)}/sources/${encodeURIComponent(source.id)}/complete`,
      method: "POST",
    }) as { source?: unknown };
    return durableSource(completed.source);
  } catch (error) {
    try {
      await deleteDurableSource({ ...options, agentId: options.agentId, sourceId: source.id });
    } catch {
      // The server has its own deletion/retention controls; preserve the original upload failure.
    }
    throw error;
  }
}

export async function beginGitHubConnection(options: CreatorApiCallOptions) {
  const result = await creatorApiRequest({
    ...options,
    path: "/v1/github/connect",
    method: "POST",
  }) as { installationUrl?: unknown };
  if (typeof result.installationUrl !== "string") throw new Error("The creator API returned an invalid GitHub installation URL.");
  const url = new URL(result.installationUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error("The creator API returned an unsafe GitHub installation URL.");
  return url.toString();
}

export async function listDurableGitHubRepositories(
  options: CreatorApiCallOptions & { installationId: number },
) {
  const result = await creatorApiRequest({
    ...options,
    path: `/v1/github/installations/${options.installationId}/repositories`,
  }) as { repositories?: unknown };
  if (!Array.isArray(result.repositories)) throw new Error("The creator API returned an invalid GitHub repository list.");
  return result.repositories.map(durableGitHubRepository);
}

export async function importDurableGitHubSource(
  options: CreatorApiCallOptions & {
    agentId: string;
    input: {
      installationId: number;
      title: string;
      repositoryOwner: string;
      repositoryName: string;
      path: string;
      ref?: string;
    };
  },
) {
  const result = await creatorApiRequest({
    ...options,
    path: `/v1/agents/${encodeURIComponent(options.agentId)}/sources/github`,
    method: "POST",
    body: options.input,
  }) as { source?: unknown; content?: unknown };
  if (typeof result.content !== "string") throw new Error("The creator API returned invalid GitHub source content.");
  return { source: durableSource(result.source), content: result.content };
}

export function CreatorWorkspaceProvider({
  children,
  configuration,
}: {
  children: ReactNode;
  configuration: CreatorApiConfiguration;
}) {
  const auth = useCreatorAuth();
  const [remote, setRemote] = useState<RemoteWorkspaceState>({
    isLoading: auth.mode === "auth0",
    sources: [],
    githubInstallations: [],
  });

  useEffect(() => {
    if (auth.mode === "local" || configuration.error || !configuration.baseUrl) return;
    let current = true;
    setRemote({ isLoading: true, sources: [], githubInstallations: [] });
    void openCreatorWorkspace({
      baseUrl: configuration.baseUrl,
      getAccessToken: auth.getAccessToken,
    }).then(
      (workspace) => current && setRemote({
        creatorId: workspace.profile.id,
        agent: workspace.agent,
        sources: workspace.sources,
        githubInstallations: workspace.githubInstallations,
        isLoading: false,
      }),
      (error: unknown) => current && setRemote({
        isLoading: false,
        sources: [],
        githubInstallations: [],
        error: error instanceof Error ? error.message : "The creator API is unavailable.",
      }),
    );
    return () => { current = false; };
  }, [auth.getAccessToken, auth.mode, configuration.baseUrl, configuration.error]);

  const value = useMemo<CreatorWorkspace>(() => {
    if (configuration.error) return unavailableWorkspace(configuration.error);
    if (auth.mode === "local") return {
      creatorId: auth.user?.id,
      sources: [],
      githubInstallations: [],
      isPersistent: false,
      isLoading: false,
      saveAgent: async () => null,
      createSource: async () => null,
      uploadVideo: async () => null,
      setSourceVisibility: async () => null,
      deleteSource: async () => undefined,
      connectGitHub: async () => { throw new Error("GitHub connection requires managed authentication."); },
      listGitHubRepositories: async () => [],
      importGitHubSource: async () => { throw new Error("GitHub import requires managed authentication."); },
    };
    const apiOptions = {
      baseUrl: configuration.baseUrl!,
      getAccessToken: auth.getAccessToken,
    };
    return {
      ...remote,
      isPersistent: true,
      saveAgent: async (patch) => {
        if (!remote.agent) throw new Error("No durable agent is open.");
        const agent = await saveDurableAgent({ ...apiOptions, agentId: remote.agent.id, patch });
        setRemote((current) => ({ ...current, agent }));
        return agent;
      },
      createSource: async (input) => {
        if (!remote.agent) throw new Error("No durable agent is open.");
        const source = await createDurableSource({ ...apiOptions, agentId: remote.agent.id, input });
        setRemote((current) => ({ ...current, sources: [source, ...current.sources] }));
        return source;
      },
      uploadVideo: async (input) => {
        if (!remote.agent) throw new Error("No durable agent is open.");
        const source = await uploadDurableVideo({
          ...apiOptions,
          agentId: remote.agent.id,
          title: input.title,
          file: input.file,
        });
        setRemote((current) => ({ ...current, sources: [source, ...current.sources] }));
        return source;
      },
      setSourceVisibility: async (sourceId, visibility) => {
        if (!remote.agent) throw new Error("No durable agent is open.");
        const source = await saveDurableSourceVisibility({
          ...apiOptions,
          agentId: remote.agent.id,
          sourceId,
          visibility,
        });
        setRemote((current) => ({
          ...current,
          sources: current.sources.map((item) => item.id === source.id ? source : item),
        }));
        return source;
      },
      deleteSource: async (sourceId) => {
        if (!remote.agent) throw new Error("No durable agent is open.");
        await deleteDurableSource({ ...apiOptions, agentId: remote.agent.id, sourceId });
        setRemote((current) => ({
          ...current,
          sources: current.sources.filter((source) => source.id !== sourceId),
        }));
      },
      connectGitHub: async () => beginGitHubConnection(apiOptions),
      listGitHubRepositories: async (installationId) => listDurableGitHubRepositories({
        ...apiOptions,
        installationId,
      }),
      importGitHubSource: async (input) => {
        if (!remote.agent) throw new Error("No durable agent is open.");
        const imported = await importDurableGitHubSource({
          ...apiOptions,
          agentId: remote.agent.id,
          input,
        });
        setRemote((current) => ({ ...current, sources: [imported.source, ...current.sources] }));
        return imported;
      },
    };
  }, [auth.getAccessToken, auth.mode, auth.user?.id, configuration.baseUrl, configuration.error, remote]);

  return <CreatorWorkspaceContext.Provider value={value}>{children}</CreatorWorkspaceContext.Provider>;
}

function unavailableWorkspace(error: string): CreatorWorkspace {
  return {
    isLoading: false,
    isPersistent: false,
    sources: [],
    githubInstallations: [],
    error,
    saveAgent: async () => null,
    createSource: async () => null,
    uploadVideo: async () => null,
    setSourceVisibility: async () => null,
    deleteSource: async () => undefined,
    connectGitHub: async () => { throw new Error("GitHub App integration is unavailable."); },
    listGitHubRepositories: async () => [],
    importGitHubSource: async () => { throw new Error("GitHub App integration is unavailable."); },
  };
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

function durableAgent(value: unknown): DurableAgent {
  if (!value || typeof value !== "object") throw new Error("The creator API returned an invalid agent.");
  const agent = value as Partial<DurableAgent>;
  const configuration = agent.configuration as Partial<DurableAgentConfiguration> | undefined;
  if (
    typeof agent.id !== "string" || typeof agent.name !== "string" ||
    typeof agent.description !== "string" || typeof agent.configurationVersion !== "number" ||
    (agent.status !== "draft" && agent.status !== "published" && agent.status !== "unpublished") ||
    typeof agent.createdAt !== "string" || typeof agent.updatedAt !== "string" ||
    !configuration || typeof configuration.instructions !== "string" ||
    typeof configuration.tone !== "string" || !stringArray(configuration.boundaries) ||
    !stringArray(configuration.signaturePhrases) || !stringArray(configuration.prohibitedTopics) ||
    (configuration.stylePreset !== "warm" && configuration.stylePreset !== "direct" &&
      configuration.stylePreset !== "curious" && configuration.stylePreset !== "custom") ||
    (configuration.responseLength !== "short" && configuration.responseLength !== "balanced" &&
      configuration.responseLength !== "deep") ||
    typeof configuration.greeting !== "string"
  ) throw new Error("The creator API returned an invalid agent.");
  return agent as DurableAgent;
}

function durableSource(value: unknown): DurableSource {
  if (!value || typeof value !== "object") throw new Error("The creator API returned an invalid source.");
  const source = value as Partial<DurableSource>;
  if (
    typeof source.id !== "string" || typeof source.agentId !== "string" ||
    typeof source.title !== "string" ||
    (source.type !== "document" && source.type !== "audio" && source.type !== "video") ||
    (source.status !== "awaiting_upload" && source.status !== "uploaded" && source.status !== "scanning" &&
      source.status !== "processing" && source.status !== "ready" &&
      source.status !== "failed" && source.status !== "deleting") ||
    (source.visibility !== "preview" && source.visibility !== "public" && source.visibility !== "disabled") ||
    typeof source.createdAt !== "string" || typeof source.updatedAt !== "string"
  ) throw new Error("The creator API returned an invalid source.");
  return source as DurableSource;
}

function durableGitHubInstallation(value: unknown): DurableGitHubInstallation {
  if (!value || typeof value !== "object") throw new Error("The creator API returned an invalid GitHub installation.");
  const installation = value as Partial<DurableGitHubInstallation>;
  if (
    typeof installation.id !== "number" || !Number.isSafeInteger(installation.id) || installation.id <= 0 ||
    typeof installation.accountLogin !== "string" ||
    (installation.accountType !== "User" && installation.accountType !== "Organization") ||
    (installation.repositorySelection !== "all" && installation.repositorySelection !== "selected") ||
    typeof installation.suspended !== "boolean" ||
    (installation.status !== "active" && installation.status !== "suspended" && installation.status !== "revoked") ||
    typeof installation.createdAt !== "string" || typeof installation.updatedAt !== "string"
  ) throw new Error("The creator API returned an invalid GitHub installation.");
  return installation as DurableGitHubInstallation;
}

function durableGitHubRepository(value: unknown): DurableGitHubRepository {
  if (!value || typeof value !== "object") throw new Error("The creator API returned an invalid GitHub repository.");
  const repository = value as Partial<DurableGitHubRepository>;
  if (
    typeof repository.id !== "number" || !Number.isSafeInteger(repository.id) || repository.id <= 0 ||
    typeof repository.owner !== "string" || typeof repository.name !== "string" ||
    typeof repository.fullName !== "string" || typeof repository.private !== "boolean" ||
    typeof repository.defaultBranch !== "string"
  ) throw new Error("The creator API returned an invalid GitHub repository.");
  return repository as DurableGitHubRepository;
}

function uploadPolicy(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("The creator API returned an invalid upload policy.");
  const policy = value as { url?: unknown; fields?: unknown; expiresAt?: unknown };
  if (
    typeof policy.url !== "string" || !policy.fields || typeof policy.fields !== "object" ||
    Array.isArray(policy.fields) || typeof policy.expiresAt !== "string" ||
    !Object.values(policy.fields).every((field) => typeof field === "string")
  ) throw new Error("The creator API returned an invalid upload policy.");
  const destination = new URL(policy.url);
  const localHttp = destination.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(destination.hostname);
  if (destination.protocol !== "https:" && !localHttp) {
    throw new Error("The creator API returned an unsafe upload destination.");
  }
  return policy as { url: string; fields: Record<string, string>; expiresAt: string };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
