import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CreatorAuthProvider, RequireAuthentication, resolveAuthConfiguration } from "./auth";
import "./styles.css";

const authConfiguration = resolveAuthConfiguration({
  VITE_AUTH_MODE: import.meta.env.VITE_AUTH_MODE,
  VITE_AUTH0_DOMAIN: import.meta.env.VITE_AUTH0_DOMAIN,
  VITE_AUTH0_CLIENT_ID: import.meta.env.VITE_AUTH0_CLIENT_ID,
  VITE_AUTH0_AUDIENCE: import.meta.env.VITE_AUTH0_AUDIENCE,
}, import.meta.env.DEV);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CreatorAuthProvider configuration={authConfiguration}>
      <RequireAuthentication>
        <App />
      </RequireAuthentication>
    </CreatorAuthProvider>
  </StrictMode>,
);
