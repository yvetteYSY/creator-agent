import { useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleGauge,
  Cable,
  Clock3,
  FileText,
  Film,
  FlaskConical,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Mic2,
  Palette,
  Plus,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  CreatorAgentEngine,
  CreatorAgentError,
  invokeRemoteAgent,
  simulateConcurrentChat,
  type Agent,
  type Conversation,
  type ResponseLength,
  type Source,
  type SourceKind,
  type SourceVisibility,
  type StylePreset,
} from "@creator-agent/core";
import { useCreatorAuth } from "./auth";
import { useCreatorWorkspace } from "./creator-workspace";

type View = "studio" | "customize" | "preview" | "routing" | "load";
type AudienceId = "maya" | "theo" | "jules";
type AgentRoute =
  | { mode: "local" }
  | { mode: "remote"; endpoint: string; bearerToken: string };

const AUDIENCE: Array<{ id: AudienceId; name: string; color: string }> = [
  { id: "maya", name: "Maya", color: "coral" },
  { id: "theo", name: "Theo", color: "blue" },
  { id: "jules", name: "Jules", color: "gold" },
];

function createRuntime(ownerId: string) {
  const engine = new CreatorAgentEngine();
  const agent = engine.createAgent({
    ownerId,
    name: "Ari's Creative Coach",
    handle: "ari-creates",
    description:
      "Practical guidance for building an audience and a sustainable creative practice.",
    tone: "Warm, concise, encouraging, and specific",
    stylePreset: "warm",
    responseLength: "balanced",
    signaturePhrases: ["Make the next step small enough to start."],
    prohibitedTopics: ["Individual financial advice", "Private relationships"],
    boundaries:
      "Stay within approved sources. Never invent private opinions, personal details, or financial advice.",
    greeting: "What are you trying to create this week?",
  });

  engine.addSource({
    ownerId,
    agentId: agent.id,
    title: "The Sustainable Content System",
    kind: "document",
    visibility: "public",
    content:
      "Publish one durable idea each week. Write a useful weekly essay before adapting it into other formats. A consistent cadence matters more than daily volume.\n\nTurn the weekly essay into one short video, three conversation prompts, and a newsletter note. Measure meaningful replies and saves instead of chasing raw impressions.\n\nProtect two ninety-minute creation blocks each week. Batch administrative work after the creative work is complete.",
  });
  engine.addSource({
    ownerId,
    agentId: agent.id,
    title: "Audience Research Workshop",
    kind: "video",
    visibility: "public",
    content:
      "The best audience questions use the words people already use. Collect recurring questions from comments and interviews, group them by desired outcome, and create one useful answer for each group.\n\nDo not mistake a large audience for a clear audience. Choose one person, one painful problem, and one promise for the next thirty days.",
  });
  engine.addSource({
    ownerId,
    agentId: agent.id,
    title: "Unreleased launch notes",
    kind: "document",
    visibility: "preview",
    content:
      "This private draft contains unreleased launch dates and partner details. It is available only in creator preview and must never be cited publicly.",
  });
  engine.publishAgent(ownerId, agent.id);

  const conversations = Object.fromEntries(
    AUDIENCE.map(({ id }) => [id, engine.createConversation(agent.id, id).id]),
  ) as Record<AudienceId, string>;

  return { engine, ownerId, agentId: agent.id, conversations };
}

