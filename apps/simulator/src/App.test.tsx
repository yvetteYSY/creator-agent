// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { LocalAuthProvider } from "./auth";
import { CreatorWorkspaceProvider, RequireCreatorWorkspace } from "./creator-workspace";

function renderApp() {
  return render(
    <LocalAuthProvider initialAuthenticated>
      <CreatorWorkspaceProvider configuration={{ mode: "local" }}>
        <RequireCreatorWorkspace><App /></RequireCreatorWorkspace>
      </CreatorWorkspaceProvider>
    </LocalAuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Creator Agent simulator", () => {
  it("shows source privacy controls and opens the isolated audience preview", () => {
    renderApp();

    expect(screen.getByText("Private by default")).toBeTruthy();
    expect(screen.getByText("Unreleased launch notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open audience preview/i }));
    expect(screen.getByText("Test the published experience")).toBeTruthy();
    expect(screen.getByText("Conversation isolation on")).toBeTruthy();
  });

  it("answers a suggested question with a citation", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /open audience preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /how often should i publish/i }));

    expect(screen.getByText(/one durable idea each week/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /the sustainable content system/i })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("updates load results when traffic increases", () => {
    renderApp();
    const loadButtons = screen.getAllByRole("button", { name: /load/i });
    fireEvent.click(loadButtons[0]);
    const userSlider = screen.getByRole("slider", { name: /active audience members/i });
    fireEvent.change(userSlider, { target: { value: "500" } });

    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("Graceful overload active")).toBeTruthy();
  });

  it("previews and saves creator style changes without an AI call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderApp();

    fireEvent.click(screen.getAllByRole("button", { name: "Customize" })[0]);
    fireEvent.click(screen.getByRole("radio", { name: /direct strategist/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Short" }));
    fireEvent.change(screen.getByRole("textbox", { name: /signature phrases/i }), {
      target: { value: "Ship the useful version." },
    });

    expect(screen.getByText(/Start here: Publish one durable idea each week. Ship the useful version./i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /save customization as v3/i }));
    expect(screen.getByText(/customization saved as a new agent version/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stages a video file locally without uploading or claiming it is ready", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    fireEvent.change(screen.getByLabelText(/content type/i), { target: { value: "video" } });
    const file = new File(["local video bytes"], "creator-workshop.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText(/^video file$/i), { target: { files: [file] } });

    expect(screen.getByDisplayValue("creator-workshop")).toBeTruthy();
    expect(screen.getByText(/staged locally/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /stage video/i }));

    expect(screen.getByText("creator-workshop")).toBeTruthy();
    expect(screen.getByText(/awaiting transcription/i)).toBeTruthy();
    expect(screen.getByText(/remain unavailable to answers/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("processes a creator-provided WebVTT transcript locally with timestamped sections", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    fireEvent.change(screen.getByLabelText(/content type/i), { target: { value: "video" } });
    const video = new File(["local video bytes"], "workspace-guide.mp4", { type: "video/mp4" });
    const captions = new File([
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nWorkspaces keep panels organized.\n\n2\n00:00:05.000 --> 00:00:08.000\nChoose a workspace for each task.",
    ], "workspace-guide.en.vtt", { type: "text/vtt" });
    fireEvent.change(screen.getByLabelText(/^video file$/i), { target: { files: [video] } });
    fireEvent.change(screen.getByLabelText(/webvtt transcript/i), { target: { files: [captions] } });
    fireEvent.click(screen.getByRole("button", { name: /process video \+ transcript/i }));

    const title = await screen.findByText("workspace-guide");
    const row = title.closest("article");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Ready")).toBeTruthy();
    expect(within(row!).getByText(/2 timestamped sections/i)).toBeTruthy();
    expect(screen.getByText(/processed locally without an ai call/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Visibility for workspace-guide"), { target: { value: "public" } });
    fireEvent.click(screen.getByRole("button", { name: /open audience preview/i }));
    expect(screen.getByText(/grounded in 3 sources/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes to an explicitly activated user endpoint without exposing private sources", async () => {
    const fetchSpy = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(JSON.stringify(body)).not.toContain("Unreleased launch notes");
      expect(JSON.stringify(body)).not.toContain("private draft");
      return new Response(
        JSON.stringify({
          answer: "Answer from the user-owned endpoint.",
          citations: [body.context[0].sourceId],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
    renderApp();

    fireEvent.click(screen.getAllByRole("button", { name: "Route" })[0]);
    fireEvent.click(screen.getByRole("radio", { name: /user-owned agent endpoint/i }));
    const activate = screen.getByRole("button", { name: /activate user-owned route/i });
    expect((activate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /i own or trust this endpoint/i }));
    expect((activate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(activate);

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /how often should i publish/i }));

    expect(await screen.findByText("Answer from the user-owned endpoint.")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/routed to the user-owned endpoint/i)).toBeTruthy();
  });
});
