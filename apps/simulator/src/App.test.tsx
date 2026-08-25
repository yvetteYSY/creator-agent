// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Creator Agent simulator", () => {
  it("shows source privacy controls and opens the isolated audience preview", () => {
    render(<App />);

    expect(screen.getByText("Private by default")).toBeTruthy();
    expect(screen.getByText("Unreleased launch notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open audience preview/i }));
    expect(screen.getByText("Test the published experience")).toBeTruthy();
    expect(screen.getByText("Conversation isolation on")).toBeTruthy();
  });

  it("answers a suggested question with a citation", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open audience preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /how often should i publish/i }));

    expect(screen.getByText(/one durable idea each week/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /the sustainable content system/i })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("updates load results when traffic increases", () => {
    render(<App />);
    const loadButtons = screen.getAllByRole("button", { name: /load/i });
    fireEvent.click(loadButtons[0]);
    const userSlider = screen.getByRole("slider", { name: /active audience members/i });
    fireEvent.change(userSlider, { target: { value: "500" } });

    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("Graceful overload active")).toBeTruthy();
  });
});