function sourceIcon(kind: SourceKind) {
  if (kind === "video") return <Film aria-hidden="true" />;
  if (kind === "audio") return <Mic2 aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function App() {
  const auth = useCreatorAuth();
  const workspace = useCreatorWorkspace();
  const runtime = useMemo(() => createRuntime(workspace.creatorId!), [workspace.creatorId]);
  const [view, setView] = useState<View>("studio");
  const [route, setRoute] = useState<AgentRoute>({ mode: "local" });
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const agent = runtime.engine.getAgent(runtime.agentId);
  const sources = runtime.engine.listSources(runtime.ownerId, runtime.agentId);

  const refresh = (message?: string) => {
    setRevision((current) => current + 1);
    if (message) setNotice(message);
  };

  return (
    <div className="app-shell" data-revision={revision}>
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setView("studio")}>
          <span className="brand-mark"><Sparkles aria-hidden="true" /></span>
          <span>Creator Agent</span>
          <span className="prototype-label">MVP</span>
        </button>
        <nav aria-label="Primary navigation">
          <NavButton active={view === "studio"} icon={<BookOpen />} onClick={() => setView("studio")}>
            Studio
          </NavButton>
          <NavButton active={view === "customize"} icon={<Palette />} onClick={() => setView("customize")}>
            Customize
          </NavButton>
          <NavButton active={view === "preview"} icon={<MessageCircle />} onClick={() => setView("preview")}>
            Preview
          </NavButton>
          <NavButton active={view === "routing"} icon={<Cable />} onClick={() => setView("routing")}>
            Route
          </NavButton>
          <NavButton active={view === "load"} icon={<FlaskConical />} onClick={() => setView("load")}>
            Load lab
          </NavButton>
        </nav>
        <div className="topbar-actions">
          <span className={route.mode === "local" ? "cost-label" : "cost-label remote"}>
            {route.mode === "local" ? <LockKeyhole aria-hidden="true" /> : <Cable aria-hidden="true" />}
            {route.mode === "local" ? "Local · $0 AI spend" : "User-owned route"}
          </span>
          <span className="auth-label">{auth.mode === "local" ? "Local session" : "Auth0"}</span>
          <div className="creator-account">
            {auth.user!.picture ? <img className="creator-avatar" src={auth.user!.picture} alt="" referrerPolicy="no-referrer" /> : <span className="creator-avatar" aria-hidden="true">{auth.user!.initials}</span>}
            <span className="creator-account-copy"><strong>{auth.user!.name}</strong><small>{auth.user!.email ?? "OIDC account"}</small></span>
            <button className="sign-out" type="button" onClick={() => void auth.logout()} aria-label={`Sign out ${auth.user!.name}`}><LogOut /></button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <Check aria-hidden="true" /> {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      <main>
        {view === "studio" && (
          <Studio
            agent={agent}
            sources={sources}
            onAddSource={(input) => {
              runtime.engine.addSource({
                ownerId: runtime.ownerId,
                agentId: runtime.agentId,
                ...input,
              });
              refresh("Source processed locally and added to the agent.");
            }}
            onStageVideo={(input) => {
              runtime.engine.stageVideoSource({
                ownerId: runtime.ownerId,
                agentId: runtime.agentId,
                ...input,
              });
              refresh("Video staged locally. It will remain unavailable to answers until transcription is configured.");
            }}
            onVisibility={(sourceId, visibility) => {
              runtime.engine.setSourceVisibility(runtime.ownerId, sourceId, visibility);
              refresh(visibility === "public" ? "Source approved for public answers." : "Source moved to preview only.");
            }}
            onDelete={(sourceId) => {
              runtime.engine.deleteSource(runtime.ownerId, sourceId);
              refresh("Source and its simulated derived data were deleted.");
            }}
            onPreview={() => setView("preview")}
            onCustomize={() => setView("customize")}
            onRoute={() => setView("routing")}
          />
        )}
        {view === "customize" && (
          <Customization
            agent={agent}
            onSave={(patch) => {
              runtime.engine.updateAgent(runtime.ownerId, runtime.agentId, patch);
              refresh("Customization saved as a new agent version.");
            }}
            onPreview={() => setView("preview")}
          />
        )}
        {view === "preview" && (
          <Preview
            runtime={runtime}
            route={route}
            onBack={() => setView("studio")}
            onMessage={() => setRevision((current) => current + 1)}
          />
        )}
        {view === "routing" && (
          <Routing route={route} onChange={(nextRoute) => {
            setRoute(nextRoute);
            refresh(nextRoute.mode === "local" ? "Local zero-cost engine activated." : "User-owned agent route activated for new messages.");
          }} />
        )}
        {view === "load" && <LoadLab />}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavButton active={view === "studio"} icon={<BookOpen />} onClick={() => setView("studio")}>Studio</NavButton>
        <NavButton active={view === "customize"} icon={<Palette />} onClick={() => setView("customize")}>Style</NavButton>
        <NavButton active={view === "preview"} icon={<MessageCircle />} onClick={() => setView("preview")}>Preview</NavButton>
        <NavButton active={view === "routing"} icon={<Cable />} onClick={() => setView("routing")}>Route</NavButton>
        <NavButton active={view === "load"} icon={<FlaskConical />} onClick={() => setView("load")}>Load</NavButton>
      </nav>
    </div>
  );
}

function NavButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactElement;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={active ? "nav-button active" : "nav-button"} type="button" onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function Studio({
  agent,
  sources,
  onAddSource,
  onStageVideo,
  onVisibility,
  onDelete,
  onPreview,
  onCustomize,
  onRoute,
}: {
  agent: ReturnType<CreatorAgentEngine["getAgent"]>;
  sources: Source[];
  onAddSource: (input: { title: string; kind: SourceKind; content: string; visibility: SourceVisibility }) => void;
  onStageVideo: (input: { title: string; fileName: string; mimeType: string; size: number; visibility: SourceVisibility }) => void;
  onVisibility: (sourceId: string, visibility: SourceVisibility) => void;
  onDelete: (sourceId: string) => void;
  onPreview: () => void;
  onCustomize: () => void;
  onRoute: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SourceKind>("document");
  const [visibility, setVisibility] = useState<SourceVisibility>("preview");
  const [content, setContent] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (kind === "video") {
        if (!videoFile) throw new Error("Choose an MP4, WebM, or QuickTime video.");
        onStageVideo({
          title,
          fileName: videoFile.name,
          mimeType: videoFile.type,
          size: videoFile.size,
          visibility,
        });
      } else {
        onAddSource({ title, kind, content, visibility });
      }
      setTitle("");
      setContent("");
      setVideoFile(null);
      setVisibility("preview");
      setShowForm(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the source.");
    }
  };

  return (
    <div className="workspace">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><Bot aria-hidden="true" /> Agent studio</div>
          <h1>{agent.name}</h1>
          <p>{agent.description}</p>
        </div>
        <div className="heading-actions">
          <span className="status-chip live"><span /> Published · v{agent.version}</span>
          <button className="button secondary" type="button" onClick={onPreview}>Open audience preview <ChevronRight /></button>
        </div>
      </section>

      <div className="studio-grid">
        <section className="content-panel sources-panel">
          <div className="section-heading">
            <div>
              <h2>Knowledge sources</h2>
              <p>Only approved sources can shape public answers.</p>
            </div>
            <button className="button primary" type="button" onClick={() => setShowForm((current) => !current)}>
              <Plus aria-hidden="true" /> Add source
            </button>
          </div>

          {showForm && (
            <form className="source-form" onSubmit={submit}>
              <div className="form-banner"><LockKeyhole aria-hidden="true" /><span>{kind === "video" ? "The selected file stays in this browser. No bytes are uploaded or sent to a transcription service." : "This prototype processes pasted text in your browser. Nothing is uploaded."}</span></div>
              <div className="form-row">
                <label>
                  Source title
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "video" ? "e.g. My creator workshop" : "e.g. My podcast transcript"} />
                </label>
                <label>
                  Content type
                  <select value={kind} onChange={(event) => {
                    const nextKind = event.target.value as SourceKind;
                    setKind(nextKind);
                    setError("");
                    if (nextKind !== "video") setVideoFile(null);
                  }}>
                    <option value="document">Document</option>
                    <option value="video">Video file</option>
                    <option value="audio">Audio transcript</option>
                  </select>
                </label>
              </div>
              {kind === "video" ? (
                <label className="video-picker">
                  Video file
                  <span className={videoFile ? "file-drop selected" : "file-drop"}>
                    <UploadCloud aria-hidden="true" />
                    <span>
                      <strong>{videoFile?.name ?? "Choose a video from your device"}</strong>
                      <small>{videoFile ? `${formatBytes(videoFile.size)} · staged locally` : "MP4, WebM, or QuickTime · up to 250 MB"}</small>
                    </span>
                    <input
                      aria-label="Video file"
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setVideoFile(file);
                        setError("");
                        if (file && !title) setTitle(file.name.replace(/\.[^.]+$/, ""));
                      }}
                    />
                  </span>
                  <span className="processing-explainer"><Clock3 /> This zero-cost prototype stages metadata only. The source stays in processing and cannot answer questions until a creator-owned or self-hosted transcription route is connected.</span>
                </label>
              ) : (
                <label>
                  Extracted content
                  <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste text or a transcript to simulate scanning, chunking, and retrieval…" rows={5} />
                </label>
              )}
              <fieldset>
                <legend>Who can use this source?</legend>
                <label className={visibility === "preview" ? "radio-card selected" : "radio-card"}>
                  <input type="radio" name="visibility" checked={visibility === "preview"} onChange={() => setVisibility("preview")} />
                  <LockKeyhole aria-hidden="true" />
                  <span><strong>Preview only</strong><small>Private to the creator studio</small></span>
                </label>
                <label className={visibility === "public" ? "radio-card selected" : "radio-card"}>
                  <input type="radio" name="visibility" checked={visibility === "public"} onChange={() => setVisibility("public")} />
                  <Users aria-hidden="true" />
                  <span><strong>Public answers</strong><small>May be cited by the published agent</small></span>
                </label>
              </fieldset>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button className="button ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="button primary" type="submit">{kind === "video" ? <UploadCloud aria-hidden="true" /> : <Sparkles aria-hidden="true" />} {kind === "video" ? "Stage video" : "Process source"}</button>
              </div>
            </form>
          )}

          <div className="source-list">
            {sources.map((source) => (
              <article className="source-row" key={source.id}>
                <span className={`source-icon ${source.kind}`}>{sourceIcon(source.kind)}</span>
                <div className="source-copy">
                  <div className="source-title-line">
                    <h3>{source.title}</h3>
                    <span className={source.status === "processing" ? "ready-label processing" : "ready-label"}>
                      {source.status === "processing" ? <Clock3 /> : <Check />}
                      {source.status === "processing" ? "Awaiting transcription" : "Ready"}
                    </span>
                  </div>
                  <p>{source.status === "processing" ? source.processingDetail : `${source.chunks.length} sections`} · {formatBytes(source.size)} · {source.kind}</p>
                </div>
                <select
                  className={`visibility-select ${source.visibility}`}
                  aria-label={`Visibility for ${source.title}`}
                  value={source.visibility}
                  onChange={(event) => onVisibility(source.id, event.target.value as SourceVisibility)}
                >
                  <option value="preview">Preview only</option>
                  <option value="public">Public answers</option>
                </select>
                <button className="icon-button danger" type="button" aria-label={`Delete ${source.title}`} onClick={() => onDelete(source.id)}><Trash2 /></button>
              </article>
            ))}
          </div>
        </section>

        <aside className="studio-sidebar">
          <section className="content-panel privacy-panel">
            <div className="privacy-icon"><ShieldCheck aria-hidden="true" /></div>
            <h2>Private by default</h2>
            <p>Original files and full transcripts are never exposed by publishing an agent.</p>
            <ul>
              <li><Check /> Explicit source approval</li>
              <li><Check /> Tenant-isolated retrieval</li>
              <li><Check /> Immediate source disable</li>
              <li><Check /> No training without opt-in</li>
            </ul>
          </section>
          <section className="content-panel settings-panel">
            <div className="mini-label">Agent behavior</div>
            <dl>
              <div><dt>Tone</dt><dd>{agent.tone}</dd></div>
              <div><dt>Boundary</dt><dd>{agent.boundaries}</dd></div>
            </dl>
            <button className="route-link" type="button" onClick={onCustomize}><Palette /> Customize tone & behavior <ChevronRight /></button>
            <button className="route-link" type="button" onClick={onRoute}><Cable /> Configure response routing <ChevronRight /></button>
          </section>
        </aside>
      </div>
    </div>
  );
}

