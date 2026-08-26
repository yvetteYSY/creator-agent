// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalAuthProvider,
  RequireAuthentication,
  resolveAuthConfiguration,
  useCreatorAuth,
} from "./auth";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function ProtectedFixture() {
  const auth = useCreatorAuth();
  return (
    <section>
      <p>Protected workspace for {auth.user!.id}</p>
      <button type="button" onClick={() => void auth.logout()}>End session</button>
    </section>
  );
}

describe("managed OIDC configuration", () => {
  it("uses an explicit local session only during development", () => {
    expect(resolveAuthConfiguration({}, true)).toEqual({ mode: "local" });
    expect(resolveAuthConfiguration({ VITE_AUTH_MODE: "local" }, false).error)
      .toMatch(/disabled in production/i);
  });

  it("fails closed when production Auth0 configuration is missing", () => {
    const configuration = resolveAuthConfiguration({}, false);

    expect(configuration.mode).toBe("auth0");
    expect(configuration.error).toMatch(/domain.*client/i);
  });

  it("accepts public Auth0 SPA settings without a client secret", () => {
    expect(resolveAuthConfiguration({
      VITE_AUTH_MODE: "auth0",
      VITE_AUTH0_DOMAIN: " tenant.us.auth0.com ",
      VITE_AUTH0_CLIENT_ID: " spa-client-id ",
      VITE_AUTH0_AUDIENCE: " https://api.creator-agent.example ",
    }, false)).toEqual({
      mode: "auth0",
      domain: "tenant.us.auth0.com",
      clientId: "spa-client-id",
      audience: "https://api.creator-agent.example",
    });
  });

  it("gates and restores the local developer session without a network request", () => {
    render(
      <LocalAuthProvider initialAuthenticated={false}>
        <RequireAuthentication><ProtectedFixture /></RequireAuthentication>
      </LocalAuthProvider>,
    );

    expect(screen.queryByText(/protected workspace/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /start local session/i }));
    expect(screen.getByText(/local\|creator-demo/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /end session/i }));
    expect(screen.getByRole("button", { name: /start local session/i })).toBeTruthy();
  });
});