const STYLE_PRESETS: Array<{
  id: StylePreset;
  name: string;
  description: string;
  tone: string;
}> = [
  { id: "warm", name: "Warm mentor", description: "Encouraging, practical, and human", tone: "Warm, concise, encouraging, and specific" },
  { id: "direct", name: "Direct strategist", description: "Decisive, crisp, and action-oriented", tone: "Direct, concise, decisive, and practical" },
  { id: "curious", name: "Curious teacher", description: "Reflective, explanatory, and question-led", tone: "Curious, educational, reflective, and clear" },
  { id: "custom", name: "Custom voice", description: "Describe the creator's distinct style", tone: "Distinctive and faithful to the creator's approved examples" },
];

function stylePreview(
  preset: StylePreset,
  length: ResponseLength,
  signaturePhrases: string[],
) {
  const lead = preset === "direct"
    ? "Start here:"
    : preset === "curious"
      ? "A useful way to think about it:"
      : preset === "warm"
        ? "Let's make this practical:"
        : "Based on the approved content:";
  const sentences = [
    "Publish one durable idea each week.",
    "Turn it into one short video and three conversation prompts.",
    "Measure meaningful replies and saves instead of raw impressions.",
  ];
  const limit = length === "short" ? 1 : length === "deep" ? 3 : 2;
  return `${lead} ${sentences.slice(0, limit).join(" ")}${signaturePhrases[0] ? ` ${signaturePhrases[0]}` : ""}`;
}

function Customization({
  agent,
  onSave,
  onPreview,
}: {
  agent: Agent;
  onSave: (patch: Partial<Pick<Agent, "tone" | "stylePreset" | "responseLength" | "signaturePhrases" | "prohibitedTopics" | "boundaries" | "greeting">>) => void;
  onPreview: () => void;
}) {
  const [stylePreset, setStylePreset] = useState(agent.stylePreset);
  const [responseLength, setResponseLength] = useState(agent.responseLength);
  const [tone, setTone] = useState(agent.tone);
  const [signatureText, setSignatureText] = useState(agent.signaturePhrases.join("\n"));
  const [prohibitedText, setProhibitedText] = useState(agent.prohibitedTopics.join("\n"));
  const [boundaries, setBoundaries] = useState(agent.boundaries);
  const [greeting, setGreeting] = useState(agent.greeting);
  const signaturePhrases = signatureText.split("\n").map((value) => value.trim()).filter(Boolean);
  const prohibitedTopics = prohibitedText.split("\n").map((value) => value.trim()).filter(Boolean);
  const preview = stylePreview(stylePreset, responseLength, signaturePhrases);

  const choosePreset = (preset: typeof STYLE_PRESETS[number]) => {
    setStylePreset(preset.id);
    if (preset.id !== "custom") setTone(preset.tone);
  };

  return (
    <div className="workspace customization-workspace">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><Palette /> Customization studio</div>
          <h1>Shape how the agent speaks</h1>
          <p>Knowledge stays grounded in approved sources. These controls shape delivery, boundaries, and recognizable language without changing the underlying facts.</p>
        </div>
        <div className="heading-actions">
          <span className="status-chip healthy"><span /> Published · v{agent.version}</span>
          <button className="button secondary" type="button" onClick={onPreview}>Open chat preview <ChevronRight /></button>
        </div>
      </section>

      <form className="customization-grid" onSubmit={(event) => {
        event.preventDefault();
        onSave({ stylePreset, responseLength, tone, signaturePhrases, prohibitedTopics, boundaries, greeting });
      }}>
        <div className="customization-controls">
          <section className="content-panel customization-section">
            <div className="section-heading"><div><h2>Voice preset</h2><p>Start with a direction, then refine the language.</p></div></div>
            <div className="preset-grid">
              {STYLE_PRESETS.map((preset) => (
                <label className={stylePreset === preset.id ? "preset-option selected" : "preset-option"} key={preset.id}>
                  <input type="radio" name="style-preset" checked={stylePreset === preset.id} onChange={() => choosePreset(preset)} />
                  <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
                  {stylePreset === preset.id && <Check aria-hidden="true" />}
                </label>
              ))}
            </div>
            <label className="custom-field">
              Tone description
              <textarea rows={3} value={tone} onChange={(event) => { setTone(event.target.value); setStylePreset("custom"); }} />
            </label>
          </section>

          <section className="content-panel customization-section">
            <div className="section-heading"><div><h2>Answer behavior</h2><p>Control depth, signature language, and hard boundaries.</p></div></div>
            <fieldset className="length-control">
              <legend>Response depth</legend>
              {(["short", "balanced", "deep"] as ResponseLength[]).map((length) => (
                <label className={responseLength === length ? "selected" : ""} key={length}>
                  <input type="radio" name="response-length" checked={responseLength === length} onChange={() => setResponseLength(length)} />
                  <span>{length === "short" ? "Short" : length === "balanced" ? "Balanced" : "Deep dive"}</span>
                </label>
              ))}
            </fieldset>
            <div className="custom-field-row">
              <label className="custom-field">
                Signature phrases <span>one per line</span>
                <textarea rows={4} value={signatureText} onChange={(event) => setSignatureText(event.target.value)} placeholder="Make the next step small enough to start." />
              </label>
              <label className="custom-field">
                Prohibited topics <span>one per line</span>
                <textarea rows={4} value={prohibitedText} onChange={(event) => setProhibitedText(event.target.value)} placeholder="Private relationships" />
              </label>
            </div>
            <label className="custom-field">
              Welcome message
              <input value={greeting} onChange={(event) => setGreeting(event.target.value)} />
            </label>
            <label className="custom-field">
              Behavioral boundaries
              <textarea rows={3} value={boundaries} onChange={(event) => setBoundaries(event.target.value)} />
            </label>
          </section>
        </div>

        <aside className="customization-preview">
          <section className="content-panel preview-card">
            <div className="preview-card-header"><span>Live zero-cost preview</span><span className="memory-badge"><LockKeyhole /> No AI call</span></div>
            <div className="preview-question"><MessageCircle /><span><small>Audience asks</small>How often should I publish?</span></div>
            <div className="preview-answer"><div className="agent-avatar"><Sparkles /></div><div><small>{STYLE_PRESETS.find((preset) => preset.id === stylePreset)?.name} · {responseLength}</small><p>{preview}</p><button type="button" className="citation"><FileText /><span><strong>The Sustainable Content System</strong><small>Section 1</small></span><ChevronRight /></button></div></div>
            <div className="knowledge-lock"><ShieldCheck /><span><strong>Knowledge unchanged</strong>Only phrasing and depth change. The cited source remains the same.</span></div>
          </section>
          <button className="button primary save-customization" type="submit"><Check /> Save customization as v{agent.version + 1}</button>
        </aside>
      </form>
    </div>
  );
}

function Preview({
  runtime,
  route,
  onBack,
  onMessage,
}: {
  runtime: ReturnType<typeof createRuntime>;
  route: AgentRoute;
  onBack: () => void;
  onMessage: () => void;
}) {
  const [audienceId, setAudienceId] = useState<AudienceId>("maya");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const agent = runtime.engine.getAgent(runtime.agentId);
  const conversation = runtime.engine.getConversation(runtime.conversations[audienceId], audienceId);

  const send = async (value: string) => {
    if (!value.trim()) return;
    setSending(true);
    try {
      const messageRequest = {
        agentId: runtime.agentId,
        conversationId: runtime.conversations[audienceId],
        userId: audienceId,
        question: value,
        idempotencyKey: `ui-${audienceId}-${Date.now()}`,
      };
      if (route.mode === "local") {
        runtime.engine.sendMessage(messageRequest);
      } else {
        await runtime.engine.sendMessageWithGenerator(
          messageRequest,
          (input) => invokeRemoteAgent({
            endpoint: route.endpoint,
            bearerToken: route.bearerToken,
          }, input),
        );
      }
      setQuestion("");
      setError("");
      onMessage();
    } catch (caught) {
      setError(caught instanceof CreatorAgentError ? caught.message : "Message failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="preview-workspace">
      <section className="preview-context">
        <div className="eyebrow"><MessageCircle /> Audience preview</div>
        <h1>Test the published experience</h1>
        <p>Each simulated audience member has an isolated conversation. Switch people to verify their messages never mix.</p>
        <div className="audience-picker" role="group" aria-label="Simulated audience member">
          {AUDIENCE.map((person) => (
            <button className={audienceId === person.id ? "person selected" : "person"} key={person.id} type="button" onClick={() => setAudienceId(person.id)}>
              <span className={`person-avatar ${person.color}`}>{person.name.slice(0, 1)}</span>
              <span>{person.name}</span>
              {audienceId === person.id && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="privacy-note"><ShieldCheck /><span><strong>Conversation isolation on</strong> Messages are scoped to this audience member and agent.</span></div>
        <button className="button ghost back-button" type="button" onClick={onBack}>← Back to studio</button>
      </section>

      <section className="phone-stage">
        <div className="phone" aria-label="Mobile audience chat preview">
          <div className="phone-status"><span>9:41</span><span>● ●●</span></div>
          <div className="chat-header">
            <div className="agent-avatar"><Sparkles /></div>
            <div><strong>{agent.name}</strong><span><i /> AI agent · grounded in 2 sources</span></div>
          </div>
          <div className={route.mode === "local" ? "disclosure" : "disclosure remote"}>
            {route.mode === "local" ? <Bot /> : <Cable />}
            {route.mode === "local"
              ? "Deterministic local demo · no AI/API calls or token charges."
              : "Answers are routed to the user-owned endpoint shown in Route settings."}
          </div>
          <div className="messages" aria-live="polite">
            {conversation.messages.length === 0 ? (
              <EmptyChat greeting={agent.greeting} onPrompt={(prompt) => { void send(prompt); }} />
            ) : (
              conversation.messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))
            )}
          </div>
          {error && <div className="chat-error">{error}</div>}
          <form className="composer" onSubmit={(event) => { event.preventDefault(); send(question); }}>
            <input aria-label="Message" value={question} disabled={sending} onChange={(event) => setQuestion(event.target.value)} placeholder={sending ? "Waiting for routed agent…" : "Ask about Ari's content…"} />
            <button type="submit" aria-label="Send message" disabled={sending}><Send /></button>
          </form>
        </div>
      </section>
    </div>
  );
}

function EmptyChat({ greeting, onPrompt }: { greeting: string; onPrompt: (prompt: string) => void }) {
  const prompts = [
    "How often should I publish?",
    "How do I understand my audience?",
    "What should I measure?",
  ];
  return (
    <div className="empty-chat">
      <div className="empty-spark"><Sparkles /></div>
      <h2>{greeting}</h2>
      <p>Answers stay grounded in Ari's approved content and show their sources.</p>
      <div className="prompt-list">
        {prompts.map((prompt) => <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}<ChevronRight /></button>)}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: Conversation["messages"][number] }) {
  return (
    <article className={`bubble ${message.role}`}>
      <p>{message.content}</p>
      {message.citations.map((citation) => (
        <button className="citation" type="button" key={`${message.id}-${citation.sourceId}`}>
          <FileText /><span><strong>{citation.title}</strong><small>{citation.location}</small></span><ChevronRight />
        </button>
      ))}
    </article>
  );
}

function Routing({
  route,
  onChange,
}: {
  route: AgentRoute;
  onChange: (route: AgentRoute) => void;
}) {
  const [mode, setMode] = useState<AgentRoute["mode"]>(route.mode);
  const [endpoint, setEndpoint] = useState(
    route.mode === "remote"
      ? route.endpoint
      : "http://127.0.0.1:4310/v1/respond",
  );
  const [bearerToken, setBearerToken] = useState(
    route.mode === "remote" ? route.bearerToken : "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const activate = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "local") {
      onChange({ mode: "local" });
      setError("");
      return;
    }
    if (!confirmed) {
      setError("Confirm endpoint ownership and processing before routing messages.");
      return;
    }
    try {
      new URL(endpoint);
      onChange({ mode: "remote", endpoint: endpoint.trim(), bearerToken });
      setError("");
    } catch {
      setError("Enter a valid endpoint URL.");
    }
  };

  return (
    <div className="workspace routing-workspace">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><Cable /> Response routing</div>
          <h1>Choose who runs the answer</h1>
          <p>Creator Agent owns retrieval and privacy. The selected response engine receives only approved excerpts for the current question.</p>
        </div>
        <span className={route.mode === "local" ? "status-chip healthy" : "status-chip warning"}>
          <span /> {route.mode === "local" ? "Local zero-cost route active" : "User-owned endpoint active"}
        </span>
      </section>

      <form className="route-grid" onSubmit={activate}>
        <section className="content-panel route-options">
          <h2>Response engine</h2>
          <label className={mode === "local" ? "route-option selected" : "route-option"}>
            <input type="radio" name="route-mode" checked={mode === "local"} onChange={() => setMode("local")} />
            <span className="route-option-icon local"><LockKeyhole /></span>
            <span><strong>Local deterministic</strong><small>Default · no network, model, token, or usage cost</small></span>
            <span className="route-cost free">$0</span>
          </label>
          <label className={mode === "remote" ? "route-option selected" : "route-option"}>
            <input type="radio" name="route-mode" checked={mode === "remote"} onChange={() => setMode("remote")} />
            <span className="route-option-icon remote"><Server /></span>
            <span><strong>User-owned agent endpoint</strong><small>Explicit BYOA route · endpoint owner pays any model cost</small></span>
            <span className="route-cost">BYOA</span>
          </label>

          <div className="route-recommendation">
            <ShieldCheck />
            <span><strong>Recommended E2E path</strong>Run the included local reference agent with <code>npm run dev:e2e</code>. It exercises the full HTTP route and reports zero AI calls.</span>
          </div>
        </section>

        <section className={mode === "remote" ? "content-panel endpoint-panel" : "content-panel endpoint-panel disabled"}>
          <div className="section-heading">
            <div><h2>Endpoint connection</h2><p>Credentials remain in memory and reset when the page reloads.</p></div>
            <span className="memory-badge"><LockKeyhole /> Not persisted</span>
          </div>
          <label>
            Agent endpoint
            <input type="url" value={endpoint} disabled={mode !== "remote"} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://your-agent.example.com/respond" />
          </label>
          <label>
            Bearer token <span>(optional)</span>
            <input type="password" autoComplete="off" value={bearerToken} disabled={mode !== "remote"} onChange={(event) => setBearerToken(event.target.value)} placeholder="Held in memory for this tab only" />
          </label>
          <div className="payload-contract">
            <div><span>Sent</span><p>Question, last 10 messages, agent instructions, and up to 4 approved excerpts</p></div>
            <div><span>Never sent</span><p>Original files, preview-only sources, unrelated conversations, or platform credentials</p></div>
          </div>
          <label className="route-confirm">
            <input type="checkbox" checked={confirmed} disabled={mode !== "remote"} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I own or trust this endpoint and understand its operator controls processing and any model charges.</span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="route-actions">
            {mode === "remote" && (
              <button className="button secondary" type="button" onClick={() => {
                setEndpoint("http://127.0.0.1:4310/v1/respond");
                setBearerToken("");
              }}>Use zero-cost local endpoint</button>
            )}
            <button className="button primary" type="submit" disabled={mode === "remote" && (!confirmed || !endpoint.trim())}>
              {mode === "local" ? "Activate local route" : "Activate user-owned route"}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}

function LoadLab() {
  const [activeUsers, setActiveUsers] = useState(120);
  const [popularShare, setPopularShare] = useState(70);
  const [platformConcurrency, setPlatformConcurrency] = useState(24);
  const [maxQueue, setMaxQueue] = useState(80);
  const result = useMemo(
    () => simulateConcurrentChat({
      activeUsers,
      messagesPerUser: 2,
      agentCount: 5,
      popularAgentShare: popularShare / 100,
      platformConcurrency,
      perAgentConcurrency: 8,
      maxQueuePerAgent: maxQueue,
      serviceTimeMs: 750,
    }),
    [activeUsers, maxQueue, platformConcurrency, popularShare],
  );
  const maxTimeline = Math.max(...result.timeline.map((point) => point.active), 1);

  return (
    <div className="workspace load-workspace">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><CircleGauge /> Multi-user simulator</div>
          <h1>Load & fairness lab</h1>
          <p>Explore how bounded queues protect the platform when one creator suddenly becomes popular.</p>
        </div>
        <span className={result.rejected > 0 ? "status-chip warning" : "status-chip healthy"}>
          <span /> {result.rejected > 0 ? "Graceful overload active" : "Within capacity"}
        </span>
      </section>

      <div className="metric-grid">
        <Metric label="Requests" value={result.totalRequests.toLocaleString()} detail={`${activeUsers} concurrent people`} />
        <Metric label="Completed" value={result.completed.toLocaleString()} detail={`${result.rejected} rejected with Retry-After`} />
        <Metric label="p95 latency" value={`${(result.p95LatencyMs / 1000).toFixed(1)}s`} detail={`${result.peakConcurrency} peak streams`} />
        <Metric label="Fairness" value={`${Math.round(result.fairnessIndex * 100)}%`} detail="Normalized service ratio" />
      </div>

      <div className="load-grid">
        <section className="content-panel control-panel">
          <h2>Traffic controls</h2>
          <Range label="Active audience members" value={activeUsers} min={10} max={500} step={10} onChange={setActiveUsers} />
          <Range label="Traffic to popular agent" value={popularShare} suffix="%" min={20} max={95} step={5} onChange={setPopularShare} />
          <Range label="Platform concurrent streams" value={platformConcurrency} min={4} max={80} step={4} onChange={setPlatformConcurrency} />
          <Range label="Queue per agent" value={maxQueue} min={0} max={200} step={10} onChange={setMaxQueue} />
          <div className="load-policy"><ShieldCheck /><span><strong>Fairness policy</strong> Each agent receives at most 8 simultaneous generations. Excess work waits in a bounded queue or receives a retryable response.</span></div>
        </section>

        <section className="content-panel timeline-panel">
          <div className="section-heading"><div><h2>Active generations</h2><p>Each bar is one 750 ms service window.</p></div><span className="tiny-legend"><i /> Active streams</span></div>
          <div className="bar-chart" role="img" aria-label={`Load simulation with ${result.peakConcurrency} peak active streams`}>
            {result.timeline.slice(0, 28).map((point) => (
              <div className="bar-column" key={point.timeMs}>
                <div className="bar" style={{ height: `${Math.max(5, (point.active / maxTimeline) * 100)}%` }}><span>{point.active}</span></div>
              </div>
            ))}
          </div>
          <div className="chart-axis"><span>Start</span><span>Service windows</span><span>{((result.timeline.at(-1)?.timeMs ?? 0) / 1000).toFixed(1)}s</span></div>
          <div className="agent-table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>Requested</th><th>Completed</th><th>Rejected</th><th>Max wait</th></tr></thead>
              <tbody>
                {result.agents.map((agent, index) => (
                  <tr key={agent.agentId}>
                    <td><span className={index === 0 ? "agent-dot popular" : "agent-dot"} />{index === 0 ? "Popular agent" : `Agent ${index + 1}`}</td>
                    <td>{agent.requested}</td><td>{agent.completed}</td><td>{agent.rejected}</td><td>{(agent.maxLatencyMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function Range({ label, value, suffix = "", min, max, step, onChange }: { label: string; value: number; suffix?: string; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="range-control">
      <span><strong>{label}</strong><output>{value}{suffix}</output></span>
      <input aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
      <small><span>{min}{suffix}</span><span>{max}{suffix}</span></small>
    </label>
  );
}
